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
import { SyncGmailButton } from './SyncGmailButton';

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
    // Gmail-specific
    ownerEmail?: string;
    ownerName?: string | null;
    historyId?: string | null;
    // DevRev-specific
    orgId?: string;
    orgSlug?: string;
    webhookSecret?: string;
    patEnc?: string;
    // GitHub-specific (M11.5 — App install)
    installationId?: number;
    accountLogin?: string;
    accountType?: string;
    accountHtmlUrl?: string;
    accountAvatarUrl?: string;
    repositorySelection?: 'all' | 'selected' | string;
    repositories?: Array<{ id: number; fullName: string; htmlUrl: string; private: boolean }>;
    permissions?: Record<string, string>;
    events?: string[];
    includeBots?: boolean;
  };
  const slug = instance.kind.toLowerCase();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const isSlack = instance.kind === 'SLACK';
  const isGmail = instance.kind === 'GMAIL';
  const isDevRev = instance.kind === 'DEVREV';
  const isGitHub = instance.kind === 'GITHUB';
  // Slack and GitHub both send to a single app-wide URL (no instanceId).
  // Gmail uses polling. DevRev uses the generic webhook receiver with a
  // 32-char URL-safe secret in the URL. Everything else uses the basic
  // Stub-style token pattern.
  const webhookUrl = isSlack
    ? `${baseUrl}/api/ingest/slack`
    : isGmail
      ? null
      : isDevRev
        ? `${baseUrl}/api/ingest/devrev/${instance.id}?token=${config.webhookSecret ?? ''}`
        : isGitHub
          ? `${baseUrl}/api/ingest/github`
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
          {/* Gmail-specific: connected account + Sync button */}
          {isGmail && (
            <section className="rounded-lg border border-ink-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-ink-900">Gmail account</h2>
              <p className="mt-1 text-xs text-ink-500">
                Authenticated via Google OAuth. Click <strong>Sync now</strong> to fetch new
                messages — they flow through the same resolver + worker pipeline as Slack events.
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-ink-500">Inbox</dt>
                  <dd className="font-medium text-ink-900">{config.ownerEmail ?? '—'}</dd>
                </div>
                {config.ownerName && (
                  <div>
                    <dt className="text-ink-500">Display name</dt>
                    <dd className="text-ink-900">{config.ownerName}</dd>
                  </div>
                )}
                {config.historyId && (
                  <div>
                    <dt className="text-ink-500">History cursor</dt>
                    <dd className="font-mono text-ink-900">{config.historyId}</dd>
                  </div>
                )}
              </dl>
              <div className="mt-4">
                <SyncGmailButton instanceId={instance.id} />
              </div>
              <p className="mt-3 text-xs text-ink-500">
                MVP polls Gmail with a time-window query (last sync + 10-min overlap). True
                incremental sync via Gmail's History API + auto-polling lands in M8b.5. To
                re-authorize this Gmail account, click{' '}
                <Link href="/api/auth/google/start" className="text-accent hover:underline">
                  Add to Gmail
                </Link>{' '}
                again.
              </p>
            </section>
          )}

          {/* DevRev-specific: account + webhook URL */}
          {isDevRev && (
            <section className="rounded-lg border border-ink-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-ink-900">DevRev workspace</h2>
              <p className="mt-1 text-xs text-ink-500">
                Authenticated via Personal Access Token. Events arrive at the webhook URL below —
                paste it into DevRev → Settings → Webhooks.
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-ink-500">Org ID</dt>
                  <dd className="font-mono text-ink-900">{config.orgId ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-ink-500">Org slug</dt>
                  <dd className="font-mono text-ink-900">{config.orgSlug ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-ink-500">PAT</dt>
                  <dd className="font-mono text-ink-900">
                    {config.patEnc ? '•••••••• (encrypted, never displayed)' : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-500">Installed</dt>
                  <dd className="text-ink-900">
                    {config.installedAt
                      ? relativeTime(new Date(config.installedAt))
                      : relativeTime(instance.createdAt)}
                  </dd>
                </div>
              </dl>
              <div className="mt-4">
                <p className="text-xs font-semibold text-ink-700">Webhook URL</p>
                <p className="mt-1 text-xs text-ink-500">
                  Subscribe to <code className="rounded bg-ink-100 px-1">work_created</code>,{' '}
                  <code className="rounded bg-ink-100 px-1">work_updated</code>, and{' '}
                  <code className="rounded bg-ink-100 px-1">timeline_entry_created</code>. Keep the
                  token in the URL secret — anyone with it can post events as this connector.
                </p>
                <div className="mt-2">
                  <CopyWebhookUrl url={webhookUrl!} />
                </div>
                <p className="mt-3 text-xs text-ink-500">
                  To rotate the secret, uninstall and re-install the connector (the PAT can be
                  re-pasted from your password manager). A standalone rotate button lands when we
                  generalize ConnectorInstance config in M10.
                </p>
              </div>
            </section>
          )}

          {/* GitHub-specific: App installation details */}
          {isGitHub && (
            <section className="rounded-lg border border-ink-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-ink-900">GitHub App install</h2>
              <p className="mt-1 text-xs text-ink-500">
                Installed via the PCS GitHub App. Every webhook hits a single app-wide endpoint
                and is routed to this connector by{' '}
                <code className="rounded bg-ink-100 px-1">installation.id</code>. No per-install
                webhook configuration to maintain.
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-ink-500">Account</dt>
                  <dd className="font-medium text-ink-900">
                    {config.accountHtmlUrl ? (
                      <a
                        href={config.accountHtmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:underline"
                      >
                        {config.accountLogin ?? '—'}
                      </a>
                    ) : (
                      config.accountLogin ?? '—'
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-500">Account type</dt>
                  <dd className="text-ink-900">{config.accountType ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-ink-500">Installation ID</dt>
                  <dd className="font-mono text-ink-900">{config.installationId ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-ink-500">Repository scope</dt>
                  <dd className="text-ink-900">
                    {config.repositorySelection === 'all'
                      ? 'All repositories'
                      : config.repositorySelection === 'selected'
                        ? `${config.repositories?.length ?? 0} selected`
                        : config.repositorySelection ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-500">Include bot accounts</dt>
                  <dd className="text-ink-900">
                    {config.includeBots ? 'Yes (Dependabot, Renovate, etc.)' : 'No — bots are filtered out'}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-500">Installed</dt>
                  <dd className="text-ink-900">
                    {config.installedAt
                      ? relativeTime(new Date(config.installedAt))
                      : relativeTime(instance.createdAt)}
                  </dd>
                </div>
              </dl>

              {config.repositorySelection === 'selected' && (config.repositories?.length ?? 0) > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-ink-700">
                    Selected repositories ({config.repositories!.length})
                  </p>
                  <ul className="mt-2 divide-y divide-ink-200 rounded-md border border-ink-200">
                    {config.repositories!.slice(0, 20).map((r) => (
                      <li key={r.id} className="flex items-center justify-between px-3 py-2 text-xs">
                        <a
                          href={r.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-ink-900 hover:text-accent hover:underline"
                        >
                          {r.fullName}
                        </a>
                        {r.private && (
                          <Badge tone="muted" >private</Badge>
                        )}
                      </li>
                    ))}
                    {config.repositories!.length > 20 && (
                      <li className="px-3 py-2 text-xs text-ink-500">
                        …and {config.repositories!.length - 20} more.
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {config.permissions && Object.keys(config.permissions).length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-ink-700">Permissions granted</p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(config.permissions).map(([k, v]) => (
                      <li
                        key={k}
                        className="rounded-full border border-ink-200 bg-ink-50 px-2 py-0.5 text-[11px] text-ink-700"
                      >
                        {k}: <span className="font-mono">{v}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 rounded-md bg-ink-50 p-3 text-xs text-ink-700">
                <p className="font-medium">Webhook endpoint (informational)</p>
                <p className="mt-1 text-ink-500">
                  All installs deliver to the App-level URL configured in the GitHub developer portal.
                  You normally never need this — listed here for ops + debugging.
                </p>
                <div className="mt-2">
                  <CopyWebhookUrl url={webhookUrl!} />
                </div>
              </div>

              <p className="mt-4 text-xs text-ink-500">
                To change repo selection or re-grant permissions, manage the install at{' '}
                <a
                  href={
                    config.accountType === 'Organization'
                      ? `${config.accountHtmlUrl ?? ''}/settings/installations`
                      : 'https://github.com/settings/installations'
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  GitHub <ExternalLink className="inline-block" size={10} />
                </a>
                . Or click{' '}
                <Link href="/api/auth/github/start" className="text-accent hover:underline">
                  Install on GitHub
                </Link>{' '}
                to re-run the install flow.
              </p>
            </section>
          )}

          {/* Webhook URL — non-Slack, non-Gmail, non-DevRev, non-GitHub connectors (Stub today) */}
          {!isSlack && !isGmail && !isDevRev && !isGitHub && (
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
