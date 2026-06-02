/**
 * GitHub connector adapter (M11.5 — GitHub App install).
 *
 * Architecture mirrors Slack:
 *
 *   - A single GitHub App lives in Anthropic-org-level config (one App ID,
 *     one private key, one webhook secret — see `app.ts` and `signature.ts`).
 *   - Customers click "Install on GitHub" → land on the App's install page →
 *     pick a repo or whole org → GitHub posts to our callback with the
 *     `installation_id` in the query string.
 *   - We persist a ConnectorInstance with `config.installationId` and pull
 *     the account login + repo list to render in the UI.
 *   - All webhooks from all installs hit ONE app-wide URL
 *     (`/api/ingest/github` — no instanceId in the path). The receiver:
 *       1. Verifies the HMAC against the app-wide webhook secret.
 *       2. Reads `installation.id` from the payload body.
 *       3. Looks up the ConnectorInstance with that installationId.
 *       4. Calls this adapter's parseWebhook().
 *
 * Why webhook verification doesn't run in `verifyWebhook` here:
 *   The HMAC secret is app-wide, not per-install. The adapter contract
 *   wants per-instance verification, which doesn't apply. Like Slack, we
 *   put HMAC checking in the dedicated route and return `false` from
 *   `verifyWebhook` so the generic /api/ingest/[kind]/[instanceId] route
 *   refuses anything addressed to GitHub. Slack does the same.
 *
 * What lives in instance.config (M11.5 shape):
 *   {
 *     installationId:        12345678,
 *     accountLogin:          "shipsy-eng",
 *     accountType:           "Organization" | "User",
 *     accountHtmlUrl:        "https://github.com/shipsy-eng",
 *     accountAvatarUrl:      "...",
 *     repositorySelection:   "all" | "selected",
 *     repositories:          [{ id, fullName, htmlUrl, private }] (only when selection=selected),
 *     permissions:           { issues: "read", pull_requests: "read", ... },
 *     events:                ["issues", "pull_request", ...],
 *     includeBots:           false,
 *     installedAt:           "ISO-8601 string"
 *   }
 *
 * The M11 personal-webhook config shape (`webhookSecret`, no installationId)
 * is no longer produced. Old instances that still have it can be uninstalled
 * + reinstalled to migrate — the dedicated webhook receiver routes purely
 * by installationId now, so they would no longer receive events anyway.
 */

import type { ConnectorInstance } from '@pcs/db';
import type {
  ConnectorAdapter,
  NormalizedEvent,
  ParsedWebhookRequest,
} from '../adapter';
import { parseGitHubEvent, type GitHubWebhookPayload } from './parse';
import { appInstallUrl, generateOpaqueState } from './app';

export {
  parseGitHubEvent,
  getInstallationIdFromPayload,
  extractTicketIdsFromString,
  extractTicketIdMentions,
  type GitHubWebhookPayload,
  type ParseGitHubContext,
} from './parse';
export {
  verifyGitHubSignature,
  type VerifyGitHubOpts,
  type VerifyGitHubResult,
} from './signature';
export {
  signAppJwt,
  getInstallationToken,
  getInstallationDetails,
  appInstallUrl,
  generateOpaqueState,
  parseState,
  type InstallationDetails,
} from './app';

/**
 * Events the GitHub App subscribes to in its app manifest. The parser
 * silently drops anything else, so subscribing to extra events is harmless
 * — but each extra event costs a webhook delivery + signature verification.
 *
 * These are also the events the docs/github-app-setup.md instructs the user
 * to enable when registering the App in the GitHub developer portal.
 */
export const GITHUB_APP_EVENTS = [
  'pull_request',
  'issues',
  'issue_comment',
  'pull_request_review',
  'pull_request_review_comment',
] as const;

/**
 * Permissions the GitHub App requests. Read-only across the board — PCS
 * never writes to GitHub. These map to the "permissions" object inside the
 * App's manifest / settings page.
 */
export const GITHUB_APP_PERMISSIONS = {
  issues: 'read',
  pull_requests: 'read',
  contents: 'read',         // for repository metadata; safe minimum
  metadata: 'read',         // always required
  members: 'read',          // org installs: see who's on the org
} as const;

export const githubAdapter: ConnectorAdapter = {
  descriptor: {
    kind: 'GITHUB',
    displayName: 'GitHub',
    description:
      'Pull GitHub PRs, issues, and review comments into the resolver via a one-click GitHub App install.',
    capabilities: { webhooks: true, backfill: false, authFlow: 'oauth2' },
  },

  /**
   * GitHub webhooks only arrive at the dedicated /api/ingest/github route
   * (no instanceId — the App sends to one URL across all installs and we
   * route by installation.id). Anything hitting the generic
   * /api/ingest/[connector]/[instanceId] route addressed to GitHub bypasses
   * that lookup + signature check, so reject it outright. Slack does the
   * same.
   */
  async verifyWebhook(_req: ParsedWebhookRequest, _instance: ConnectorInstance): Promise<boolean> {
    return false;
  },

  async parseWebhook(
    req: ParsedWebhookRequest,
    instance: ConnectorInstance,
  ): Promise<NormalizedEvent[]> {
    const eventName =
      ((req.headers['x-github-event'] ?? req.headers['X-GitHub-Event']) as string | undefined) ??
      '';
    const payload = req.json as GitHubWebhookPayload | undefined;
    if (!payload || !eventName) return [];

    const config = (instance.config ?? {}) as { includeBots?: boolean };
    return parseGitHubEvent(payload, {
      eventName,
      includeBots: !!config.includeBots,
    });
  },

  /**
   * Returns the GitHub App install URL. The /api/auth/github/start route
   * sets a signed `state` cookie and 302s here.
   *
   * Returns null if GITHUB_APP_NAME isn't configured — surfaces a clean
   * "App not configured" error in the install UI rather than a broken URL.
   */
  async beginInstall(workspaceId: string): Promise<{ authUrl: string } | null> {
    const state = generateOpaqueState(workspaceId);
    const url = appInstallUrl(state);
    if (!url) return null;
    return { authUrl: url };
  },
};
