import Link from 'next/link';
import { Plus, ChevronRight } from 'lucide-react';
import { prisma, ConnectorStatus } from '@pcs/db';
import { listAdapters } from '@pcs/connectors';
import { getSession } from '@/lib/auth';
import { Topbar } from '@/components/Topbar';
import { Badge } from '@/components/ui/Badge';
import { SourceIcon, sourceLabel } from '@/components/SourceIcon';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const STATUS_TONES: Record<ConnectorStatus, 'success' | 'muted' | 'warn' | 'danger'> = {
  ACTIVE: 'success',
  PENDING: 'warn',
  ERROR: 'danger',
  PAUSED: 'muted',
  DISCONNECTED: 'muted',
};

export default async function ConnectorsPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const session = await getSession();
  const [instances, adapters] = await Promise.all([
    prisma.connectorInstance.findMany({
      where: { workspaceId: session.workspace.id },
      orderBy: { createdAt: 'desc' },
    }),
    Promise.resolve(listAdapters()),
  ]);

  return (
    <>
      <Topbar
        title="Connectors"
        subtitle={`${instances.length} installed`}
        primaryAction={{ label: 'Install', href: '/connectors/new' }}
      />
      <main className="px-6 py-6">
        {searchParams.error && (
          <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <strong className="block text-xs uppercase tracking-wide">Connector error</strong>
            <p className="mt-1">{searchParams.error}</p>
          </div>
        )}
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold text-ink-900">Installed</h2>
          {instances.length === 0 ? (
            <div className="rounded-lg border border-dashed border-ink-200 bg-white p-12 text-center text-sm text-ink-500">
              No connectors yet. <Link href="/connectors/new" className="text-accent hover:underline">Install one</Link> to start ingesting events.
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {instances.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/connectors/${c.id}`}
                    className="group flex items-center gap-3 rounded-lg border border-ink-200 bg-white p-4 shadow-sm hover:border-ink-300"
                  >
                    <SourceIcon source={c.kind} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">{c.displayName}</p>
                      <p className="truncate text-xs text-ink-500">
                        {sourceLabel(c.kind)}
                        {c.lastSyncAt && <> · synced {relativeTime(c.lastSyncAt)}</>}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONES[c.status]}>{c.status.toLowerCase()}</Badge>
                    <ChevronRight size={16} className="text-ink-300 group-hover:text-ink-500" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink-900">Available to install</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {adapters.map((a) => (
              <li
                key={a.descriptor.kind}
                className="flex items-center gap-3 rounded-lg border border-ink-200 bg-white p-4 shadow-sm"
              >
                <SourceIcon source={a.descriptor.kind} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900">{a.descriptor.displayName}</p>
                  <p className="truncate text-xs text-ink-500">{a.descriptor.description}</p>
                </div>
                <Link
                  href={`/connectors/new?slug=${slugFromKind(a.descriptor.kind)}`}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-ink-900 px-2.5 text-xs font-medium text-white hover:bg-ink-700"
                >
                  <Plus size={12} />
                  Install
                </Link>
              </li>
            ))}
            {/* Placeholders for upcoming connectors */}
            {(['SLACK', 'DEVREV', 'GITHUB', 'GMAIL'] as const).map((kind) => (
              <li
                key={kind}
                className="flex items-center gap-3 rounded-lg border border-dashed border-ink-200 bg-white/40 p-4"
              >
                <SourceIcon source={kind} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900">{sourceLabel(kind)}</p>
                  <p className="truncate text-xs text-ink-500">Coming in M8</p>
                </div>
                <button
                  disabled
                  className="inline-flex h-7 cursor-not-allowed items-center rounded-md bg-ink-100 px-2.5 text-xs font-medium text-ink-500"
                >
                  Install
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}

function slugFromKind(kind: string): string {
  return kind.toLowerCase();
}
