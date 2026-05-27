import { getUserOrRedirect } from '@/lib/auth';
import { CreateWorkspaceForm } from './CreateWorkspaceForm';

export const dynamic = 'force-dynamic';

export default async function NewWorkspacePage() {
  const user = await getUserOrRedirect();

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4 py-12">
      <div className="w-full max-w-md">
        <p className="mb-8 text-center text-[11px] font-mono uppercase tracking-[0.18em] text-ink-500">
          Problem Context Store
        </p>
        <div className="rounded-xl border border-ink-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-ink-900">Create your workspace</h1>
          <p className="mt-1 text-sm text-ink-500">
            A workspace is where your team’s customer problems live. You can be in multiple.
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Signed in as <span className="font-medium text-ink-700">{user.email}</span>.
          </p>
          <CreateWorkspaceForm />
        </div>
      </div>
    </div>
  );
}
