import Link from 'next/link';
import { prisma, Severity } from '@pcs/db';
import { getSession } from '@/lib/auth';
import { createProblem } from '@/app/actions/problems';
import { Topbar } from '@/components/Topbar';
import { Label, Input, Textarea, Select } from '@/components/ui/FormField';
import { Button } from '@/components/ui/Button';

export const dynamic = 'force-dynamic';

export default async function NewProblemPage() {
  const session = await getSession();
  const clients = await prisma.client.findMany({
    where: { workspaceId: session.workspace.id },
    orderBy: { name: 'asc' },
  });

  return (
    <>
      <Topbar title="New problem" subtitle="Create a problem to attach context to" />
      <main className="mx-auto max-w-2xl px-6 py-6">
        <form action={createProblem.bind(null, null)} className="space-y-4 rounded-lg border border-ink-200 bg-white p-5 shadow-sm">
          <div>
            <Label htmlFor="clientId">Client</Label>
            <Select id="clientId" name="clientId" required defaultValue="">
              <option value="" disabled>
                Pick a client…
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            {clients.length === 0 && (
              <p className="mt-1 text-xs text-red-600">
                No clients yet. Add one in <Link href="/clients" className="underline">Clients</Link>.
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              name="title"
              required
              placeholder="e.g. COD reconciliation mismatch for Mumbai hub"
            />
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              rows={4}
              placeholder="What's the customer seeing? What's been ruled out so far?"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="severity">Severity</Label>
              <Select id="severity" name="severity" defaultValue={Severity.MEDIUM}>
                {Object.values(Severity).map((s) => (
                  <option key={s} value={s}>
                    {s.toLowerCase()}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Link href="/dashboard">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
            <Button type="submit">Create problem</Button>
          </div>
        </form>
      </main>
    </>
  );
}
