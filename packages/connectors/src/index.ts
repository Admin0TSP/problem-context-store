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

export * from './adapter';
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

/**
 * Registry keyed by the string used in the `/api/ingest/[connector]` URL.
 * Note that the `SourceKind` enum has values like SLACK, DEVREV; we use the
 * lowercased version in URLs for cleanliness ("slack", "devrev", "stub").
 */
const REGISTRY: Record<string, ConnectorAdapter> = {
  stub: stubAdapter,
  slack: slackAdapter,
  gmail: gmailAdapter,
  // devrev: devrevAdapter,      // M8c
  // github: githubAdapter,      // M8c
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
