'use client';

import { ProblemStatus, Severity, type Problem, type Client } from '@pcs/db';
import { StatusBadge, SeverityBadge } from './StatusBadge';
import { updateProblemStatus, updateProblemSeverity } from '@/app/actions/problems';
import { relativeTime } from '@/lib/format';

/**
 * Header for the Problem detail page. Two inline forms — each form submits
 * directly to a Server Action when the select changes. Next handles
 * revalidation; the page re-renders with the new status/severity.
 */
export function ProblemHeader({
  problem,
  client,
}: {
  problem: Pick<Problem, 'id' | 'title' | 'status' | 'severity' | 'firstSeenAt' | 'resolvedAt'>;
  client: Pick<Client, 'id' | 'name' | 'slug'>;
}) {
  return (
    <header className="border-b border-ink-200 bg-white px-6 py-5">
      <p className="text-xs font-medium text-ink-500">
        <a href={`/clients/${client.slug}`} className="hover:text-ink-900">
          {client.name}
        </a>
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-900">{problem.title}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <form action={updateProblemStatus} className="flex items-center gap-2">
          <input type="hidden" name="problemId" value={problem.id} />
          <span className="text-xs text-ink-500">Status</span>
          <select
            name="status"
            defaultValue={problem.status}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="h-7 rounded-md border border-ink-200 bg-white px-2 text-xs text-ink-700 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {Object.values(ProblemStatus).map((s) => (
              <option key={s} value={s}>
                {s.replaceAll('_', ' ').toLowerCase()}
              </option>
            ))}
          </select>
          <StatusBadge status={problem.status} />
        </form>

        <form action={updateProblemSeverity} className="flex items-center gap-2">
          <input type="hidden" name="problemId" value={problem.id} />
          <span className="text-xs text-ink-500">Severity</span>
          <select
            name="severity"
            defaultValue={problem.severity}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="h-7 rounded-md border border-ink-200 bg-white px-2 text-xs text-ink-700 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {Object.values(Severity).map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </select>
          <SeverityBadge severity={problem.severity} />
        </form>

        <span className="ml-auto text-xs text-ink-500">
          First seen {relativeTime(problem.firstSeenAt)}
          {problem.resolvedAt && <> · Resolved {relativeTime(problem.resolvedAt)}</>}
        </span>
      </div>
    </header>
  );
}
