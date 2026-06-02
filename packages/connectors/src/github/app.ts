/**
 * GitHub App authentication primitives.
 *
 *   - signAppJwt()             — RS256-sign a 9-minute JWT with the app's
 *                                 private key. Used as a Bearer token to
 *                                 hit the /app/installations/* endpoints.
 *   - getInstallationToken()   — exchange the JWT for a 1-hour installation
 *                                 access token. Cached in memory for 50 min.
 *   - getInstallationDetails() — fetch the account + repo selection for an
 *                                 installation (used on the OAuth callback).
 *
 * GitHub App auth model:
 *
 *   1. You (the app developer) hold the app's private key.
 *   2. To call GitHub APIs as the app you sign a short-lived JWT with it.
 *      The JWT contains your appId in `iss`.
 *   3. To call APIs scoped to a specific installation (e.g. read issues in
 *      one org's repos) you exchange that JWT for an installation token
 *      via POST /app/installations/{id}/access_tokens. Installation tokens
 *      expire after 1 hour and are scoped to whatever permissions the
 *      install was granted.
 *   4. Webhooks are signed by the app-wide webhook secret, separately
 *      from the JWT/token mechanism (see signature.ts).
 *
 * No external deps — Node's native crypto handles RS256 fine.
 */

import { createSign, createPrivateKey } from 'node:crypto';

// ---------------------------------------------------------------------------
// Env access
// ---------------------------------------------------------------------------

/** Returns the app's numeric ID from GITHUB_APP_ID. Throws if unset. */
function appId(): string {
  const v = process.env.GITHUB_APP_ID;
  if (!v) throw new Error('GITHUB_APP_ID env var is not set');
  return v;
}

/**
 * Returns the app's PEM private key from GITHUB_APP_PRIVATE_KEY.
 *
 * Heads-up on multi-line PEM in .env:
 *   - You can paste the literal `-----BEGIN…-----` block surrounded by
 *     double quotes — most env loaders preserve newlines inside quoted
 *     values. dotenv does. dotenv-cli (which this project uses) does too.
 *   - If your platform mangles newlines, set the var with `\n` escapes
 *     and the helper below converts them.
 */
function privateKeyPem(): string {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!raw) throw new Error('GITHUB_APP_PRIVATE_KEY env var is not set');
  // Common pitfall: env loaders that don't preserve newlines. Allow both
  // real newlines and the `\n` escape.
  return raw.includes('-----BEGIN') ? raw.replace(/\\n/g, '\n') : raw;
}

// ---------------------------------------------------------------------------
// JWT signing (RS256, native crypto)
// ---------------------------------------------------------------------------

function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Sign a short-lived JWT for the GitHub App itself.
 *
 *   - alg:  RS256
 *   - iat:  now - 60s    (clock skew tolerance)
 *   - exp:  now + 9 min  (GitHub max is 10; we leave 1m buffer)
 *   - iss:  appId
 *
 * The returned JWT goes in the Authorization header as `Bearer <jwt>`.
 */
export function signAppJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: appId(),
    }),
  );
  const signingInput = `${header}.${payload}`;
  const key = createPrivateKey(privateKeyPem());
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(key, 'base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${signingInput}.${signature}`;
}

// ---------------------------------------------------------------------------
// Installation tokens (cached in memory)
// ---------------------------------------------------------------------------

interface CachedToken {
  token: string;
  expiresAt: number; // ms epoch
}

const installationTokens = new Map<string, CachedToken>();

/**
 * Get a valid installation access token for the given installation_id.
 * Cached for ~50 min — GitHub tokens are valid for 1 hour, we refresh
 * 10 min early to leave room for clock skew.
 */
export async function getInstallationToken(installationId: number | string): Promise<string> {
  const key = String(installationId);
  const cached = installationTokens.get(key);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }

  const jwt = signAppJwt();
  const res = await fetch(`https://api.github.com/app/installations/${key}/access_tokens`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `GitHub installation token exchange failed: ${res.status} ${body.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as { token?: string; expires_at?: string };
  if (!json.token) {
    throw new Error('GitHub returned no installation token');
  }
  const expiresAt = json.expires_at
    ? new Date(json.expires_at).getTime() - 10 * 60 * 1000 // refresh 10 min early
    : Date.now() + 50 * 60 * 1000;

  installationTokens.set(key, { token: json.token, expiresAt });
  return json.token;
}

// ---------------------------------------------------------------------------
// Installation metadata (used on the OAuth callback to populate the UI)
// ---------------------------------------------------------------------------

export interface InstallationDetails {
  id: number;
  /** Org or user the app is installed on. */
  account: {
    login?: string;
    type?: string;     // "User" or "Organization"
    htmlUrl?: string;
    avatarUrl?: string;
  };
  /** "all" or "selected". */
  repositorySelection: 'all' | 'selected' | string;
  /** Subset of repos if selection=selected. */
  repositories?: Array<{
    id: number;
    fullName: string;
    htmlUrl: string;
    private: boolean;
  }>;
  /** Permissions GitHub granted to the app on this install. */
  permissions?: Record<string, string>;
  /** Webhook events the app is subscribed to. */
  events?: string[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Fetch installation details for display in the connector detail page.
 * Uses the app JWT (not an installation token) since we're asking
 * meta-information about the installation itself.
 */
export async function getInstallationDetails(
  installationId: number | string,
): Promise<InstallationDetails | null> {
  const jwt = signAppJwt();
  const res = await fetch(`https://api.github.com/app/installations/${installationId}`, {
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) {
    console.warn(`[github/app] getInstallationDetails failed: ${res.status}`);
    return null;
  }
  const inst = (await res.json()) as any;
  const details: InstallationDetails = {
    id: inst.id,
    account: {
      login: inst.account?.login,
      type: inst.account?.type,
      htmlUrl: inst.account?.html_url,
      avatarUrl: inst.account?.avatar_url,
    },
    repositorySelection: inst.repository_selection ?? 'selected',
    permissions: inst.permissions,
    events: inst.events,
    createdAt: inst.created_at,
    updatedAt: inst.updated_at,
  };

  // For "selected" repository_selection, fetch the actual repo list using
  // an installation token. For "all" we don't enumerate — could be 1000+.
  if (details.repositorySelection === 'selected') {
    try {
      const token = await getInstallationToken(installationId);
      const reposRes = await fetch(`https://api.github.com/installation/repositories?per_page=100`, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
      });
      if (reposRes.ok) {
        const j = (await reposRes.json()) as { repositories?: any[] };
        details.repositories = (j.repositories ?? []).map((r) => ({
          id: r.id,
          fullName: r.full_name,
          htmlUrl: r.html_url,
          private: r.private,
        }));
      }
    } catch (err) {
      console.warn('[github/app] listing repos failed (non-fatal):', err);
    }
  }

  return details;
}

/**
 * Build the install URL for the configured GitHub App.
 * Format: https://github.com/apps/<name>/installations/new?state=<state>
 *
 * Customer clicks the URL → picks repos → GitHub redirects back to your
 * callback URL with installation_id + setup_action in the query string.
 */
export function appInstallUrl(state: string): string | null {
  const name = process.env.GITHUB_APP_NAME;
  if (!name) return null;
  const url = new URL(`https://github.com/apps/${encodeURIComponent(name)}/installations/new`);
  url.searchParams.set('state', state);
  return url.toString();
}

/** OAuth state helpers — identical pattern to Slack/Gmail. */
export function generateOpaqueState(workspaceId: string): string {
  const expires = Date.now() + 10 * 60 * 1000;
  const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return Buffer.from(`${workspaceId}.${nonce}.${expires}`).toString('base64url');
}

export function parseState(
  state: string,
): { workspaceId: string; nonce: string; expiresAt: number } | null {
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf-8');
    const [workspaceId, nonce, expiresStr] = decoded.split('.');
    if (!workspaceId || !nonce || !expiresStr) return null;
    const expiresAt = Number.parseInt(expiresStr, 10);
    if (!Number.isFinite(expiresAt)) return null;
    return { workspaceId, nonce, expiresAt };
  } catch {
    return null;
  }
}
