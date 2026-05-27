import { prisma, MembershipRole } from '@pcs/db';
import { getSession } from '@/lib/auth';
import { roleAtLeast } from '@/lib/rbac';
import { Topbar } from '@/components/Topbar';
import { Badge } from '@/components/ui/Badge';
import { relativeTime } from '@/lib/format';
import { MembersControls } from './MembersControls';
import { InviteForm } from './InviteForm';

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const session = await getSession();

  const [memberships, invites] = await Promise.all([
    prisma.membership.findMany({
      where: { workspaceId: session.workspace.id },
      include: { user: true },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.workspaceInvite.findMany({
      where: { workspaceId: session.workspace.id, acceptedAt: null },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const canManage = roleAtLeast(session.membership.role, MembershipRole.ADMIN);
  const isOwner = session.membership.role === MembershipRole.OWNER;

  return (
    <>
      <Topbar
        title="Members"
        subtitle={`${memberships.length} member${memberships.length === 1 ? '' : 's'} · ${invites.length} pending invite${invites.length === 1 ? '' : 's'}`}
      />
      <main className="mx-auto max-w-3xl px-6 py-6 space-y-6">
        {canManage && (
          <section className="rounded-lg border border-ink-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-ink-900">Invite a teammate</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              They'll receive an email with a one-click accept link.
            </p>
            <InviteForm canInviteOwner={isOwner} />
          </section>
        )}

        <section className="overflow-hidden rounded-lg border border-ink-200 bg-white shadow-sm">
          <header className="border-b border-ink-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-ink-900">Members</h2>
          </header>
          <ul className="divide-y divide-ink-200">
            {memberships.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900">
                    {m.user.name ?? m.user.email}
                    {m.userId === session.user.id && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-ink-500">You</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-ink-500">{m.user.email}</p>
                </div>
                <MembersControls
                  membershipId={m.id}
                  userIsSelf={m.userId === session.user.id}
                  targetRole={m.role}
                  currentUserRole={session.membership.role}
                  canManage={canManage}
                />
              </li>
            ))}
          </ul>
        </section>

        {invites.length > 0 && (
          <section className="overflow-hidden rounded-lg border border-ink-200 bg-white shadow-sm">
            <header className="border-b border-ink-200 px-5 py-3">
              <h2 className="text-sm font-semibold text-ink-900">Pending invites</h2>
            </header>
            <ul className="divide-y divide-ink-200">
              {invites.map((iv) => (
                <li key={iv.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink-900">{iv.email}</p>
                    <p className="truncate text-xs text-ink-500">
                      Invited {relativeTime(iv.createdAt)} · expires {relativeTime(iv.expiresAt)}
                    </p>
                  </div>
                  <Badge tone="muted">{iv.role.toLowerCase()}</Badge>
                  {canManage && (
                    <form action={async (fd) => {
                      'use server';
                      const { cancelInvite } = await import('@/app/actions/members');
                      await cancelInvite(fd);
                    }}>
                      <input type="hidden" name="inviteId" value={iv.id} />
                      <button
                        type="submit"
                        className="text-xs text-red-600 hover:underline"
                      >
                        Cancel
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
