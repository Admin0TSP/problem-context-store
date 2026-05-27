/**
 * Connector adapter contract.
 *
 * Every source system (Slack, DevRev, GitHub, Gmail, …) implements this
 * interface. The ingest pipeline (apps/web/lib/ingestion) is fully
 * adapter-agnostic — it only knows about `ConnectorAdapter` and the
 * `NormalizedEvent` shape from @pcs/core.
 *
 *   Lifecycle of a webhook:
 *     1. POST hits /api/ingest/[kind]/[instanceId]
 *     2. Receiver loads the ConnectorInstance + finds the adapter for `kind`
 *     3. adapter.verifyWebhook(req, instance) — must return true to proceed
 *     4. adapter.parseWebhook(req, instance) returns 0..N NormalizedEvents
 *     5. Ingest pipeline persists each one, runs resolution, audit-logs
 */

import type {
  ConnectorInstance,
  SourceKind,
  EventKind,
  MentionKind,
} from '@pcs/db';

/** Headers and body extracted from the incoming HTTP request. */
export interface ParsedWebhookRequest {
  /** Lowercase header name → value (or array of values). */
  headers: Record<string, string | string[] | undefined>;
  /** Raw body bytes — needed for HMAC signature verification. */
  rawBody: string;
  /** Parsed JSON body (or undefined if not JSON). */
  json: unknown;
  /** Query string params from the URL. */
  query: Record<string, string>;
}

/** What a connector returns to the ingest pipeline. */
export interface NormalizedEvent {
  source: SourceKind;
  /** Stable ID in the source system. (source, sourceId) is the dedup key. */
  sourceId: string;
  sourceUrl?: string;
  kind: EventKind;
  timestamp: Date;
  actor: {
    name?: string;
    email?: string;
    /** ID in the source system, e.g. Slack user ID, GitHub login. */
    sourceId?: string;
  };
  body: string;
  bodyHtml?: string;
  parentThreadId?: string;
  mentions?: Array<{ kind: MentionKind; value: string }>;
  /** If the connector already resolved client/problem deterministically. */
  resolutionHints?: {
    clientId?: string;
    problemId?: string;
    reason?: string;
  };
}

/** Capability bits declared by an adapter. */
export interface ConnectorCapabilities {
  /** Receives realtime webhooks (vs. only polling). */
  webhooks: boolean;
  /** Can backfill historical data from a cursor. */
  backfill: boolean;
  /** Auth flow the install UI should render. */
  authFlow: 'oauth2' | 'apikey' | 'none';
}

/** Descriptor used by the install UI. */
export interface ConnectorDescriptor {
  kind: SourceKind;
  displayName: string;
  description: string;
  capabilities: ConnectorCapabilities;
}

/** Result of a poll / backfill iteration. */
export interface PollResult {
  events: NormalizedEvent[];
  nextCursor: string | null;
  /** True when the source has no more historical data behind `nextCursor`. */
  done: boolean;
}

export interface ConnectorAdapter {
  descriptor: ConnectorDescriptor;

  /**
   * Verify the request actually came from the source system.
   * Most real adapters HMAC-check a signature header against the raw body.
   * Stub adapter: checks a query-string token.
   */
  verifyWebhook(req: ParsedWebhookRequest, instance: ConnectorInstance): Promise<boolean>;

  /**
   * Translate the verified payload into 0..N NormalizedEvents.
   * One incoming webhook can produce multiple events (e.g. a Slack thread
   * fetch returning many messages).
   */
  parseWebhook(req: ParsedWebhookRequest, instance: ConnectorInstance): Promise<NormalizedEvent[]>;

  /**
   * Optional: historical backfill. Drives a background job that walks the
   * source from `cursor` forward in time.
   */
  pollSince?(instance: ConnectorInstance, cursor: string | null): Promise<PollResult>;

  /**
   * Optional: generate a fresh OAuth URL / API-key prompt for installation.
   * Stub adapter: returns null (no auth).
   */
  beginInstall?(workspaceId: string): Promise<{ authUrl: string } | null>;
}
