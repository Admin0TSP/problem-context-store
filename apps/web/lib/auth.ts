/**
 * Session resolver — now backed by Auth.js v5.
 *
 * The return shape (`{ user, workspace, membership }`) is intentionally
 * preserved from the M2-lite dev-cookie version so the rest of the app
 * doesn't change.
 *
 *   Behavior:
 *     - If no Auth.js session → redirect to /signin.
 *     - If signed in but no memberships → redirect to /workspaces/new.
 *     - If signed in with memberships:
 *         - Active workspace = cookie `pcs_active_workspace` if it points at
 *           a workspace the user belongs to, otherwise first membership.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma, type User, type Workspace, type Membership } from '@pcs/db';
import { auth } from '@/auth';

const COOKIE_WORKSPACE = 'pcs_active_workspace';

export type Session = {
  user: User;
  workspace: Workspace;
  membership: Membership;
};

/**
 * Returns the current session. Throws via Next.js `redirect()` if the user
 * is not signed in or has no workspace yet.
 */
export async function getSession(): Promise<Session> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/signin');
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) {
    // Stale session — force re-sign-in.
    redirect('/signin');
  }

  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { createdAt: 'asc' },
  });

  if (memberships.length === 0) {
    redirect('/workspaces/new');
  }

  const cookieWorkspaceId = cookies().get(COOKIE_WORKSPACE)?.value;
  const active =
    memberships.find((m) => m.workspaceId === cookieWorkspaceId) ?? memberships[0]!;

  return {
    user,
    workspace: active.workspace,
    membership: active,
  };
}

/**
 * Same as getSession() but doesn't redirect when there's no workspace.
 * Used by /workspaces/new to render its own UI.
 */
export async function getUserOrRedirect(): Promise<User> {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) redirect('/signin');
  return user;
}

/**
 * Set the active workspace cookie. Called by the workspace switcher.
 */
export async function setActiveWorkspace(workspaceId: string) {
  cookies().set(COOKIE_WORKSPACE, workspaceId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}
