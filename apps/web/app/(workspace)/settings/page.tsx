import Link from 'next/link';
import { Users, ArrowRight } from 'lucide-react';
import { getSession } from '@/lib/auth';
import { Topbar } from '@/components/Topbar';
import { BackfillEmbeddingsButton } from './BackfillEmbeddingsButton';
import { IntelligenceStatus } from './IntelligenceStatus';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await getSession();
  return (
    <>
      <Topbar title="Settings" subtitle="Workspace + account" />
      <main className="mx-auto max-w-2xl px-6 py-6">
        <section className="rounded-lg border border-ink-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-ink-900">Workspace</h2>
          <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
            <Row label="Name">{session.workspace.name}</Row>
            <Row label="Slug">{session.workspace.slug}</Row>
            <Row label="Created">{session.workspace.createdAt.toString().slice(0, 10)}</Row>
            <Row label="Your role">{session.membership.role}</Row>
          </dl>
        </section>

        <section className="mt-5 rounded-lg border border-ink-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-ink-900">Team</h2>
          <p className="mt-1 text-xs text-ink-500">
            Invite teammates, change roles, remove members.
          </p>
          <Link
            href="/settings/members"
            className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-md bg-white px-3 text-sm font-medium text-ink-900 ring-1 ring-inset ring-ink-200 hover:bg-ink-50"
          >
            <Users size={14} />
            Members
            <ArrowRight size={12} className="ml-0.5" />
          </Link>
        </section>

        <section className="mt-5 rounded-lg border border-ink-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-ink-900">Intelligence</h2>
          <p className="mt-1 text-xs text-ink-500">
            Provider status for the resolver, plus a one-shot embeddings backfill for existing
            Problems and Events.
          </p>
          {/* @ts-expect-error Async Server Component */}
          <IntelligenceStatus />
          <div className="mt-4">
            <BackfillEmbeddingsButton />
          </div>
        </section>

        <section className="mt-5 rounded-lg border border-ink-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-ink-900">You</h2>
          <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
            <Row label="Name">{session.user.name ?? '—'}</Row>
            <Row label="Email">{session.user.email}</Row>
          </dl>
        </section>

        <p className="mt-6 text-xs text-ink-500">
          Profile editing, workspace renames, billing, and audit log filters arrive in M10.
        </p>
      </main>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-ink-900">{children}</dd>
    </div>
  );
}
