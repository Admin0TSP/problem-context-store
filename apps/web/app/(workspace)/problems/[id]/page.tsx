import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { prisma } from '@pcs/db';
import { getSession } from '@/lib/auth';
import { ProblemHeader } from '@/components/ProblemHeader';
import { Timeline } from '@/components/Timeline';
import { SourceIcon, sourceLabel } from '@/components/SourceIcon';
import { Topbar } from '@/components/Topbar';
import { ProblemQuickLogButton } from '@/components/ProblemQuickLogButton';
import { relativeTime } from '@/lib/format';
import { RefreshSummaryButton } from './RefreshSummaryButton';

export const dynamic = 'force-dynamic';

export default async function ProblemDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();

  const problem = await prisma.problem.findFirst({
    where: { id: params.id, workspaceId: session.workspace.id },
    include: {
      client: true,
      events: { orderBy: { timestamp: 'asc' } },
      artifacts: { orderBy: { createdAt: 'desc' } },
      manualNotes: { include: { author: true }, orderBy: { occurredAt: 'asc' } },
      edgesFrom: { include: { to: { include: { client: true } } } },
      edgesTo: { include: { from: { include: { client: true } } } },
    },
  });

  if (!problem) notFound();

  const notesForTimeline = problem.manualNotes.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    channel: n.channel,
    occurredAt: n.occurredAt,
    participants: n.participants,
    authorName: n.author?.name ?? n.author?.email ?? null,
  }));

  return (
    <>
      <Topbar
        title={`Problem · ${problem.client.name}`}
        subtitle={`${problem.events.length} events · ${problem.manualNotes.length} manual notes · ${problem.artifacts.length} artifacts`}
      />

      <ProblemHeader problem={problem} client={problem.client} />

      <main className="grid gap-6 px-6 py-6 lg:grid-cols-[1fr,320px]">
        {/* Left column — summaries + timeline */}
        <div className="space-y-5">
          {problem.description && (
            <section className="rounded-lg border border-ink-200 bg-white p-5 shadow-sm">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
                Description
              </h2>
              <p className="whitespace-pre-wrap text-sm text-ink-700">{problem.description}</p>
            </section>
          )}

          <section>
            <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-ink-900">AI summaries</h2>
                <p className="text-xs text-ink-500">
                  {(() => {
                    const summaryState = computeSummaryState({
                      summaryGeneratedAt: problem.summaryGeneratedAt,
                      lastEventAt: problem.events[problem.events.length - 1]?.timestamp ?? null,
                      lastNoteAt:
                        problem.manualNotes[problem.manualNotes.length - 1]?.occurredAt ?? null,
                    });
                    if (!summaryState.hasSummary)
                      return 'Generate a summary from this Problem\'s events and notes.';
                    if (summaryState.isStale)
                      return `Stale — last generated ${relativeTime(
                        problem.summaryGeneratedAt!,
                      )}, but new evidence has arrived since.`;
                    return `Last generated ${relativeTime(problem.summaryGeneratedAt!)}.`;
                  })()}
                </p>
              </div>
              <RefreshSummaryButton
                problemId={problem.id}
                hasSummary={
                  !!(
                    problem.rootCauseSummary ||
                    problem.approachSummary ||
                    problem.resolutionSummary
                  )
                }
                isStale={
                  computeSummaryState({
                    summaryGeneratedAt: problem.summaryGeneratedAt,
                    lastEventAt: problem.events[problem.events.length - 1]?.timestamp ?? null,
                    lastNoteAt:
                      problem.manualNotes[problem.manualNotes.length - 1]?.occurredAt ?? null,
                  }).isStale
                }
              />
            </header>
            <div className="grid gap-4 sm:grid-cols-3">
              <SummaryCard
                label="Approach"
                body={problem.approachSummary}
                emptyHint="What's the team trying?"
              />
              <SummaryCard
                label="Root cause"
                body={problem.rootCauseSummary}
                emptyHint="Filled in when we know."
              />
              <SummaryCard
                label="Resolution"
                body={problem.resolutionSummary}
                emptyHint={
                  problem.status === 'RESOLVED'
                    ? 'Regenerate to populate now that this is resolved.'
                    : 'Filled in on resolve.'
                }
              />
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-900">Timeline</h2>
              <ProblemQuickLogButton problemId={problem.id} />
            </div>
            <Timeline events={problem.events} notes={notesForTimeline} />
          </section>
        </div>

        {/* Right rail */}
        <aside className="space-y-4">
          {/* Artifacts */}
          <section className="rounded-lg border border-ink-200 bg-white shadow-sm">
            <header className="border-b border-ink-200 px-4 py-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                Linked artifacts
              </h3>
            </header>
            <ul className="divide-y divide-ink-200">
              {problem.artifacts.length === 0 ? (
                <li className="px-4 py-3 text-xs text-ink-500">
                  No artifacts linked yet. Tickets, PRs, and docs will appear here when connectors
                  are live.
                </li>
              ) : (
                problem.artifacts.map((a) => (
                  <li key={a.id} className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <SourceIcon source={a.source} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink-900">
                          {a.title ?? a.sourceId}
                        </p>
                        <p className="text-xs text-ink-500">
                          {sourceLabel(a.source)} · {a.kind.toLowerCase().replace('_', ' ')}
                          {a.status && <> · {a.status}</>}
                        </p>
                        {a.url && (
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                          >
                            Open <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </section>

          {/* Related */}
          <section className="rounded-lg border border-ink-200 bg-white shadow-sm">
            <header className="border-b border-ink-200 px-4 py-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                Related problems
              </h3>
            </header>
            <ul className="divide-y divide-ink-200">
              {[...problem.edgesFrom, ...problem.edgesTo].length === 0 ? (
                <li className="px-4 py-3 text-xs text-ink-500">
                  None linked yet. The resolution layer will suggest these in M6.
                </li>
              ) : (
                <>
                  {problem.edgesFrom.map((e) => (
                    <li key={e.id} className="px-4 py-3">
                      <Link href={`/problems/${e.to.id}`} className="block">
                        <p className="text-sm font-medium text-ink-900 hover:underline">
                          {e.to.title}
                        </p>
                        <p className="text-xs text-ink-500">
                          {e.kind.toLowerCase()} · {e.to.client.name}
                        </p>
                      </Link>
                    </li>
                  ))}
                  {problem.edgesTo.map((e) => (
                    <li key={e.id} className="px-4 py-3">
                      <Link href={`/problems/${e.from.id}`} className="block">
                        <p className="text-sm font-medium text-ink-900 hover:underline">
                          {e.from.title}
                        </p>
                        <p className="text-xs text-ink-500">
                          {e.kind.toLowerCase()} · {e.from.client.name}
                        </p>
                      </Link>
                    </li>
                  ))}
                </>
              )}
            </ul>
          </section>

          {/* Meta */}
          <section className="rounded-lg border border-ink-200 bg-white shadow-sm">
            <header className="border-b border-ink-200 px-4 py-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                Meta
              </h3>
            </header>
            <dl className="divide-y divide-ink-200 text-xs">
              <Row label="Created">{relativeTime(problem.createdAt)}</Row>
              <Row label="Updated">{relativeTime(problem.updatedAt)}</Row>
              <Row label="First seen">{relativeTime(problem.firstSeenAt)}</Row>
              {problem.resolvedAt && (
                <Row label="Resolved">{relativeTime(problem.resolvedAt)}</Row>
              )}
            </dl>
          </section>
        </aside>
      </main>
    </>
  );
}

function SummaryCard({
  label,
  body,
  emptyHint,
}: {
  label: string;
  body: string | null;
  emptyHint: string;
}) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-4 shadow-sm">
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
        {label}
      </h3>
      {body ? (
        <p className="text-sm text-ink-700">{body}</p>
      ) : (
        <p className="text-xs italic text-ink-500">{emptyHint}</p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between px-4 py-2">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-ink-700">{children}</dd>
    </div>
  );
}

/**
 * A summary is "stale" when there's evidence newer than the last generation.
 * Returns { hasSummary, isStale }.
 */
function computeSummaryState(input: {
  summaryGeneratedAt: Date | null;
  lastEventAt: Date | null;
  lastNoteAt: Date | null;
}): { hasSummary: boolean; isStale: boolean } {
  const hasSummary = !!input.summaryGeneratedAt;
  if (!hasSummary) return { hasSummary: false, isStale: false };

  const generatedAt = input.summaryGeneratedAt!.getTime();
  const lastEvidence = Math.max(
    input.lastEventAt ? input.lastEventAt.getTime() : 0,
    input.lastNoteAt ? input.lastNoteAt.getTime() : 0,
  );
  return { hasSummary: true, isStale: lastEvidence > generatedAt };
}
