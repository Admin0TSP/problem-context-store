# Gmail Connector Setup (M8b)

Walks you through creating a Google Cloud project + OAuth credentials so PCS can read a Gmail inbox via OAuth. Like the Slack app, **one** OAuth client lets you connect any number of customer Gmail accounts.

## 0. Prerequisites

- You're running the app on a public HTTPS URL (cloudflared / ngrok). Free Cloudflare quick tunnels work; see `docs/slack-setup.md` for the recipe.
- `PCS_ENCRYPTION_KEY` is set in `.env` (Gmail's refresh token is stored AES-encrypted).

## 1. Create the Google Cloud project

Go to [console.cloud.google.com](https://console.cloud.google.com).

1. Top-left dropdown → **New Project**. Name: `Problem Context Store — dev`. Click **Create**. Wait ~5 seconds, then switch to the new project from the dropdown.

## 2. Enable the Gmail API

In the new project:

1. Left sidebar → **APIs & Services** → **Library**.
2. Search **Gmail API** → click result → **Enable**. Takes a few seconds.

## 3. Configure the OAuth consent screen

This is the "what permissions does your app ask for" screen Google shows users.

1. **APIs & Services** → **OAuth consent screen**.
2. User Type → **External** → Create. (Internal is only for Google Workspace orgs.)
3. **App information**:
   - App name: `Problem Context Store — dev`
   - User support email: (your email)
   - Developer contact email: (your email)
   - Save and continue.
4. **Scopes** → **Add or remove scopes**. Add these four (paste each into the filter):
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
   - `openid`
   - Save.
5. **Test users** → **Add users**. Add the Gmail address(es) you want to connect (e.g. `admin@theseopilot.pro`). You can add up to 100 here without going through Google's app verification process. Save.
6. Click through the rest. Don't click "Publish app" — that triggers Google's review.

## 4. Create OAuth credentials

1. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**.
2. Application type → **Web application**.
3. Name: `PCS dev`.
4. **Authorized redirect URIs** → **Add URI**:
   ```
   <NEXT_PUBLIC_APP_URL>/api/auth/google/callback
   ```
   (e.g. `https://your-tunnel.trycloudflare.com/api/auth/google/callback`)
5. **Create**. Google shows you the Client ID + Client Secret in a modal — copy both.

## 5. Put them in `.env`

```env
GMAIL_CLIENT_ID="...apps.googleusercontent.com"
GMAIL_CLIENT_SECRET="..."
```

Restart `pnpm dev` (env vars don't hot-reload).

## 6. Install

In PCS:

1. Navigate to `/connectors/new`.
2. Click **Gmail**.
3. Click **Add to Gmail**.
4. Google shows the consent screen with the four scopes you registered. Click **Allow**. (Google will show a "Google hasn't verified this app" warning — that's expected because we're in test mode. Click "Continue" or "Advanced → Go to PCS (unsafe)".)
5. You'll land on `/connectors/<new-id>` showing the Gmail account as **active**, with your email + a history cursor.

## 7. Sync your inbox

On the instance page, click **Sync now**.

- First sync looks back 1 day. So if there's nothing new in the last 24 hours, expect `Fetched 0 messages`. To test with real data, send yourself an email first.
- Subsequent syncs use the last-sync timestamp minus a 10-minute safety overlap.

Watch the terminal:
```
[gmail/sync] instance=... owner=admin@theseopilot.pro query="after:2026/05/27"
[gmail/sync] fetched 3 message id(s)
[worker] ⇢ job=22 (gmail:admin@theseopilot.pro) processing 3 events
[resolver] ───── GMAIL/EMAIL_RECEIVED "Subject: Help with site speed..."
[resolver] ✓ DECISION: attached / spawned / inbox ...
```

Emails get routed by the same client-domain rule that Slack uses: sender domain → Client.domain.

## 8. Re-installing

If you re-install the same Gmail account (e.g. to refresh tokens after revoking), the callback detects the matching `ownerEmail` and **updates the existing instance** rather than creating a duplicate. The history cursor is preserved.

## 9. When you change the tunnel URL

Every time `NEXT_PUBLIC_APP_URL` changes (free Cloudflare quick tunnels reset every restart), you need to update the **Authorized redirect URI** in Google Cloud Console → Credentials. Otherwise the OAuth callback bounces with `redirect_uri_mismatch`. This is the same dance as the Slack app.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Google hasn't verified this app" + you can't click past it | Your Gmail account isn't on the Test users list | Add yourself under OAuth consent screen → Test users |
| `redirect_uri_mismatch` on callback | Tunnel URL changed, GCP still has the old one | Update Authorized redirect URI in Credentials |
| "Google did not return a refresh_token" | You previously consented; Google won't return a new refresh token unless you revoke first | Go to https://myaccount.google.com/permissions → revoke PCS dev → re-install |
| Sync fetches 0 messages even though there are new ones | The query window is too narrow, or the messages are in Spam/Trash/Drafts (filtered out) | Send a test email to the connected account, then sync |
| `Token refresh failed: invalid_grant` | Refresh token was revoked OR the OAuth client was deleted | Re-install via /connectors/new |
