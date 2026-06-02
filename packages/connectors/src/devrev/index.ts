/**
 * DevRev connector adapter (M8c).
 *
 *   Auth flow:    apikey (Personal Access Token + Org ID)
 *   Webhook URL:  /api/ingest/devrev/[instanceId]?token=<webhookSecret>
 *   Verification: token comparison against instance.config.webhookSecret
 *
 * Why token-based, not HMAC: DevRev's HMAC webhook signing isn't uniformly
 * available across all DevRev plans. A shared-secret query token works
 * everywhere and is the same pattern the Stub adapter uses. Easy to upgrade
 * to HMAC later once we verify the customer's DevRev tier supports it.
 *
 * What ends up in instance.config:
 *   {
 *     orgId:          "DEV-acmecorp"
 *     orgSlug:        "acmecorp"           (derived from orgId, used for URLs)
 *     patEnc:         "<AES-encrypted PAT>"  (for future REST API calls)
 *     webhookSecret:  "<32 random chars>"
 *   }
 */

import type { ConnectorInstance } from '@pcs/db';
import type {
  ConnectorAdapter,
  NormalizedEvent,
  ParsedWebhookRequest,
} from '../adapter';
import { parseDevRevEvent, type DevRevWebhookPayload } from './parse';

export {
  parseDevRevEvent,
  type DevRevWebhookPayload,
  type DevRevWork,
  type DevRevTimelineEntry,
  type DevRevPerson,
  type ParseDevRevContext,
} from './parse';

/**
 * Webhook event types we recommend subscribing to in DevRev's webhook config.
 * Other events are accepted and silently dropped by the parser.
 */
export const DEVREV_RECOMMENDED_EVENTS = [
  'work_created',
  'work_updated',
  'timeline_entry_created',
] as const;

export const devrevAdapter: ConnectorAdapter = {
  descriptor: {
    kind: 'DEVREV',
    displayName: 'DevRev',
    description:
      'Pull DevRev tickets, work updates, and external customer comments into the resolver. Token-based auth.',
    capabilities: { webhooks: true, backfill: false, authFlow: 'apikey' },
  },

  async verifyWebhook(req: ParsedWebhookRequest, instance: ConnectorInstance): Promise<boolean> {
    const config = (instance.config ?? {}) as { webhookSecret?: string };
    const expected = config.webhookSecret;
    if (!expected) return false;
    // Accept the secret via query token OR custom header — DevRev's webhook
    // configuration form sometimes mangles URLs, so we also fall back to a
    // header. The Stub adapter does the same trick.
    const given =
      req.query.token ||
      (req.headers['x-pcs-devrev-token'] as string | undefined) ||
      (req.headers['x-devrev-token'] as string | undefined);
    if (!given || given.length < 8) return false;
    // Constant-time-ish compare. Not crypto-grade but adequate against
    // length-disclosure timing attacks for a 32-char random token.
    if (given.length !== expected.length) return false;
    let mismatch = 0;
    for (let i = 0; i < given.length; i++) {
      mismatch |= given.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return mismatch === 0;
  },

  async parseWebhook(req: ParsedWebhookRequest, instance: ConnectorInstance): Promise<NormalizedEvent[]> {
    const payload = req.json as DevRevWebhookPayload | undefined;
    if (!payload) return [];
    const config = (instance.config ?? {}) as { orgSlug?: string };
    return parseDevRevEvent(payload, { orgSlug: config.orgSlug });
  },
};

/**
 * Generate a webhook secret at install time. URL-safe, 32 chars.
 * Stored in instance.config.webhookSecret and surfaced to the user as part
 * of the webhook URL (`?token=<secret>`).
 */
export function generateDevRevWebhookSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

/**
 * Extract the user-friendly org slug from a DevRev org ID.
 *   "DEV-acmecorp"      → "acmecorp"
 *   "acmecorp"          → "acmecorp"
 *   "DEV-acmecorp/..."  → "acmecorp"
 */
export function devrevOrgSlugFromId(orgId: string): string {
  const trimmed = orgId.trim();
  const afterPrefix = trimmed.replace(/^DEV-/i, '');
  return afterPrefix.split('/')[0]!.toLowerCase();
}
