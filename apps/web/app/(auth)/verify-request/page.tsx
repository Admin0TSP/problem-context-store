import Link from 'next/link';
import { Mail } from 'lucide-react';

export default function VerifyRequestPage() {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-8 shadow-sm text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Mail size={20} />
      </div>
      <h1 className="text-xl font-semibold text-ink-900">Check your email</h1>
      <p className="mt-2 text-sm text-ink-500">
        We sent you a one-time sign-in link. Click it from the same browser to continue.
      </p>
      <p className="mt-6 text-xs text-ink-500">
        If <code className="rounded bg-ink-100 px-1 py-0.5">RESEND_API_KEY</code> isn't set,
        the link is printed to your <code className="rounded bg-ink-100 px-1 py-0.5">pnpm dev</code> terminal — copy it from there.
      </p>
      <p className="mt-6 text-xs">
        <Link href="/signin" className="text-accent hover:underline">
          ← Back to sign in
        </Link>
      </p>
    </div>
  );
}
