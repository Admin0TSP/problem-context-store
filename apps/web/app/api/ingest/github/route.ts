/**
 * GitHub App webhook receiver (M11.5).
 *
 * Mirrors the Slack receiver: ONE app-wide URL that all installs deliver to,
 * with HMAC signature verification + per-event tenant lookup.
 *
 * Lifecycle:
 *   1. Verify HMAC-SHA256 against GITHUB_APP_WEBHOOK_SECRET (app-wide, not
 *      per-install — every install delivers to this same endpoint).
 *   2. Handle the `ping` event GitHub fires when the App is registered.
 *   3. Read `installation.id` from the payload and look up the
 *      ConnectorInstance with that installationId in config.
 *   4. Call the adapter's parseWebhook() to get NormalizedEvent[].
 *   5. Hand events to addIngestJob() — the background worker drains the
 *      queue and runs the heavy ingest pipeline.
 *   6. Return 200 with a small "received/enqueued" summary.
 *
 * GitHub expects a ~10s response window; the queue handoff keeps us well
 * under that even with the resolver running 30s+ LLM judgments.
 *
 * Headers GitHub sends on every delivery (we read the first two):
 *   x-github-event:            "pull_request" | "issues" | "issue_comment" | …
 *   x-hub-signature-256:       "sha256=<hex>"
 *   x-github-delivery:         "<uuid>"   (useful for log correlation)
 *   x-github-hook-installation-target-id:    the App's numeric ID
 *   x-github-hook-installation-target-type:  "integration"
 */

import { NextResponse } from 'next/server';
import { prisma, ConnectorStatus, SourceKind } from '@pcs/db';
import {
  verifyGitHubSignature,
  type GitHubWebhookPayload,
  parseGitHubEvent,
  getInstallationIdFromPayload,
} from '@pcs/connectors';
import { addIngestJob } from '@pcs/queue';

export const dynamic = 'force-dynamic';

interface GitHubInstanceConfig {
  installationId?: number;
  accountLogin?: string;
  accountType?: string;
  repositorySelection?: 'all' | 'selected' | string;
  includeBots?: boolean;
}

export async function POST(req: Request) {
  const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET ?? '';
  if (!webhookSecret) {
    console.error('[github] GITHUB_APP_WEBHOOK_SECRET not set — rejecting');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const rawBody = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));

  const eventName = headers['x-github-event'] ?? '';
  const deliveryId = headers['x-github-delivery'] ?? '(no-delivery-id)';

  // -------- Signature verification --------
  const verification = verifyGitHubSignature({
    webhookSecret,
    rawBody,
    signatureHeader: headers['x-hub-signature-256'],
  });
  if (!verification.ok) {
    console.warn(
      `[github] signature failed for delivery=${deliveryId} event=${eventName}: ${verification.reason}`,
    );
    return NextResponse.json({ error: 'Signature verification failed' }, { status: 401 });
  }

  // -------- Parse body --------
  let payload: GitHubWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as GitHubWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Body is not JSON' }, { status: 400 });
  }

  // -------- ping: GitHub fires this when the App is registered / saved --------
  // Ping payloads have a `zen` string + `hook_id` but no `installation` on
  // app-registration pings (only on install pings). Either way we just ACK.
  if (eventName === 'ping') {
    console.log(`[github] ping received delivery=${deliveryId}`);
    return NextResponse.json({ ok: true, ping: true });
  }

  // -------- Installation lifecycle events --------
  // When a user installs / uninstalls / changes repo selection on the App,
  // GitHub fires `installation` and `installation_repositories`. We don't
  // ingest these into the resolver — they're handled in the OAuth callback
  // flow + a future webhook handler. For now, ACK silently.
  if (eventName === 'installation' || eventName === 'installation_repositories') {
    console.log(
      `[github] ${eventName} delivery=${deliveryId} action=${payload.action ?? '?'} — ack-only`,
    );
    return NextResponse.json({ ok: true, lifecycle: eventName, action: payload.action });
  }

  // -------- Look up tenant by installation.id --------
  const installationId = getInstallationIdFromPayload(payload);
  if (installationId == null) {
    console.warn(
      `[github] event delivery=${deliveryId} event=${eventName} missing installation.id — ignoring`,
    );
    return NextResponse.json({ ok: true, ignored: 'no_installation_id' });
  }

  const instance = await findInstanceForInstallation(installationId);
  if (!instance) {
    console.warn(
      `[github] event delivery=${deliveryId} event=${eventName} for unknown installationId=${installationId} — ignoring`,
    );
    return NextResponse.json({ ok: true, ignored: 'unknown_installation' });
  }
  if (
    instance.status === ConnectorStatus.PAUSED ||
    instance.status === ConnectorStatus.DISCONNECTED
  ) {
    return NextResponse.json({ ok: true, ignored: 'connector_inactive' });
  }

  const config = (instance.config ?? {}) as GitHubInstanceConfig;

  // -------- Parse → NormalizedEvent[] --------
  const events = parseGitHubEvent(payload, {
    eventName,
    includeBots: !!config.includeBots,
  });

  // The parser silently drops events we don't ingest (pushes, stars, etc.)
  // and ping events. ACK and move on — but don't bother enqueueing an
  // empty batch.
  if (events.length === 0) {
    return NextResponse.json({ received: 0, enqueued: 0, jobId: null });
  }

  // -------- Enqueue --------
  const enqueued = await addIngestJob({
    workspaceId: instance.workspaceId,
    events,
    connectorInstanceId: instance.id,
    source: `github:${installationId}`,
  }).catch((err) => {
    console.error('[github] enqueue failed — Redis down?', err);
    return null;
  });

  if (!enqueued) {
    // Returning 500 makes GitHub retry per its webhook retry policy (up to
    // 3 attempts over ~30 min). Better than silently dropping events.
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
    connector: 'github',
    note: 'GitHub App should POST events here. Configure GITHUB_APP_WEBHOOK_SECRET to match the App settings.',
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findInstanceForInstallation(installationId: number) {
  // Prisma's JSON filter is awkward across DB engines for typed equality on
  // a numeric field, so we fetch the small set of GitHub instances and
  // filter in JS. There won't be many (one per workspace per install). If
  // this ever gets hot, drop a generated column or a unique index on
  // (kind, config->>'installationId') and switch to a parameterized query.
  const all = await prisma.connectorInstance.findMany({
    where: { kind: SourceKind.GITHUB },
  });
  return (
    all.find((inst) => Number((inst.config as any)?.installationId) === installationId) ?? null
  );
}
