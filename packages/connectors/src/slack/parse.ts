/**
 * Slack event → NormalizedEvent parsing.
 *
 * Slack sends a wide variety of events. For M8a we handle:
 *   - message               (plain channel message, including thread replies)
 *   - message.app_mention   (bot was @-mentioned)
 *   - thread_broadcast      (reply sent to channel + thread)
 *
 * Subtypes we filter OUT (low signal / noisy):
 *   - bot_message (unless from a different integration we care about — TODO)
 *   - message_changed / message_deleted (edits & deletes — TODO: handle later)
 *   - channel_join / channel_leave / member_joined_channel / pinned_item
 *
 * Slack's user IDs (U…) don't carry emails. The webhook receiver layer
 * (which has access to the bot token) is responsible for resolving them
 * to email+name via users.info — this file stays pure I/O-free.
 */

import type { NormalizedEvent } from '../adapter';

/** What the Slack Events API wraps every event in. */
export interface SlackEventEnvelope {
  type: 'event_callback' | 'url_verification' | string;
  team_id?: string;
  api_app_id?: string;
  event_id?: string;
  event_time?: number;
  challenge?: string;
  event?: SlackEvent;
  authorizations?: Array<{ team_id?: string; user_id?: string; is_bot?: boolean }>;
}

export interface SlackEvent {
  type: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
  team?: string;
  blocks?: unknown;
}

/** Subtypes we skip because they're operational noise. */
const SKIP_SUBTYPES = new Set([
  'channel_join',
  'channel_leave',
  'channel_topic',
  'channel_purpose',
  'channel_name',
  'pinned_item',
  'unpinned_item',
  'message_changed',
  'message_deleted',
  'bot_message', // skip our own bot's messages
  'file_share', // TODO: artifact ingestion in M8b
  'file_comment',
]);

export interface ParseContext {
  /** Slack workspace (team) ID from envelope.team_id — used to build URLs. */
  teamId: string;
  /** Optional: domain of the Slack workspace, for sourceUrl construction. */
  teamDomain?: string;
  /**
   * Map of Slack user IDs → { email, name }. Empty {} is fine — the resolver
   * will fall back to vector + LLM if it can't tell the client from email.
   */
  userIndex?: Record<string, { email?: string; name?: string }>;
}

/**
 * Convert a verified Slack envelope into 0 or 1 NormalizedEvents.
 * (Most events produce exactly 1; ignored events produce 0.)
 */
export function parseSlackEnvelope(
  env: SlackEventEnvelope,
  ctx: ParseContext,
): NormalizedEvent[] {
  if (env.type !== 'event_callback' || !env.event) return [];
  const ev = env.event;

  // Only message-shaped events for now.
  if (ev.type !== 'message' && ev.type !== 'app_mention') return [];

  // Skip noise subtypes.
  if (ev.subtype && SKIP_SUBTYPES.has(ev.subtype)) return [];

  // Anything from a bot (not just our bot) — skip. Real customer signal is
  // human messages. We can revisit if a customer's monitoring bot posts useful
  // context, but that's case-by-case.
  if (ev.bot_id) return [];

  const text = (ev.text ?? '').trim();
  if (!text) return [];

  const user = ev.user ?? '';
  const channel = ev.channel ?? '';
  const ts = ev.ts ?? '';
  if (!user || !channel || !ts) return [];

  const userInfo = ctx.userIndex?.[user];
  const sourceUrl = ctx.teamDomain
    ? `https://${ctx.teamDomain}.slack.com/archives/${channel}/p${ts.replace('.', '')}` +
      (ev.thread_ts && ev.thread_ts !== ts ? `?thread_ts=${ev.thread_ts}&cid=${channel}` : '')
    : undefined;

  const out: NormalizedEvent = {
    source: 'SLACK',
    // (source, sourceId) is the dedup key. Slack guarantees (channel, ts) is unique.
    sourceId: `${ctx.teamId}:${channel}:${ts}`,
    sourceUrl,
    kind: 'MESSAGE',
    timestamp: new Date(parseFloat(ts) * 1000),
    actor: {
      name: userInfo?.name,
      email: userInfo?.email,
      sourceId: user,
    },
    body: text,
    // Slack uses `ts` of the parent message as the thread identifier.
    parentThreadId: ev.thread_ts && ev.thread_ts !== ts ? ev.thread_ts : undefined,
  };

  return [out];
}

/**
 * Pull every unique user_id mentioned in the envelope, so the receiver can
 * batch-fetch users.info before calling parseSlackEnvelope.
 */
export function collectSlackUserIds(env: SlackEventEnvelope): string[] {
  const ids = new Set<string>();
  const ev = env.event;
  if (ev?.user) ids.add(ev.user);
  // Future: parse @mentions out of text for user resolution.
  return [...ids];
}
