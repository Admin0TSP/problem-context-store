/**
 * M7 — Problem summarization.
 *
 *   summarizeProblem(problemId) → { rootCause, approach, resolution, confidence }
 *
 * Reads the Problem + its full evidence trail (events + manual notes, sorted
 * chronologically), packs it into a structured prompt, calls the LLM, and
 * parses the JSON response.
 *
 * Model selection:
 *   - Uses OLLAMA_SUMMARY_MODEL if set, else falls back to OLLAMA_LLM_MODEL.
 *   - Anthropic path uses ANTHROPIC_SUMMARY_MODEL → ANTHROPIC_MODEL → default.
 *
 * This file does NOT touch the database — it's pure "given a Problem id, give
 * me a summary." The server action in app/actions/summarize.ts wraps this
 * with auth, audit, and persistence.
 */

import { prisma } from '@pcs/db';
import { complete, llmAvailable, parseJsonFromLlm } from './llm';

const MAX_EVENTS_IN_PROMPT = 25;
const MAX_NOTES_IN_PROMPT = 10;
const EVENT_BODY_CHARS = 800;
const NOTE_BODY_CHARS = 1200;

export interface ProblemSummary {
  rootCause: string | null;
  approach: string | null;
  resolution: string | null;
  confidence: number;
  /** Free-form note from the model — e.g. "based on 8 events, 2 notes". */
  basis: string;
}

export class SummarizeError extends Error {
  constructor(message: string, public code: 'no_llm' | 'no_evidence' | 'llm_failed' | 'parse_failed') {
    super(message);
  }
}

export async function summarizeProblem(args: {
  workspaceId: string;
  problemId: string;
}): Promise<ProblemSummary> {
  if (!llmAvailable()) {
    throw new SummarizeError(
      'No LLM provider configured. Set OLLAMA_BASE_URL or ANTHROPIC_API_KEY.',
      'no_llm',
    );
  }

  const problem = await prisma.problem.findFirst({
    where: { id: args.problemId, workspaceId: args.workspaceId },
    include: {
      client: { select: { name: true } },
      events: {
        orderBy: { timestamp: 'asc' },
        select: {
          id: true,
          timestamp: true,
          source: true,
          kind: true,
          actorName: true,
          actorEmail: true,
          body: true,
        },
      },
      manualNotes: {
        orderBy: { occurredAt: 'asc' },
        select: {
          id: true,
          title: true,
          body: true,
          channel: true,
          occurredAt: true,
          author: { select: { name: true, email: true } },
        },
      },
    },
  });

  if (!problem) throw new SummarizeError('Problem not found', 'parse_failed');

  const totalEvidence = problem.events.length + problem.manualNotes.length;
  if (totalEvidence === 0) {
    throw new SummarizeError(
      'Nothing to summarize yet — attach at least one event or manual note first.',
      'no_evidence',
    );
  }

  // Truncate to avoid blowing past the model's context window.
  // We take the most recent N events because recency usually carries the most
  // signal about current state. Older events drop out, but the model is told
  // how many it didn't see.
  const events = problem.events.slice(-MAX_EVENTS_IN_PROMPT);
  const notes = problem.manualNotes.slice(-MAX_NOTES_IN_PROMPT);
  const droppedEvents = problem.events.length - events.length;
  const droppedNotes = problem.manualNotes.length - notes.length;

  const prompt = buildPrompt({
    problemTitle: problem.title,
    problemDescription: problem.description,
    clientName: problem.client.name,
    status: problem.status,
    severity: problem.severity,
    events,
    notes,
    droppedEvents,
    droppedNotes,
  });

  const summaryModel = process.env.OLLAMA_SUMMARY_MODEL; // falls back inside llm.ts
  const anthropicSummaryModel = process.env.ANTHROPIC_SUMMARY_MODEL;
  const modelOverride = summaryModel || anthropicSummaryModel;

  const t0 = Date.now();
  console.log(
    `[summarize] problem=${problem.id} title="${problem.title}" ` +
      `events=${events.length}/${problem.events.length} notes=${notes.length}/${problem.manualNotes.length} ` +
      `model=${modelOverride ?? '(default)'}`,
  );

  let raw: string;
  try {
    raw = await complete({
      system: SYSTEM_PROMPT,
      prompt,
      maxTokens: 700,
      temperature: 0.2, // a hair above 0 — summaries benefit from slight phrasing freedom
      jsonMode: true,
      model: modelOverride,
    });
  } catch (err) {
    console.error('[summarize] LLM call failed:', err);
    throw new SummarizeError(
      `Summary LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      'llm_failed',
    );
  }
  console.log(`[summarize] LLM done in ${Date.now() - t0}ms`);

  const parsed = parseJsonFromLlm<{
    rootCause?: string | null;
    approach?: string | null;
    resolution?: string | null;
    confidence?: number;
  }>(raw);

  if (!parsed) {
    throw new SummarizeError(
      `LLM did not return valid JSON. First 200 chars: ${raw.slice(0, 200)}`,
      'parse_failed',
    );
  }

  const rootCause = cleanField(parsed.rootCause);
  const approach = cleanField(parsed.approach);
  const resolution = cleanField(parsed.resolution);
  const confidence = clamp(Number(parsed.confidence ?? 0.5), 0, 1);

  // Don't fabricate a resolution when the Problem isn't resolved.
  const finalResolution = problem.status === 'RESOLVED' ? resolution : null;

  return {
    rootCause,
    approach,
    resolution: finalResolution,
    confidence,
    basis:
      `Based on ${events.length} event${events.length === 1 ? '' : 's'}` +
      (notes.length ? ` + ${notes.length} manual note${notes.length === 1 ? '' : 's'}` : '') +
      (droppedEvents || droppedNotes
        ? ` (${droppedEvents + droppedNotes} older items not shown to the model)`
        : ''),
  };
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a senior customer-success analyst writing concise, factual summaries about a customer-facing Problem. You are summarizing for the operator's team — be specific, technical, and short. No flowery prose, no hype, no hedging filler like "it appears that" or "may have".

Three fields, each 1-3 sentences:

- rootCause:  What is actually broken or going wrong, in concrete terms (system / data / process). Use "Unknown" if the evidence doesn't make it clear.
- approach:   What has the team investigated, tried, or decided so far? Current focus / next step.
- resolution: How was it fixed and verified? Only fill if the Problem's status is RESOLVED. Otherwise return null.

Quote specific systems / hubs / metric names that appear in the evidence — don't generalize. If different pieces of evidence contradict, prefer the most recent one and mention the contradiction.

confidence (0.0–1.0): How well does the evidence support these summaries?
  - 0.9   strong, multiple consistent events with specifics
  - 0.7   reasonable signal, some uncertainty
  - 0.5   thin — you're inferring more than you'd like
  - 0.3   really not enough evidence yet; say "Unknown" liberally

Reply with JSON ONLY, no prose, no code fences. Schema:
{
  "rootCause": string | null,
  "approach": string | null,
  "resolution": string | null,
  "confidence": number
}`;

function buildPrompt(input: {
  problemTitle: string;
  problemDescription: string | null;
  clientName: string;
  status: string;
  severity: string;
  events: Array<{
    timestamp: Date;
    source: string;
    kind: string;
    actorName: string | null;
    actorEmail: string | null;
    body: string;
  }>;
  notes: Array<{
    title: string | null;
    body: string;
    channel: string;
    occurredAt: Date;
    author: { name: string | null; email: string | null } | null;
  }>;
  droppedEvents: number;
  droppedNotes: number;
}): string {
  const eventLines = input.events.length
    ? input.events
        .map((e, i) => {
          const who = e.actorName ?? e.actorEmail ?? 'unknown';
          return `${i + 1}. [${e.timestamp.toISOString()}] ${e.source}/${e.kind} · ${who}
   ${truncate(e.body, EVENT_BODY_CHARS)}`;
        })
        .join('\n\n')
    : '(none)';

  const noteLines = input.notes.length
    ? input.notes
        .map((n, i) => {
          const who = n.author?.name ?? n.author?.email ?? 'unknown';
          return `${i + 1}. [${n.occurredAt.toISOString()}] ${n.channel} · ${who}${
            n.title ? ` · ${n.title}` : ''
          }
   ${truncate(n.body, NOTE_BODY_CHARS)}`;
        })
        .join('\n\n')
    : '(none)';

  const droppedNote =
    input.droppedEvents || input.droppedNotes
      ? `(${input.droppedEvents} earlier events and ${input.droppedNotes} earlier notes omitted; assume they're consistent with the trend below)`
      : '';

  return `PROBLEM
Title: ${input.problemTitle}
Client: ${input.clientName}
Status: ${input.status}
Severity: ${input.severity}
Description: ${input.problemDescription ?? '(none)'}

${droppedNote ? droppedNote + '\n\n' : ''}EVENTS (chronological):
${eventLines}

MANUAL NOTES (chronological):
${noteLines}

Summarize. JSON only, in the exact schema specified.`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanField(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || /^(unknown|n\/a|none|null)$/i.test(s)) return null;
  // Hard cap so the UI doesn't blow up if the model rambles.
  return s.slice(0, 1500);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + ' …[truncated]';
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}
