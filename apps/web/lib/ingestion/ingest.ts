/**
 * The ingest pipeline.
 *
 *   For each NormalizedEvent:
 *     1. Dedup by (workspaceId, source, sourceId).
 *     2. M9.6: classify noise — short messages, OOO, calendar invites,
 *        social chatter, marketing footers. Noise events are persisted
 *        (audit completeness) but tagged with a `pcs:noise` mention and
 *        skip the resolver + embedding (no LLM calls, no vector pollution).
 *     3. Resolve client + problem via lib/resolution/resolve (M6).
 *     4. Persist the Event row with resolved fields and a flag indicating
 *        whether it needs a human confirm.
 *     5. Best-effort: embed the event body and store the vector.
 *     6. Audit-log "event.ingest" (or "event.noise_filtered" if step 2 fired).
 */

import { prisma, ResolutionMethod } from '@pcs/db';
import type { NormalizedEvent } from '@pcs/connectors';
import { resolve } from '@/lib/resolution/resolve';
import { embedText, embeddingsAvailable } from '@/lib/intelligence/embeddings';
import { persistEventEmbedding } from '@/lib/resolution/vector';
import { classifyNoise } from './noise';
import { classifyNoiseSemantic } from './noise-semantic';

export interface IngestResult {
  ingested: string[]; // event IDs (signal only — noise events not counted here)
  duplicates: number;
  resolved: number; // both clientId and problemId attached
  spawned: number; // new Problems auto-created during resolution
  needsConfirm: number; // attached but flagged for human confirm
  noiseFiltered: number; // M9.6 — events caught by the noise pre-filter
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
    noiseFiltered: 0,
  };

  // Workspace-specific noise patterns will be added when we land the
  // settings UI in M10. For now the built-in pattern library is the source
  // of truth. Pass an empty extras list.
  const extraPatterns: Array<string | RegExp> = [];

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

    // ---------- M9.6 + M9.6.1: noise pre-filter (hybrid regex → semantic) ----------
    // Two-stage filter:
    //   1. Regex pattern match — free, instant, catches obvious structural
    //      cases (OOO, calendar invites, one-word reactions).
    //   2. If regex passes, semantic classifier — ~200ms embedding compare
    //      against centroids of noise/signal anchors. Catches "what are
    //      plans for outing this weekend" and similar tonal noise that
    //      regex can't see.
    let noiseReason: string | null = null;
    const noiseRegex = classifyNoise(ev.body, { extraPatterns });
    if (noiseRegex.isNoise) {
      noiseReason = `regex: ${noiseRegex.reason}`;
    } else {
      // Regex passed — fall to semantic check.
      const noiseSemantic = await classifyNoiseSemantic(ev.body);
      if (noiseSemantic.isNoise) {
        noiseReason = `semantic: ${noiseSemantic.reason}`;
      }
    }

    if (noiseReason) {
      const preview = ev.body.slice(0, 60).replace(/\s+/g, ' ');
      console.log(
        `[noise] ✗ filtered ${ev.source}/${ev.kind} "${preview}…" → ${noiseReason}`,
      );

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
          // No client / problem resolution attempted — noise events skip the
          // resolver entirely.
          resolutionMethod: ResolutionMethod.RULE,
          resolutionReason: `Noise filter (M9.6): ${noiseReason}`,
          mentions: { create: [{ kind: 'HASHTAG', value: 'pcs:noise' }] },
        },
        select: { id: true },
      });

      await prisma.auditLog.create({
        data: {
          workspaceId,
          actorUserId: context.actorUserId ?? null,
          action: 'event.noise_filtered',
          targetType: 'event',
          targetId: created.id,
          metadata: {
            source: ev.source,
            sourceId: ev.sourceId,
            reason: noiseReason,
            connectorInstanceId: context.connectorInstanceId ?? null,
          },
        },
      });

      result.noiseFiltered++;
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
