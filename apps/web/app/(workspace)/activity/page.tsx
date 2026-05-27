import { prisma } from '@pcs/db';
import { getSession } from '@/lib/auth';
import { Topbar } from '@/components/Topbar';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ActivityPage() {
  const session = await getSession();
  const logs = await prisma.auditLog.findMany({
    where: { workspaceId: session.workspace.id },
    include: { actor: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return (
    <>
      <Topbar title="Activity" subtitle="Audit log for this workspace" />
      <main className="px-6 py-6">
        {logs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-200 bg-white p-12 text-center text-sm text-ink-500">
            No activity yet.
          </div>
        ) : (
          <ul className="divide-y divide-ink-200 rounded-lg border border-ink-200 bg-white shadow-sm">
            {logs.map((l) => (
              <li key={l.id} className="px-4 py-3 text-sm">
                <p className="text-ink-900">
                  <span className="font-medium">{l.actor?.name ?? l.actor?.email ?? 'system'}</span>{' '}
                  <span className="text-ink-500">{l.action}</span>
                  {l.targetType && (
                    <span className="text-ink-500"> · {l.targetType}</span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-ink-500">{relativeTime(l.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
