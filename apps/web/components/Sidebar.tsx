import Link from 'next/link';
import { LayoutDashboard, Users, Plug, Settings, Activity, StickyNote, Inbox } from 'lucide-react';
import { prisma, type Workspace, type User, type Membership } from '@pcs/db';
import { RESOLUTION_AUTO_THRESHOLD } from '@pcs/core';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { UserMenu } from './UserMenu';

export async function Sidebar({
  workspace,
  user,
  membership,
}: {
  workspace: Workspace;
  user: User;
  membership: Membership;
}) {
  // Inbox count = unattached + auto-attached-but-low-confidence (needs confirm).
  const [memberships, unattachedCount, lowConfCount] = await Promise.all([
    prisma.membership.findMany({
      where: { userId: user.id },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.event.count({
      where: {
        workspaceId: workspace.id,
        problemId: null,
        mentions: { none: { kind: 'HASHTAG', value: 'pcs:dismissed' } },
      },
    }),
    prisma.event.count({
      where: {
        workspaceId: workspace.id,
        problemId: { not: null },
        problemResolutionConfidence: { lt: RESOLUTION_AUTO_THRESHOLD },
        resolutionMethod: { notIn: ['MANUAL_CONFIRM'] },
      },
    }),
  ]);

  const inboxCount = unattachedCount + lowConfCount;

  const switcherOptions = memberships.map((m) => ({
    id: m.workspaceId,
    name: m.workspace.name,
    slug: m.workspace.slug,
    role: m.role,
  }));

  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-ink-200 bg-white md:flex">
      {/* Workspace switcher */}
      <div className="border-b border-ink-200 px-2 py-2">
        <WorkspaceSwitcher
          active={{ id: workspace.id, name: workspace.name, slug: workspace.slug, role: membership.role }}
          workspaces={switcherOptions}
        />
      </div>

      {/* Primary nav */}
      <nav className="flex-1 space-y-0.5 px-2 py-3">
        <NavItem href="/dashboard" icon={<LayoutDashboard size={15} />} label="Problems" />
        <NavItem
          href="/inbox"
          icon={<Inbox size={15} />}
          label="Inbox"
          badge={inboxCount > 0 ? inboxCount : undefined}
        />
        <NavItem href="/clients" icon={<Users size={15} />} label="Clients" />
        <NavItem href="/notes" icon={<StickyNote size={15} />} label="Manual notes" />
        <NavItem href="/activity" icon={<Activity size={15} />} label="Activity" />

        <div className="pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
          Setup
        </div>
        <NavItem href="/connectors" icon={<Plug size={15} />} label="Connectors" />
        <NavItem href="/settings" icon={<Settings size={15} />} label="Settings" />
      </nav>

      {/* User menu */}
      <div className="border-t border-ink-200 px-2 py-2">
        <UserMenu user={{ name: user.name, email: user.email }} />
      </div>
    </aside>
  );
}

function NavItem({
  href,
  icon,
  label,
  badge,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-ink-700 hover:bg-ink-100 hover:text-ink-900"
    >
      <span className="text-ink-500 group-hover:text-ink-700">{icon}</span>
      <span className="flex-1">{label}</span>
      {badge !== undefined && (
        <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">
          {badge}
        </span>
      )}
    </Link>
  );
}
