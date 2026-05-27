import { Sidebar } from '@/components/Sidebar';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <div className="min-h-screen bg-ink-50">
      {/* @ts-expect-error Async Server Component */}
      <Sidebar workspace={session.workspace} user={session.user} membership={session.membership} />
      <div className="md:pl-60">{children}</div>
    </div>
  );
}
