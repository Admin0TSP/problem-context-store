/**
 * Layout for unauthenticated routes (signin, verify-request, auth-error).
 * Center the content on a clean background. No sidebar.
 */

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-ink-500">
            Problem Context Store
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
