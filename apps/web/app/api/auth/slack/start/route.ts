/**
 * Slack OAuth — start route.
 *
 *   GET /api/auth/slack/start
 *
 * 1. Requires the user to be signed in (getSession() redirects to /signin if not).
 * 2. Validates server-side config (SLACK_CLIENT_ID, NEXT_PUBLIC_APP_URL, etc.)
 *    and bounces back to /connectors with a friendly error in the URL if
 *    anything is missing. Returning a bare 500 makes Chrome show its generic
 *    "This page isn't working" page, which is useless for debugging.
 * 3. Generates a CSRF state, sets it in an HttpOnly cookie scoped to this
 *    route + the callback, then redirects to Slack's authorize endpoint.
 *
 * Cookie pattern: we set the cookie on the response object directly via
 * `response.cookies.set` (rather than `cookies().set()` from next/headers)
 * because the former is the bulletproof way to attach a cookie to a redirect
 * in App Router route handlers across Next.js versions.
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { slackAdapter, slackOAuthRedirectUri } from '@pcs/connectors';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'slack_oauth_state';
const STATE_COOKIE_TTL = 10 * 60; // 10 min

export async function GET() {
  try {
    // Auth-gate. getSession() redirects to /signin if not authenticated.
    const session = await getSession();

    // Concrete env-var checks so the user gets a useful pointer.
    const missing: string[] = [];
    if (!process.env.SLACK_CLIENT_ID) missing.push('SLACK_CLIENT_ID');
    if (!process.env.SLACK_CLIENT_SECRET) missing.push('SLACK_CLIENT_SECRET');
    if (!process.env.SLACK_SIGNING_SECRET) missing.push('SLACK_SIGNING_SECRET');
    if (!process.env.NEXT_PUBLIC_APP_URL) missing.push('NEXT_PUBLIC_APP_URL');
    if (!process.env.PCS_ENCRYPTION_KEY) missing.push('PCS_ENCRYPTION_KEY');
    if (missing.length) {
      const msg = `Slack OAuth needs these in your .env (then restart pnpm dev): ${missing.join(', ')}. See docs/slack-setup.md.`;
      console.error('[slack/start] ' + msg);
      return errorBounce(msg);
    }

    if (!slackOAuthRedirectUri()) {
      const msg = 'Could not compute the Slack OAuth redirect URI. Set NEXT_PUBLIC_APP_URL to your public HTTPS URL (cloudflared / ngrok tunnel).';
      console.error('[slack/start] ' + msg);
      return errorBounce(msg);
    }

    const begin = await slackAdapter.beginInstall?.(session.workspace.id);
    if (!begin) {
      return errorBounce('beginInstall returned null — see server logs for details.');
    }

    const url = new URL(begin.authUrl);
    const state = url.searchParams.get('state') ?? '';
    if (!state) {
      return errorBounce('OAuth state could not be generated.');
    }

    console.log(
      `[slack/start] redirecting workspace=${session.workspace.id} to Slack OAuth (state set in cookie)`,
    );

    const response = NextResponse.redirect(begin.authUrl);
    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/auth/slack',
      maxAge: STATE_COOKIE_TTL,
    });
    return response;
  } catch (err) {
    // Bubble unexpected errors up to the user with detail, instead of a bare 500.
    const message = err instanceof Error ? err.message : String(err);
    console.error('[slack/start] unhandled error:', err);
    return errorBounce(`Unexpected error starting Slack OAuth: ${message}`);
  }
}

function errorBounce(message: string): NextResponse {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') || '';
  // If NEXT_PUBLIC_APP_URL isn't set we can't build an absolute URL —
  // fall back to a JSON response in that case.
  if (!base) {
    return NextResponse.json({ error: message }, { status: 400 });
  }
  return NextResponse.redirect(
    `${base}/connectors?error=${encodeURIComponent(message)}`,
  );
}
