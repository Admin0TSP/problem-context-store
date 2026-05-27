import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import { prisma } from '@pcs/db';
import { getSession } from '@/lib/auth';
import { Topbar } from '@/components/Topbar';
import { StatusBadge, SeverityBadge } from '@/components/StatusBadge';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ClientDetailPage({ params }: { params: { slug: string } }) {
  const session = await getSession();
  const client = await prisma.client.findFirst({
    where: { workspaceId: session.workspace.id, slug: params.slug },
    include: {
      problems: {
        orderBy: [{ status: 'asc' }, { firstSeenAt: 'desc' }],
        include: { _count: { select: { events: true, manualNotes: true } } },
      },
    },
  });

  if (!client) notFound();

  const metadata = (client.metadata as Record<string, unknown> | null) ?? {};
  const tier = (metadata.tier as string | undefined) ?? '—';
  const arr = (metadata.arr as number | undefined) ?? undefined;
  const owner = (metadata.accountOwner as string | undefined) ?? '—';

  return (
    <>
      <Topbar
        title={client.name}
        subtitle={`${client.problems.length} problem${client.problems.length === 1 ? '' : 's'}`}
        primaryAction={{ label: 'New problem', href: '/problems/new' }}
      />

      <main className="px-6 py-6">
        <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Tier" value={tier} />
          <Stat label="ARR" value={arr ? `$${arr.toLocaleString()}` : '—'} />
          <Stat label="Domain" value={client.domain ?? '—'} />
          <Stat label="Account owner" value={owner} />
        </section>

        <h2 className="mb-3 text-sm font-semibold text-ink-900">Problems</h2>
        {client.problems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
            No problems yet for {client.name}.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-ink-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-ink-200 text-sm">
              <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Problem</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="px-4 py-2.5 text-left font-medium">Severity</th>
                  <th className="px-4 py-2.5 text-left font-medium">Activity</th>
                  <th className="px-4 py-2.5 text-left font-medium">First seen</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200">
                {client.problems.map((p) => (
                  <tr key={p.id} className="group hover:bg-ink-50">
                    <td className="px-4 py-3">
                      <Link href={`/problems/${p.id}`} className="font-medium text-ink-900 group-hover:underline">
                        {p.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-3">
                      <SeverityBadge severity={p.severity} />
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-500">
                      {p._count.events} events · {p._count.manualNotes} notes
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-500">{relativeTime(p.firstSeenAt)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/problems/${p.id}`}
                        className="inline-flex h-7 items-center rounded-md px-2 text-xs text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                      >
                        Open <ArrowUpRight size={12} className="ml-1" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1 text-base font-semibold text-ink-900">{value}</p>
    </div>
  );
}
