import Link from 'next/link';
import { AlertCircle } from 'lucide-react';

const ERROR_TEXT: Record<string, string> = {
  Configuration: 'Sign-in is misconfigured. Check the server logs and your env vars.',
  AccessDenied: 'You don\'t have access to this workspace.',
  Verification: 'That sign-in link has expired or already been used.',
  Default: 'Something went wrong during sign-in.',
};

export default function AuthErrorPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const code = searchParams.error ?? 'Default';
  const text = ERROR_TEXT[code] ?? ERROR_TEXT.Default;

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-8 shadow-sm text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
        <AlertCircle size={20} />
      </div>
      <h1 className="text-xl font-semibold text-ink-900">Sign-in error</h1>
      <p className="mt-2 text-sm text-ink-700">{text}</p>
      <p className="mt-1 text-xs text-ink-500">Error code: {code}</p>
      <p className="mt-6 text-xs">
        <Link href="/signin" className="text-accent hover:underline">
          ← Try again
        </Link>
      </p>
    </div>
  );
}
