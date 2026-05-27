/**
 * Resolution stub for M5.
 *
 * M6 replaces this with the real resolver (rules → vector → LLM judge).
 * For now we apply a few cheap deterministic rules so the test flow proves
 * the pipeline can attach events to the right Client and Problem.
 *
 *   Rules attempted, in order:
 *     1. Explicit hints from the connector (resolutionHints.{clientId,problemId})
 *        — adapters may pre-resolve. The stub passes them through.
 *     2. `#PRB-<problemId>` substring in the body → that Problem.
 *     3. Thread continuity — if any event in this Slack thread is already
 *        attached, inherit its Client + Problem.
 *     4. Actor email domain → Client.domain match.
 *
 *   Anything not resolved by these rules is persisted unattached and shows
 *   up in the inbox (`/inbox`) for the user to triage. M6's resolver will
 *   take a swing at those automatically.
 */

import { prisma, ResolutionMethod, type Event } from '@pcs/db';
import type { NormalizedEvent } from '@pcs/connectors';

export interface StubResolutionResult {
  clientId: string | null;
  problemId: string | null;
  clientConfidence: number;
  problemConfidence: number;
  method: ResolutionMethod;
  reason: string | null;
}

export async function resolveWithStub(
  workspaceId: string,
  ev: NormalizedEvent,
): Promise<StubResolutionResult> {
  // ---------------------------------------------------------------------------
  // 1. Honor explicit hints from the connector.
  // ---------------------------------------------------------------------------
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
        clientConfidence: 1,
        problemConfidence: 1,
        method: ResolutionMethod.EXPLICIT,
        reason: 'Connector hint: explicit problemId',
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
        clientConfidence: 1,
        problemConfidence: 0,
        method: ResolutionMethod.EXPLICIT,
        reason: 'Connector hint: explicit clientId',
      };
    }
  }

  // ---------------------------------------------------------------------------
  // 2. #PRB-<id> reference in the body.
  // ---------------------------------------------------------------------------
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
        clientConfidence: 1,
        problemConfidence: 1,
        method: ResolutionMethod.RULE,
        reason: `Body referenced #PRB-${prbMatch[1]}`,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Thread continuity.
  // ---------------------------------------------------------------------------
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
        clientConfidence: 0.95,
        problemConfidence: 0.95,
        method: ResolutionMethod.RULE,
        reason: 'Thread continuity — sibling event already attached',
      };
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Actor email domain → Client.domain.
  // ---------------------------------------------------------------------------
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
          clientConfidence: 0.9,
          problemConfidence: 0,
          method: ResolutionMethod.RULE,
          reason: `Actor email domain matched Client.domain (${domain})`,
        };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Nothing matched — leave for M6 / human triage.
  // ---------------------------------------------------------------------------
  return {
    clientId: null,
    problemId: null,
    clientConfidence: 0,
    problemConfidence: 0,
    method: ResolutionMethod.RULE,
    reason: 'No deterministic rule matched',
  };
}
