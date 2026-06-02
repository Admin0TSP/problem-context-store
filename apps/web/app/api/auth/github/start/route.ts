/**
 * GitHub App install — start route (M11.5).
 *
 *   GET /api/auth/github/start
 *
 * Mirrors /api/auth/slack/start. The only structural differences:
 *
 *   - GitHub Apps don't use OAuth in the classic code-exchange sense for
 *     install. The "authorize URL" is just the App's install page:
 *     https://github.com/apps/<name>/installations/new?state=<state>
 *   - On approval, GitHub sends the user to our callback with
 *     ?installation_id=<n>&setup_action=install&state=<state>.
 *     No `code` to exchange — the install_id itself IS the grant.
 *
 * 1. Auth-gate via getSession() (redirects to /signin if not signed in).
 * 2. Validate server-side config (GITHUB_APP_ID, GITHUB_APP_NAME, …) and
 *    bounce back to /connectors with a friendly error if anything's missing.
 * 3. Generate CSRF state, set it in an HttpOnly cookie, redirect to GitHub.
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { githubAdapter } from '@pcs/connectors';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'github_install_state';
const STATE_COOKIE_TTL = 10 * 60; // 10 min

export async function GET() {
  try {
    // Auth-gate. getSession() redirects to /signin if not authenticated.
    const session = await getSession();

    const missing: string[] = [];
    if (!process.env.GITHUB_APP_ID) missing.push('GITHUB_APP_ID');
    if (!process.env.GITHUB_APP_NAME) missing.push('GITHUB_APP_NAME');
    if (!process.env.GITHUB_APP_PRIVATE_KEY) missing.push('GITHUB_APP_PRIVATE_KEY');
    if (!process.env.GITHUB_APP_WEBHOOK_SECRET) missing.push('GITHUB_APP_WEBHOOK_SECRET');
    if (!process.env.NEXT_PUBLIC_APP_URL) missing.push('NEXT_PUBLIC_APP_URL');
    if (missing.length) {
      const msg = `GitHub App install needs these in your .env (then restart pnpm dev): ${missing.join(', ')}. See docs/github-app-setup.md.`;
      console.error('[github/start] ' + msg);
      return errorBounce(msg);
    }

    const begin = await githubAdapter.beginInstall?.(session.workspace.id);
    if (!begin) {
      return errorBounce(
        'Could not build the GitHub App install URL — make sure GITHUB_APP_NAME matches the slug from https://github.com/settings/apps/<your-app>.',
      );
    }

    const url = new URL(begin.authUrl);
    const state = url.searchParams.get('state') ?? '';
    if (!state) {
      return errorBounce('Install state could not be generated.');
    }

    console.log(
      `[github/start] redirecting workspace=${session.workspace.id} to GitHub App install (state set in cookie)`,
    );

    const response = NextResponse.redirect(begin.authUrl);
    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/auth/github',
      maxAge: STATE_COOKIE_TTL,
    });
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[github/start] unhandled error:', err);
    return errorBounce(`Unexpected error starting GitHub App install: ${message}`);
  }
}

function errorBounce(message: string): NextResponse {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') || '';
  if (!base) {
    return NextResponse.json({ error: message }, { status: 400 });
  }
  return NextResponse.redirect(
    `${base}/connectors?error=${encodeURIComponent(message)}`,
  );
}
