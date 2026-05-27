import Link from 'next/link';
import { prisma } from '@pcs/db';
import { getSession } from '@/lib/auth';
import { Topbar } from '@/components/Topbar';
import { Badge } from '@/components/ui/Badge';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const CHANNEL_LABEL: Record<string, string> = {
  HALLWAY: 'Hallway',
  PHONE_CALL: 'Phone call',
  WHATSAPP: 'WhatsApp',
  IN_PERSON_MEETING: 'In-person',
  CUSTOMER_VISIT: 'Customer visit',
  CONFERENCE: 'Conference',
  TEXT_MESSAGE: 'Text',
  OTHER: 'Other',
};

export default async function NotesPage() {
  const session = await getSession();
  const notes = await prisma.manualNote.findMany({
    where: { workspaceId: session.workspace.id },
    include: { author: true, problem: { include: { client: true } } },
    orderBy: { occurredAt: 'desc' },
    take: 100,
  });

  return (
    <>
      <Topbar
        title="Manual notes"
        subtitle={`${notes.length} note${notes.length === 1 ? '' : 's'} captured`}
      />
      <main className="px-6 py-6">
        {notes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-200 bg-white p-12 text-center text-sm text-ink-500">
            No manual notes yet. Use Quick log (⌘K) anywhere in the app to capture one.
          </div>
        ) : (
          <ul className="space-y-3">
            {notes.map((n) => (
              <li
                key={n.id}
                className="rounded-lg border border-ink-200 bg-white p-4 shadow-sm"
              >
                <div className="mb-1 flex items-baseline gap-2 text-xs text-ink-500">
                  <span className="font-medium text-ink-900">
                    {n.author.name ?? n.author.email}
                  </span>
                  <span>·</span>
                  <Badge tone="success">{CHANNEL_LABEL[n.channel] ?? n.channel}</Badge>
                  <span className="ml-auto">{relativeTime(n.occurredAt)}</span>
                </div>
                {n.title && <p className="text-sm font-medium text-ink-900">{n.title}</p>}
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700 line-clamp-4">{n.body}</p>
                {n.problem && (
                  <p className="mt-2 text-xs text-ink-500">
                    Attached to{' '}
                    <Link
                      href={`/problems/${n.problem.id}`}
                      className="font-medium text-ink-700 hover:underline"
                    >
                      {n.problem.title}
                    </Link>{' '}
                    · {n.problem.client.name}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
