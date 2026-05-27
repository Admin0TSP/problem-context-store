/**
 * Edge middleware — coarse-grained route guard.
 *
 * Does NOT import `@/auth` because that pulls in Prisma, which doesn't run
 * in the Edge runtime. Instead we check for the Auth.js session cookie's
 * presence (httpOnly, so JS-set attempts won't survive). Real session
 * validation (and forged-cookie rejection) happens server-side in
 * `getSession()` at the page/action level.
 */

import { NextResponse, type NextRequest } from 'next/server';

/**
 * Auth.js picks the cookie name based on the URL scheme:
 *   - HTTP  → "authjs.session-token"
 *   - HTTPS → "__Secure-authjs.session-token"  (browser only sends over HTTPS)
 *
 * That decision happens per-request inside Auth.js, so the only safe move
 * in middleware is to check BOTH names. This matters in dev whenever the
 * app is reached via HTTPS — cloudflared/ngrok tunnels, Vercel previews,
 * production behind a load balancer, etc.
 */
const SESSION_COOKIE_NAMES = ['__Secure-authjs.session-token', 'authjs.session-token'] as const;

function hasSessionCookie(req: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => !!req.cookies.get(name)?.value);
}

const PUBLIC_PREFIXES = [
  '/signin',
  '/verify-request',
  '/auth-error',
  '/invite/',
  '/api/auth/',
  '/api/ingest/', // webhooks come from external services with no session
];

export default function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Public root: redirect signed-in users into the app, send others to signin.
  if (pathname === '/') {
    const url = req.nextUrl.clone();
    url.pathname = hasSessionCookie(req) ? '/dashboard' : '/signin';
    return NextResponse.redirect(url);
  }

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Everything else requires a session cookie. Page-level getSession()
  // still validates that the cookie corresponds to a real user.
  if (!hasSessionCookie(req)) {
    const url = req.nextUrl.clone();
    url.pathname = '/signin';
    url.searchParams.set('callbackUrl', pathname + search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
