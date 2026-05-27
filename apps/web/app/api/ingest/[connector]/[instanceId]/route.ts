/**
 * Webhook receiver — the single entry point for ALL connectors.
 *
 *   URL shape:
 *     POST /api/ingest/[connector]/[instanceId]?token=...
 *
 *   Lifecycle:
 *     1. Look up the ConnectorInstance by ID + workspaceId.
 *     2. Find the adapter for `connector` (e.g. "stub", "slack").
 *     3. adapter.verifyWebhook(req, instance) — must return true.
 *     4. adapter.parseWebhook(req, instance) → NormalizedEvent[].
 *     5. ingestEvents() — dedup, resolve, persist, audit.
 *     6. Return 200 with a small JSON summary.
 *
 *   Returns 200 even when the body produces zero events, as long as the
 *   signature was valid — connectors often send "ping" payloads.
 */

import { NextResponse } from 'next/server';
import { prisma, ConnectorStatus } from '@pcs/db';
import { getAdapter, type ParsedWebhookRequest } from '@pcs/connectors';
import { addIngestJob } from '@pcs/queue';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: { connector: string; instanceId: string } },
) {
  const adapter = getAdapter(params.connector);
  if (!adapter) {
    return NextResponse.json({ error: 'Unknown connector' }, { status: 404 });
  }

  const instance = await prisma.connectorInstance.findUnique({
    where: { id: params.instanceId },
  });
  if (!instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }
  if (instance.status === ConnectorStatus.PAUSED || instance.status === ConnectorStatus.DISCONNECTED) {
    return NextResponse.json({ error: 'Connector is not active' }, { status: 409 });
  }

  // Parse the request — keep both raw body (for HMAC) and JSON.
  const rawBody = await req.text();
  let json: unknown = undefined;
  try {
    if (rawBody) json = JSON.parse(rawBody);
  } catch {
    /* not JSON — adapters can handle form-encoded etc. */
  }

  const url = new URL(req.url);
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (query[k] = v));

  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));

  const parsedReq: ParsedWebhookRequest = { headers, rawBody, json, query };

  let verified = false;
  try {
    verified = await adapter.verifyWebhook(parsedReq, instance);
  } catch (err) {
    console.error('verifyWebhook threw', err);
  }
  if (!verified) {
    await prisma.auditLog.create({
      data: {
        workspaceId: instance.workspaceId,
        action: 'ingest.unauthorized',
        targetType: 'connector_instance',
        targetId: instance.id,
        metadata: { connector: params.connector },
      },
    });
    return NextResponse.json({ error: 'Signature verification failed' }, { status: 401 });
  }

  let events: Awaited<ReturnType<typeof adapter.parseWebhook>>;
  try {
    events = await adapter.parseWebhook(parsedReq, instance);
  } catch (err) {
    console.error('parseWebhook threw', err);
    await prisma.connectorInstance.update({
      where: { id: instance.id },
      data: {
        status: ConnectorStatus.ERROR,
        lastError: err instanceof Error ? err.message : String(err),
      },
    });
    return NextResponse.json({ error: 'Parse failed' }, { status: 400 });
  }

  // M9: enqueue instead of processing inline. The worker handles dedup,
  // resolution, persistence, audit-logging, and bumps lastSyncAt + status.
  const enqueued = await addIngestJob({
    workspaceId: instance.workspaceId,
    events,
    connectorInstanceId: instance.id,
    source: `${params.connector}:${instance.id.slice(0, 10)}`,
  }).catch((err) => {
    console.error(`[${params.connector}] enqueue failed — Redis down?`, err);
    return null;
  });

  if (!enqueued) {
    // Return 500 so the source system retries. We've verified the signature,
    // we'd rather lose-and-retry than acknowledge-and-drop.
    return NextResponse.json({ error: 'Could not enqueue job' }, { status: 500 });
  }

  return NextResponse.json({
    received: events.length,
    enqueued: enqueued.enqueued,
    jobId: enqueued.jobId,
  });
}

// Some sources do a GET-based handshake / verification ping. Allow it.
export async function GET(
  _req: Request,
  { params }: { params: { connector: string; instanceId: string } },
) {
  const adapter = getAdapter(params.connector);
  if (!adapter) return NextResponse.json({ error: 'Unknown connector' }, { status: 404 });
  return NextResponse.json({ ok: true, connector: adapter.descriptor.kind, instanceId: params.instanceId });
}
