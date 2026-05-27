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
 *   4. Actor email domain → Client.domain
 */

import { prisma, ResolutionMethod } from '@pcs/db';
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

  // ---- 4. Actor email domain → Client.domain ----
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
