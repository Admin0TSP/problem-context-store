# GitHub App Setup (M11.5)

Set up the PCS GitHub App so customers can install it with one click on any
account or org they admin.

## Is GitHub free for this?

**Yes, 100% free, every tier.** GitHub Apps are free to create, free to
install, free to deliver webhooks. No marketplace listing required, no PAT
required, no usage caps that matter for PCS-scale traffic. The free tier
covers private repos, org installs, and unlimited webhook deliveries.

## Why a GitHub App (vs. per-repo webhooks)

The M11 path used a personal webhook per repo: install in PCS → copy the URL
and secret → paste into each repo's settings. That works, but it's tedious
for multi-repo orgs and impossible to scale to customers. The App flow is
the proper way:

- **One install, many repos.** A customer picks "All repos" or hand-picks a
  list at install time — no per-repo configuration.
- **Org-wide.** Once installed at the org level, every existing and future
  repo gets covered automatically.
- **Revocable in one click.** Customer uninstalls in GitHub settings → all
  webhooks stop instantly.
- **No secrets pasted by humans.** The webhook secret lives in the App
  config (set once, by you, never seen by the customer).

## 0. Prerequisites

- A GitHub account where you control either:
  - A personal account (fine for dev), or
  - An organization you own (recommended for production).
- Your PCS dev server reachable at a public HTTPS URL. GitHub will reject
  `http://localhost` and self-signed certs at App-registration time.
  The Cloudflare named tunnel `pcs.theseopilot.pro` works.

## 1. Register the App on GitHub

1. Go to **Settings → Developer settings → GitHub Apps → New GitHub App**
   (personal: <https://github.com/settings/apps/new>, org:
   `https://github.com/organizations/<org>/settings/apps/new`).

2. Fill in:

   | Field | Value |
   |---|---|
   | **GitHub App name** | Anything globally unique. Used in the install URL. Pick something stable — renaming changes the URL. Example: `pcs-theseopilot`. |
   | **Homepage URL** | Your `NEXT_PUBLIC_APP_URL` (e.g. `https://pcs.theseopilot.pro`). |
   | **Identifying and authorizing users → Callback URL** | `https://pcs.theseopilot.pro/api/auth/github/callback` |
   | **Identifying and authorizing users → Request user authorization (OAuth) during installation** | ✅ checked (so the same install grants both user-OAuth + App install in one flow). |
   | **Webhook → Active** | ✅ checked |
   | **Webhook → Webhook URL** | `https://pcs.theseopilot.pro/api/ingest/github` (no instance ID — one URL across all installs). |
   | **Webhook → Webhook secret** | Generate one: `openssl rand -hex 32`. Paste here and into `.env` as `GITHUB_APP_WEBHOOK_SECRET`. |
   | **Where can this GitHub App be installed?** | "Any account" if you want others to install it; "Only on this account" if it's just for you. |

3. **Repository permissions** — request all of these as **Read-only**:

   - Issues — Read
   - Pull requests — Read
   - Contents — Read (needed for repo metadata)
   - Metadata — Read (auto-selected, always required)

4. **Organization permissions**:

   - Members — Read (optional; useful for resolving actor → email)

5. **Subscribe to events** — check all of:

   - ✅ Issues
   - ✅ Issue comment
   - ✅ Pull request
   - ✅ Pull request review
   - ✅ Pull request review comment

6. Click **Create GitHub App**. You're dropped onto the App's settings page.

## 2. Capture the secrets

On the App's settings page:

1. **App ID** at the top — a number like `123456`. Copy into `.env` as
   `GITHUB_APP_ID`.

2. **About → Public link** is `https://github.com/apps/<slug>`. Copy
   `<slug>` into `.env` as `GITHUB_APP_NAME`.

3. **Private keys** section → **Generate a private key**. A `.pem` file
   downloads. Open it, copy the entire contents (including the
   `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----`
   lines), and paste into `.env` as `GITHUB_APP_PRIVATE_KEY` surrounded by
   double quotes:

   ```dotenv
   GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
   MIIEpAIBAAKCAQEA...
   ...
   -----END RSA PRIVATE KEY-----"
   ```

   `dotenv` (and `dotenv-cli`, which this repo uses) preserves newlines
   inside double-quoted values, so this works as-is. If your env loader
   doesn't preserve newlines, replace each newline with `\n` — `app.ts`
   converts those back automatically.

4. The webhook secret you generated in step 1.5 is `GITHUB_APP_WEBHOOK_SECRET`.

Your `.env` should now have:

```dotenv
GITHUB_APP_ID="123456"
GITHUB_APP_NAME="pcs-theseopilot"
GITHUB_APP_WEBHOOK_SECRET="<openssl rand -hex 32 output>"
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY----- ..."
```

Restart `pnpm dev` (the worker process too, if running).

## 3. Install on a repo or org

1. In PCS, open `https://pcs.theseopilot.pro/connectors/new`.
2. Pick **GitHub** → click **Install on GitHub**.
3. GitHub shows the App install page. Pick:
   - **Personal account** or **an organization you admin**.
   - **All repositories** (org-wide) or **Only select repositories** (pick
     a few). You can change this later via GitHub settings.
4. Click **Install & Authorize**.
5. GitHub redirects back to `/api/auth/github/callback?installation_id=…`.
   PCS reads installation details (account login, repo list, permissions),
   creates a ConnectorInstance, and drops you on `/connectors/<new-id>`.

The detail page shows:

- Account login + type (User / Organization)
- Installation ID (numeric)
- Repository scope (All vs. N selected)
- Selected repository list (if hand-picked)
- Permissions granted by GitHub
- The shared webhook endpoint (informational only)

No URL or secret to copy and paste this time.

## 4. Confirm webhooks are flowing

GitHub fires an `installation: created` event the moment the App install
completes — this is the App-install equivalent of the classic `ping` event
you'd see with per-repo webhooks. In `pnpm dev` you should see:

```
[github] installation delivery=<uuid> action=created — ack-only
POST /api/ingest/github 200 in ~30ms
```

That single line proves three things at once: GitHub reached your URL, the
HMAC verified against `GITHUB_APP_WEBHOOK_SECRET`, and the route handled
the event cleanly. The route deliberately ack-only-handles `installation`
and `installation_repositories` events — they're connector-lifecycle, not
resolver evidence.

Then create a test issue or PR in one of the connected repos. Within a
couple of seconds:

```
POST /api/ingest/github 200 in ~50ms
[worker] ⇢ job=N (github:<installationId>) processing 1 event
[resolver] ───── GITHUB/TICKET_CREATED "[Issue opened] ..."
[resolver] ✓ DECISION: ...
```

If you don't see anything, debug in GitHub:

- **Org-installed App:** `https://github.com/organizations/<org>/settings/installations`
  → click the App → **Advanced** tab → **Recent Deliveries**.
- **Personal-account App:** `https://github.com/settings/installations`
  → same path.

Each delivery has a Request + Response tab and a **Redeliver** button — gold
for fixing things without faking activity.

| Symptom | Likely cause | Fix |
|---|---|---|
| Status 401 — "Signature verification failed" | `GITHUB_APP_WEBHOOK_SECRET` in `.env` doesn't match the App settings | Re-copy the secret from GitHub App settings → paste into `.env` → restart `pnpm dev`. |
| Status 500 — "Server misconfigured" | `GITHUB_APP_WEBHOOK_SECRET` missing in `.env` | Add it, restart. |
| Status 200 but `received: 0` for non-ping events | Bot account filter | If the actor is a bot (Dependabot, etc.), check the Include-bots toggle. |
| Status 200 with `ignored: "unknown_installation"` | DB doesn't have a ConnectorInstance for that installation_id | Re-run the install flow in PCS — the callback persists the row. |

## 5. Adjusting noise

Bot accounts (Dependabot, Renovate, GitHub Actions) are filtered out by
default. Toggle them back on from the connector detail page if needed.

The two-stage noise filter (M9.6 + M9.6.1) still applies on top — short
"LGTM" review comments and off-topic chatter get filtered before they hit
the resolver.

## 6. Re-installing & rotation

- **Change repo selection:** Manage at
  `https://github.com/<account>/settings/installations` → the App → **Configure**.
  Pick different repos, save. No PCS action needed — the next webhook payload
  carries the updated `installation.id` (which doesn't change), and PCS
  re-syncs the repo list on subsequent installs only. To refresh PCS's cached
  repo list right now, click **Install on GitHub** again from the connector
  detail page; the callback re-fetches `getInstallationDetails`.

- **Rotate the webhook secret:** GitHub App settings → **Webhook → Webhook
  secret** → paste a new value. Update `GITHUB_APP_WEBHOOK_SECRET` in `.env`.
  Restart. Past events stay in the DB.

- **Rotate the private key:** App settings → **Private keys** → **Generate
  a private key** (download new .pem). Update `GITHUB_APP_PRIVATE_KEY` in
  `.env`. Restart. Old keys keep working until you delete them in the
  GitHub UI — handy for zero-downtime rotation.

- **Uninstall:** Either the customer uninstalls from GitHub (revokes the
  token and stops webhooks instantly) or you uninstall the connector in PCS
  (deletes the ConnectorInstance row but leaves Event rows in place).
  Subsequent webhooks from the GitHub side get `unknown_installation`
  responses and are dropped.

## What's deliberately not yet wired

- **App-token API enrichment.** `getInstallationToken()` is implemented and
  cached in memory, but no code calls it yet — the webhook payloads alone
  have enough for the resolver. When we want richer Problem evidence
  (file-level PR diffs, full review threads, author profile lookups) we'll
  use it.
- **Marketplace listing.** Making the App publicly discoverable + reviewed
  by GitHub. Not needed until we have an external customer.
- **`installation` lifecycle webhook handling.** Currently we ack-only on
  installation/uninstallation webhooks. When uninstalls happen from the
  GitHub side, the corresponding ConnectorInstance in PCS goes stale (still
  shows as ACTIVE). A small follow-up will flip it to DISCONNECTED on the
  `installation: deleted` webhook.
- **Push event ingest.** Per-commit events would 10x volume on active repos
  for marginal Problem-resolution value.

## Architecture notes

- **One App, many tenants.** A single PCS instance can host one GitHub App
  (one App ID, one private key, one webhook secret). Multiple customers
  install that same App into their own accounts. Each install gets its own
  `installation.id` which we use to scope webhooks to a `ConnectorInstance`.
- **Single webhook endpoint.** `apps/web/app/api/ingest/github/route.ts`
  handles every install. It HMAC-verifies against the app-wide secret, reads
  `installation.id` from the payload, and routes to the right tenant — same
  pattern as the Slack receiver.
- **JIT installation tokens.** When the resolver wants to call the GitHub
  API (future enrichment), `getInstallationToken(id)` signs a 9-min JWT with
  the App's private key, exchanges it for a 1-hour installation token, and
  caches the result for 50 min in process memory.
- **Auth helpers in `packages/connectors/src/github/app.ts`:**
  `signAppJwt()`, `getInstallationToken()`, `getInstallationDetails()`,
  `appInstallUrl()`, plus opaque-state helpers for CSRF on the install
  callback. No external dependencies — native Node `crypto` does RS256.
- **Parser unchanged from M11.** `parseGitHubEvent()` still produces the
  same NormalizedEvents, plus a new exported helper
  `getInstallationIdFromPayload()` used by the receiver.
