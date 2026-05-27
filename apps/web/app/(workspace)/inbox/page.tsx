import { prisma, Prisma } from '@pcs/db';
import { RESOLUTION_AUTO_THRESHOLD } from '@pcs/core';
import { getSession } from '@/lib/auth';
import { Topbar } from '@/components/Topbar';
import { SourceIcon, sourceLabel } from '@/components/SourceIcon';
import { relativeTime, absoluteTime } from '@/lib/format';
import { TriageActions } from './TriageActions';

export const dynamic = 'force-dynamic';

const NEEDS_CONFIRM_FLOOR = 0.0; // anything attached with confidence < AUTO threshold

export default async function InboxPage() {
  const session = await getSession();

  // 1. Events not attached to any problem (and not dismissed).
  // 2. Events auto-attached but with confidence below the AUTO threshold.
  const [unattached, lowConfidence, clients, problems] = await Promise.all([
    prisma.event.findMany({
      where: {
        workspaceId: session.workspace.id,
        problemId: null,
        mentions: { none: { kind: 'HASHTAG', value: 'pcs:dismissed' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { client: true },
    }),
    prisma.event.findMany({
      where: {
        workspaceId: session.workspace.id,
        problemId: { not: null },
        problemResolutionConfidence: {
          gte: NEEDS_CONFIRM_FLOOR,
          lt: RESOLUTION_AUTO_THRESHOLD,
        },
        resolutionMethod: { notIn: ['MANUAL_CONFIRM'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { client: true, problem: { include: { client: true } } },
    }),
    prisma.client.findMany({
      where: { workspaceId: session.workspace.id },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.problem.findMany({
      where: { workspaceId: session.workspace.id },
      orderBy: { firstSeenAt: 'desc' },
      select: { id: true, title: true, client: { select: { id: true, name: true } } },
      take: 500,
    }),
  ]);

  const withClient = unattached.filter((e) => e.clientId);
  const withoutClient = unattached.filter((e) => !e.clientId);
  const total = unattached.length + lowConfidence.length;

  return (
    <>
      <Topbar
        title="Inbox"
        subtitle={`${total} event${total === 1 ? '' : 's'} need attention`}
      />

      <main className="px-6 py-6 space-y-6">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <strong>How this works:</strong> The resolver tries rules → vector → LLM. If it can't
          decide with high confidence (≥{Math.round(RESOLUTION_AUTO_THRESHOLD * 100)}%) the event lands here. Confirm correct guesses, move
          wrong ones, dismiss noise, or spawn a new Problem.
        </div>

        {lowConfidence.length > 0 && (
          <Group
            title={`Auto-attached — please confirm (${lowConfidence.length})`}
            subtitle="Confidence was mid-range. Confirm if correct, or move."
            mode="confirm"
            events={lowConfidence}
            clients={clients}
            problems={problems}
          />
        )}

        {withClient.length > 0 && (
          <Group
            title={`Client identified · Problem unknown (${withClient.length})`}
            subtitle="Pick from this client's open Problems, or spawn a new one."
            mode="attach"
            events={withClient}
            clients={clients}
            problems={problems}
          />
        )}

        {withoutClient.length > 0 && (
          <Group
            title={`Client unknown (${withoutClient.length})`}
            subtitle="No matching domain, rule, or vector signal. Pick a Problem (and inherit its client) or spawn."
            mode="attach"
            events={withoutClient}
            clients={clients}
            problems={problems}
          />
        )}

        {total === 0 && (
          <div className="rounded-lg border border-dashed border-ink-200 bg-white p-12 text-center">
            <h3 className="text-base font-medium text-ink-900">Inbox zero</h3>
            <p className="mt-1 text-sm text-ink-500">
              Everything ingested has been resolved with high confidence. Nothing to triage.
            </p>
          </div>
        )}
      </main>
    </>
  );
}

type EventRow = Awaited<ReturnType<typeof prisma.event.findMany>>[number] & {
  client?: { id: string; name: string } | null;
  problem?: { id: string; title: string; client: { id: string; name: string } } | null;
};

function Group({
  title,
  subtitle,
  events,
  clients,
  problems,
  mode,
}: {
  title: string;
  subtitle: string;
  events: EventRow[];
  clients: Array<{ id: string; name: string }>;
  problems: Array<{ id: string; title: string; client: { id: string; name: string } }>;
  mode: 'attach' | 'confirm';
}) {
  return (
    <section>
      <header className="mb-2">
        <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
        <p className="text-xs text-ink-500">{subtitle}</p>
      </header>
      <ul className="divide-y divide-ink-200 rounded-lg border border-ink-200 bg-white shadow-sm">
        {events.map((e) => {
          const eventClientId = e.client?.id ?? e.problem?.client.id ?? null;
          const candidateProblems = eventClientId
            ? problems.filter((p) => p.client.id === eventClientId)
            : problems;

          return (
            <li key={e.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr,360px]">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <SourceIcon source={e.source} size="sm" />
                  <span className="font-medium text-ink-900">{e.actorName ?? 'Unknown'}</span>
                  <span>·</span>
                  <span>{sourceLabel(e.source)}</span>
                  <span>·</span>
                  <span>{e.kind.toLowerCase().replace(/_/g, ' ')}</span>
                  <span className="ml-auto" title={absoluteTime(e.createdAt)}>
                    {relativeTime(e.createdAt)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{e.body}</p>
                <div className="mt-2 text-xs text-ink-500">
                  {e.client && (
                    <span>
                      Client: <span className="font-medium text-ink-700">{e.client.name}</span>
                    </span>
                  )}
                  {e.problem && (
                    <span>
                      {' · '}Attached to:{' '}
                      <span className="font-medium text-ink-700">{e.problem.title}</span>
                    </span>
                  )}
                  {(e.problemResolutionConfidence ?? 0) > 0 && (
                    <span>
                      {' · '}Confidence{' '}
                      <span className="font-medium text-ink-700">
                        {Math.round((e.problemResolutionConfidence ?? 0) * 100)}%
                      </span>
                    </span>
                  )}
                  {e.resolutionReason && (
                    <span className="block italic">{e.resolutionReason}</span>
                  )}
                </div>
              </div>
              <TriageActions
                mode={mode}
                eventId={e.id}
                clientId={eventClientId ?? undefined}
                currentProblemId={e.problemId ?? undefined}
                clients={clients}
                candidateProblems={candidateProblems}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
