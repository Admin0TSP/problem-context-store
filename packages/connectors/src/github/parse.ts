/**
 * GitHub webhook payload → NormalizedEvent parsing.
 *
 * Event types we ingest, mapped to PCS EventKind:
 *
 *   pull_request                 (opened)       → PR_OPENED
 *   pull_request                 (closed/merged)→ PR_MERGED  (action=closed && merged=true)
 *   pull_request                 (closed)       → PR_CLOSED  (action=closed && merged=false)
 *   pull_request                 (reopened)     → PR_OPENED
 *   issues                       (opened)       → TICKET_CREATED
 *   issues                       (closed)       → TICKET_RESOLVED
 *   issues                       (reopened)     → TICKET_CREATED
 *   issue_comment                (created)      → MESSAGE
 *   pull_request_review_comment  (created)      → MESSAGE
 *   pull_request_review          (submitted)    → STATUS_CHANGE
 *
 * Filtered out by default (operationally noisy or low-signal):
 *   - push, fork, star, watch, member, label_*, milestone_*, project_*
 *   - any *.deleted / *.edited (we already captured the original)
 *   - bot-authored events when sender.type === 'Bot' (Dependabot, etc.)
 *
 * Threading:
 *   parentThreadId is the canonical "<owner>/<repo>#<number>" for PRs and
 *   issues. All comments on the same PR or issue cluster onto the parent
 *   Problem via the existing thread-continuity rule.
 *
 * Pure I/O-free — the receiver layer feeds us already-parsed JSON.
 */

import type { NormalizedEvent } from '../adapter';
import { extractTicketIdsFromString } from '../util/ticket-ids';

// ---------------------------------------------------------------------------
// Common payload shapes (partial — just what we read)
// ---------------------------------------------------------------------------

interface GitHubUser {
  login?: string;
  id?: number;
  html_url?: string;
  email?: string | null;
  type?: string; // "User" | "Bot" | "Organization"
}

interface GitHubRepo {
  full_name?: string; // "owner/repo"
  name?: string;
  html_url?: string;
  owner?: GitHubUser;
}

interface GitHubPR {
  number?: number;
  title?: string;
  body?: string | null;
  html_url?: string;
  user?: GitHubUser;
  state?: string;
  merged?: boolean;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  merged_at?: string | null;
  draft?: boolean;
  /**
   * Source branch of the PR. THE most authoritative place to read engineering
   * ticket IDs from at orgs that enforce branch naming like
   * `feature/ISS-280035/customer-object-retrieve-and-action`.
   * For fork-PRs the ref is prefixed with `username:`; the extractor strips that.
   */
  head?: { ref?: string };
}

interface GitHubIssue {
  number?: number;
  title?: string;
  body?: string | null;
  html_url?: string;
  user?: GitHubUser;
  state?: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  pull_request?: { html_url?: string }; // marker if issue is actually a PR
}

interface GitHubComment {
  id?: number;
  body?: string | null;
  html_url?: string;
  user?: GitHubUser;
  created_at?: string;
  path?: string;       // for PR review comments
  position?: number;
}

interface GitHubReview {
  id?: number;
  body?: string | null;
  html_url?: string;
  user?: GitHubUser;
  state?: string;      // "approved" | "changes_requested" | "commented"
  submitted_at?: string;
}

export interface GitHubWebhookPayload {
  action?: string;
  sender?: GitHubUser;
  repository?: GitHubRepo;

  /**
   * Present on EVERY webhook delivered by a GitHub App install. The
   * dedicated /api/ingest/github receiver uses this to look up the
   * ConnectorInstance — the same shape Slack uses with team_id.
   */
  installation?: {
    id?: number;
    node_id?: string;
  };

  // payload variants
  pull_request?: GitHubPR;
  issue?: GitHubIssue;
  comment?: GitHubComment;
  review?: GitHubReview;
}

/**
 * Extract the installation_id from a webhook payload. GitHub App webhooks
 * always include `installation.id` at the top level — the receiver uses
 * this to find the right ConnectorInstance without needing it in the URL.
 *
 * Returns null for `ping` events on org-level installs that occasionally
 * omit `installation` and for any malformed payload.
 */
export function getInstallationIdFromPayload(
  payload: GitHubWebhookPayload | unknown,
): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const id = (payload as GitHubWebhookPayload).installation?.id;
  return typeof id === 'number' && Number.isFinite(id) ? id : null;
}

// ---------------------------------------------------------------------------
// Ticket ID extraction (M11.6, generalized to all sources in M11.7)
// ---------------------------------------------------------------------------

// The regex + per-string extractor moved to ../util/ticket-ids.ts in M11.7 so
// Slack and Gmail parsers can share them without an awkward cross-adapter
// import. Re-exported here so anything that previously imported from
// `@pcs/connectors/github` (the package's github sub-export and the package
// root) keeps working unchanged.
export { TICKET_ID_PATTERN, extractTicketIdsFromString } from '../util/ticket-ids';

/**
 * Strip the `username:` prefix that GitHub adds to `head.ref` on cross-fork
 * PRs (e.g. `octocat:feature/ISS-1234/foo` → `feature/ISS-1234/foo`).
 * In-org PRs are unprefixed already; this is a no-op for them.
 */
function unprefixBranchRef(ref: string): string {
  const i = ref.indexOf(':');
  return i >= 0 ? ref.slice(i + 1) : ref;
}

/**
 * Gather all the ticket IDs we can see in this payload, with a heuristic
 * that puts branch-derived IDs first (most authoritative — engineers can
 * forget to put the ID in a PR title but cannot push without naming the
 * branch). Deduped, preserving first-seen order.
 *
 * Returned as mention objects, ready to drop straight onto NormalizedEvent.
 */
export function extractTicketIdMentions(
  payload: GitHubWebhookPayload,
): Array<{ kind: 'TICKET_ID'; value: string }> {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (ids: string[]) => {
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        ordered.push(id);
      }
    }
  };

  // Branch ref first — the most reliable source by convention.
  const branchRef = payload.pull_request?.head?.ref;
  if (branchRef) push(extractTicketIdsFromString(unprefixBranchRef(branchRef)));

  // Then PR title + body (engineers usually echo the branch ID here too).
  push(extractTicketIdsFromString(payload.pull_request?.title));
  push(extractTicketIdsFromString(payload.pull_request?.body));

  // Issues — title is most useful; body sometimes carries cross-references.
  push(extractTicketIdsFromString(payload.issue?.title));
  push(extractTicketIdsFromString(payload.issue?.body));

  // Comments + reviews — last resort. Engineers sometimes only mention the
  // ID in a "see ISS-280035" follow-up.
  push(extractTicketIdsFromString(payload.comment?.body));
  push(extractTicketIdsFromString(payload.review?.body));

  return ordered.map((value) => ({ kind: 'TICKET_ID' as const, value }));
}

// ---------------------------------------------------------------------------
// Parse context
// ---------------------------------------------------------------------------

export interface ParseGitHubContext {
  /** "X-GitHub-Event" header value: "pull_request", "issues", "issue_comment", … */
  eventName: string;
  /** Optional: include events from bot accounts (Dependabot, etc.). Default false. */
  includeBots?: boolean;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function parseGitHubEvent(
  payload: GitHubWebhookPayload,
  ctx: ParseGitHubContext,
): NormalizedEvent[] {
  if (!payload || typeof payload !== 'object') return [];
  const sender = payload.sender;
  if (!ctx.includeBots && sender?.type === 'Bot') return [];

  switch (ctx.eventName) {
    case 'pull_request':
      return parsePullRequest(payload);
    case 'issues':
      return parseIssue(payload);
    case 'issue_comment':
      return parseIssueComment(payload);
    case 'pull_request_review_comment':
      return parsePullRequestReviewComment(payload);
    case 'pull_request_review':
      return parsePullRequestReview(payload);
    case 'ping':
      // GitHub sends a ping when the webhook is first created. We don't
      // ingest it but we want the receiver to know it was valid → return [].
      return [];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Per-event handlers
// ---------------------------------------------------------------------------

function parsePullRequest(p: GitHubWebhookPayload): NormalizedEvent[] {
  const pr = p.pull_request;
  const repo = p.repository?.full_name ?? 'unknown/repo';
  if (!pr || !pr.number) return [];

  // Only act on actions we care about — opened/reopened/closed.
  const action = p.action;
  if (!action || !['opened', 'reopened', 'closed', 'edited'].includes(action)) {
    return [];
  }
  // Edited events on PRs are rare and usually low-signal; skip them.
  if (action === 'edited') return [];

  // Decide kind based on merged flag.
  let kind: NormalizedEvent['kind'];
  if (action === 'closed') {
    kind = pr.merged ? 'PR_MERGED' : 'PR_CLOSED';
  } else {
    kind = 'PR_OPENED';
  }

  const threadId = `${repo}#${pr.number}`;
  const composedBody =
    [
      `[${kindLabel(kind, pr.draft)}] ${pr.title ?? '(no title)'}`,
      pr.body?.trim() || null,
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 16000);

  return [
    {
      source: 'GITHUB',
      sourceId: `${repo}/pr/${pr.number}/${action}`, // include action so reopen creates a new Event
      sourceUrl: pr.html_url,
      kind,
      timestamp: parseGitHubDate(pr.merged_at, pr.closed_at, pr.updated_at, pr.created_at),
      actor: actorFrom(pr.user ?? p.sender),
      body: composedBody,
      parentThreadId: threadId,
      mentions: extractTicketIdMentions(p),
    },
  ];
}

function parseIssue(p: GitHubWebhookPayload): NormalizedEvent[] {
  const issue = p.issue;
  const repo = p.repository?.full_name ?? 'unknown/repo';
  if (!issue || !issue.number) return [];

  // If this is actually a PR coming through as an issue event (GitHub does
  // this for issue_comment on PRs), skip — we handle PRs separately.
  if (issue.pull_request) return [];

  const action = p.action;
  if (!action || !['opened', 'reopened', 'closed'].includes(action)) {
    return [];
  }

  const kind: NormalizedEvent['kind'] = action === 'closed' ? 'TICKET_RESOLVED' : 'TICKET_CREATED';
  const threadId = `${repo}#${issue.number}`;

  const composedBody =
    [
      `[Issue ${action}] ${issue.title ?? '(no title)'}`,
      issue.body?.trim() || null,
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 16000);

  return [
    {
      source: 'GITHUB',
      sourceId: `${repo}/issue/${issue.number}/${action}`,
      sourceUrl: issue.html_url,
      kind,
      timestamp: parseGitHubDate(issue.closed_at, issue.updated_at, issue.created_at),
      actor: actorFrom(issue.user ?? p.sender),
      body: composedBody,
      parentThreadId: threadId,
      mentions: extractTicketIdMentions(p),
    },
  ];
}

function parseIssueComment(p: GitHubWebhookPayload): NormalizedEvent[] {
  if (p.action !== 'created') return [];
  const comment = p.comment;
  const issue = p.issue;
  const repo = p.repository?.full_name ?? 'unknown/repo';
  if (!comment || !issue?.number) return [];

  const body = (comment.body ?? '').trim();
  if (!body) return [];

  const isOnPR = !!issue.pull_request;
  const threadId = `${repo}#${issue.number}`;

  return [
    {
      source: 'GITHUB',
      sourceId: `${repo}/comment/${comment.id ?? Date.now()}`,
      sourceUrl: comment.html_url,
      kind: 'MESSAGE',
      timestamp: comment.created_at ? new Date(comment.created_at) : new Date(),
      actor: actorFrom(comment.user ?? p.sender),
      body: `${isOnPR ? `[Comment on PR #${issue.number}]` : `[Comment on issue #${issue.number}]`}\n${body}`,
      parentThreadId: threadId,
      mentions: extractTicketIdMentions(p),
    },
  ];
}

function parsePullRequestReviewComment(p: GitHubWebhookPayload): NormalizedEvent[] {
  if (p.action !== 'created') return [];
  const comment = p.comment;
  const pr = p.pull_request;
  const repo = p.repository?.full_name ?? 'unknown/repo';
  if (!comment || !pr?.number) return [];

  const body = (comment.body ?? '').trim();
  if (!body) return [];

  const threadId = `${repo}#${pr.number}`;
  const locator = comment.path ? `${comment.path}${comment.position != null ? `:${comment.position}` : ''}` : 'inline';

  return [
    {
      source: 'GITHUB',
      sourceId: `${repo}/review-comment/${comment.id ?? Date.now()}`,
      sourceUrl: comment.html_url,
      kind: 'MESSAGE',
      timestamp: comment.created_at ? new Date(comment.created_at) : new Date(),
      actor: actorFrom(comment.user ?? p.sender),
      body: `[Review comment on PR #${pr.number} · ${locator}]\n${body}`,
      parentThreadId: threadId,
      mentions: extractTicketIdMentions(p),
    },
  ];
}

function parsePullRequestReview(p: GitHubWebhookPayload): NormalizedEvent[] {
  if (p.action !== 'submitted') return [];
  const review = p.review;
  const pr = p.pull_request;
  const repo = p.repository?.full_name ?? 'unknown/repo';
  if (!review || !pr?.number) return [];

  // Empty-body reviews (just an approval click) are status signals — keep
  // them but compose a useful body. Reviews with bodies are mini-comments.
  const body = (review.body ?? '').trim();
  const stateLabel = (review.state ?? 'commented').toUpperCase();
  const composed = body
    ? `[Review ${stateLabel} on PR #${pr.number}]\n${body}`
    : `[Review ${stateLabel} on PR #${pr.number}]`;

  const threadId = `${repo}#${pr.number}`;

  return [
    {
      source: 'GITHUB',
      sourceId: `${repo}/review/${review.id ?? Date.now()}`,
      sourceUrl: review.html_url,
      kind: 'STATUS_CHANGE',
      timestamp: review.submitted_at ? new Date(review.submitted_at) : new Date(),
      actor: actorFrom(review.user ?? p.sender),
      body: composed,
      parentThreadId: threadId,
      mentions: extractTicketIdMentions(p),
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function actorFrom(u?: GitHubUser): NormalizedEvent['actor'] {
  if (!u) return {};
  return {
    name: u.login,
    // GitHub usually masks emails in webhooks (privacy default). Only set
    // when actually present so the email-domain rule doesn't get fed junk.
    email: u.email && u.email.includes('@') ? u.email.toLowerCase() : undefined,
    sourceId: u.id != null ? String(u.id) : undefined,
  };
}

function kindLabel(kind: NormalizedEvent['kind'], draft?: boolean): string {
  if (kind === 'PR_OPENED') return draft ? 'PR draft' : 'PR opened';
  if (kind === 'PR_MERGED') return 'PR merged';
  if (kind === 'PR_CLOSED') return 'PR closed';
  return String(kind);
}

function parseGitHubDate(...candidates: Array<string | null | undefined>): Date {
  for (const c of candidates) {
    if (c) {
      const d = new Date(c);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return new Date();
}
