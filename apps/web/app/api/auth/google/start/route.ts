/**
 * Google (Gmail) OAuth — start route.
 *
 *   GET /api/auth/google/start
 *
 * 1. Auth-gated (getSession() bounces to /signin if not signed in).
 * 2. Validates server config and bounces back to /connectors with a friendly
 *    error if anything's missing (mirrors the Slack start route).
 * 3. Generates a CSRF state, stashes in an HttpOnly cookie scoped to this
 *    route + callback, then redirects to Google's authorize endpoint.
 *
 * Note we use GMAIL_CLIENT_ID/SECRET (NOT AUTH_GOOGLE_ID/SECRET — those are
 * for user sign-in via Auth.js with a very different scope set).
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { gmailAdapter, gmailOAuthRedirectUri } from '@pcs/connectors';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'gmail_oauth_state';
const STATE_COOKIE_TTL = 10 * 60;

export async function GET() {
  try {
    const session = await getSession();

    const missing: string[] = [];
    if (!process.env.GMAIL_CLIENT_ID) missing.push('GMAIL_CLIENT_ID');
    if (!process.env.GMAIL_CLIENT_SECRET) missing.push('GMAIL_CLIENT_SECRET');
    if (!process.env.NEXT_PUBLIC_APP_URL) missing.push('NEXT_PUBLIC_APP_URL');
    if (!process.env.PCS_ENCRYPTION_KEY) missing.push('PCS_ENCRYPTION_KEY');
    if (missing.length) {
      const msg = `Gmail OAuth needs these in your .env (then restart pnpm dev): ${missing.join(', ')}. See docs/gmail-setup.md.`;
      console.error('[gmail/start] ' + msg);
      return errorBounce(msg);
    }

    if (!gmailOAuthRedirectUri()) {
      const msg = 'Could not compute the Gmail OAuth redirect URI. Set NEXT_PUBLIC_APP_URL to your public HTTPS URL.';
      console.error('[gmail/start] ' + msg);
      return errorBounce(msg);
    }

    const begin = await gmailAdapter.beginInstall?.(session.workspace.id);
    if (!begin) return errorBounce('beginInstall returned null — see server logs.');

    const url = new URL(begin.authUrl);
    const state = url.searchParams.get('state') ?? '';
    if (!state) return errorBounce('OAuth state could not be generated.');

    console.log(
      `[gmail/start] redirecting workspace=${session.workspace.id} to Google OAuth`,
    );

    const response = NextResponse.redirect(begin.authUrl);
    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/auth/google',
      maxAge: STATE_COOKIE_TTL,
    });
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[gmail/start] unhandled error:', err);
    return errorBounce(`Unexpected error starting Gmail OAuth: ${message}`);
  }
}

function errorBounce(message: string): NextResponse {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') || '';
  if (!base) return NextResponse.json({ error: message }, { status: 400 });
  return NextResponse.redirect(
    `${base}/connectors?error=${encodeURIComponent(message)}`,
  );
}
