import Link from 'next/link';
import { prisma } from '@pcs/db';
import { auth } from '@/auth';
import { acceptInvite } from '@/app/actions/members';
import { Button } from '@/components/ui/Button';

export const dynamic = 'force-dynamic';

export default async function AcceptInvitePage({ params }: { params: { token: string } }) {
  const invite = await prisma.workspaceInvite.findUnique({
    where: { token: params.token },
    include: { workspace: true },
  });

  const session = await auth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4 py-12">
      <div className="w-full max-w-md">
        <p className="mb-8 text-center text-[11px] font-mono uppercase tracking-[0.18em] text-ink-500">
          Problem Context Store
        </p>
        <div className="rounded-xl border border-ink-200 bg-white p-8 shadow-sm">
          {!invite ? (
            <>
              <h1 className="text-xl font-semibold text-ink-900">Invite not found</h1>
              <p className="mt-2 text-sm text-ink-500">
                This invite link is invalid. Ask the person who invited you to send it again.
              </p>
            </>
          ) : invite.acceptedAt ? (
            <>
              <h1 className="text-xl font-semibold text-ink-900">Already accepted</h1>
              <p className="mt-2 text-sm text-ink-500">
                This invite has already been used.{' '}
                <Link href="/dashboard" className="text-accent hover:underline">
                  Go to dashboard
                </Link>
                .
              </p>
            </>
          ) : invite.expiresAt < new Date() ? (
            <>
              <h1 className="text-xl font-semibold text-ink-900">Invite expired</h1>
              <p className="mt-2 text-sm text-ink-500">
                This invite link expired. Ask the person who invited you to send a new one.
              </p>
            </>
          ) : !session?.user?.id ? (
            <>
              <h1 className="text-xl font-semibold text-ink-900">
                Sign in to join {invite.workspace.name}
              </h1>
              <p className="mt-2 text-sm text-ink-500">
                You've been invited to join <strong>{invite.workspace.name}</strong> as a{' '}
                <strong>{invite.role.toLowerCase()}</strong>. Sign in as{' '}
                <strong>{invite.email}</strong> to accept.
              </p>
              <Link
                href={`/signin?callbackUrl=${encodeURIComponent(`/invite/${params.token}`)}`}
                className="mt-5 inline-flex h-9 items-center rounded-md bg-ink-900 px-4 text-sm font-medium text-white hover:bg-ink-700"
              >
                Sign in
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-ink-900">
                Join {invite.workspace.name}
              </h1>
              <p className="mt-2 text-sm text-ink-500">
                You've been invited to join <strong>{invite.workspace.name}</strong> as a{' '}
                <strong>{invite.role.toLowerCase()}</strong>.
              </p>
              <form action={acceptInvite} className="mt-5">
                <input type="hidden" name="token" value={params.token} />
                <Button type="submit">Accept invite</Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
