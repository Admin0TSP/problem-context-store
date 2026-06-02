# CSP Deployment — PCS on `pcs.theseopilot.pro`

PCS sets its own Content-Security-Policy via `apps/web/next.config.mjs`. The
Cloudflare zone `theseopilot.pro` separately injects a different CSP on every
response (set up for the marketing site, which is Contentful + GTM based).
Cloudflare's header **overrides whatever the origin sets** — so until the
zone rule is updated, the app-level CSP has no effect.

This doc is the half-page checklist for plugging the gap.

## TL;DR

1. The app sets its own CSP via `next.config.mjs` ✅ (already in M11.7's commit).
2. You need to **carve `pcs.theseopilot.pro` out of the Cloudflare zone CSP rule** so
   it lets the origin's CSP through.

## Step 1 — find the Cloudflare rule injecting the zone-wide CSP

In the Cloudflare dashboard:

1. Open <https://dash.cloudflare.com> → select the **`theseopilot.pro`** zone.
2. Check, in order:
   - **Rules → Transform Rules → Modify Response Header** — the most common place.
   - **Rules → Configuration Rules** — less common.
   - **Security → Settings → Managed Transforms → Add security HTTP headers** —
     Cloudflare's one-click security headers feature.

You're looking for whatever sets a header named `Content-Security-Policy` with
a value mentioning `cdn.contentful.com` and `googletagmanager.com`.

## Step 2 — carve out the PCS subdomain

Edit the rule's matching expression to **exclude** `pcs.theseopilot.pro`. The
simplest expression:

```
(http.host eq "pcs.theseopilot.pro")  →  Skip this rule
```

Or, if the rule uses a hostname-matches expression, append:

```
and not (http.host eq "pcs.theseopilot.pro")
```

Save. The change is global within a few seconds.

## Step 3 — verify the right CSP is now coming through

In the dev environment with `pnpm dev` running and cloudflared up:

```bash
curl -sI https://pcs.theseopilot.pro/ | grep -i content-security-policy
```

You should see PCS's CSP, NOT Cloudflare's. The key tells:

- ✅ Contains `'unsafe-eval'` in dev (`process.env.NODE_ENV !== 'production'`).
- ✅ Mentions `static.cloudflareinsights.com` in `script-src`.
- ❌ Does NOT mention `contentful.com` anywhere.
- ❌ Does NOT mention `googletagmanager.com`.

Then in the browser, open <https://pcs.theseopilot.pro/inbox>, open dev tools,
switch to the **Issues** tab. The "Content Security Policy of your site blocks
the use of 'eval' in JavaScript" violation should be gone.

If the CSP still mentions Contentful, the Cloudflare rule didn't get the
exception — go back to Step 1.

## Production-mode caveat

In `NODE_ENV=production`, the CSP drops `'unsafe-eval'`. That's fine for
production builds (Next.js doesn't use eval-based HMR in prod), but it means
**you cannot run `pnpm dev` against a production-built tree behind this CSP**.
If you ever do a `next start` against a `next build` output and load the app
through the tunnel, dev-tools-style debugging that uses eval() (some extensions
do) might break. Switch to plain `pnpm dev` when iterating.

## Future hardening (not done yet)

The current CSP relies on `'unsafe-inline'` for both `script-src` and
`style-src`. The proper fix is nonce-based CSP — Next.js supports it via
middleware (`headers().set('x-nonce', ...)` + `headers().set(...)`), then the
inline scripts/styles need a matching nonce attribute. That's a separate
follow-up (CSP-2.0) and not blocking for the customer demo. Tracking issue:
follow up after the first customer install.
