import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { listAdapters } from '@pcs/connectors';
import { prisma } from '@pcs/db';
import { getSession } from '@/lib/auth';
import { Topbar } from '@/components/Topbar';
import { installConnector } from '@/app/actions/ingest';
import { Label, Input, FieldHint } from '@/components/ui/FormField';
import { Button } from '@/components/ui/Button';
import { SourceIcon } from '@/components/SourceIcon';

export const dynamic = 'force-dynamic';

export default async function NewConnectorPage({
  searchParams,
}: {
  searchParams: { slug?: string };
}) {
  const session = await getSession();
  const adapters = listAdapters();
  const chosen = searchParams.slug
    ? adapters.find((a) => a.descriptor.kind.toLowerCase() === searchParams.slug)
    : null;

  // Suggest a default displayName that won't collide with an existing instance.
  let defaultName = chosen?.descriptor.displayName ?? '';
  if (chosen) {
    const existingNames = new Set(
      (
        await prisma.connectorInstance.findMany({
          where: { workspaceId: session.workspace.id, kind: chosen.descriptor.kind },
          select: { displayName: true },
        })
      ).map((c) => c.displayName),
    );
    if (existingNames.has(defaultName)) {
      let n = 2;
      while (existingNames.has(`${chosen.descriptor.displayName} #${n}`)) n++;
      defaultName = `${chosen.descriptor.displayName} #${n}`;
    }
  }

  return (
    <>
      <Topbar title="Install connector" subtitle="Bring a source system online" />
      <main className="mx-auto max-w-2xl px-6 py-6">
        <Link
          href="/connectors"
          className="inline-flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-700"
        >
          <ArrowLeft size={12} /> Back to connectors
        </Link>

        {!chosen ? (
          <section className="mt-4 rounded-lg border border-ink-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-ink-900">Pick a connector</h2>
            <ul className="mt-3 space-y-2">
              {adapters.map((a) => (
                <li key={a.descriptor.kind}>
                  <Link
                    href={`/connectors/new?slug=${a.descriptor.kind.toLowerCase()}`}
                    className="flex items-center gap-3 rounded-md border border-ink-200 p-3 hover:bg-ink-50"
                  >
                    <SourceIcon source={a.descriptor.kind} />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-ink-900">{a.descriptor.displayName}</p>
                      <p className="text-xs text-ink-500">{a.descriptor.description}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section className="mt-4 rounded-lg border border-ink-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <SourceIcon source={chosen.descriptor.kind} />
              <div>
                <h2 className="text-sm font-semibold text-ink-900">{chosen.descriptor.displayName}</h2>
                <p className="text-xs text-ink-500">{chosen.descriptor.description}</p>
              </div>
            </div>

            {chosen.descriptor.capabilities.authFlow === 'none' ? (
              <form action={installConnector} className="mt-5 space-y-3">
                <input type="hidden" name="slug" value={searchParams.slug} />
                <div>
                  <Label htmlFor="displayName">Display name</Label>
                  <Input
                    id="displayName"
                    name="displayName"
                    required
                    placeholder="A short, recognizable label for this install"
                    defaultValue={defaultName}
                  />
                  <FieldHint>Must be unique per connector type in this workspace.</FieldHint>
                </div>
                <div className="rounded-md bg-ink-50 p-3 text-xs text-ink-700">
                  <p>No OAuth — this connector authenticates via a webhook token assigned on install.</p>
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <Link href="/connectors"><Button type="button" variant="ghost">Cancel</Button></Link>
                  <Button type="submit">Install</Button>
                </div>
              </form>
            ) : chosen.descriptor.kind === 'SLACK' ? (
              <div className="mt-5 space-y-3">
                <div className="rounded-md bg-ink-50 p-3 text-xs text-ink-700">
                  <p className="font-medium">You'll be redirected to Slack to authorize the app.</p>
                  <p className="mt-1">
                    After approving, you'll come back here with the install ready. The display name will
                    be set to your Slack workspace name automatically. Re-installing the same workspace
                    updates the existing instance instead of creating a duplicate.
                  </p>
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <Link href="/connectors"><Button type="button" variant="ghost">Cancel</Button></Link>
                  <Link href="/api/auth/slack/start">
                    <Button type="button">Add to Slack</Button>
                  </Link>
                </div>
              </div>
            ) : chosen.descriptor.kind === 'GMAIL' ? (
              <div className="mt-5 space-y-3">
                <div className="rounded-md bg-ink-50 p-3 text-xs text-ink-700">
                  <p className="font-medium">You'll be redirected to Google to grant Gmail read access.</p>
                  <p className="mt-1">
                    Pick the Gmail account you want to monitor (typically a customer-support inbox like{' '}
                    <code className="rounded bg-ink-100 px-1">support@yourdomain.com</code>). After approval
                    you'll return here with the inbox active. Use the <strong>Sync now</strong> button on
                    the instance page to pull new messages.
                  </p>
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <Link href="/connectors"><Button type="button" variant="ghost">Cancel</Button></Link>
                  <Link href="/api/auth/google/start">
                    <Button type="button">Add to Gmail</Button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-md bg-amber-50 p-3 text-xs text-amber-900">
                OAuth not wired yet for this connector. (Lands in a later M8 release.)
              </div>
            )}
          </section>
        )}
      </main>
    </>
  );
}
