'use server';

/**
 * Gmail sync server action (M8b).
 *
 *   syncGmailInstance(formData)
 *
 * Reads NEW Gmail messages from the connected account, parses them into
 * NormalizedEvents, and enqueues an ingest job per batch. Idempotent — the
 * ingest pipeline dedups by (source, sourceId), so re-running a sync over a
 * window we've already seen is harmless.
 *
 * For MVP this uses time-window polling: fetch messages with the Gmail
 * search query `after:YYYY/MM/DD` based on the instance's lastSyncAt (or
 * a default of 1 day ago on first sync). When auto-polling lands in M8b.5
 * we'll switch to history.list for true incremental sync.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, MembershipRole, SourceKind, ConnectorStatus } from '@pcs/db';
import { parseGmailMessage, type GmailMessage } from '@pcs/connectors';
import { addIngestJob } from '@pcs/queue';
import { getSession } from '@/lib/auth';
import { requireMinRole } from '@/lib/rbac';
import { decryptFromString } from '@/lib/crypto';

const Schema = z.object({ instanceId: z.string().min(1) });

export type SyncGmailResult =
  | {
      ok: true;
      fetched: number;
      enqueued: number;
      durationMs: number;
      ownerEmail: string;
      windowStart: string;
    }
  | { ok: false; error: string; code: 'not_found' | 'no_token' | 'gmail_api' | 'forbidden' };

interface GmailInstanceConfig {
  ownerEmail?: string;
  ownerName?: string | null;
  refreshTokenEnc?: string;
  historyId?: string | null;
  scope?: string | null;
  installedAt?: string;
  /** Custom override for how far back to look on a given sync (ISO string). */
  syncSince?: string | null;
}

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MAX_MESSAGES_PER_SYNC = 50; // keep first runs sane

export async function syncGmailInstance(formData: FormData): Promise<SyncGmailResult> {
  const session = await getSession();
  requireMinRole(session, MembershipRole.MEMBER);

  const parsed = Schema.safeParse({ instanceId: formData.get('instanceId') });
  if (!parsed.success) {
    return { ok: false, error: 'Missing instanceId', code: 'not_found' };
  }
  const startedAt = Date.now();

  const instance = await prisma.connectorInstance.findFirst({
    where: {
      id: parsed.data.instanceId,
      workspaceId: session.workspace.id,
      kind: SourceKind.GMAIL,
    },
  });
  if (!instance) return { ok: false, error: 'Gmail instance not found', code: 'not_found' };

  const config = (instance.config ?? {}) as GmailInstanceConfig;
  if (!config.refreshTokenEnc || !config.ownerEmail) {
    return {
      ok: false,
      error: 'Gmail instance has no stored refresh token. Re-install the connector.',
      code: 'no_token',
    };
  }

  // ---- 1. Refresh the access token ----
  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(decryptFromString(config.refreshTokenEnc));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markErrored(instance.id, msg);
    return { ok: false, error: `Token refresh failed: ${msg}`, code: 'no_token' };
  }

  // ---- 2. Decide the sync window ----
  // First sync (lastSyncAt null) → look back 1 day to keep the first run fast.
  // Subsequent syncs → from lastSyncAt minus a 10 minute safety overlap (in
  // case clocks differ slightly with Google).
  const now = Date.now();
  const overlapMs = 10 * 60 * 1000;
  const windowStartMs = instance.lastSyncAt
    ? Math.max(instance.lastSyncAt.getTime() - overlapMs, now - 14 * 24 * 60 * 60 * 1000)
    : now - 1 * 24 * 60 * 60 * 1000;
  const windowStartDate = new Date(windowStartMs);
  const query = `after:${formatGmailDate(windowStartDate)}`;

  console.log(
    `[gmail/sync] instance=${instance.id} owner=${config.ownerEmail} query="${query}"`,
  );

  // ---- 3. Fetch message IDs ----
  let messageIds: string[];
  try {
    messageIds = await listMessageIds(accessToken, query, MAX_MESSAGES_PER_SYNC);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markErrored(instance.id, msg);
    return { ok: false, error: `messages.list failed: ${msg}`, code: 'gmail_api' };
  }
  console.log(`[gmail/sync] fetched ${messageIds.length} message id(s)`);

  if (messageIds.length === 0) {
    await markSynced(instance.id);
    return {
      ok: true,
      fetched: 0,
      enqueued: 0,
      durationMs: Date.now() - startedAt,
      ownerEmail: config.ownerEmail,
      windowStart: windowStartDate.toISOString(),
    };
  }

  // ---- 4. Fetch each message's full content + parse ----
  const events = [];
  for (const id of messageIds) {
    try {
      const msg = await getMessage(accessToken, id);
      if (!msg) continue;
      const parsed = parseGmailMessage(msg, {
        ownerEmail: config.ownerEmail,
        skipFromSelf: false, // include self-sent — useful for tracking outbound problem-related emails
      });
      events.push(...parsed);
    } catch (err) {
      console.error(`[gmail/sync] failed to fetch msg=${id}:`, err);
      // continue — one bad message shouldn't kill the whole sync
    }
  }

  // ---- 5. Enqueue ----
  const enqueued = await addIngestJob({
    workspaceId: instance.workspaceId,
    events,
    connectorInstanceId: instance.id,
    source: `gmail:${config.ownerEmail}`,
  }).catch((err) => {
    console.error('[gmail/sync] enqueue failed:', err);
    return null;
  });

  if (!enqueued) {
    return {
      ok: false,
      error: 'Could not enqueue ingest job — is Redis up?',
      code: 'gmail_api',
    };
  }

  await markSynced(instance.id);
  await prisma.auditLog.create({
    data: {
      workspaceId: instance.workspaceId,
      actorUserId: session.user.id,
      action: 'gmail.sync',
      targetType: 'connector_instance',
      targetId: instance.id,
      metadata: {
        fetched: messageIds.length,
        enqueued: enqueued.enqueued,
        windowStart: windowStartDate.toISOString(),
      },
    },
  });

  revalidatePath(`/connectors/${instance.id}`);
  revalidatePath('/inbox');

  return {
    ok: true,
    fetched: messageIds.length,
    enqueued: enqueued.enqueued,
    durationMs: Date.now() - startedAt,
    ownerEmail: config.ownerEmail,
    windowStart: windowStartDate.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Gmail API helpers
// ---------------------------------------------------------------------------

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GMAIL_CLIENT_ID/SECRET not configured');
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const json = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!json.access_token) {
    throw new Error(`${json.error ?? 'unknown'}: ${json.error_description ?? ''}`);
  }
  return json.access_token;
}

async function listMessageIds(
  accessToken: string,
  query: string,
  limit: number,
): Promise<string[]> {
  const url = new URL(`${GMAIL_BASE}/users/me/messages`);
  url.searchParams.set('q', query);
  url.searchParams.set('maxResults', String(Math.min(limit, 500)));
  const res = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
  const json = (await res.json()) as { messages?: Array<{ id: string }> };
  return (json.messages ?? []).slice(0, limit).map((m) => m.id);
}

async function getMessage(accessToken: string, id: string): Promise<GmailMessage | null> {
  const url = new URL(`${GMAIL_BASE}/users/me/messages/${id}`);
  url.searchParams.set('format', 'full');
  const res = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`HTTP ${res.status} on message ${id}`);
  }
  return (await res.json()) as GmailMessage;
}

// ---------------------------------------------------------------------------
// Instance state helpers
// ---------------------------------------------------------------------------

async function markSynced(instanceId: string) {
  await prisma.connectorInstance.update({
    where: { id: instanceId },
    data: { lastSyncAt: new Date(), lastError: null, status: ConnectorStatus.ACTIVE },
  });
}

async function markErrored(instanceId: string, message: string) {
  await prisma.connectorInstance
    .update({
      where: { id: instanceId },
      data: { status: ConnectorStatus.ERROR, lastError: message.slice(0, 1000) },
    })
    .catch(() => {});
}

function formatGmailDate(d: Date): string {
  // Gmail's `after:` search operator uses YYYY/MM/DD.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}
