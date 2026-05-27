/**
 * Slack-specific webhook receiver (M9 — async).
 *
 * Lifecycle:
 *   1. Verify HMAC signature against SLACK_SIGNING_SECRET.
 *   2. Echo back url_verification challenge if Slack is verifying the URL.
 *   3. Look up the ConnectorInstance by `team_id`.
 *   4. Resolve any new Slack user IDs to email+name via users.info (cheap,
 *      cached in instance.config.userIndex so repeat users don't hit Slack
 *      again).
 *   5. Hand the normalized event(s) to addIngestJob() — the background
 *      worker drains the queue and runs the heavy ingest pipeline.
 *   6. Return 200 with a small "received/enqueued" summary.
 *
 * Why M9 split it this way: Slack expects a 200 within ~3 seconds. The
 * resolver's LLM judge can take 30–60s on a small local model, which used
 * to block this response. Now we acknowledge fast and process async.
 */

import { NextResponse } from 'next/server';
import { prisma, ConnectorStatus, SourceKind } from '@pcs/db';
import {
  verifySlackSignature,
  type SlackEventEnvelope,
  parseSlackEnvelope,
  collectSlackUserIds,
} from '@pcs/connectors';
import { addIngestJob } from '@pcs/queue';
import { decryptFromString } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

interface SlackInstanceConfig {
  teamId: string;
  teamName?: string;
  teamDomain?: string;
  userIndex?: Record<string, { email?: string; name?: string }>;
  botTokenEnc?: string;
}

export async function POST(req: Request) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET ?? '';
  if (!signingSecret) {
    console.error('[slack] SLACK_SIGNING_SECRET not set — rejecting');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const rawBody = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));

  const verification = verifySlackSignature({
    signingSecret,
    rawBody,
    timestampHeader: headers['x-slack-request-timestamp'],
    signatureHeader: headers['x-slack-signature'],
  });
  if (!verification.ok) {
    console.warn('[slack] signature failed:', verification.reason);
    return NextResponse.json({ error: 'Signature verification failed' }, { status: 401 });
  }

  let env: SlackEventEnvelope;
  try {
    env = JSON.parse(rawBody) as SlackEventEnvelope;
  } catch {
    return NextResponse.json({ error: 'Body is not JSON' }, { status: 400 });
  }

  // URL verification — Slack confirms the endpoint owns the URL.
  if (env.type === 'url_verification' && env.challenge) {
    console.log('[slack] URL verification challenge received — echoing');
    return NextResponse.json({ challenge: env.challenge });
  }

  if (env.type !== 'event_callback') {
    return NextResponse.json({ ok: true, ignored: env.type });
  }

  const teamId = env.team_id;
  if (!teamId) {
    return NextResponse.json({ error: 'Missing team_id' }, { status: 400 });
  }

  const instance = await findInstanceForTeam(teamId);
  if (!instance) {
    console.warn(`[slack] event for unknown team_id=${teamId} — ignoring`);
    return NextResponse.json({ ok: true, ignored: 'unknown_team' });
  }
  if (
    instance.status === ConnectorStatus.PAUSED ||
    instance.status === ConnectorStatus.DISCONNECTED
  ) {
    return NextResponse.json({ ok: true, ignored: 'connector_inactive' });
  }

  const config = (instance.config ?? {}) as SlackInstanceConfig;

  // -------- Cheap, synchronous user enrichment --------
  // We want events arriving in the worker to have actor.email already filled
  // (so the email-domain rule can fire). users.info is fast (≈200ms cached
  // via our own userIndex). Keeping it here avoids needing the bot token on
  // the worker side.
  const userIds = collectSlackUserIds(env);
  const userIndex = { ...(config.userIndex ?? {}) };
  let userIndexDirty = false;

  if (userIds.length && config.botTokenEnc) {
    let botToken: string | null = null;
    try {
      botToken = decryptFromString(config.botTokenEnc);
    } catch (err) {
      console.error('[slack] failed to decrypt bot token — proceeding without email resolution', err);
    }
    if (botToken) {
      for (const uid of userIds) {
        if (userIndex[uid]) continue;
        const info = await fetchSlackUserInfo(botToken, uid);
        if (info) {
          userIndex[uid] = info;
          userIndexDirty = true;
        }
      }
    }
  }

  if (userIndexDirty) {
    await prisma.connectorInstance.update({
      where: { id: instance.id },
      data: { config: { ...config, userIndex } },
    });
  }

  // -------- Parse envelope → NormalizedEvent(s) --------
  const events = parseSlackEnvelope(env, {
    teamId,
    teamDomain: config.teamDomain,
    userIndex,
  });

  // -------- Enqueue for the worker. Webhook returns immediately. --------
  const enqueued = await addIngestJob({
    workspaceId: instance.workspaceId,
    events,
    connectorInstanceId: instance.id,
    source: `slack:${teamId}`,
  }).catch((err) => {
    console.error('[slack] enqueue failed — Redis down?', err);
    return null;
  });

  if (!enqueued) {
    // Don't ACK Slack — let them retry. Returning 500 means Slack will
    // re-deliver this event later, so we don't lose it.
    return NextResponse.json({ error: 'Could not enqueue job' }, { status: 500 });
  }

  return NextResponse.json({
    received: events.length,
    enqueued: enqueued.enqueued,
    jobId: enqueued.jobId,
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    connector: 'slack',
    note: 'Slack should POST events here. URL verification happens via POST.',
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findInstanceForTeam(teamId: string) {
  const all = await prisma.connectorInstance.findMany({
    where: { kind: SourceKind.SLACK },
  });
  return all.find((inst) => (inst.config as any)?.teamId === teamId) ?? null;
}

interface SlackUserResponse {
  ok?: boolean;
  user?: {
    id?: string;
    name?: string;
    real_name?: string;
    profile?: { email?: string; real_name?: string; display_name?: string };
  };
  error?: string;
}

async function fetchSlackUserInfo(
  botToken: string,
  userId: string,
): Promise<{ email?: string; name?: string } | null> {
  try {
    const res = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`, {
      headers: { authorization: `Bearer ${botToken}` },
    });
    if (!res.ok) {
      console.warn(`[slack] users.info HTTP ${res.status} for ${userId}`);
      return null;
    }
    const j = (await res.json()) as SlackUserResponse;
    if (!j.ok || !j.user) {
      console.warn(`[slack] users.info error for ${userId}: ${j.error ?? 'unknown'}`);
      return null;
    }
    return {
      email: j.user.profile?.email,
      name:
        j.user.profile?.display_name ||
        j.user.profile?.real_name ||
        j.user.real_name ||
        j.user.name,
    };
  } catch (err) {
    console.error('[slack] users.info threw', err);
    return null;
  }
}
