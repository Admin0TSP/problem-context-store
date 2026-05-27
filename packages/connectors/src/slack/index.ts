/**
 * Slack connector adapter (M8a).
 *
 * NOTE on URL pattern:
 *   Unlike the Stub (which uses /api/ingest/stub/[instanceId]), Slack sends
 *   ALL events to a single app-wide URL configured in the Slack app dashboard.
 *   We expose /api/ingest/slack (no instanceId) and the receiver there looks
 *   up the ConnectorInstance by `team_id` from the payload.
 *
 *   This adapter therefore exists mainly to:
 *     1. Declare the descriptor (so /connectors/new shows Slack as installable).
 *     2. Expose parseWebhook() so the receiver can call it after team_id lookup.
 *     3. Expose beginInstall() that returns the OAuth URL.
 *
 *   verifyWebhook is delegated to the dedicated /api/ingest/slack route
 *   because signature verification uses an app-wide secret, not the
 *   per-install config — the adapter's signature doesn't fit that model well.
 *   The route calls verifySlackSignature() directly.
 */

import type { ConnectorInstance } from '@pcs/db';
import type {
  ConnectorAdapter,
  NormalizedEvent,
  ParsedWebhookRequest,
} from '../adapter';
import { parseSlackEnvelope, type SlackEventEnvelope, type ParseContext } from './parse';

export { parseSlackEnvelope, collectSlackUserIds } from './parse';
export type { SlackEventEnvelope, ParseContext, SlackEvent } from './parse';
export { verifySlackSignature } from './signature';
export type { VerifySlackOpts, VerifySlackResult } from './signature';

/** Scopes we request from Slack at install time. */
export const SLACK_BOT_SCOPES = [
  'channels:history', // read messages in public channels the bot is in
  'channels:read', // list/inspect public channels
  'groups:history', // read messages in private channels the bot is in
  'groups:read', // list/inspect private channels
  'im:history', // direct messages with the bot
  'mpim:history', // multi-person DMs with the bot
  'users:read', // resolve user IDs → names
  'users:read.email', // resolve user IDs → emails (the high-value scope for tenant mapping)
  'team:read', // get workspace name + domain for URL construction
] as const;

export const slackAdapter: ConnectorAdapter = {
  descriptor: {
    kind: 'SLACK',
    displayName: 'Slack',
    description:
      'Capture customer-channel messages, support threads, and @-mentions as Problem evidence.',
    capabilities: { webhooks: true, backfill: false, authFlow: 'oauth2' },
  },

  /**
   * Slack only accepts events via the dedicated /api/ingest/slack route
   * (no instanceId — Slack sends to one URL across all installs and we look
   * up the tenant by team_id). If anything hits the generic
   * /api/ingest/[connector]/[instanceId] route with connector=slack, reject
   * it — that path bypasses the dedicated route's signature check.
   */
  async verifyWebhook(_req: ParsedWebhookRequest, _instance: ConnectorInstance): Promise<boolean> {
    return false;
  },

  async parseWebhook(req: ParsedWebhookRequest, instance: ConnectorInstance): Promise<NormalizedEvent[]> {
    const env = req.json as SlackEventEnvelope | undefined;
    if (!env) return [];
    const config = (instance.config ?? {}) as {
      teamId?: string;
      teamDomain?: string;
      userIndex?: Record<string, { email?: string; name?: string }>;
    };
    const ctx: ParseContext = {
      teamId: config.teamId ?? env.team_id ?? 'unknown',
      teamDomain: config.teamDomain,
      // The receiver populates userIndex on a per-call basis (via users.info).
      // Adapter-level call uses whatever's cached in config.
      userIndex: config.userIndex ?? {},
    };
    return parseSlackEnvelope(env, ctx);
  },

  /**
   * Returns the Slack OAuth start URL. Called from the server action that
   * kicks off install — the action persists `state` in a signed cookie, then
   * redirects the browser here.
   */
  async beginInstall(workspaceId: string): Promise<{ authUrl: string } | null> {
    const clientId = process.env.SLACK_CLIENT_ID;
    if (!clientId) return null;
    const redirectUri = oauthRedirectUri();
    if (!redirectUri) return null;

    const state = generateOpaqueState(workspaceId);
    const url = new URL('https://slack.com/oauth/v2/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('scope', SLACK_BOT_SCOPES.join(','));
    url.searchParams.set('user_scope', '');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return { authUrl: url.toString() };
  },
};

// ---------------------------------------------------------------------------
// OAuth helpers (exported so the callback route can reuse them)
// ---------------------------------------------------------------------------

export function oauthRedirectUri(): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/api/auth/slack/callback`;
}

/**
 * A simple opaque state: `${workspaceId}.${random}.${expiry}`. Verified by
 * the callback by checking the cookie also set at start time.
 */
export function generateOpaqueState(workspaceId: string): string {
  const expires = Date.now() + 10 * 60 * 1000;
  const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return Buffer.from(`${workspaceId}.${nonce}.${expires}`).toString('base64url');
}

export function parseState(state: string): { workspaceId: string; nonce: string; expiresAt: number } | null {
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf-8');
    const [workspaceId, nonce, expiresStr] = decoded.split('.');
    if (!workspaceId || !nonce || !expiresStr) return null;
    const expiresAt = Number.parseInt(expiresStr, 10);
    if (!Number.isFinite(expiresAt)) return null;
    return { workspaceId, nonce, expiresAt };
  } catch {
    return null;
  }
}
