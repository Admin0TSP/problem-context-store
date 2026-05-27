import Link from 'next/link';
import { ArrowUpRight, Plus } from 'lucide-react';
import { prisma, ProblemStatus, Severity } from '@pcs/db';
import { getSession } from '@/lib/auth';
import { Topbar } from '@/components/Topbar';
import { StatusBadge, SeverityBadge } from '@/components/StatusBadge';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const STATUS_OPTIONS: Array<{ value: ProblemStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: ProblemStatus.OPEN, label: 'Open' },
  { value: ProblemStatus.INVESTIGATING, label: 'Investigating' },
  { value: ProblemStatus.IN_PROGRESS, label: 'In progress' },
  { value: ProblemStatus.AWAITING_CUSTOMER, label: 'Awaiting customer' },
  { value: ProblemStatus.RESOLVED, label: 'Resolved' },
];

const SEVERITY_OPTIONS: Array<{ value: Severity | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Any severity' },
  { value: Severity.CRITICAL, label: 'Critical' },
  { value: Severity.HIGH, label: 'High' },
  { value: Severity.MEDIUM, label: 'Medium' },
  { value: Severity.LOW, label: 'Low' },
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { status?: string; severity?: string; client?: string };
}) {
  const session = await getSession();

  const statusFilter =
    searchParams.status && searchParams.status !== 'ALL'
      ? (searchParams.status as ProblemStatus)
      : undefined;
  const severityFilter =
    searchParams.severity && searchParams.severity !== 'ALL'
      ? (searchParams.severity as Severity)
      : undefined;
  const clientFilter = searchParams.client && searchParams.client !== 'ALL' ? searchParams.client : undefined;

  const [problems, clients, counts] = await Promise.all([
    prisma.problem.findMany({
      where: {
        workspaceId: session.workspace.id,
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(severityFilter ? { severity: severityFilter } : {}),
        ...(clientFilter ? { clientId: clientFilter } : {}),
      },
      include: {
        client: true,
        _count: { select: { events: true, manualNotes: true, artifacts: true } },
      },
      orderBy: [{ status: 'asc' }, { firstSeenAt: 'desc' }],
      take: 100,
    }),
    prisma.client.findMany({
      where: { workspaceId: session.workspace.id },
      orderBy: { name: 'asc' },
    }),
    prisma.problem.groupBy({
      by: ['status'],
      where: { workspaceId: session.workspace.id },
      _count: { _all: true },
    }),
  ]);

  const totalOpen = counts
    .filter((c) => !['RESOLVED', 'CLOSED', 'ARCHIVED'].includes(c.status))
    .reduce((acc, c) => acc + c._count._all, 0);

  return (
    <>
      <Topbar
        title="Problems"
        subtitle={`${totalOpen} open · ${problems.length} shown`}
        primaryAction={{ label: 'New problem', href: '/problems/new' }}
      />

      <main className="px-6 py-6">
        {/* Filters */}
        <form
          className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 shadow-sm"
          action="/dashboard"
        >
          <FilterChips name="status" value={searchParams.status ?? 'ALL'} options={STATUS_OPTIONS} />
          <span className="mx-1 h-5 w-px bg-ink-200" />
          <SelectInline name="severity" value={searchParams.severity ?? 'ALL'}>
            {SEVERITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectInline>
          <SelectInline name="client" value={searchParams.client ?? 'ALL'}>
            <option value="ALL">Any client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectInline>
          <button
            type="submit"
            className="ml-auto inline-flex h-7 items-center rounded-md bg-ink-900 px-2.5 text-xs font-medium text-white hover:bg-ink-700"
          >
            Apply
          </button>
          <Link
            href="/dashboard"
            className="inline-flex h-7 items-center rounded-md px-2 text-xs text-ink-500 hover:bg-ink-100"
          >
            Reset
          </Link>
        </form>

        {/* Problem list */}
        {problems.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-hidden rounded-lg border border-ink-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-ink-200 text-sm">
              <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Problem</th>
                  <th className="px-4 py-2.5 text-left font-medium">Client</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="px-4 py-2.5 text-left font-medium">Severity</th>
                  <th className="px-4 py-2.5 text-left font-medium">Activity</th>
                  <th className="px-4 py-2.5 text-left font-medium">First seen</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200">
                {problems.map((p) => (
                  <tr key={p.id} className="group hover:bg-ink-50">
                    <td className="px-4 py-3">
                      <Link href={`/problems/${p.id}`} className="block">
                        <p className="font-medium text-ink-900 group-hover:underline">{p.title}</p>
                        {p.description && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-ink-500">
                            {p.description}
                          </p>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink-700">{p.client.name}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-3">
                      <SeverityBadge severity={p.severity} />
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-500">
                      {p._count.events} events · {p._count.manualNotes} notes
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-500">
                      {relativeTime(p.firstSeenAt)}
                    </td>
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

function FilterChips({
  name,
  value,
  options,
}: {
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <div className="flex flex-wrap items-center gap-1">
        {options.map((o) => {
          const active = value === o.value;
          return (
            <Link
              key={o.value}
              href={{ pathname: '/dashboard', query: { [name]: o.value } }}
              className={
                active
                  ? 'inline-flex h-7 items-center rounded-md bg-ink-900 px-2.5 text-xs font-medium text-white'
                  : 'inline-flex h-7 items-center rounded-md px-2.5 text-xs text-ink-700 hover:bg-ink-100'
              }
            >
              {o.label}
            </Link>
          );
        })}
      </div>
    </>
  );
}

function SelectInline({
  name,
  value,
  children,
}: {
  name: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <select
      name={name}
      defaultValue={value}
      className="h-7 rounded-md border border-ink-200 bg-white px-2 text-xs text-ink-700 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
    >
      {children}
    </select>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-ink-200 bg-white p-12 text-center">
      <h3 className="text-base font-medium text-ink-900">No problems yet</h3>
      <p className="mt-1 text-sm text-ink-500">
        Once connectors are live, problems will appear here as events arrive. For now you can
        create one manually.
      </p>
      <Link
        href="/problems/new"
        className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-md bg-ink-900 px-3.5 text-sm font-medium text-white hover:bg-ink-700"
      >
        <Plus size={14} /> Create a problem
      </Link>
    </div>
  );
}
