'use server';

/**
 * Server Actions for authentication.
 *
 * Thin wrappers around Auth.js v5 so the UI can call them as form actions.
 */

import { signIn, signOut } from '@/auth';
import { redirect } from 'next/navigation';

export async function signInWithEmail(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const callbackUrl = String(formData.get('callbackUrl') ?? '/dashboard');
  if (!email) throw new Error('Email is required');

  await signIn('nodemailer', { email, redirectTo: callbackUrl, redirect: true });
}

export async function signInWithGoogle(callbackUrl?: string) {
  await signIn('google', { redirectTo: callbackUrl || '/dashboard', redirect: true });
}

export async function signOutAction() {
  await signOut({ redirectTo: '/signin', redirect: true });
}
