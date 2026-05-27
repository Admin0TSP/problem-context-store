import { Suspense } from 'react';
import { SignInForm } from './SignInForm';

export const dynamic = 'force-dynamic';

const hasGoogle = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export default function SignInPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string; error?: string };
}) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-8 shadow-sm">
      <h1 className="text-xl font-semibold text-ink-900">Sign in</h1>
      <p className="mt-1 text-sm text-ink-500">
        We'll email you a one-time sign-in link. No password.
      </p>

      {searchParams.error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {prettyError(searchParams.error)}
        </div>
      )}

      <Suspense>
        <SignInForm hasGoogle={hasGoogle} callbackUrl={searchParams.callbackUrl} />
      </Suspense>

      <p className="mt-6 text-center text-xs text-ink-500">
        By signing in, you agree to use this product as Shipsy intends. (We'll
        write a proper Terms once we have lawyers.)
      </p>
    </div>
  );
}

function prettyError(code: string): string {
  const errors: Record<string, string> = {
    Configuration: 'Sign-in is misconfigured. Check the server logs.',
    AccessDenied: 'Access denied. Your email may not be permitted in this workspace.',
    Verification: 'That sign-in link is invalid or has expired. Request a new one.',
    OAuthSignin: 'Could not start the OAuth flow.',
    OAuthCallback: 'OAuth provider returned an error.',
    OAuthAccountNotLinked:
      'This email is already linked to a different sign-in method. Use the original method.',
    EmailSignin: "Could not send the sign-in email. Try again.",
    Default: 'Something went wrong. Try again.',
  };
  return errors[code] ?? errors.Default!;
}
