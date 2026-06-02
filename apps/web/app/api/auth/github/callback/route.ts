/**
 * GitHub App install — callback route (M11.5).
 *
 *   GET /api/auth/github/callback?installation_id=...&setup_action=install&state=...
 *
 *   Or, if the user clicked the App's "Authorize" button rather than the
 *   install button, GitHub might send `?code=...` instead — that's the
 *   user-OAuth path which we don't use here. We only care about installs.
 *
 * 1. Verify the state matches the cookie we set at /api/auth/github/start.
 * 2. Verify state hasn't expired and decodes to a real workspace.
 * 3. Read installation_id from the query.
 * 4. Use the App JWT to fetch installation details (account, repos, perms).
 * 5. Upsert a ConnectorInstance keyed on (workspaceId, kind=GITHUB,
 *    installationId) so re-installing the same GitHub org updates the
 *    existing row instead of creating duplicates.
 * 6. Redirect the user to the connector detail page.
 *
 * Note: We do NOT store any tokens here. The App's installation token is
 * fetched JIT (and cached in memory) whenever we need to call the API.
 * The webhook secret is app-wide (env var), not per-install.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma, ConnectorStatus, MembershipRole, SourceKind } from '@pcs/db';
import { getSession } from '@/lib/auth';
import { githubParseState, getInstallationDetails } from '@pcs/connectors';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'github_install_state';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const installationIdStr = url.searchParams.get('installation_id');
  const setupAction = url.searchParams.get('setup_action');
  const state = url.searchParams.get('state');
  const ghError = url.searchParams.get('error');

  if (ghError) {
    return errorResponse(`GitHub returned: ${ghError}`);
  }
  if (!installationIdStr) {
    return errorResponse(
      'Callback was missing `installation_id`. If you cancelled the install on GitHub, just retry — otherwise check that the callback URL is set correctly in the App settings.',
    );
  }
  if (!state) {
    return errorResponse('Missing `state` in callback URL.');
  }
  if (setupAction && setupAction !== 'install' && setupAction !== 'update') {
    // GitHub also sends `request` if the install is pending org-admin approval.
    return errorResponse(`Unexpected setup_action="${setupAction}". Try installing again.`);
  }

  // ---- 1. CSRF: state must match the cookie we set at start ----
  const cookieState = cookies().get(STATE_COOKIE)?.value;
  cookies().delete(STATE_COOKIE);
  if (!cookieState || cookieState !== state) {
    return errorResponse('Install state mismatch — possible CSRF, refusing.');
  }

  // ---- 2. Decode + expiry-check the state ----
  const parsed = githubParseState(state);
  if (!parsed) return errorResponse('Malformed state parameter.');
  if (Date.now() > parsed.expiresAt) {
    return errorResponse('Install flow expired — please try again.');
  }

  // ---- 3. Confirm the user is still signed into the same workspace ----
  const session = await getSession();
  if (session.workspace.id !== parsed.workspaceId) {
    return errorResponse(
      'You switched workspaces during the install. Start the install again from the new workspace.',
    );
  }
  if (
    session.membership.role !== MembershipRole.OWNER &&
    session.membership.role !== MembershipRole.ADMIN
  ) {
    return errorResponse('Only Admins or Owners can install connectors.');
  }

  const installationId = Number.parseInt(installationIdStr, 10);
  if (!Number.isFinite(installationId)) {
    return errorResponse(`Bad installation_id "${installationIdStr}".`);
  }

  // ---- 4. Fetch installation metadata (account, repo selection, perms) ----
  const details = await getInstallationDetails(installationId);
  if (!details) {
    return errorResponse(
      'Could not read installation details from GitHub. Check GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY in your .env.',
    );
  }

  const accountLogin = details.account.login ?? 'github-install';

  // ---- 5. Upsert: same installationId should reuse the existing instance ----
  const allGithub = await prisma.connectorInstance.findMany({
    where: { workspaceId: session.workspace.id, kind: SourceKind.GITHUB },
  });
  const sameInstall = allGithub.find(
    (i) => Number((i.config as any)?.installationId) === installationId,
  );

  const config = {
    installationId,
    accountLogin,
    accountType: details.account.type,
    accountHtmlUrl: details.account.htmlUrl,
    accountAvatarUrl: details.account.avatarUrl,
    repositorySelection: details.repositorySelection,
    repositories: details.repositories ?? [],
    permissions: details.permissions ?? {},
    events: details.events ?? [],
    // Preserve the user's "include bots" toggle across re-installs.
    includeBots: ((sameInstall?.config as any)?.includeBots as boolean | undefined) ?? false,
    installedAt: new Date().toISOString(),
  };

  let instanceId: string;
  if (sameInstall) {
    await prisma.connectorInstance.update({
      where: { id: sameInstall.id },
      data: {
        status: ConnectorStatus.ACTIVE,
        lastError: null,
        config,
      },
    });
    instanceId = sameInstall.id;
  } else {
    // Build a displayName that doesn't collide with existing GitHub instances.
    const baseName =
      details.account.type === 'Organization' ? accountLogin : `${accountLogin} (user)`;
    const allNames = new Set(allGithub.map((i) => i.displayName));
    let displayName = baseName;
    let n = 2;
    while (allNames.has(displayName)) displayName = `${baseName} #${n++}`;

    const created = await prisma.connectorInstance.create({
      data: {
        workspaceId: session.workspace.id,
        kind: SourceKind.GITHUB,
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
      action: sameInstall ? 'connector.reinstall' : 'connector.install',
      targetType: 'connector_instance',
      targetId: instanceId,
      metadata: {
        kind: 'GITHUB',
        installationId,
        accountLogin,
        accountType: details.account.type,
        repositorySelection: details.repositorySelection,
      },
    },
  });

  return NextResponse.redirect(
    `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') || ''}/connectors/${instanceId}`,
  );
}

function errorResponse(message: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') || '';
  return NextResponse.redirect(
    `${base}/connectors?error=${encodeURIComponent(`GitHub App install: ${message}`)}`,
  );
}
