/**
 * Slack OAuth — callback route.
 *
 *   GET /api/auth/slack/callback?code=...&state=...
 *
 * 1. Verify the state matches the cookie we set at /api/auth/slack/start.
 * 2. Verify state hasn't expired and decodes to a real workspace.
 * 3. Exchange `code` for a bot token via Slack's oauth.v2.access.
 * 4. Encrypt the bot token, then upsert a ConnectorInstance keyed on
 *    (workspaceId, kind=SLACK, team_id) so re-installing the same Slack
 *    workspace updates the existing row instead of creating duplicates.
 * 5. Redirect the user to the connector detail page.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma, ConnectorStatus, MembershipRole, SourceKind } from '@pcs/db';
import { getSession } from '@/lib/auth';
import { slackOAuthRedirectUri, slackParseState } from '@pcs/connectors';
import { encryptToString } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'slack_oauth_state';

interface SlackOAuthV2AccessResponse {
  ok: boolean;
  error?: string;
  access_token?: string; // xoxb- bot token
  scope?: string;
  bot_user_id?: string;
  app_id?: string;
  team?: { id?: string; name?: string };
  enterprise?: { id?: string; name?: string };
  authed_user?: { id?: string; scope?: string; access_token?: string };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const slackError = url.searchParams.get('error');

  if (slackError) {
    return errorResponse(`Slack returned: ${slackError}`);
  }
  if (!code || !state) {
    return errorResponse('Missing `code` or `state` in callback URL.');
  }

  // ---- 1. CSRF: state must match the cookie we set at start ----
  const cookieState = cookies().get(STATE_COOKIE)?.value;
  cookies().delete(STATE_COOKIE);
  if (!cookieState || cookieState !== state) {
    return errorResponse('OAuth state mismatch — possible CSRF, refusing.');
  }

  // ---- 2. Decode + expiry-check the state ----
  const parsed = slackParseState(state);
  if (!parsed) return errorResponse('Malformed state parameter.');
  if (Date.now() > parsed.expiresAt) return errorResponse('OAuth flow expired — please try again.');

  // ---- 3. Confirm the user is still signed into the same workspace ----
  const session = await getSession();
  if (session.workspace.id !== parsed.workspaceId) {
    return errorResponse(
      'You switched workspaces during the OAuth handshake. Start the install again from the new workspace.',
    );
  }
  if (
    session.membership.role !== MembershipRole.OWNER &&
    session.membership.role !== MembershipRole.ADMIN
  ) {
    return errorResponse('Only Admins or Owners can install connectors.');
  }

  // ---- 4. Exchange code for tokens ----
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const redirectUri = slackOAuthRedirectUri();
  if (!clientId || !clientSecret || !redirectUri) {
    return errorResponse('Server misconfigured: missing SLACK_CLIENT_ID / SECRET / NEXT_PUBLIC_APP_URL.');
  }

  let exchange: SlackOAuthV2AccessResponse;
  try {
    const res = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }).toString(),
    });
    exchange = (await res.json()) as SlackOAuthV2AccessResponse;
  } catch (err) {
    return errorResponse(`oauth.v2.access fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!exchange.ok || !exchange.access_token || !exchange.team?.id) {
    return errorResponse(`Slack rejected the code: ${exchange.error ?? 'unknown'}`);
  }

  const teamId = exchange.team.id;
  const teamName = exchange.team.name ?? 'Slack workspace';
  const botTokenEnc = encryptToString(exchange.access_token);

  // ---- 5. Optional: fetch team domain for nicer sourceUrls ----
  let teamDomain: string | undefined;
  try {
    const teamRes = await fetch('https://slack.com/api/team.info', {
      headers: { authorization: `Bearer ${exchange.access_token}` },
    });
    const teamJson = (await teamRes.json()) as { ok?: boolean; team?: { domain?: string } };
    if (teamJson.ok && teamJson.team?.domain) teamDomain = teamJson.team.domain;
  } catch {
    /* non-fatal */
  }

  // ---- 6. Upsert: same team_id should reuse the existing instance ----
  const existing = await prisma.connectorInstance.findFirst({
    where: { workspaceId: session.workspace.id, kind: SourceKind.SLACK },
    // We can't filter on a JSON field cleanly in Prisma without rawAccess;
    // we'll match in app code below.
  });
  // If there are multiple Slack installs in this workspace (rare), match by team_id.
  const matchByTeam = await prisma.connectorInstance.findMany({
    where: { workspaceId: session.workspace.id, kind: SourceKind.SLACK },
  });
  const sameTeam = matchByTeam.find((i) => (i.config as any)?.teamId === teamId);

  const config = {
    teamId,
    teamName,
    teamDomain,
    botTokenEnc,
    botUserId: exchange.bot_user_id,
    appId: exchange.app_id,
    scope: exchange.scope,
    userIndex: {},
    installedAt: new Date().toISOString(),
  };

  let instanceId: string;
  if (sameTeam) {
    await prisma.connectorInstance.update({
      where: { id: sameTeam.id },
      data: {
        status: ConnectorStatus.ACTIVE,
        lastError: null,
        config,
      },
    });
    instanceId = sameTeam.id;
  } else {
    // Find a non-colliding displayName.
    const baseName = teamName;
    const allNames = new Set(matchByTeam.map((i) => i.displayName));
    let displayName = baseName;
    let n = 2;
    while (allNames.has(displayName)) displayName = `${baseName} #${n++}`;

    const created = await prisma.connectorInstance.create({
      data: {
        workspaceId: session.workspace.id,
        kind: SourceKind.SLACK,
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
      action: sameTeam ? 'connector.reinstall' : 'connector.install',
      targetType: 'connector_instance',
      targetId: instanceId,
      metadata: { kind: 'SLACK', teamId, teamName },
    },
  });

  return NextResponse.redirect(
    `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') || ''}/connectors/${instanceId}`,
  );
}

function errorResponse(message: string) {
  // Bounce back to /connectors with an error in the URL — the page can render it.
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') || '';
  return NextResponse.redirect(
    `${base}/connectors?error=${encodeURIComponent(`Slack OAuth: ${message}`)}`,
  );
}
