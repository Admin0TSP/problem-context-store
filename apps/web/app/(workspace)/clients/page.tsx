import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { prisma } from '@pcs/db';
import { getSession } from '@/lib/auth';
import { Topbar } from '@/components/Topbar';
import { Badge } from '@/components/ui/Badge';

export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  const session = await getSession();

  const clients = await prisma.client.findMany({
    where: { workspaceId: session.workspace.id },
    include: {
      _count: { select: { problems: true, events: true } },
    },
    orderBy: { name: 'asc' },
  });

  return (
    <>
      <Topbar title="Clients" subtitle={`${clients.length} client${clients.length === 1 ? '' : 's'}`} />
      <main className="px-6 py-6">
        <div className="overflow-hidden rounded-lg border border-ink-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-ink-200 text-sm">
            <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Client</th>
                <th className="px-4 py-2.5 text-left font-medium">Domain</th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
                <th className="px-4 py-2.5 text-left font-medium">Problems</th>
                <th className="px-4 py-2.5 text-left font-medium">Events</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200">
              {clients.map((c) => (
                <tr key={c.id} className="group hover:bg-ink-50">
                  <td className="px-4 py-3">
                    <Link href={`/clients/${c.slug}`} className="font-medium text-ink-900 group-hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-700">{c.domain ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge tone={c.status === 'ACTIVE' ? 'success' : 'muted'}>{c.status.toLowerCase()}</Badge>
                  </td>
                  <td className="px-4 py-3 text-ink-700">{c._count.problems}</td>
                  <td className="px-4 py-3 text-ink-700">{c._count.events}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/clients/${c.slug}`}
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
      </main>
    </>
  );
}
