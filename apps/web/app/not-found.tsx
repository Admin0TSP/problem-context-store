import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-6 py-16 text-center">
      <p className="text-xs font-mono uppercase tracking-widest text-ink-500">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-ink-900">Not found</h1>
      <p className="mt-2 text-sm text-ink-500">
        That problem, client, or page doesn't exist (or you don't have access in this workspace).
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-flex h-9 items-center rounded-md bg-ink-900 px-4 text-sm font-medium text-white hover:bg-ink-700"
      >
        Back to dashboard
      </Link>
    </main>
  );
}
