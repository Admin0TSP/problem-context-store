/** @type {import('next').NextConfig} */

// ---------------------------------------------------------------------------
// Content Security Policy
// ---------------------------------------------------------------------------
//
// We set this here, at the application level, instead of letting Cloudflare
// inject a zone-wide CSP on every response under *.theseopilot.pro. The
// zone-wide CSP was tuned for our marketing site (Contentful + GTM); it
// (a) omits `'unsafe-eval'`, which breaks Next.js dev mode HMR, and
// (b) blocks scripts PCS doesn't need but Cloudflare Web Analytics injects.
//
// In dev we tolerate `'unsafe-eval'` because webpack uses eval()-based source
// maps and HMR. In prod we drop it.
//
// IMPORTANT: once this is shipping, add an exception in the Cloudflare zone
// CSP rule so it does NOT apply to `pcs.theseopilot.pro` — otherwise
// Cloudflare's header overrides the one Next.js sets and we're back to
// square one. See docs/csp-deployment.md.
const isDev = process.env.NODE_ENV !== 'production';
const cspDirectives = {
  'default-src': ["'self'"],
  // 'unsafe-inline' covers Next.js's inline bootstrap scripts.
  // 'unsafe-eval' is dev-only — webpack HMR needs it; prod bundles do not.
  'script-src': [
    "'self'",
    "'unsafe-inline'",
    ...(isDev ? ["'unsafe-eval'"] : []),
    // Cloudflare Web Analytics beacon. Drop this line if you disable Web
    // Analytics in the Cloudflare zone; keeping it costs nothing.
    'https://static.cloudflareinsights.com',
  ],
  // Tailwind's runtime-generated styles + Next.js's inline critical CSS.
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'https:', 'blob:'],
  'font-src': ["'self'", 'data:'],
  // XHR / fetch / WebSocket. In dev, Next.js opens a WebSocket back to the
  // dev server for HMR — `ws:` / `wss:` covers it.
  'connect-src': [
    "'self'",
    ...(isDev ? ['ws:', 'wss:'] : []),
    'https://cloudflareinsights.com',
  ],
  // Block being embedded in iframes outside our own origin.
  'frame-ancestors': ["'self'"],
  // Disallow Flash / plugins entirely.
  'object-src': ["'none'"],
  // Force HTTPS for sub-resources in prod.
  ...(isDev ? {} : { 'upgrade-insecure-requests': [] }),
  // Server actions POST to same-origin; deny cross-origin form posts.
  'form-action': ["'self'"],
  'base-uri': ["'self'"],
};

const cspString = Object.entries(cspDirectives)
  .map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k))
  .join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: cspString },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=()',
  },
];

const nextConfig = {
  reactStrictMode: true,
  // Transpile workspace packages so they're picked up by Next's bundler.
  transpilePackages: ['@pcs/db', '@pcs/core', '@pcs/connectors'],
  experimental: {
    // We hit Prisma from server components / route handlers; mark it external so
    // Next doesn't try to bundle the engine binary.
    serverComponentsExternalPackages: ['@prisma/client', 'prisma'],
  },
  async headers() {
    return [
      {
        // Apply to every route. Webhook receivers + API routes also get the
        // CSP, which is harmless — those responses are JSON, browsers don't
        // execute the CSP against them, and external clients (GitHub, Slack)
        // ignore HTTP security headers.
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
