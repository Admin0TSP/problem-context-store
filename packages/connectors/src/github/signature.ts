/**
 * GitHub webhook signature verification.
 *
 * GitHub signs every webhook delivery with HMAC-SHA256 over the raw body
 * using the webhook secret you configured in the webhook settings. The
 * computed signature is sent in the `X-Hub-Signature-256` header as
 * `sha256=<hex>`.
 *
 * Docs: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 *
 * Notes:
 *   - GitHub also sends a legacy `X-Hub-Signature` (SHA-1). We do NOT
 *     accept it — SHA-256 has been GA since 2019 and is the recommended
 *     algorithm. Rejecting SHA-1 protects against downgrade attacks.
 *   - There is no timestamp header on GitHub webhooks, so there's no
 *     replay window check — GitHub relies on the signature alone to
 *     prove authenticity. We mirror that.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifyGitHubOpts {
  webhookSecret: string;
  /** The raw, unparsed request body — exactly the bytes GitHub signed. */
  rawBody: string;
  /** Value of the X-Hub-Signature-256 header. Format: "sha256=<hex>". */
  signatureHeader: string | undefined;
}

export interface VerifyGitHubResult {
  ok: boolean;
  reason?: string;
}

export function verifyGitHubSignature(opts: VerifyGitHubOpts): VerifyGitHubResult {
  if (!opts.webhookSecret) {
    return { ok: false, reason: 'Webhook secret not configured on the connector instance' };
  }
  if (!opts.signatureHeader) {
    return { ok: false, reason: 'Missing X-Hub-Signature-256 header' };
  }
  if (!opts.signatureHeader.startsWith('sha256=')) {
    return { ok: false, reason: 'Unexpected signature format — expected sha256=<hex>' };
  }

  const expected =
    'sha256=' +
    createHmac('sha256', opts.webhookSecret).update(opts.rawBody).digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(opts.signatureHeader);
  if (a.length !== b.length) {
    return { ok: false, reason: 'Signature length mismatch' };
  }
  if (!timingSafeEqual(a, b)) {
    return { ok: false, reason: 'Signature mismatch' };
  }
  return { ok: true };
}
