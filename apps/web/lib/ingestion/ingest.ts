/**
 * The ingest pipeline.
 *
 *   For each NormalizedEvent:
 *     1. Dedup by (workspaceId, source, sourceId).
 *     2. Resolve client + problem via lib/resolution/resolve (M6).
 *     3. Persist the Event row with resolved fields and a flag indicating
 *        whether it needs a human confirm.
 *     4. Best-effort: embed the event body and store the vector.
 *     5. Audit-log "event.ingest".
 */

import { prisma } from '@pcs/db';
import type { NormalizedEvent } from '@pcs/connectors';
import { resolve } from '@/lib/resolution/resolve';
import { embedText, embeddingsAvailable } from '@/lib/intelligence/embeddings';
import { persistEventEmbedding } from '@/lib/resolution/vector';

export interface IngestResult {
  ingested: string[]; // event IDs
  duplicates: number;
  resolved: number; // both clientId and problemId attached
  spawned: number; // new Problems auto-created during resolution
  needsConfirm: number; // attached but flagged for human confirm
}

export async function ingestEvents(
  workspaceId: string,
  events: NormalizedEvent[],
  context: { connectorInstanceId?: string; actorUserId?: string },
): Promise<IngestResult> {
  const result: IngestResult = {
    ingested: [],
    duplicates: 0,
    resolved: 0,
    spawned: 0,
    needsConfirm: 0,
  };

  for (const ev of events) {
    const existing = await prisma.event.findUnique({
      where: {
        workspaceId_source_sourceId: {
          workspaceId,
          source: ev.source,
          sourceId: ev.sourceId,
        },
      },
      select: { id: true },
    });
    if (existing) {
      result.duplicates++;
      continue;
    }

    const r = await resolve(workspaceId, ev);

    const created = await prisma.event.create({
      data: {
        workspaceId,
        source: ev.source,
        sourceId: ev.sourceId,
        sourceUrl: ev.sourceUrl ?? null,
        kind: ev.kind,
        timestamp: ev.timestamp,
        actorName: ev.actor.name ?? null,
        actorEmail: ev.actor.email ?? null,
        actorSourceId: ev.actor.sourceId ?? null,
        body: ev.body,
        bodyHtml: ev.bodyHtml ?? null,
        parentThreadId: ev.parentThreadId ?? null,
        clientId: r.clientId,
        problemId: r.problemId,
        clientResolutionConfidence: r.clientConfidence || null,
        problemResolutionConfidence: r.problemConfidence || null,
        resolutionMethod: r.method,
        resolutionReason: r.reason,
        mentions: ev.mentions?.length
          ? { create: ev.mentions.map((m) => ({ kind: m.kind, value: m.value })) }
          : undefined,
      },
      select: { id: true },
    });

    result.ingested.push(created.id);
    if (r.clientId && r.problemId) result.resolved++;
    if (r.spawnedProblemId) result.spawned++;
    if (r.needsConfirm) result.needsConfirm++;

    // Best-effort embedding — fire and forget shape.
    if (embeddingsAvailable()) {
      try {
        const vec = await embedText(ev.body);
        if (vec) await persistEventEmbedding(created.id, vec);
      } catch (err) {
        console.error('Embedding event failed (non-fatal):', err);
      }
    }

    await prisma.auditLog.create({
      data: {
        workspaceId,
        actorUserId: context.actorUserId ?? null,
        action: 'event.ingest',
        targetType: 'event',
        targetId: created.id,
        metadata: {
          source: ev.source,
          sourceId: ev.sourceId,
          connectorInstanceId: context.connectorInstanceId ?? null,
          clientId: r.clientId,
          problemId: r.problemId,
          method: r.method,
          spawnedProblemId: r.spawnedProblemId ?? null,
          needsConfirm: r.needsConfirm,
        },
      },
    });
  }

  return result;
}

/**
 * Generate a random URL-safe token for webhook authentication.
 * Used when installing a connector.
 */
export function generateWebhookToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}
