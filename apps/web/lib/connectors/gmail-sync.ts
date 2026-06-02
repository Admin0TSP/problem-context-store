/**
 * Gmail sync — core function (worker-friendly, no session).
 *
 *   syncGmailInstanceCore({ instanceId, workspaceId, actorUserId?, source })
 *
 * Shared by:
 *   - The user-facing server action `syncGmailInstance` in app/actions/gmail.ts
 *     (which wraps this with getSession() + requireMinRole()).
 *   - The background worker that fires this on a repeating schedule
 *     (M8b.5 — apps/web/scripts/worker.ts).
 *
 * Why split:
 *   The action depends on Next.js's getSession() which requires HTTP context.
 *   The worker has no HTTP — it's a long-running Node process. Both want
 *   identical sync behavior. Extracting the core into a pure function lets
 *   both call it without conditional auth branches polluting the logic.
 *
 * Behavior:
 *   - Refreshes the OAuth access token using the encrypted refresh token.
 *   - Computes a sync window (after:YYYY/MM/DD) from lastSyncAt minus a
 *     10-min safety overlap, capped at 14 days back.
 *   - Calls Gmail messages.list, then messages.get for each ID (full body).
 *   - Parses to NormalizedEvent[], enqueues to ingestQueue.
 *   - Updates ConnectorInstance.lastSyncAt + status + audit-logs.
 *
 *   Dedup is the ingest pipeline's job — re-syncing a window we've already
 *   seen produces 0 ingested + N duplicates, no harm done.
 */

import { prisma, SourceKind, ConnectorStatus } from '@pcs/db';
import { parseGmailMessage, type GmailMessage } from '@pcs/connectors';
import { addIngestJob } from '@pcs/queue';
import { decryptFromString } from '@/lib/crypto';

export type SyncGmailCoreResult =
  | {
      ok: true;
      fetched: number;
      enqueued: number;
      durationMs: number;
      ownerEmail: string;
      windowStart: string;
    }
  | { ok: false; error: string; code: 'not_found' | 'no_token' | 'gmail_api' };

interface GmailInstanceConfig {
  ownerEmail?: string;
  ownerName?: string | null;
  refreshTokenEnc?: string;
  historyId?: string | null;
  scope?: string | null;
  installedAt?: string;
}

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MAX_MESSAGES_PER_SYNC = 50;

export async function syncGmailInstanceCore(args: {
  instanceId: string;
  workspaceId: string;
  /** User who triggered this sync. Null for system-driven (worker) syncs. */
  actorUserId?: string | null;
  /** Free-form tag for audit/log purposes — "manual" or "auto-poll". */
  source?: 'manual' | 'auto-poll';
}): Promise<SyncGmailCoreResult> {
  const startedAt = Date.now();
  const sourceTag = args.source ?? 'manual';

  const instance = await prisma.connectorInstance.findFirst({
    where: {
      id: args.instanceId,
      workspaceId: args.workspaceId,
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
  const now = Date.now();
  const overlapMs = 10 * 60 * 1000;
  const windowStartMs = instance.lastSyncAt
    ? Math.max(instance.lastSyncAt.getTime() - overlapMs, now - 14 * 24 * 60 * 60 * 1000)
    : now - 1 * 24 * 60 * 60 * 1000;
  const windowStartDate = new Date(windowStartMs);
  const query = `after:${formatGmailDate(windowStartDate)}`;

  console.log(
    `[gmail/sync:${sourceTag}] instance=${instance.id} owner=${config.ownerEmail} query="${query}"`,
  );

  // ---- 3. List message IDs ----
  let messageIds: string[];
  try {
    messageIds = await listMessageIds(accessToken, query, MAX_MESSAGES_PER_SYNC);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markErrored(instance.id, msg);
    return { ok: false, error: `messages.list failed: ${msg}`, code: 'gmail_api' };
  }
  console.log(`[gmail/sync:${sourceTag}] fetched ${messageIds.length} message id(s)`);

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

  // ---- 4. Fetch each message + parse ----
  const events = [];
  for (const id of messageIds) {
    try {
      const msg = await getMessage(accessToken, id);
      if (!msg) continue;
      const parsed = parseGmailMessage(msg, {
        ownerEmail: config.ownerEmail,
        skipFromSelf: false,
      });
      events.push(...parsed);
    } catch (err) {
      console.error(`[gmail/sync:${sourceTag}] failed to fetch msg=${id}:`, err);
    }
  }

  // ---- 5. Enqueue ingest job ----
  const enqueued = await addIngestJob({
    workspaceId: instance.workspaceId,
    events,
    connectorInstanceId: instance.id,
    source: `gmail:${config.ownerEmail}`,
  }).catch((err) => {
    console.error(`[gmail/sync:${sourceTag}] enqueue failed:`, err);
    return null;
  });

  if (!enqueued) {
    return { ok: false, error: 'Could not enqueue ingest job — is Redis up?', code: 'gmail_api' };
  }

  await markSynced(instance.id);
  await prisma.auditLog.create({
    data: {
      workspaceId: instance.workspaceId,
      actorUserId: args.actorUserId ?? null,
      action: sourceTag === 'auto-poll' ? 'gmail.sync.auto' : 'gmail.sync',
      targetType: 'connector_instance',
      targetId: instance.id,
      metadata: {
        fetched: messageIds.length,
        enqueued: enqueued.enqueued,
        windowStart: windowStartDate.toISOString(),
      },
    },
  });

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
// Internal helpers (private to this module)
// ---------------------------------------------------------------------------

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('GMAIL_CLIENT_ID/SECRET not configured');
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
  const json = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
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
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
  }
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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}
