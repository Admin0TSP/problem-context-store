/**
 * DevRev event payload → NormalizedEvent parsing.
 *
 * DevRev wraps webhook payloads with a `type` field and a key matching that
 * type holding the actual data. Examples:
 *
 *   { type: "work.created",
 *     work_created: { work: { id, title, body, created_by, ... } } }
 *
 *   { type: "work.updated",
 *     work_updated: { work: {...}, old_work: {...}, change: {...} } }
 *
 *   { type: "timeline_entry_created",
 *     timeline_entry_created: { timeline_entry: { id, body, object: {id} } } }
 *
 * We map:
 *   work.created               → TICKET_CREATED
 *   work.updated               → TICKET_UPDATED  (skip pure metadata churn)
 *   timeline_entry_created     → MESSAGE         (a comment on a ticket)
 *
 * `parentThreadId` is always the parent work item's id — so comments + updates
 * cluster onto the same PCS Problem as the original ticket via the
 * thread-continuity rule.
 */

import type { NormalizedEvent } from '../adapter';

// ---------------------------------------------------------------------------
// Payload shapes — partial, just enough for parsing
// ---------------------------------------------------------------------------

export interface DevRevPerson {
  id?: string;
  display_name?: string;
  full_name?: string;
  email?: string;
  type?: string;
}

export interface DevRevWork {
  id?: string;
  display_id?: string;
  type?: string;
  title?: string;
  body?: string;
  created_date?: string;
  modified_date?: string;
  created_by?: DevRevPerson;
  owned_by?: DevRevPerson[];
  stage?: { name?: string; display_name?: string };
  priority?: string;
  applies_to_part?: { id?: string; name?: string };
  tags?: Array<{ name?: string }>;
}

export interface DevRevTimelineEntry {
  id?: string;
  display_id?: string;
  type?: string;            // "comment", "system", etc.
  body?: string;
  body_type?: string;       // "text" | "html"
  created_date?: string;
  created_by?: DevRevPerson;
  object?: { id?: string };
  visibility?: string;      // "external", "internal", "private"
}

export interface DevRevWebhookPayload {
  type?: string;
  id?: string;
  webhook_id?: string;
  event_date?: string;
  work_created?:   { work?: DevRevWork };
  work_updated?:   { work?: DevRevWork; old_work?: DevRevWork };
  timeline_entry_created?: { timeline_entry?: DevRevTimelineEntry };
}

// ---------------------------------------------------------------------------
// Parse context (per-instance config)
// ---------------------------------------------------------------------------

export interface ParseDevRevContext {
  /** DevRev org ID, e.g. "DEV-acmecorp". Used to build sourceUrl. */
  orgSlug?: string;
}

const SKIP_STAGES_FOR_UPDATE = new Set<string>([
  // Pure UI / housekeeping transitions that produce no Problem signal.
  // Real workflow moves (queued → in_progress, etc.) still come through.
]);

/**
 * Convert a single DevRev webhook payload into 0..N NormalizedEvents.
 * Most payloads produce exactly 1; payloads we don't recognise produce 0.
 */
export function parseDevRevEvent(
  payload: DevRevWebhookPayload,
  ctx: ParseDevRevContext = {},
): NormalizedEvent[] {
  if (!payload || typeof payload !== 'object') return [];

  switch (payload.type) {
    case 'work.created': {
      const work = payload.work_created?.work;
      if (!work) return [];
      return [fromWork(work, ctx, 'TICKET_CREATED')];
    }
    case 'work.updated': {
      const work = payload.work_updated?.work;
      if (!work) return [];
      // Skip silent metadata-only updates we don't care about.
      if (SKIP_STAGES_FOR_UPDATE.has(work.stage?.name ?? '')) return [];
      // If the stage is "resolved" / "closed", flag as TICKET_RESOLVED.
      const stageName = (work.stage?.name ?? '').toLowerCase();
      const isResolved =
        stageName.includes('resolved') ||
        stageName.includes('closed') ||
        stageName.includes('done');
      return [fromWork(work, ctx, isResolved ? 'TICKET_RESOLVED' : 'TICKET_UPDATED')];
    }
    case 'timeline_entry_created': {
      const entry = payload.timeline_entry_created?.timeline_entry;
      if (!entry) return [];
      // Only ingest human-authored comments. Skip system entries (status
      // changes, automated edits) — they're already covered by work.updated.
      if (entry.type && entry.type !== 'comment' && entry.type !== 'timeline_comment') {
        return [];
      }
      // Skip internal/private comments — those are team-only chatter.
      if (entry.visibility && entry.visibility !== 'external') return [];

      const body = (entry.body ?? '').trim();
      if (!body) return [];

      const parent = entry.object?.id ?? '';
      if (!parent) return [];

      return [
        {
          source: 'DEVREV',
          sourceId: entry.id ?? `devrev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sourceUrl: workUrl(ctx, parent),
          kind: 'MESSAGE',
          timestamp: entry.created_date ? new Date(entry.created_date) : new Date(),
          actor: actorFrom(entry.created_by),
          body,
          parentThreadId: parent,
        },
      ];
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fromWork(
  work: DevRevWork,
  ctx: ParseDevRevContext,
  kind: 'TICKET_CREATED' | 'TICKET_UPDATED' | 'TICKET_RESOLVED',
): NormalizedEvent {
  const title = (work.title ?? '').trim();
  const body = (work.body ?? '').trim();
  // Compose body with title + description + light metadata. Embedding works
  // better when there's enough context — empty bodies on tickets are common.
  const composed = [
    title ? `Title: ${title}` : null,
    body || null,
    work.stage?.display_name ? `Stage: ${work.stage.display_name}` : null,
    work.priority ? `Priority: ${work.priority}` : null,
    work.applies_to_part?.name ? `Component: ${work.applies_to_part.name}` : null,
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 16000);

  return {
    source: 'DEVREV',
    sourceId: work.id ?? `devrev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourceUrl: workUrl(ctx, work.id ?? ''),
    kind,
    timestamp: work.modified_date
      ? new Date(work.modified_date)
      : work.created_date
        ? new Date(work.created_date)
        : new Date(),
    actor: actorFrom(work.created_by),
    body: composed || `(empty ticket: ${work.display_id ?? work.id ?? 'unknown'})`,
    parentThreadId: work.id, // ties future updates + comments to this work item
  };
}

function actorFrom(p?: DevRevPerson): NormalizedEvent['actor'] {
  if (!p) return {};
  return {
    name: p.display_name ?? p.full_name,
    email: p.email?.toLowerCase(),
    sourceId: p.id,
  };
}

/**
 * Best-effort DevRev work URL. DevRev's actual URL format is:
 *   https://app.devrev.ai/{org-slug}/works/{display-id}
 * The orgSlug comes from instance config; if missing we fall back to a stub
 * URL that still uniquely identifies the work item.
 */
function workUrl(ctx: ParseDevRevContext, workId: string): string | undefined {
  if (!workId) return undefined;
  if (ctx.orgSlug) {
    // workId looks like "DEV-acmecorp/TKT-12345" → take part after slash
    const displayPart = workId.includes('/') ? workId.split('/').pop()! : workId;
    return `https://app.devrev.ai/${ctx.orgSlug}/works/${displayPart}`;
  }
  return `devrev://${workId}`;
}
