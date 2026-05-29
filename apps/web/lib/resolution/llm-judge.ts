/**
 * Stage 3: LLM judge.
 *
 * Used when rules + vector haven't produced a confident attachment.
 * Given the event body and the top-K candidate Problems (within the resolved
 * client), Claude picks one of:
 *   - { decision: "existing", problemId, confidence, reason }
 *   - { decision: "new", title, severity?, confidence, reason }
 *   - { decision: "uncertain", reason }
 *
 * If no ANTHROPIC_API_KEY is set, returns null and the caller falls back to
 * "don't attach, send to inbox."
 */

import type { NormalizedEvent } from '@pcs/connectors';
import { Severity } from '@pcs/db';
import { complete, parseJsonFromLlm, llmAvailable } from '@/lib/intelligence/llm';

export interface LlmJudgeInput {
  event: NormalizedEvent;
  clientName: string;
  candidates: Array<{ id: string; title: string; summary?: string | null }>;
}

export type LlmJudgement =
  | {
      decision: 'existing';
      problemId: string;
      confidence: number; // 0..1
      reason: string;
    }
  | {
      decision: 'new';
      title: string;
      severity?: Severity;
      confidence: number;
      reason: string;
    }
  | { decision: 'uncertain'; reason: string };

const SYSTEM = `You are the resolution judge inside the Problem Context Store. Your job is to look at a new incoming event (a Slack message, ticket update, email, etc.) and decide which existing customer Problem it belongs to — or whether it represents a new Problem worth tracking.

You will be given:
- The event body and metadata.
- The client (customer) the event is about.
- A list of that client's open Problems with their titles and summaries.

Decide one of:
1. "existing" — the event is evidence about ONE of the listed Problems. Only pick this if you'd defend the match to an engineer who knows the system. Same broken component AND same kind of failure mode. If the event is about a different system or a different failure mode, do NOT pick existing — even if the client is the same.
2. "new" — the event describes a customer problem that doesn't match any of the existing ones, and is substantive enough to track as its own Problem.
3. "uncertain" — you don't have enough information to decide confidently. Better to flag for human review than to mislabel.

DEFAULT TO "uncertain". You will be judged on PRECISION, not coverage. Polluting the customer's institutional memory with a wrong "existing" pick is much worse than punting to a human. If you find yourself hedging in the reason field with "could be related to" or "possibly tied to" — stop and pick "uncertain".

"new" should be reserved for actual new customer problems — not for internal chatter, status updates on existing problems, or off-topic side conversation.

EXAMPLES — what counts as "existing" vs "new":

Existing problem: "Site speed issues on theseopilot.pro homepage — Homepage takes 8+ seconds on mobile, LCP 6.2s, hero image suspected."
  ✓ EXISTING: "Customers complaining the homepage is super slow today, LCP hit 7s in Lighthouse."
                (Same system + same symptom. Confidence 0.85.)
  ✗ NOT EXISTING: "SSL cert expired this morning, Chrome shows Not Secure on the site."
                (Different system: SSL cert vs frontend asset size. Pick "new".)
  ✗ NOT EXISTING: "Massive 5xx error spike in Search Console — 2,800 pages."
                (Different failure mode: server errors vs slow rendering. Pick "new".)

Existing problem: "Google Search Console verification keeps failing — DNS TXT record set via Cloudflare, GSC reports failed."
  ✓ EXISTING: "Tried the meta-tag GSC verification method too, still says incomplete."
                (Same GSC verification flow. Confidence 0.85.)
  ✗ NOT EXISTING: "Article schema isn't showing rich results in SERPs."
                (Different GSC area: verification vs rich-snippet rendering. Pick "new".)

Reply with JSON ONLY, no prose, in this exact shape:
{
  "decision": "existing" | "new" | "uncertain",
  "problemId": "<one of the candidate ids if decision=existing>",
  "title": "<short Problem title if decision=new>",
  "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "confidence": <number between 0.0 and 1.0>,
  "reason": "<one sentence explaining your choice — name the specific component/symptom you matched>"
}

CONFIDENCE GUIDE — pick a real number; do NOT default to 0:
  0.95  the event explicitly names the Problem id, ticket key, or restates the title nearly verbatim.
  0.85  the event clearly describes the SAME component AND the SAME kind of failure as the existing Problem.
  0.75  strong topical overlap on both component AND failure mode, but worded differently.
  0.65  plausibly the same Problem, but the event is short or vague.
  0.50  same client, same general area, but probably a related-but-separate Problem — pick "uncertain" instead.
  0.30  weak signal — pick "uncertain" instead.

NEVER output confidence: 0 unless decision is "uncertain". If you picked "existing" you must justify it with confidence ≥ 0.65 AND name the specific shared component/symptom in your reason.`;

export async function judgeWithLlm(input: LlmJudgeInput): Promise<LlmJudgement | null> {
  if (!llmAvailable()) return null;

  const prompt = buildPrompt(input);

  let raw: string;
  try {
    raw = await complete({
      system: SYSTEM,
      prompt,
      maxTokens: 400,
      temperature: 0,
      jsonMode: true, // enables format:json on Ollama; Anthropic ignores
    });
  } catch (err) {
    console.error('LLM judge failed:', err);
    return null;
  }

  const parsed = parseJsonFromLlm<{
    decision?: string;
    problemId?: string;
    title?: string;
    severity?: string;
    confidence?: number;
    reason?: string;
  }>(raw);

  if (!parsed?.decision) return { decision: 'uncertain', reason: 'LLM returned no decision' };

  const confidence = clamp(Number(parsed.confidence ?? 0), 0, 1);
  const reason = String(parsed.reason ?? '').slice(0, 500);

  switch (parsed.decision) {
    case 'existing': {
      if (!parsed.problemId || !input.candidates.find((c) => c.id === parsed.problemId)) {
        return { decision: 'uncertain', reason: 'LLM returned an unknown problemId' };
      }
      return { decision: 'existing', problemId: parsed.problemId, confidence, reason };
    }
    case 'new': {
      const title = String(parsed.title ?? '').trim();
      if (!title) return { decision: 'uncertain', reason: 'LLM proposed new but gave no title' };
      const severity = normalizeSeverity(parsed.severity);
      return { decision: 'new', title: title.slice(0, 200), severity, confidence, reason };
    }
    case 'uncertain':
    default:
      return { decision: 'uncertain', reason: reason || 'LLM said uncertain' };
  }
}

function buildPrompt(input: LlmJudgeInput): string {
  const { event, clientName, candidates } = input;
  const candidateBlocks = candidates.length
    ? candidates
        .map(
          (c, i) =>
            `${i + 1}. id=${c.id}
   title: ${c.title}
   summary: ${(c.summary ?? '(no summary)').slice(0, 400)}`,
        )
        .join('\n\n')
    : '(no existing open problems for this client)';

  return `Client: ${clientName}

EXISTING OPEN PROBLEMS for ${clientName}:
${candidateBlocks}

INCOMING EVENT:
Source: ${event.source}
Kind: ${event.kind}
Actor: ${event.actor.name ?? 'unknown'}${event.actor.email ? ` <${event.actor.email}>` : ''}
Timestamp: ${event.timestamp.toISOString()}

Body:
${event.body.slice(0, 4000)}

Decide which Problem this is evidence for, propose a new one, or say uncertain. Reply with JSON only.`;
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function normalizeSeverity(s?: string): Severity {
  const v = String(s ?? '').toUpperCase();
  if (v === 'LOW' || v === 'MEDIUM' || v === 'HIGH' || v === 'CRITICAL') return v as Severity;
  return Severity.MEDIUM;
}
