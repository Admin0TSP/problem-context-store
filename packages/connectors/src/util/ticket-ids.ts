/**
 * Cross-adapter helpers for extracting engineering-ticket IDs from raw text
 * (Shipsy + most B2B orgs name issues `ISS-<digits>` and tickets `TKT-<digits>`).
 *
 * Lives outside any individual adapter folder because GitHub, Slack, Gmail and
 * (eventually) DevRev all want the same extraction so the resolver's
 * TICKET_ID-mention rule (M11.6, see `apps/web/lib/resolution/rules.ts`) can
 * cluster a customer Slack message saying "ISS-280035 still broken" onto the
 * same Problem that the matching GitHub PR is already on — without any
 * per-source duplication of the regex.
 */

/**
 * Matches engineering-ticket references the way Shipsy + most B2B orgs name
 * their work — DevRev `ISS-280035`, Jira-ish `TKT-1234`. Case-insensitive so a
 * stray `iss-12345` in a Slack message still gets caught. Word-bounded so we
 * don't false-positive on `LOSS-1234` or `prefixISS-12`.
 *
 * If a different org needs a different prefix scheme (e.g. `BUG-123`, `JIRA-7`)
 * we can either grow the alternation here or accept a per-workspace prefix
 * list — for now Shipsy's two-prefix convention is hard-coded since that's
 * what unblocks the first real customer.
 */
export const TICKET_ID_PATTERN = /\b(ISS|TKT)-(\d+)\b/gi;

/**
 * Pull every unique ticket ID from a single string, normalized to upper-case
 * prefix (`ISS-280035`, not `iss-280035`). Ordering is preserved so callers
 * can prefer earlier matches if they care (e.g. branch name before PR body).
 */
export function extractTicketIdsFromString(s: string | null | undefined): string[] {
  if (!s) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of s.matchAll(TICKET_ID_PATTERN)) {
    const id = `${m[1]!.toUpperCase()}-${m[2]!}`;
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Convenience: dedupe + concat ticket IDs across multiple strings and return
 * them already shaped as `NormalizedEvent.mentions` entries. Order is preserved
 * — first source listed wins for IDs that appear in multiple places, which
 * lets callers list their most-authoritative source first (e.g. PR branch ref
 * before PR body).
 */
export function ticketIdMentionsFromStrings(
  ...sources: Array<string | null | undefined>
): Array<{ kind: 'TICKET_ID'; value: string }> {
  const seen = new Set<string>();
  const out: Array<{ kind: 'TICKET_ID'; value: string }> = [];
  for (const s of sources) {
    for (const id of extractTicketIdsFromString(s)) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push({ kind: 'TICKET_ID', value: id });
      }
    }
  }
  return out;
}
