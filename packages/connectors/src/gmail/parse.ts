/**
 * Gmail message → NormalizedEvent parsing.
 *
 * Gmail's REST response shape (users.messages.get with format=full):
 *
 *   {
 *     id: "messageId",
 *     threadId: "threadId",
 *     labelIds: ["INBOX", "UNREAD"],
 *     snippet: "First 100 chars...",
 *     historyId: "12345",
 *     internalDate: "1700000000000",  // ms since epoch as STRING
 *     payload: {
 *       headers: [{ name, value }],
 *       mimeType: "multipart/alternative",
 *       body: { data: "base64url..." },
 *       parts: [
 *         { mimeType: "text/plain", body: { data: "base64url..." } },
 *         { mimeType: "text/html",  body: { data: "base64url..." } },
 *       ]
 *     }
 *   }
 *
 * We always prefer text/plain. If only text/html is present we strip tags
 * conservatively. Both fields land on NormalizedEvent.body / bodyHtml so the
 * UI can render either later.
 *
 * Pure I/O-free — the caller is responsible for actually calling the Gmail
 * API and feeding us the JSON.
 */

import type { NormalizedEvent } from '../adapter';

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string; // ms since epoch as STRING
  payload?: GmailMessagePart;
}

export interface ParseGmailContext {
  /** Gmail address of the authenticated user, e.g. "support@theseopilot.pro". */
  ownerEmail: string;
  /** Optional: don't ingest messages from the bot user itself (auto-replies, drafts). */
  skipFromSelf?: boolean;
}

/**
 * Convert a single Gmail message into 0 or 1 NormalizedEvents.
 *
 * Returns [] when:
 *   - The message has no body (rare, drafts).
 *   - skipFromSelf=true and the sender matches the owner.
 *   - The labels suggest spam/trash/draft.
 */
export function parseGmailMessage(
  msg: GmailMessage,
  ctx: ParseGmailContext,
): NormalizedEvent[] {
  if (!msg.id || !msg.payload) return [];

  // Filter out drafts / spam / trash — never useful as customer signal.
  const labels = new Set(msg.labelIds ?? []);
  if (labels.has('DRAFT') || labels.has('SPAM') || labels.has('TRASH')) return [];

  const headers = headerMap(msg.payload.headers ?? []);
  const fromHeader = headers.get('from') ?? '';
  const subject = headers.get('subject') ?? '';
  const dateHeader = headers.get('date') ?? '';

  const { name: actorName, email: actorEmail } = parseFromHeader(fromHeader);
  if (!actorEmail) return [];

  if (ctx.skipFromSelf && actorEmail.toLowerCase() === ctx.ownerEmail.toLowerCase()) {
    return [];
  }

  const { text, html } = extractBodies(msg.payload);
  if (!text && !html) return [];

  // Prepend the subject so the resolver gets it in the embedding text. Email
  // subjects carry a lot of intent that the body sometimes buries.
  const composedBody = subject
    ? `Subject: ${subject}\n\n${text || stripHtml(html)}`
    : text || stripHtml(html);

  const timestamp = msg.internalDate
    ? new Date(Number(msg.internalDate))
    : dateHeader
      ? new Date(dateHeader)
      : new Date();

  // Gmail's thread_id maps cleanly to NormalizedEvent.parentThreadId. Multiple
  // emails in the same Gmail thread will cluster onto the same Problem via
  // the existing thread-continuity rule.
  return [
    {
      source: 'GMAIL',
      sourceId: msg.id, // Gmail IDs are globally unique within an account
      sourceUrl: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
      kind: labels.has('SENT') ? 'EMAIL_SENT' : 'EMAIL_RECEIVED',
      timestamp,
      actor: {
        name: actorName,
        email: actorEmail,
      },
      body: composedBody.slice(0, 16000), // cap to keep embeddings sane
      bodyHtml: html || undefined,
      parentThreadId: msg.threadId,
    },
  ];
}

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------

function headerMap(hs: GmailHeader[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const h of hs) {
    if (h.name && h.value) m.set(h.name.toLowerCase(), h.value);
  }
  return m;
}

/**
 * "John Doe <john@example.com>" → { name: "John Doe", email: "john@example.com" }
 * "john@example.com"            → { name: undefined, email: "john@example.com" }
 * "\"Doe, John\" <j@e.com>"     → { name: "Doe, John", email: "j@e.com" }
 */
export function parseFromHeader(raw: string): { name?: string; email?: string } {
  const angleMatch = raw.match(/^\s*("?)(.*?)\1\s*<([^>]+)>\s*$/);
  if (angleMatch) {
    const name = (angleMatch[2] ?? '').trim();
    return { name: name || undefined, email: angleMatch[3]!.trim().toLowerCase() };
  }
  const emailMatch = raw.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
  if (emailMatch) return { email: emailMatch[0].toLowerCase() };
  return {};
}

// ---------------------------------------------------------------------------
// Body extraction
// ---------------------------------------------------------------------------

/**
 * Walk the MIME tree, return the first text/plain and text/html bodies found.
 * Gmail nests multipart/alternative arbitrarily deep — we recurse.
 */
function extractBodies(part: GmailMessagePart): { text: string; html: string } {
  let text = '';
  let html = '';

  function walk(p: GmailMessagePart): void {
    if (p.mimeType === 'text/plain' && p.body?.data) {
      if (!text) text = decodeBase64Url(p.body.data);
    } else if (p.mimeType === 'text/html' && p.body?.data) {
      if (!html) html = decodeBase64Url(p.body.data);
    }
    for (const child of p.parts ?? []) {
      walk(child);
    }
  }

  walk(part);

  // Some plain messages put the body directly on payload.body without parts.
  if (!text && !html && part.body?.data) {
    const decoded = decodeBase64Url(part.body.data);
    if (part.mimeType === 'text/html') html = decoded;
    else text = decoded;
  }

  return { text, html };
}

/** Gmail uses base64url encoding (RFC 4648 §5). */
function decodeBase64Url(s: string): string {
  // pad to a multiple of 4
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  try {
    return Buffer.from(padded + padding, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

/**
 * Minimal HTML strip — for when text/plain isn't present. Removes <script>,
 * <style>, all tags, decodes a few common entities, collapses whitespace.
 * We don't pull in a full HTML library — emails are an arms race we shouldn't
 * win on. Good enough for embedding purposes.
 */
export function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(p|div|br|li|tr|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
