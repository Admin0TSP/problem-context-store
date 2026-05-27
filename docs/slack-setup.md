# Slack Connector Setup (M8a)

This guide walks you through creating a Slack app and wiring it into Problem Context Store. You do this once per environment (dev / staging / prod) — one Slack app can be installed into unlimited customer Slack workspaces.

## 0. Prerequisites

- A Slack account (any free workspace will do for development).
- The app running on a public HTTPS URL. For local dev that means **ngrok** (or similar):

  ```bash
  # In a separate terminal
  ngrok http 3000
  # Copy the https://*.ngrok-free.app URL it prints — you'll use it below.
  ```

  Then in your `.env`, set ALL THREE of these to the tunnel URL:

  ```env
  NEXT_PUBLIC_APP_URL="https://<your-tunnel>.trycloudflare.com"
  AUTH_URL="https://<your-tunnel>.trycloudflare.com"
  AUTH_TRUST_HOST=true
  ```

  `AUTH_URL` and `AUTH_TRUST_HOST` are needed because Auth.js v5 refuses to
  redirect callbackUrls whose origin doesn't match its own — and without
  these, it sees the request host as `localhost:3000` and rejects redirects
  to your tunnel URL with a misleading `?error=Verification`.

  Restart `pnpm dev` after editing `.env` — env vars don't hot-reload. The
  tunnel URL changes every restart on the free plan; if it does, update all
  three env vars and the URLs in the Slack app dashboard.

## 1. Create the Slack app

⚠️ **Do not use a corporate / Enterprise Grid Slack as the development workspace.** Admin-managed workspaces force every scope through an approval queue with the "Please add reasons" prompt, blocking dev iteration.

Instead, create a **free personal Slack workspace** at [slack.com/get-started](https://slack.com/get-started) (any email you control works — takes 90 seconds, you become the admin). Use *that* as the development workspace.

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**.
2. Name it (e.g. `Problem Context Store — dev`), pick the **personal** workspace you just created as the development workspace. Click **Create App**.

When you eventually ship to real customers, the same one app handles distribution into any number of Slack workspaces — corporate Slacks become just another `ConnectorInstance`.

## 2. Basic Information → secrets

On the **Basic Information** tab, scroll to **App Credentials** and copy these into your `.env`:

```env
SLACK_CLIENT_ID="..."
SLACK_CLIENT_SECRET="..."
SLACK_SIGNING_SECRET="..."
```

Generate a 32-byte encryption key for the bot token at rest:

```bash
openssl rand -hex 32
```

Put it in `.env` as `PCS_ENCRYPTION_KEY`.

## 3. OAuth & Permissions → scopes + redirect URL

Open **OAuth & Permissions**.

Under **Redirect URLs**, click **Add New Redirect URL** and paste:

```
<NEXT_PUBLIC_APP_URL>/api/auth/slack/callback
```

Save URLs.

Under **Scopes → Bot Token Scopes**, add:

- `channels:history`
- `channels:read`
- `groups:history`
- `groups:read`
- `im:history`
- `mpim:history`
- `users:read`
- `users:read.email`
- `team:read`

(These are also exported as `SLACK_BOT_SCOPES` in `packages/connectors/src/slack/index.ts` for reference.)

## 4. Event Subscriptions → realtime stream

Open **Event Subscriptions** and toggle **Enable Events** on.

Under **Request URL**, paste:

```
<NEXT_PUBLIC_APP_URL>/api/ingest/slack
```

Slack will immediately send a `url_verification` POST to that URL with a challenge token. Our `/api/ingest/slack` route echoes it back, so the URL should turn green with a checkmark. If it doesn't:

- Make sure `pnpm dev` is running.
- Make sure `SLACK_SIGNING_SECRET` is set (the route 500s without it).
- Make sure ngrok is forwarding to port 3000.

Under **Subscribe to bot events**, click **Add Bot User Event** and add:

- `message.channels` — messages in public channels the bot is in
- `message.groups` — messages in private channels the bot is in
- `message.im` — DMs to the bot
- `message.mpim` — multi-person DMs
- `app_mention` — direct @-mentions of the bot (optional but useful)

Save changes. Slack may prompt you to reinstall the app — do it.

## 5. Manage Distribution → make it installable everywhere

Open **Manage Distribution**.

Click **Distribute App** → **Activate Public Distribution**. (You do NOT need to submit to the App Directory — distribution just means "anyone with the install link can add the app to their workspace".)

This is the step that turns your dev/single-workspace app into a multi-tenant SaaS connector.

## 6. Install it

Back in your running PCS app:

1. Navigate to **/connectors/new** in your browser.
2. Click **Slack**.
3. Click **Add to Slack**.
4. You'll bounce through Slack's authorize screen. Click **Allow**.
5. You'll land back on `/connectors/<id>` showing the new instance, status: **ACTIVE**.

## 7. Test it

In the same Slack workspace, invite the bot to a channel (or just DM it). Post a message — for example:

> "Mumbai hub COD is off by ₹4,500 today again"

Within a few seconds, check `/inbox` in PCS. The message should appear there or be auto-attached to the Mumbai COD problem, depending on similarity. Check the `pnpm dev` terminal for `[resolver]` lines showing the vector scores.

## 8. Re-installing

If you re-install the bot to the same Slack workspace (for example, to update scopes), the OAuth callback detects the matching `team_id` and **updates the existing `ConnectorInstance` instead of creating a duplicate**. The bot token is rotated; no events are lost.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Request URL` won't verify in Slack | App not running / ngrok down / `SLACK_SIGNING_SECRET` not set | Check `pnpm dev` terminal, restart ngrok, set the env var, save the Slack URL again |
| Signature verification failures in PCS logs | Signing secret mismatch between Slack and `.env` | Copy the secret again, restart `pnpm dev` |
| `unknown_team` in logs | The Slack workspace installed the app but its ConnectorInstance was deleted | Re-install via `/connectors/new` |
| Events arrive but `actor.email` is null | `users:read.email` scope was not granted | Add the scope, reinstall the app to push the new scope to your workspace |
| Bot doesn't see messages in a channel | Bot isn't a member of the channel | `/invite @your-app-name` in that channel |
