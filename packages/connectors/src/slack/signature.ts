/**
 * Slack request signature verification.
 *
 * Slack signs every webhook with HMAC-SHA256 over `v0:{timestamp}:{rawBody}`
 * using your app's Signing Secret. We re-compute the signature, constant-time
 * compare against the X-Slack-Signature header, and reject anything older
 * than 5 minutes (replay window per Slack's docs).
 *
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const REPLAY_WINDOW_SECONDS = 60 * 5;

export interface VerifySlackOpts {
  signingSecret: string;
  /** Raw, un-mutated request body. We MUST hash exactly what Slack sent. */
  rawBody: string;
  /** Value of X-Slack-Request-Timestamp header (unix seconds). */
  timestampHeader: string | undefined;
  /** Value of X-Slack-Signature header — looks like "v0=abcd…". */
  signatureHeader: string | undefined;
  /** Optional override of "now" for testing. */
  nowSeconds?: number;
}

export interface VerifySlackResult {
  ok: boolean;
  reason?: string;
}

export function verifySlackSignature(opts: VerifySlackOpts): VerifySlackResult {
  if (!opts.signingSecret) {
    return { ok: false, reason: 'SLACK_SIGNING_SECRET not configured on server' };
  }
  if (!opts.timestampHeader || !opts.signatureHeader) {
    return { ok: false, reason: 'Missing X-Slack-Request-Timestamp or X-Slack-Signature header' };
  }

  const ts = Number.parseInt(opts.timestampHeader, 10);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: 'Malformed X-Slack-Request-Timestamp' };
  }
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: `Timestamp outside ±${REPLAY_WINDOW_SECONDS}s replay window` };
  }

  const baseString = `v0:${opts.timestampHeader}:${opts.rawBody}`;
  const computed = 'v0=' + createHmac('sha256', opts.signingSecret).update(baseString).digest('hex');

  const a = Buffer.from(computed);
  const b = Buffer.from(opts.signatureHeader);
  if (a.length !== b.length) {
    return { ok: false, reason: 'Signature length mismatch' };
  }
  if (!timingSafeEqual(a, b)) {
    return { ok: false, reason: 'Signature mismatch' };
  }
  return { ok: true };
}
