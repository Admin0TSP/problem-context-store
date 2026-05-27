/**
 * Stub adapter — the connector you install to test the whole pipeline
 * without any OAuth or external service.
 *
 *   Webhook URL accepts a JSON body of one or more NormalizedEvent-shaped
 *   objects (loose schema; we coerce). Verification is a shared-secret
 *   token in the query string (so unsigned curl calls fail).
 *
 *   Real adapters (Slack, DevRev, etc.) use real signatures.
 */

import type { ConnectorInstance, SourceKind, EventKind } from '@pcs/db';
import type {
  ConnectorAdapter,
  NormalizedEvent,
  ParsedWebhookRequest,
} from '../adapter';

const VALID_SOURCES: SourceKind[] = [
  'SLACK',
  'DEVREV',
  'GITHUB',
  'GMAIL',
  'GOOGLE_DRIVE',
  'MEETING_TRANSCRIPT',
  'MANUAL_NOTE',
  'EMAIL_IN',
  'WEB_CLIP',
  'PHONE_CALL',
];

const VALID_EVENT_KINDS: EventKind[] = [
  'MESSAGE',
  'TICKET_CREATED',
  'TICKET_UPDATED',
  'TICKET_RESOLVED',
  'PR_OPENED',
  'PR_MERGED',
  'PR_CLOSED',
  'COMMIT',
  'CALL_TRANSCRIPT',
  'EMAIL_SENT',
  'EMAIL_RECEIVED',
  'DOC_UPDATED',
  'STATUS_CHANGE',
  'NOTE',
];

export const stubAdapter: ConnectorAdapter = {
  descriptor: {
    kind: 'STUB' as SourceKind, // placeholder — see note below
    displayName: 'Stub (testing)',
    description:
      'A fake connector for testing the ingest pipeline. Submit events via the UI or curl to its webhook URL.',
    capabilities: { webhooks: true, backfill: false, authFlow: 'none' },
  },

  async verifyWebhook(req: ParsedWebhookRequest, instance: ConnectorInstance): Promise<boolean> {
    const config = (instance.config ?? {}) as { webhookToken?: string };
    const expected = config.webhookToken;
    if (!expected) return false;
    const given = req.query.token || (req.headers['x-pcs-stub-token'] as string | undefined);
    return given === expected;
  },

  async parseWebhook(req: ParsedWebhookRequest): Promise<NormalizedEvent[]> {
    const payload = req.json;
    if (!payload || typeof payload !== 'object') return [];

    const items = Array.isArray(payload) ? payload : [payload];
    const out: NormalizedEvent[] = [];

    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;

      const source = (r.source as SourceKind) ?? 'WEB_CLIP';
      if (!VALID_SOURCES.includes(source) && source !== ('STUB' as SourceKind)) continue;

      const kind = (r.kind as EventKind) ?? 'MESSAGE';
      if (!VALID_EVENT_KINDS.includes(kind)) continue;

      const body = typeof r.body === 'string' ? r.body : '';
      if (!body.trim()) continue;

      out.push({
        source: source,
        sourceId: String(r.sourceId ?? `stub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        sourceUrl: typeof r.sourceUrl === 'string' ? r.sourceUrl : undefined,
        kind,
        timestamp: r.timestamp ? new Date(String(r.timestamp)) : new Date(),
        actor: {
          name: typeof r.actorName === 'string' ? r.actorName : undefined,
          email: typeof r.actorEmail === 'string' ? r.actorEmail : undefined,
          sourceId: typeof r.actorSourceId === 'string' ? r.actorSourceId : undefined,
        },
        body,
        bodyHtml: typeof r.bodyHtml === 'string' ? r.bodyHtml : undefined,
        parentThreadId: typeof r.parentThreadId === 'string' ? r.parentThreadId : undefined,
        resolutionHints: {
          clientId: typeof r.clientId === 'string' ? r.clientId : undefined,
          problemId: typeof r.problemId === 'string' ? r.problemId : undefined,
        },
      });
    }

    return out;
  },
};
