'use client';

import { useState, useTransition } from 'react';
import { signInWithEmail, signInWithGoogle } from '@/app/actions/auth';
import { Label, Input } from '@/components/ui/FormField';
import { Button } from '@/components/ui/Button';

export function SignInForm({
  hasGoogle,
  callbackUrl,
}: {
  hasGoogle: boolean;
  callbackUrl?: string;
}) {
  const [email, setEmail] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-6 space-y-4">
      {hasGoogle && (
        <>
          <form
            action={() => {
              startTransition(() => signInWithGoogle(callbackUrl));
            }}
          >
            <Button
              type="submit"
              variant="secondary"
              className="w-full"
              disabled={pending}
            >
              <GoogleIcon />
              Continue with Google
            </Button>
          </form>
          <div className="flex items-center gap-3 py-1 text-[11px] uppercase tracking-wider text-ink-500">
            <span className="h-px flex-1 bg-ink-200" />
            or
            <span className="h-px flex-1 bg-ink-200" />
          </div>
        </>
      )}

      <form
        action={async (formData: FormData) => {
          const fd = new FormData();
          fd.set('email', String(formData.get('email') ?? ''));
          if (callbackUrl) fd.set('callbackUrl', callbackUrl);
          startTransition(() => signInWithEmail(fd));
        }}
        className="space-y-3"
      >
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={pending || email.length < 3}>
          {pending ? 'Sending link…' : 'Email me a sign-in link'}
        </Button>
      </form>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.48h4.844a4.14 4.14 0 01-1.796 2.716v2.258h2.908c1.703-1.568 2.684-3.874 2.684-6.614z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  );
}
