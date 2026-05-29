/**
 * Gmail connector adapter (M8b).
 *
 * Unlike Slack, Gmail has no native push webhook out of the box (you'd need
 * to set up Google Cloud Pub/Sub for that — saved for M8b.5). For MVP we
 * POLL the Gmail API via:
 *   - users.history.list to get incremental changes since the last historyId
 *   - users.messages.get to fetch full message bodies
 *
 * Adapter responsibilities here:
 *   1. Declare the descriptor so /connectors/new shows Gmail as installable.
 *   2. Expose Google OAuth helpers (auth URL builder, scopes, redirect URI).
 *   3. parseWebhook is unused for Gmail; we ingest via the polling sync
 *      server action (apps/web/app/actions/gmail.ts).
 *   4. verifyWebhook returns false to lock down the generic webhook route
 *      (same defense as Slack).
 */

import type { ConnectorInstance } from '@pcs/db';
import type {
  ConnectorAdapter,
  NormalizedEvent,
  ParsedWebhookRequest,
} from '../adapter';

export {
  parseGmailMessage,
  stripHtml as stripGmailHtml,
  parseFromHeader,
} from './parse';
export type { GmailMessage, GmailHeader, GmailMessagePart, ParseGmailContext } from './parse';

/**
 * Scopes we request from Google at install time.
 *
 *   - gmail.readonly  → read messages (full body + headers + attachments meta).
 *                       This is a "restricted scope" — production apps need
 *                       Google's app verification. In dev mode (test users
 *                       <= 100) you can use it freely without verification.
 *   - userinfo.email  → know which Gmail account we connected.
 *   - userinfo.profile → first/last name for nicer display.
 */
export const GMAIL_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid',
] as const;

export const gmailAdapter: ConnectorAdapter = {
  descriptor: {
    kind: 'GMAIL',
    displayName: 'Gmail',
    description:
      'Capture customer-support emails as Problem evidence. Connect a Gmail inbox via Google OAuth.',
    capabilities: { webhooks: false, backfill: true, authFlow: 'oauth2' },
  },

  /**
   * Gmail uses polling (sync action), not webhooks. Lock down the generic
   * webhook receiver for this adapter so nothing can spoof events.
   */
  async verifyWebhook(_req: ParsedWebhookRequest, _instance: ConnectorInstance): Promise<boolean> {
    return false;
  },

  /** Unused — we ingest via the polling action, not webhooks. */
  async parseWebhook(_req: ParsedWebhookRequest, _instance: ConnectorInstance): Promise<NormalizedEvent[]> {
    return [];
  },

  /**
   * Build the Google OAuth start URL. The server action that kicks off the
   * install calls this, then redirects the browser there. The callback at
   * /api/auth/google/callback handles the rest.
   *
   * access_type=offline + prompt=consent forces Google to return a
   * refresh_token. Without prompt=consent, Google only returns a
   * refresh_token on the user's *first* consent — re-installs would silently
   * skip it and we'd be unable to renew access tokens.
   */
  async beginInstall(workspaceId: string): Promise<{ authUrl: string } | null> {
    const clientId = process.env.GMAIL_CLIENT_ID;
    if (!clientId) return null;
    const redirectUri = gmailOAuthRedirectUri();
    if (!redirectUri) return null;

    const state = generateOpaqueState(workspaceId);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GMAIL_OAUTH_SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', state);
    return { authUrl: url.toString() };
  },
};

// ---------------------------------------------------------------------------
// OAuth helpers (mirrored from the Slack adapter so the start/callback
// routes look familiar)
// ---------------------------------------------------------------------------

export function gmailOAuthRedirectUri(): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/api/auth/google/callback`;
}

export function generateOpaqueState(workspaceId: string): string {
  const expires = Date.now() + 10 * 60 * 1000;
  const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return Buffer.from(`${workspaceId}.${nonce}.${expires}`).toString('base64url');
}

export function parseState(
  state: string,
): { workspaceId: string; nonce: string; expiresAt: number } | null {
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
