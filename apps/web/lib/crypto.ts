/**
 * AES-256-GCM helper for encrypting credentials at rest.
 *
 * We use this to store Slack bot tokens (and later other OAuth tokens) in
 * ConnectorInstance.credentialsEncrypted without leaking them in plaintext
 * if the database is dumped.
 *
 * Layout of the encrypted blob (one Buffer):
 *   [ 12-byte IV ][ 16-byte authTag ][ ciphertext ]
 *
 * Key source: PCS_ENCRYPTION_KEY env var. Must be 32 bytes encoded as either:
 *   - 64 hex chars         (recommended; generate with `openssl rand -hex 32`)
 *   - base64 of 32 bytes
 *   - any string >= 32 chars (SHA-256'd to derive — convenient for dev)
 *
 * In production you'd put this in a real KMS, but env var is fine until M10.
 */

import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw = process.env.PCS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'PCS_ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32',
    );
  }

  // Hex (64 chars) → 32 bytes
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  // Base64 (44 chars with padding) → 32 bytes
  try {
    const b = Buffer.from(raw, 'base64');
    if (b.length === 32) return b;
  } catch {
    /* fallthrough */
  }

  // Fallback: SHA-256 of whatever the user gave us. Dev convenience; warn
  // because hashing a short secret gives you no extra entropy.
  if (raw.length < 32) {
    console.warn(
      '[crypto] PCS_ENCRYPTION_KEY is shorter than 32 chars and not hex/base64. ' +
        'Deriving via SHA-256 — set a real 32-byte key for production.',
    );
  }
  return createHash('sha256').update(raw).digest();
}

export function encrypt(plaintext: string | Buffer): Buffer {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const buf = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf-8') : plaintext;
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

export function decrypt(blob: Buffer): string {
  if (blob.length < IV_LEN + TAG_LEN) {
    throw new Error('Ciphertext blob is too short to be valid');
  }
  const key = getKey();
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString('utf-8');
}

/**
 * Convenience wrappers when storing in a JSON `config` column. We can't put
 * raw Buffers in JSON, so we base64-encode.
 */
export function encryptToString(plaintext: string): string {
  return encrypt(plaintext).toString('base64');
}

export function decryptFromString(b64: string): string {
  return decrypt(Buffer.from(b64, 'base64'));
}
