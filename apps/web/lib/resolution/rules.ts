/**
 * Stage 1: deterministic rules.
 *
 * These are the cheap, high-confidence signals. If any of these fire with
 * high confidence, we skip the vector/LLM stages entirely.
 *
 * Rules tried in order:
 *   1. Connector resolution hints (explicit clientId/problemId from adapter)
 *   2. #PRB-<id> reference in body
 *   3. Thread continuity (sibling event already attached)
 *   4. TICKET_ID mention match (M11.6) — engineering ticket IDs extracted
 *      from GitHub branch names / PR titles cluster onto whatever Problem
 *      the first event carrying that same ID was attached to.
 *   5. Actor email domain → Client.domain
 */

import { prisma, ResolutionMethod, MentionKind } from '@pcs/db';
import type { NormalizedEvent } from '@pcs/connectors';

export interface RuleHit {
  clientId: string | null;
  problemId: string | null;
  confidence: number;
  reason: string;
  method: ResolutionMethod;
}

export async function applyRules(
  workspaceId: string,
  ev: NormalizedEvent,
): Promise<RuleHit | null> {
  // ---- 1. Explicit connector hints ----
  const hint = ev.resolutionHints;
  if (hint?.problemId) {
    const problem = await prisma.problem.findFirst({
      where: { id: hint.problemId, workspaceId },
      select: { id: true, clientId: true },
    });
    if (problem) {
      return {
        clientId: problem.clientId,
        problemId: problem.id,
        confidence: 1,
        reason: 'Connector hint: explicit problemId',
        method: ResolutionMethod.EXPLICIT,
      };
    }
  }
  if (hint?.clientId) {
    const client = await prisma.client.findFirst({
      where: { id: hint.clientId, workspaceId },
      select: { id: true },
    });
    if (client) {
      return {
        clientId: client.id,
        problemId: null,
        confidence: 0.95,
        reason: 'Connector hint: explicit clientId',
        method: ResolutionMethod.EXPLICIT,
      };
    }
  }

  // ---- 2. #PRB-<id> reference ----
  const prbMatch = ev.body.match(/#PRB-([a-z0-9_-]+)/i);
  if (prbMatch) {
    const problem = await prisma.problem.findFirst({
      where: { id: prbMatch[1]!, workspaceId },
      select: { id: true, clientId: true },
    });
    if (problem) {
      return {
        clientId: problem.clientId,
        problemId: problem.id,
        confidence: 1,
        reason: `Body referenced #PRB-${prbMatch[1]}`,
        method: ResolutionMethod.RULE,
      };
    }
  }

  // ---- 3. Thread continuity ----
  if (ev.parentThreadId) {
    const sibling = await prisma.event.findFirst({
      where: {
        workspaceId,
        source: ev.source,
        parentThreadId: ev.parentThreadId,
        problemId: { not: null },
      },
      orderBy: { timestamp: 'asc' },
      select: { clientId: true, problemId: true },
    });
    if (sibling?.problemId) {
      return {
        clientId: sibling.clientId,
        problemId: sibling.problemId,
        confidence: 0.95,
        reason: 'Thread continuity — sibling event already attached',
        method: ResolutionMethod.RULE,
      };
    }
  }

  // ---- 4. TICKET_ID mention match (M11.6) ----
  // GitHub adapter populates ev.mentions with TICKET_IDs extracted from the
  // PR's branch ref + title + body. If any of them have been seen on a
  // previously-resolved event in this workspace, that event's Problem is
  // the answer — deterministic by construction (ISS-280035 only ever refers
  // to one engineering ticket).
  //
  // We deliberately query mentions in the order the parser produced them
  // (branch ref first, then title/body, then comments) so that the most
  // authoritative reference wins. The first hit short-circuits.
  const ticketMentions = (ev.mentions ?? []).filter(
    (m) => m.kind === MentionKind.TICKET_ID && m.value.length > 0,
  );
  for (const m of ticketMentions) {
    // Most recent event carrying this ID is most likely the "current"
    // Problem if the ID has ever been reused (Shipsy's convention says it
    // shouldn't be, but we tie-break safely anyway).
    const prior = await prisma.event.findFirst({
      where: {
        workspaceId,
        problemId: { not: null },
        mentions: {
          some: { kind: MentionKind.TICKET_ID, value: m.value },
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { clientId: true, problemId: true },
    });
    if (prior?.problemId) {
      return {
        clientId: prior.clientId,
        problemId: prior.problemId,
        confidence: 0.95,
        reason: `Ticket ID ${m.value} previously linked to this Problem`,
        method: ResolutionMethod.RULE,
      };
    }
  }

  // ---- 5. Actor email domain → Client.domain ----
  if (ev.actor.email) {
    const domain = ev.actor.email.split('@')[1]?.toLowerCase();
    if (domain) {
      const client = await prisma.client.findFirst({
        where: { workspaceId, domain },
        select: { id: true },
      });
      if (client) {
        return {
          clientId: client.id,
          problemId: null,
          confidence: 0.9,
          reason: `Actor email domain matched Client.domain (${domain})`,
          method: ResolutionMethod.RULE,
        };
      }
    }
  }

  return null;
}
