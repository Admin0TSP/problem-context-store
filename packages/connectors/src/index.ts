/**
 * @pcs/connectors — adapter registry.
 *
 * Real adapters (slack, devrev, github, gmail) get added here as they're
 * implemented in M8. For now we have the Stub so the rest of the pipeline
 * can be tested end-to-end.
 */

import type { ConnectorAdapter } from './adapter';
import { stubAdapter } from './stub';
import { slackAdapter } from './slack';
import { gmailAdapter } from './gmail';
import { devrevAdapter } from './devrev';
import { githubAdapter } from './github';

export * from './adapter';

// Cross-adapter helpers (M11.7): ticket-ID regex + extractors used by every
// parser so a customer message referencing ISS-280035 in any source clusters
// onto the same Problem.
export {
  TICKET_ID_PATTERN,
  extractTicketIdsFromString,
  ticketIdMentionsFromStrings,
} from './util/ticket-ids';
export { slackAdapter } from './slack';
export {
  parseSlackEnvelope,
  collectSlackUserIds,
  verifySlackSignature,
  oauthRedirectUri as slackOAuthRedirectUri,
  generateOpaqueState as slackGenerateState,
  parseState as slackParseState,
  SLACK_BOT_SCOPES,
} from './slack';
export type {
  SlackEventEnvelope,
  ParseContext as SlackParseContext,
  SlackEvent,
  VerifySlackOpts,
  VerifySlackResult,
} from './slack';

export { gmailAdapter } from './gmail';
export {
  parseGmailMessage,
  stripGmailHtml,
  parseFromHeader,
  gmailOAuthRedirectUri,
  generateOpaqueState as gmailGenerateState,
  parseState as gmailParseState,
  GMAIL_OAUTH_SCOPES,
} from './gmail';
export type {
  GmailMessage,
  GmailHeader,
  GmailMessagePart,
  ParseGmailContext,
} from './gmail';

export { devrevAdapter } from './devrev';
export {
  parseDevRevEvent,
  generateDevRevWebhookSecret,
  devrevOrgSlugFromId,
  DEVREV_RECOMMENDED_EVENTS,
} from './devrev';
export type {
  DevRevWebhookPayload,
  DevRevWork,
  DevRevTimelineEntry,
  DevRevPerson,
  ParseDevRevContext,
} from './devrev';

export { githubAdapter } from './github';
export {
  parseGitHubEvent,
  getInstallationIdFromPayload,
  // extractTicketIdsFromString lives at the package root via the
  // util/ticket-ids re-export above; don't re-export it again here.
  extractTicketIdMentions,
  verifyGitHubSignature,
  signAppJwt,
  getInstallationToken,
  getInstallationDetails,
  appInstallUrl as githubAppInstallUrl,
  generateOpaqueState as githubGenerateState,
  parseState as githubParseState,
  GITHUB_APP_EVENTS,
  GITHUB_APP_PERMISSIONS,
} from './github';
export type {
  GitHubWebhookPayload,
  ParseGitHubContext,
  VerifyGitHubOpts,
  VerifyGitHubResult,
  InstallationDetails,
} from './github';

/**
 * Registry keyed by the string used in the `/api/ingest/[connector]` URL.
 * Note that the `SourceKind` enum has values like SLACK, DEVREV; we use the
 * lowercased version in URLs for cleanliness ("slack", "devrev", "stub").
 */
const REGISTRY: Record<string, ConnectorAdapter> = {
  stub: stubAdapter,
  slack: slackAdapter,
  gmail: gmailAdapter,
  devrev: devrevAdapter,
  github: githubAdapter,
};

export function getAdapter(slug: string): ConnectorAdapter | null {
  return REGISTRY[slug.toLowerCase()] ?? null;
}

export function listAdapters(): ConnectorAdapter[] {
  return Object.values(REGISTRY);
}

/**
 * URL slug for a kind. Inverse of getAdapter().
 * Used to build the webhook URL on install.
 */
export function adapterSlugForKind(kind: string): string | null {
  for (const [slug, adapter] of Object.entries(REGISTRY)) {
    if (adapter.descriptor.kind === kind) return slug;
  }
  return null;
}
