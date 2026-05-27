/**
 * Domain types shared across the app, the worker, and connectors.
 */

import type {
  SourceKind,
  EventKind,
  ProblemStatus,
  Severity,
  ResolutionMethod,
} from '@pcs/db';

/**
 * Normalized event shape produced by every connector.
 *
 * Connectors translate their source-specific payloads into this shape, and the
 * resolution layer (M6) decides which Client and which Problem it belongs to.
 */
export interface NormalizedEvent {
  source: SourceKind;
  sourceId: string;
  sourceUrl?: string;
  kind: EventKind;
  timestamp: Date;
  actor: {
    name?: string;
    email?: string;
    sourceId?: string;
  };
  body: string;
  bodyHtml?: string;
  parentThreadId?: string;
  mentions?: Array<{
    kind: 'USER_EMAIL' | 'USER_HANDLE' | 'CLIENT_NAME' | 'TICKET_ID' | 'PR_URL' | 'URL' | 'HASHTAG';
    value: string;
  }>;
  /** Reference to the raw payload stored in object storage. */
  rawPayloadRef?: string;
}

/**
 * Result of resolving an event to a Client.
 */
export interface ClientResolution {
  clientId: string | null;
  confidence: number; // 0..1
  method: ResolutionMethod;
  reason?: string;
}

/**
 * Result of resolving an event to a Problem.
 * `null` clientId/problemId means the resolver didn't find a confident match.
 */
export interface ProblemResolution {
  problemId: string | null;
  confidence: number; // 0..1
  method: ResolutionMethod;
  reason?: string;
  /** If the resolver thinks this should spawn a NEW problem, it returns this. */
  newProblem?: {
    title: string;
    description?: string;
    severity?: Severity;
  };
}

/**
 * A connector's identity + capabilities.
 */
export interface ConnectorDescriptor {
  kind: SourceKind;
  displayName: string;
  /** Whether this connector supports webhook ingestion. */
  supportsWebhooks: boolean;
  /** Whether this connector supports historical backfill. */
  supportsBackfill: boolean;
  /** Auth flow shape — keeps the UI honest about what to render. */
  authFlow: 'oauth2' | 'apikey' | 'none';
}

/**
 * Status badge styling — single source of truth for the UI.
 */
export const PROBLEM_STATUS_TONES: Record<ProblemStatus, { label: string; tone: 'neutral' | 'info' | 'warn' | 'success' | 'muted' }> = {
  OPEN: { label: 'Open', tone: 'warn' },
  INVESTIGATING: { label: 'Investigating', tone: 'info' },
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  AWAITING_CUSTOMER: { label: 'Awaiting customer', tone: 'muted' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'muted' },
  ARCHIVED: { label: 'Archived', tone: 'muted' },
};

export const SEVERITY_TONES: Record<Severity, { label: string; className: string }> = {
  LOW: { label: 'Low', className: 'text-severity-low' },
  MEDIUM: { label: 'Medium', className: 'text-severity-medium' },
  HIGH: { label: 'High', className: 'text-severity-high' },
  CRITICAL: { label: 'Critical', className: 'text-severity-critical' },
};
