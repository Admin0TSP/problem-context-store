# DevRev Connector Setup (M8c)

Connect a DevRev workspace to PCS so tickets, work updates, and external
customer comments flow through the resolver alongside Slack messages and
Gmail emails.

## Is DevRev free for this?

**Yes, the free tier is enough for everything PCS needs.**

DevRev offers a free plan (sometimes labeled **"Build"** or **"Free
Forever"**) aimed at small teams and individual developers. For our use
case — generating a Personal Access Token, creating tickets, and subscribing
to webhooks — the free tier is sufficient.

Quick reality check on what we use:

| What PCS needs | Available on free tier |
|---|---|
| Personal Access Token (PAT) | ✓ Yes |
| Webhook subscriptions on `work_created`, `work_updated`, `timeline_entry_created` | ✓ Yes |
| Creating tickets / work items | ✓ Yes |
| Read access to comments via API | ✓ Yes |

Paid tiers (Grow, Enterprise) add things we don't need: advanced
automations, AI assistance inside DevRev, SLA management, custom roles,
higher rate limits. None of those affect the connector.

**Caveat**: DevRev's pricing and feature gating change occasionally. If you
hit a "this feature requires an upgrade" wall during setup — particularly
on webhooks for organizations created after a pricing change — fall back to
polling via the PAT, which we can wire up as M8c.1.

## 0. Create a DevRev workspace (if you don't have one)

If your team already has a DevRev workspace, skip to section 0.5.

1. Go to **<https://app.devrev.ai>**. (The marketing site at devrev.ai also
   has a "Start free" button that lands in the same flow.)
2. Click **Sign up** / **Get started**.
3. Pick an auth method: Google, GitHub, Microsoft, or email + password.
4. Verify your email if you went the email route.
5. **Create an organization** when prompted:
   - Org name: e.g. `TheSEOPilot Test` (this becomes part of your Org ID
     and your DevRev URL — pick something you can live with).
   - Industry / role: best-fit, doesn't affect anything functional.
   - Plan: pick **Free / Build**. (If you see a trial of a paid plan offered,
     decline it — the free tier has what we need.)
6. Skip or quickly click through the onboarding wizard:
   - Inviting teammates → "Skip for now".
   - Connecting Slack / GitHub from inside DevRev → **skip**. (PCS connects
     to those independently; you don't want DevRev's integrations getting in
     the way.)
   - Importing tickets → skip.
7. You should land on the main DevRev dashboard at something like
   `https://app.devrev.ai/theseopilottest/...`. The path segment right after
   `app.devrev.ai/` is your **org slug** — note it down.

## 0.5. Prerequisites

- A DevRev workspace with admin access (you'll need to generate a Personal
  Access Token and add a webhook). If you just created one in section 0,
  you already have admin rights.
- `PCS_ENCRYPTION_KEY` set in your `.env` — we encrypt the PAT at rest.
- Your PCS dev server reachable at a public HTTPS URL (you've already got
  this via `pcs.theseopilot.pro` after the Cloudflare named tunnel).

## 1. Find your DevRev Org ID

In DevRev:

1. Click your workspace name → **Settings**.
2. Look for **Organization** (sometimes under "Workspace details").
3. Copy the Org ID. It looks like `DEV-acmecorp`.

If you can't find it in the UI, you can also derive it from any DevRev URL —
the path segment after `app.devrev.ai/` is your org slug (`acmecorp`), and
the full ID is `DEV-` prefixed.

## 2. Generate a Personal Access Token

Still in DevRev:

1. **Settings** → **Account** → **Personal Access Tokens** (sometimes labeled
   "API tokens" or "Developer settings").
2. Click **Create token**.
3. Name: `PCS dev` (or similar). Expiration: pick a sensible default — most
   teams use 90 days for service tokens.
4. **Scopes**: PCS only reads at this stage. Pick read-only scopes for
   conversations, works, and timeline entries if the UI exposes that. If
   scopes aren't granular, a full-access token works (just rotate it
   regularly).
5. Click **Generate** and **copy the token immediately** — DevRev won't show
   it again. Store it in your password manager.

## 3. Install the DevRev connector in PCS

1. Navigate to your PCS workspace at
   `https://pcs.theseopilot.pro/connectors/new`.
2. Pick **DevRev**.
3. Fill in:
   - **Display name**: `Shipsy DevRev` (or whatever helps you identify this
     install).
   - **Org ID**: paste the `DEV-acmecorp` value from step 1.
   - **Personal Access Token**: paste the token from step 2.
4. Click **Install**.

You'll land on `/connectors/<new-instance-id>`. The page shows a **Webhook
URL** that looks like:

```
https://pcs.theseopilot.pro/api/ingest/devrev/cmp...?token=...
```

Copy that whole URL.

## 4. Add the webhook in DevRev

In DevRev:

1. **Settings** → **Webhooks** (sometimes under "Integrations" or
   "Developer").
2. Click **Add webhook** (or **Create subscription**).
3. **URL**: paste the URL you copied from PCS.
4. **Events to subscribe to** — at minimum:
   - `work_created`
   - `work_updated`
   - `timeline_entry_created`
5. **Signing secret**: PCS uses a query-string token rather than HMAC for
   MVP. If DevRev requires a signing secret here, you can paste anything
   (PCS ignores it). HMAC support lands in a later iteration.
6. **Save** the webhook.

DevRev will usually send a test ping immediately. If it does, watch the
`pnpm dev` terminal for the request:

```
POST /api/ingest/devrev/cmp... 200 in 95ms
```

Status 200 = the secret matched and the ping was accepted (even if the
payload type isn't one we ingest — we silently 200 those).

## 5. Smoke test it

In DevRev, create a new ticket:

- Title: `"Customer reports site speed regression on Mumbai hub"`
- Body: a short description that overlaps with one of your existing PCS
  Problems (e.g. "site speed", "COD mismatch").

Within a second or two you should see in `pnpm dev`:

```
POST /api/ingest/devrev/cmp... 200 in ~50ms          ← webhook accepted
[worker] ⇢ job=N (devrev:cmp...) processing 1 event
[resolver] ───── DEVREV/TICKET_CREATED "Title: Customer reports site speed..."
[resolver] ✓ DECISION: ... attached/spawned ...
[worker] ✓ job=N → 1 ingested, 0 dup, 1 resolved, 0 spawned ...
```

Reload `/inbox` or the matching Problem detail — the DevRev ticket appears
in the timeline with the other Slack + Gmail evidence.

Then add a comment to the same ticket in DevRev. The comment fires
`timeline_entry_created` and clusters to the same Problem via the
thread-continuity rule (because `parentThreadId = work.id` for both the
ticket and its comments).

## 6. Re-installing & rotation

To rotate the webhook secret or the PAT today, uninstall the connector in
PCS and reinstall — the install form will issue a new webhook secret and
re-encrypt the PAT. Past events stay in the database (uninstall removes the
ConnectorInstance row but leaves Event rows intact).

A standalone "rotate" button is coming with M10's polish work.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Webhook returns 401 in PCS logs | Token in URL doesn't match `webhookSecret` | Copy the URL from `/connectors/<id>` again — the secret is auto-included |
| Webhook returns 401, URL looks right | DevRev stripped query string | Some DevRev tiers require passing the secret as a header. Add `X-Pcs-Devrev-Token: <secret>` if their UI allows custom headers |
| Tickets arrive but nothing routes to a Problem | No client/Problem matched | Normal for first time — manually attach via `/inbox` to teach the vector layer |
| Comments don't cluster to the parent ticket | `timeline_entry_created.visibility` is `internal`/`private` | We only ingest `external` comments. Internal-only chatter is intentional noise. |
| `DEVREV/TICKET_UPDATED` events flood the inbox | Pure metadata updates trigger them | Acceptable trade-off for M8c; M9.6 noise filter catches the worst cases. Tune blocklist if needed. |

## What's deliberately not in MVP

- **HMAC signing** — DevRev's HMAC implementation isn't uniform across plans.
  Token-in-URL works everywhere.
- **OAuth** — requires DevRev marketplace app approval. PAT is the right path
  for an internal/single-customer dev setup.
- **Backfill via REST API** — could pull historical tickets via DevRev's
  `works.list` endpoint. Saved for M8c.1 once we know which historical
  windows matter for demos.
- **DevRev artifacts** — tickets aren't yet linked as `Artifact` rows on
  Problems (the PR-style first-class artifact entry). They're stored as
  events for now.
