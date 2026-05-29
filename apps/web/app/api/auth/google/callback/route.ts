/**
 * Google (Gmail) OAuth — callback route.
 *
 *   GET /api/auth/google/callback?code=...&state=...
 *
 * 1. Verify state matches the cookie set at /start.
 * 2. Decode + expiry-check the state.
 * 3. Exchange the code for access_token + refresh_token at
 *    https://oauth2.googleapis.com/token.
 * 4. Fetch the user's email + profile via userinfo endpoint.
 * 5. Fetch Gmail's current historyId (baseline for incremental sync).
 * 6. Encrypt the refresh_token and upsert a ConnectorInstance keyed on
 *    (workspaceId, kind=GMAIL, ownerEmail). Re-installing the same Gmail
 *    account replaces tokens + scopes; the historyId baseline is kept so
 *    we don't re-ingest history.
 * 7. Redirect to /connectors/[id].
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma, ConnectorStatus, MembershipRole, SourceKind } from '@pcs/db';
import { getSession } from '@/lib/auth';
import { gmailOAuthRedirectUri, gmailParseState } from '@pcs/connectors';
import { encryptToString } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'gmail_oauth_state';

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfo {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

interface GmailProfile {
  emailAddress?: string;
  messagesTotal?: number;
  threadsTotal?: number;
  historyId?: string;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError) {
    return errorBounce(`Google returned: ${oauthError}`);
  }
  if (!code || !state) {
    return errorBounce('Missing `code` or `state` in callback URL.');
  }

  // ---- 1. CSRF check ----
  const cookieState = cookies().get(STATE_COOKIE)?.value;
  cookies().delete(STATE_COOKIE);
  if (!cookieState || cookieState !== state) {
    return errorBounce('OAuth state mismatch — possible CSRF, refusing.');
  }

  // ---- 2. State expiry + workspace match ----
  const parsed = gmailParseState(state);
  if (!parsed) return errorBounce('Malformed state parameter.');
  if (Date.now() > parsed.expiresAt) return errorBounce('OAuth flow expired — please try again.');

  const session = await getSession();
  if (session.workspace.id !== parsed.workspaceId) {
    return errorBounce(
      'You switched workspaces during the OAuth handshake. Start the install again from the new workspace.',
    );
  }
  if (
    session.membership.role !== MembershipRole.OWNER &&
    session.membership.role !== MembershipRole.ADMIN
  ) {
    return errorBounce('Only Admins or Owners can install connectors.');
  }

  // ---- 3. Server config ----
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = gmailOAuthRedirectUri();
  if (!clientId || !clientSecret || !redirectUri) {
    return errorBounce('Server misconfigured: missing GMAIL_CLIENT_ID / SECRET / NEXT_PUBLIC_APP_URL.');
  }

  // ---- 4. Code → tokens ----
  let tokens: GoogleTokenResponse;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });
    tokens = (await tokenRes.json()) as GoogleTokenResponse;
  } catch (err) {
    return errorBounce(
      `Token exchange failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!tokens.access_token || tokens.error) {
    return errorBounce(
      `Google rejected the code: ${tokens.error ?? 'unknown'} ${tokens.error_description ?? ''}`,
    );
  }
  if (!tokens.refresh_token) {
    return errorBounce(
      'Google did not return a refresh_token. This usually means the user already had a consent for this app and Google reused the old one. ' +
        'Try revoking access at https://myaccount.google.com/permissions and re-installing.',
    );
  }

  // ---- 5. Who is this? Fetch userinfo + Gmail profile ----
  let userInfo: GoogleUserInfo = {};
  try {
    const u = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    userInfo = (await u.json()) as GoogleUserInfo;
  } catch (err) {
    console.error('[gmail/callback] userinfo fetch failed (non-fatal):', err);
  }

  let gmailProfile: GmailProfile = {};
  try {
    const p = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    gmailProfile = (await p.json()) as GmailProfile;
  } catch (err) {
    console.error('[gmail/callback] gmail profile fetch failed:', err);
  }

  const ownerEmail = (gmailProfile.emailAddress ?? userInfo.email ?? '').toLowerCase();
  if (!ownerEmail) {
    return errorBounce('Could not determine which Gmail account was authorized.');
  }

  // ---- 6. Upsert ConnectorInstance ----
  const existing = await prisma.connectorInstance.findMany({
    where: { workspaceId: session.workspace.id, kind: SourceKind.GMAIL },
  });
  const sameAccount = existing.find((i) => (i.config as any)?.ownerEmail === ownerEmail);

  const refreshTokenEnc = encryptToString(tokens.refresh_token);
  // Initial historyId baseline — future syncs use this as the cursor so we
  // only get NEW messages, not the entire mailbox.
  const baselineHistoryId = gmailProfile.historyId ?? null;

  const config = {
    ownerEmail,
    ownerName: userInfo.name ?? null,
    refreshTokenEnc,
    scope: tokens.scope ?? null,
    historyId: sameAccount
      ? (sameAccount.config as any)?.historyId ?? baselineHistoryId
      : baselineHistoryId,
    installedAt: new Date().toISOString(),
  };

  let instanceId: string;
  if (sameAccount) {
    await prisma.connectorInstance.update({
      where: { id: sameAccount.id },
      data: {
        status: ConnectorStatus.ACTIVE,
        lastError: null,
        config,
      },
    });
    instanceId = sameAccount.id;
  } else {
    const baseName = ownerEmail; // use email as display name
    const allNames = new Set(existing.map((i) => i.displayName));
    let displayName = baseName;
    let n = 2;
    while (allNames.has(displayName)) displayName = `${baseName} #${n++}`;

    const created = await prisma.connectorInstance.create({
      data: {
        workspaceId: session.workspace.id,
        kind: SourceKind.GMAIL,
        displayName,
        status: ConnectorStatus.ACTIVE,
        config,
      },
    });
    instanceId = created.id;
  }

  await prisma.auditLog.create({
    data: {
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      action: sameAccount ? 'connector.reinstall' : 'connector.install',
      targetType: 'connector_instance',
      targetId: instanceId,
      metadata: { kind: 'GMAIL', ownerEmail, historyId: baselineHistoryId },
    },
  });

  return NextResponse.redirect(
    `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') || ''}/connectors/${instanceId}`,
  );
}

function errorBounce(message: string): NextResponse {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') || '';
  return NextResponse.redirect(
    `${base}/connectors?error=${encodeURIComponent(`Gmail OAuth: ${message}`)}`,
  );
}
