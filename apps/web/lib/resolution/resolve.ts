/**
 * Resolution orchestrator — the public entry point of the resolver.
 *
 *   resolve(workspaceId, event) → ResolutionResult
 *
 * Stages tried in order:
 *   1. Rules (rules.ts) — explicit / deterministic. Returns ≥ 0.9 if hits.
 *   2. Client identification (rules + vector) if not yet known.
 *   3. Problem within client:
 *      a. Vector top-K candidates (vector.ts).
 *      b. If top similarity ≥ AUTO threshold and clearly ahead → use it.
 *      c. Else: LLM judge over top candidates (llm-judge.ts).
 *      d. LLM may say "new" → spawn a fresh Problem.
 *      e. LLM may say "uncertain" → leave for inbox.
 *
 * Confidence buckets (constants in @pcs/core):
 *   - ≥ RESOLUTION_AUTO_THRESHOLD (0.85)         → auto-attach, no flag.
 *   - 0.65 ≤ x < AUTO                            → auto-attach, needs confirm.
 *   - < 0.65                                     → don't attach.
 */

import { ResolutionMethod, Severity } from '@pcs/db';
import {
  RESOLUTION_AUTO_THRESHOLD,
  PROBLEM_CLUSTER_SIMILARITY_THRESHOLD,
} from '@pcs/core';
import type { NormalizedEvent } from '@pcs/connectors';
import { applyRules } from './rules';
import { findCandidateProblems, guessClientFromText } from './vector';
import { judgeWithLlm } from './llm-judge';
import { spawnProblem } from './spawn';
import { embeddingsAvailable } from '@/lib/intelligence/embeddings';
import { llmAvailable } from '@/lib/intelligence/llm';
import { prisma } from '@pcs/db';

/** Confidence below which we DO NOT auto-attach (event goes to inbox). */
const ATTACH_CONFIDENCE_FLOOR = 0.65;

/** When the best vector candidate is this far ahead of #2, we attach without LLM. */
const VECTOR_LEAD_MARGIN = 0.05;

/**
 * Minimum vector similarity required to TRUST an LLM "existing" pick.
 *
 * Why: small local LLMs (llama3.1:8b, qwen2.5:3b) are over-eager — they will
 * cheerfully report `existing` with confidence 0.85 when the event has only
 * tangential overlap with the picked candidate. The vector layer is a much
 * more reliable signal of "are these actually about the same thing".
 *
 * Anything below this floor → we ignore the LLM's "existing" decision and
 * treat the event as uncertain (lands in inbox with client identified but
 * no problem auto-attached). Empirically calibrated against M9 testing:
 *   sim 0.77–0.86 → correct matches  ✓ above floor
 *   sim 0.60–0.65 → incorrect over-eager matches  ✗ below floor
 */
const LLM_EXISTING_VECTOR_FLOOR = 0.7;

export interface ResolutionResult {
  clientId: string | null;
  problemId: string | null;
  clientConfidence: number;
  problemConfidence: number;
  method: ResolutionMethod;
  reason: string;
  /** Set when the resolver auto-created a new Problem for this event. */
  spawnedProblemId?: string;
  /** True when confidence is mid-range — show "please confirm" in UI. */
  needsConfirm: boolean;
}

export async function resolve(
  workspaceId: string,
  ev: NormalizedEvent,
): Promise<ResolutionResult> {
  const t0 = Date.now();
  const preview = ev.body.slice(0, 80).replace(/\s+/g, ' ');
  console.log(
    `\n[resolver] ───── ${ev.source}/${ev.kind} "${preview}${ev.body.length > 80 ? '…' : ''}"`,
  );

  // ---------------------------------------------------------------------------
  // Stage 1 — Rules
  // ---------------------------------------------------------------------------
  const ruleHit = await applyRules(workspaceId, ev);

  if (ruleHit) {
    console.log(
      `[resolver] rules → client=${ruleHit.clientId ?? 'null'} problem=${ruleHit.problemId ?? 'null'} ` +
        `conf=${ruleHit.confidence.toFixed(2)} (${ruleHit.reason})`,
    );
  } else {
    console.log('[resolver] rules → no hit');
  }

  // If rules fully resolved (both client AND problem with high confidence), done.
  if (ruleHit?.problemId && ruleHit.confidence >= RESOLUTION_AUTO_THRESHOLD) {
    console.log(
      `[resolver] ✓ DECISION: rule-attached problem=${ruleHit.problemId} ` +
        `conf=${ruleHit.confidence.toFixed(2)} (${Date.now() - t0}ms)\n`,
    );
    return {
      clientId: ruleHit.clientId,
      problemId: ruleHit.problemId,
      clientConfidence: ruleHit.confidence,
      problemConfidence: ruleHit.confidence,
      method: ruleHit.method,
      reason: ruleHit.reason,
      needsConfirm: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Client identification — use rule hit if available, otherwise vector-guess.
  // ---------------------------------------------------------------------------
  let clientId: string | null = ruleHit?.clientId ?? null;
  let clientConfidence: number = ruleHit?.clientId ? ruleHit.confidence : 0;
  let clientMethod: ResolutionMethod = ruleHit?.method ?? ResolutionMethod.RULE;
  let clientReason: string = ruleHit?.reason ?? '';

  if (!clientId && embeddingsAvailable()) {
    const guesses = await guessClientFromText(workspaceId, ev.body, 3);
    if (guesses.length === 0) {
      console.log('[resolver] client-guess → no candidates (no prior events embedded)');
    } else {
      console.log(
        '[resolver] client-guess top candidates:\n' +
          guesses
            .map(
              (g, i) =>
                `           ${i + 1}. sim=${g.similarity.toFixed(4)}  ${g.name}  (id=${g.id})`,
            )
            .join('\n'),
      );
    }
    const top = guesses[0];
    const runner = guesses[1];
    if (top && top.similarity >= PROBLEM_CLUSTER_SIMILARITY_THRESHOLD) {
      const ahead = !runner || top.similarity - runner.similarity >= VECTOR_LEAD_MARGIN;
      if (ahead) {
        clientId = top.id;
        clientConfidence = Math.min(top.similarity, 0.9);
        clientMethod = ResolutionMethod.VECTOR_MATCH;
        clientReason = `Vector-matched client ${top.name} (sim ${top.similarity.toFixed(2)})`;
        console.log(
          `[resolver] client-guess → picked ${top.name} (sim ${top.similarity.toFixed(4)}, ` +
            `threshold ${PROBLEM_CLUSTER_SIMILARITY_THRESHOLD}, lead-margin ${VECTOR_LEAD_MARGIN})`,
        );
      } else {
        console.log(
          `[resolver] client-guess → top ${top.name} sim ${top.similarity.toFixed(4)} ` +
            `did NOT lead runner-up by ≥ ${VECTOR_LEAD_MARGIN} (Δ=${(top.similarity - (runner?.similarity ?? 0)).toFixed(4)})`,
        );
      }
    } else if (top) {
      console.log(
        `[resolver] client-guess → top sim ${top.similarity.toFixed(4)} ` +
          `< threshold ${PROBLEM_CLUSTER_SIMILARITY_THRESHOLD}`,
      );
    }
  }

  // If we still don't know the client, we can't resolve the problem either.
  if (!clientId) {
    console.log(
      `[resolver] ✗ DECISION: no client → inbox (Client unknown) (${Date.now() - t0}ms)\n`,
    );
    return {
      clientId: null,
      problemId: null,
      clientConfidence: 0,
      problemConfidence: 0,
      method: ResolutionMethod.RULE,
      reason: 'No client could be resolved',
      needsConfirm: false,
    };
  }
  console.log(`[resolver] client resolved → id=${clientId} conf=${clientConfidence.toFixed(2)}`);

  // ---------------------------------------------------------------------------
  // Stage 2 — Vector match against the client's open Problems.
  // ---------------------------------------------------------------------------
  let chosenProblemId: string | null = null;
  let problemConfidence = 0;
  let problemMethod: ResolutionMethod = clientMethod;
  let problemReason = '';
  let spawnedProblemId: string | undefined;

  if (embeddingsAvailable()) {
    const candidates = await findCandidateProblems(workspaceId, clientId, ev.body, 5);
    if (candidates.length === 0) {
      console.log(
        '[resolver] problem-vector → 0 open Problems with embeddings for this client',
      );
    } else {
      console.log(
        '[resolver] problem-vector top candidates:\n' +
          candidates
            .map(
              (c, i) =>
                `           ${i + 1}. sim=${c.similarity.toFixed(4)}  "${c.title}"  (id=${c.id})`,
            )
            .join('\n') +
          `\n[resolver]   thresholds: auto≥${RESOLUTION_AUTO_THRESHOLD}, ` +
          `needs-confirm≥${ATTACH_CONFIDENCE_FLOOR}, lead-margin≥${VECTOR_LEAD_MARGIN}`,
      );
    }
    const top = candidates[0];
    const runner = candidates[1];

    if (top && top.similarity >= RESOLUTION_AUTO_THRESHOLD) {
      const ahead = !runner || top.similarity - runner.similarity >= VECTOR_LEAD_MARGIN;
      if (ahead) {
        chosenProblemId = top.id;
        problemConfidence = top.similarity;
        problemMethod = ResolutionMethod.VECTOR_MATCH;
        problemReason = `Vector match (sim ${top.similarity.toFixed(2)})`;
        console.log(
          `[resolver] problem-vector → AUTO-ATTACH "${top.title}" (sim ${top.similarity.toFixed(4)})`,
        );
      } else {
        console.log(
          `[resolver] problem-vector → top "${top.title}" sim ${top.similarity.toFixed(4)} ` +
            `did NOT lead runner-up by ≥ ${VECTOR_LEAD_MARGIN} ` +
            `(Δ=${(top.similarity - (runner?.similarity ?? 0)).toFixed(4)}) → LLM judge`,
        );
      }
    } else if (top) {
      console.log(
        `[resolver] problem-vector → top sim ${top.similarity.toFixed(4)} ` +
          `< auto-threshold ${RESOLUTION_AUTO_THRESHOLD} → LLM judge`,
      );
    }

    // ---------- Stage 3 — LLM judge if vector wasn't decisive ----------
    if (!chosenProblemId && llmAvailable()) {
      const client = await prisma.client.findUnique({
        where: { id: clientId },
        select: { name: true },
      });
      if (client) {
        // If we have candidates from vector match, hand them to the LLM with summaries.
        const candidateIds = candidates.map((c) => c.id);
        const candidateRows = await prisma.problem.findMany({
          where: { id: { in: candidateIds.length ? candidateIds : ['__none__'] } },
          select: { id: true, title: true, approachSummary: true, rootCauseSummary: true, description: true },
        });
        // Order to match the vector ranking.
        const candidateById = new Map(candidateRows.map((r) => [r.id, r] as const));
        const orderedCandidates = candidates
          .map((c) => {
            const row = candidateById.get(c.id);
            return row
              ? {
                  id: row.id,
                  title: row.title,
                  summary:
                    row.approachSummary ?? row.rootCauseSummary ?? row.description ?? null,
                }
              : null;
          })
          .filter((x): x is NonNullable<typeof x> => !!x);

        const tLlm = Date.now();
        console.log(`[resolver] LLM judge → calling… (${orderedCandidates.length} candidates)`);
        const judgement = await judgeWithLlm({
          event: ev,
          clientName: client.name,
          candidates: orderedCandidates,
        });
        console.log(
          `[resolver] LLM judge → ${judgement?.decision ?? 'no-response'} ` +
            `conf=${judgement?.confidence?.toFixed(2) ?? '—'} ` +
            `(${Date.now() - tLlm}ms)`,
        );

        if (judgement?.decision === 'existing') {
          const vectorMatch = candidates.find((c) => c.id === judgement.problemId);
          const vectorSim = vectorMatch ? vectorMatch.similarity : 0;

          if (vectorSim < LLM_EXISTING_VECTOR_FLOOR) {
            // The LLM thinks it's an existing problem, but the vector layer
            // disagrees strongly — the picked candidate has weak topical
            // similarity to the incoming event. Don't trust the LLM here;
            // small local models hallucinate matches when given a small
            // candidate list. Treat as uncertain so the event lands in the
            // inbox (client still identified) for human review.
            console.log(
              `[resolver] LLM picked existing "${vectorMatch?.title ?? judgement.problemId}" ` +
                `but vector sim=${vectorSim.toFixed(4)} < floor ${LLM_EXISTING_VECTOR_FLOOR} ` +
                `→ rejecting LLM, treating as uncertain (event → inbox)`,
            );
            problemReason =
              `LLM picked existing (${judgement.reason}) but vector similarity ` +
              `${vectorSim.toFixed(2)} is below floor ${LLM_EXISTING_VECTOR_FLOOR} — ` +
              `not auto-attaching`;
            // chosenProblemId stays null → event goes to inbox.
          } else {
            chosenProblemId = judgement.problemId;
            // Small local models often return confidence=0 even when they're
            // confident in the pick. If the LLM's pick is also a top vector
            // candidate above the floor, use the vector similarity as a
            // confidence floor — both signals agreeing is a stronger signal
            // than either alone.
            const LLM_AGREEMENT_FLOOR = 0.7;
            problemConfidence = Math.max(
              judgement.confidence,
              vectorSim,
              LLM_AGREEMENT_FLOOR,
            );
            if (problemConfidence !== judgement.confidence) {
              console.log(
                `[resolver] LLM said conf=${judgement.confidence.toFixed(2)} but vector backs ` +
                  `id=${judgement.problemId} at sim=${vectorSim.toFixed(4)} → ` +
                  `using effective conf=${problemConfidence.toFixed(4)}`,
              );
            }
            problemMethod = ResolutionMethod.LLM_JUDGE;
            problemReason = `LLM picked existing: ${judgement.reason}`;
          }
        } else if (judgement?.decision === 'new' && judgement.confidence >= ATTACH_CONFIDENCE_FLOOR) {
          const spawned = await spawnProblem({
            workspaceId,
            clientId,
            title: judgement.title,
            severity: (judgement.severity ?? Severity.MEDIUM) as Severity,
            firstSeenAt: ev.timestamp,
            spawnReason: judgement.reason,
          });
          spawnedProblemId = spawned.id;
          chosenProblemId = spawned.id;
          problemConfidence = judgement.confidence;
          problemMethod = ResolutionMethod.LLM_JUDGE;
          problemReason = `LLM spawned new Problem: ${judgement.reason}`;
          console.log(`[resolver] LLM judge → SPAWNED new problem id=${spawned.id}`);
        } else if (judgement?.decision === 'uncertain') {
          problemReason = `LLM uncertain: ${judgement.reason}`;
        }
      }
    } else if (!chosenProblemId && !llmAvailable()) {
      console.log('[resolver] LLM judge → skipped (LLM_PROVIDER=none)');
    }
  }

  // ---------------------------------------------------------------------------
  // Decide whether to attach the chosen problem.
  // ---------------------------------------------------------------------------
  let needsConfirm = false;
  if (chosenProblemId && problemConfidence < ATTACH_CONFIDENCE_FLOOR) {
    // Below the floor — don't attach.
    console.log(
      `[resolver] floor-check → conf ${problemConfidence.toFixed(4)} < ` +
        `${ATTACH_CONFIDENCE_FLOOR} → drop attachment (event → inbox)`,
    );
    chosenProblemId = null;
  } else if (chosenProblemId && problemConfidence < RESOLUTION_AUTO_THRESHOLD) {
    needsConfirm = true;
  }

  if (chosenProblemId) {
    console.log(
      `[resolver] ✓ DECISION: ${spawnedProblemId ? 'spawned' : 'attached'} problem=${chosenProblemId} ` +
        `conf=${problemConfidence.toFixed(4)} method=${problemMethod} ` +
        `needsConfirm=${needsConfirm} (${Date.now() - t0}ms)\n`,
    );
  } else {
    console.log(
      `[resolver] ✗ DECISION: no attach → inbox (client=${clientId}) (${Date.now() - t0}ms)\n`,
    );
  }

  return {
    clientId,
    problemId: chosenProblemId,
    clientConfidence,
    problemConfidence,
    method: problemMethod,
    reason: chosenProblemId
      ? problemReason || clientReason
      : `${clientReason}${problemReason ? ' · ' + problemReason : ''}`,
    spawnedProblemId,
    needsConfirm,
  };
}
