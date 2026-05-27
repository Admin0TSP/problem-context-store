import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, RefreshCcw, Trash2 } from 'lucide-react';
import { prisma, ConnectorStatus } from '@pcs/db';
import { getAdapter } from '@pcs/connectors';
import { getSession } from '@/lib/auth';
import { Topbar } from '@/components/Topbar';
import { Badge } from '@/components/ui/Badge';
import { SourceIcon, sourceLabel } from '@/components/SourceIcon';
import { relativeTime, absoluteTime } from '@/lib/format';
import { regenerateWebhookToken, uninstallConnector } from '@/app/actions/ingest';
import { SimulateEventForm } from './SimulateEventForm';
import { CopyWebhookUrl } from './CopyWebhookUrl';

export const dynamic = 'force-dynamic';

const STATUS_TONES: Record<ConnectorStatus, 'success' | 'muted' | 'warn' | 'danger'> = {
  ACTIVE: 'success',
  PENDING: 'warn',
  ERROR: 'danger',
  PAUSED: 'muted',
  DISCONNECTED: 'muted',
};

export default async function ConnectorInstanceDetail({ params }: { params: { id: string } }) {
  const session = await getSession();
  const instance = await prisma.connectorInstance.findFirst({
    where: { id: params.id, workspaceId: session.workspace.id },
  });
  if (!instance) notFound();

  const [recentEvents, clients, problems] = await Promise.all([
    prisma.event.findMany({
      where: { workspaceId: session.workspace.id, source: instance.kind },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { problem: true, client: true },
    }),
    prisma.client.findMany({
      where: { workspaceId: session.workspace.id },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.problem.findMany({
      where: { workspaceId: session.workspace.id },
      orderBy: { firstSeenAt: 'desc' },
      select: { id: true, title: true, client: { select: { name: true } } },
      take: 50,
    }),
  ]);

  const config = (instance.config ?? {}) as {
    webhookToken?: string;
    teamId?: string;
    teamName?: string;
    teamDomain?: string;
    botUserId?: string;
    scope?: string;
    installedAt?: string;
  };
  const slug = instance.kind.toLowerCase();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const isSlack = instance.kind === 'SLACK';
  // Slack sends events to a single app-wide URL (no instanceId). For other
  // connectors the token+instanceId pattern still applies.
  const webhookUrl = isSlack
    ? `${baseUrl}/api/ingest/slack`
    : `${baseUrl}/api/ingest/${slug}/${instance.id}?token=${config.webhookToken ?? ''}`;

  const adapter = getAdapter(slug);

  return (
    <>
      <Topbar
        title={instance.displayName}
        subtitle={`${sourceLabel(instance.kind)} connector`}
      />

      <header className="border-b border-ink-200 bg-white px-6 py-5">
        <Link
          href="/connectors"
          className="inline-flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-700"
        >
          <ArrowLeft size={12} /> Connectors
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <SourceIcon source={instance.kind} />
          <div className="flex-1">
            <h1 className="text-xl font-semibold text-ink-900">{instance.displayName}</h1>
            <p className="text-xs text-ink-500">
              {sourceLabel(instance.kind)} ·{' '}
              {instance.lastSyncAt ? <>Synced {relativeTime(instance.lastSyncAt)}</> : 'Not yet synced'}
            </p>
          </div>
          <Badge tone={STATUS_TONES[instance.status]}>{instance.status.toLowerCase()}</Badge>
        </div>
        {instance.lastError && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            <strong>Last error:</strong> {instance.lastError}
          </div>
        )}
      </header>

      <main className="grid gap-6 px-6 py-6 lg:grid-cols-[1fr,360px]">
        <div className="space-y-6">
          {/* Webhook URL — non-Slack connectors (Stub today; DevRev/etc later) */}
          {!isSlack && (
            <section className="rounded-lg border border-ink-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-ink-900">Webhook URL</h2>
              <p className="mt-1 text-xs text-ink-500">
                Point the source system at this URL. Events POSTed here flow through the ingest
                pipeline. Keep the token secret.
              </p>
              <CopyWebhookUrl url={webhookUrl} />
              <form action={regenerateWebhookToken} className="mt-3">
                <input type="hidden" name="instanceId" value={instance.id} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-900"
                >
                  <RefreshCcw size={12} /> Rotate token
                </button>
              </form>
            </section>
          )}

          {/* Slack-specific: OAuth status + team info */}
          {isSlack && (
            <section className="rounded-lg border border-ink-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-ink-900">Slack workspace</h2>
              <p className="mt-1 text-xs text-ink-500">
                Authenticated via OAuth. Events arrive at the shared Slack endpoint and are routed
                here by <code className="rounded bg-ink-100 px-1">team_id</code>.
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-ink-500">Team name</dt>
                  <dd className="font-medium text-ink-900">{config.teamName ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-ink-500">Team ID</dt>
                  <dd className="font-mono text-ink-900">{config.teamId ?? '—'}</dd>
                </div>
                {config.teamDomain && (
                  <div>
                    <dt className="text-ink-500">Domain</dt>
                    <dd className="text-ink-900">
                      <a
                        href={`https://${config.teamDomain}.slack.com`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:underline"
                      >
                        {config.teamDomain}.slack.com
                      </a>
                    </dd>
                  </div>
                )}
                {config.botUserId && (
                  <div>
                    <dt className="text-ink-500">Bot user</dt>
                    <dd className="font-mono text-ink-900">{config.botUserId}</dd>
                  </div>
                )}
              </dl>
              <p className="mt-3 text-xs text-ink-500">
                Shared Slack endpoint:{' '}
                <code className="rounded bg-ink-100 px-1">{webhookUrl}</code>
              </p>
              <p className="mt-3 text-xs text-ink-500">
                To re-authorize (rotate token, refresh scopes), click{' '}
                <Link href="/api/auth/slack/start" className="text-accent hover:underline">
                  Add to Slack
                </Link>{' '}
                again from the same workspace.
              </p>
            </section>
          )}

          {/* Stub: simulation form */}
          {slug === 'stub' && adapter && (
            <section className="rounded-lg border border-ink-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-ink-900">Simulate an event</h2>
              <p className="mt-1 text-xs text-ink-500">
                Pushes an event through the full ingest pipeline as if a real source sent it.
                Useful for testing resolution.
              </p>
              <SimulateEventForm instanceId={instance.id} clients={clients} problems={problems} />
            </section>
          )}

          {/* Recent events from this source */}
          <section className="rounded-lg border border-ink-200 bg-white shadow-sm">
            <header className="border-b border-ink-200 px-5 py-3">
              <h2 className="text-sm font-semibold text-ink-900">Recent events</h2>
            </header>
            {recentEvents.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-500">No events yet.</p>
            ) : (
              <ul className="divide-y divide-ink-200">
                {recentEvents.map((e) => (
                  <li key={e.id} className="px-5 py-3">
                    <div className="flex items-baseline gap-2 text-xs text-ink-500">
                      <span className="font-medium text-ink-900">{e.actorName ?? 'Unknown'}</span>
                      <span>·</span>
                      <span>{e.kind.toLowerCase().replace('_', ' ')}</span>
                      <span className="ml-auto" title={absoluteTime(e.createdAt)}>
                        {relativeTime(e.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-ink-700">{e.body}</p>
                    <div className="mt-1.5 flex items-center gap-2 text-xs">
                      {e.problem ? (
                        <Link href={`/problems/${e.problem.id}`} className="text-accent hover:underline">
                          {e.problem.title}
                        </Link>
                      ) : (
                        <Link href="/inbox" className="text-amber-700 hover:underline">
                          Unattached — triage
                        </Link>
                      )}
                      {e.client && <span className="text-ink-500">· {e.client.name}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border border-ink-200 bg-white shadow-sm">
            <header className="border-b border-ink-200 px-4 py-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Meta</h3>
            </header>
            <dl className="divide-y divide-ink-200 text-xs">
              <Row label="ID">
                <code className="text-[10px]">{instance.id}</code>
              </Row>
              <Row label="Installed">{relativeTime(instance.createdAt)}</Row>
              <Row label="Last sync">
                {instance.lastSyncAt ? relativeTime(instance.lastSyncAt) : 'Never'}
              </Row>
            </dl>
          </section>

          <section className="rounded-lg border border-ink-200 bg-white shadow-sm">
            <header className="border-b border-ink-200 px-4 py-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Danger zone</h3>
            </header>
            <div className="px-4 py-3">
              <form action={uninstallConnector}>
                <input type="hidden" name="instanceId" value={instance.id} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 text-xs text-red-600 hover:underline"
                >
                  <Trash2 size={12} /> Uninstall
                </button>
              </form>
            </div>
          </section>
        </aside>
      </main>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between px-4 py-2">
      <dt className="text-ink-500">{label}</dt>
      <dd className="max-w-[60%] truncate text-right text-ink-700">{children}</dd>
    </div>
  );
}
