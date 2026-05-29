# Problem Context Store — Handoff

A living document for resuming work on PCS. Read this first if you're picking up the codebase, switching laptops, or starting a fresh Claude session.

## TL;DR — what is this?

**Problem Context Store (PCS)** is a SaaS memory layer for B2B customer-success teams. It sits over Slack, Gmail, DevRev, GitHub, and other source systems and automatically captures every conversation, ticket, message, and document about a customer Problem into one timeline. Each piece of evidence is auto-routed to the right Problem via a three-stage resolver (rules → vector similarity → LLM judge). When teams ask "what happened with Acme's COD reconciliation mismatch six months ago?" PCS gives them the full thread instead of forcing a Slack archaeology dig.

Built first for Shipsy's internal use, architected as multi-tenant SaaS from day one.

Repo: https://github.com/Admin0TSP/problem-context-store

## Architecture (one paragraph)

Next.js 14 App Router + React Server Components + Server Actions on top of a pnpm workspace + Turborepo monorepo. Postgres (Supabase hosted) with pgvector for embeddings. BullMQ + ioredis (Upstash) for the background job queue. Auth.js v5 with magic-link sign-in via Resend. Ollama runs locally for free LLM/embeddings (`qwen2.5:3b-instruct` for summaries, `llama3.1:8b` for the resolution judge, `nomic-embed-text` for embeddings), with optional swap to Anthropic Claude / OpenAI via env-driven provider selection. Cloudflare tunnel exposes localhost during dev so Slack/Gmail OAuth callbacks can reach the app.

## Current state by module

| | Module | Status | Notes |
|---|---|---|---|
| ✅ | M1 | Foundation | Monorepo, Next.js, base UI shell |
| ✅ | M2 | Auth | Auth.js v5, magic link, RBAC (OWNER/ADMIN/MEMBER/VIEWER), workspaces, members, invites |
| ✅ | M3 | Data model | 16 Prisma models, pgvector columns at 768-dim |
| ✅ | M4 | UI | Problems list/detail, Inbox, Quick Log, Clients, Manual notes |
| ✅ | M5 | Connector framework | `ConnectorAdapter` contract, Stub adapter, webhook receiver, install UI, ingest pipeline |
| ✅ | M6 | Resolution layer | rules.ts, vector.ts, llm-judge.ts, resolve.ts orchestrator |
| ✅ | M6.5 | Pluggable LLM providers | Ollama (free) / OpenAI / Anthropic, IntelligenceStatus diagnostic |
| ✅ | M7 | Auto-summarization | Per-Problem AI summary (root cause, approach, resolution), Refresh button on Problem detail |
| ✅ | M8a | Slack connector | OAuth, Events API webhook, signature verification, team_id tenant lookup |
| ✅ | M9 | Background job queue | `@pcs/queue` package, BullMQ on Upstash Redis, `apps/web/scripts/worker.ts` worker process |
| ✅ | M9.5 | LLM judge precision fix | Vector-support floor (sim ≥ 0.7) + tighter prompt with anti-examples |
| ✅ | M8b | Gmail connector | Google OAuth, polling sync via `messages.list?q=after:`, manual Sync button |
| ⏸️ | M8b verify | **In progress** | Blocked on `theseopilot.pro` DNS migration from Spaceship → Cloudflare. Mail delivery + sender domain matching depends on it completing. |
| ⏭ | M8b.5 | Gmail auto-poll | Repeating BullMQ job, ~1 hour of work |
| ⏭ | M8c | DevRev connector | Same adapter contract, OAuth + webhook + ticket-as-Artifact |
| ⏭ | M10 | Polish | Profile editing, workspace rename, audit-log UI, Stripe billing |

## Where things live (code layout)

```
Problem Context Store/
├── apps/
│   └── web/                          ← The Next.js app + worker process
│       ├── app/
│       │   ├── (workspace)/          ← Authed routes
│       │   │   ├── problems/
│       │   │   ├── inbox/
│       │   │   ├── clients/
│       │   │   ├── connectors/
│       │   │   └── settings/
│       │   ├── api/
│       │   │   ├── auth/             ← Auth.js + per-connector OAuth (slack, google)
│       │   │   └── ingest/
│       │   │       ├── slack/        ← Slack-specific webhook (single URL, team_id routes)
│       │   │       └── [connector]/[instanceId]/  ← Generic webhook (Stub)
│       │   └── actions/              ← Server Actions
│       ├── lib/
│       │   ├── auth.ts               ← getSession() — returns { user, workspace, membership }
│       │   ├── rbac.ts               ← requireRole / requireMinRole helpers
│       │   ├── crypto.ts             ← AES-256-GCM for OAuth tokens at rest
│       │   ├── intelligence/         ← embeddings.ts, llm.ts, summarize.ts (provider-pluggable)
│       │   ├── resolution/           ← rules.ts → vector.ts → llm-judge.ts → resolve.ts → spawn.ts
│       │   └── ingestion/ingest.ts   ← The shared pipeline both web + worker call
│       └── scripts/worker.ts         ← BullMQ worker process
├── packages/
│   ├── core/                         ← shared types + constants (EMBEDDING_DIMENSION=768, thresholds)
│   ├── db/                           ← Prisma schema + client
│   │   ├── prisma/schema.prisma
│   │   └── sql/                      ← One-shot SQL helpers (seed-tsp-workspace, fix-vector-dim-768)
│   ├── connectors/                   ← Adapter implementations
│   │   └── src/
│   │       ├── adapter.ts            ← The interface every connector implements
│   │       ├── stub/                 ← Test adapter
│   │       ├── slack/                ← Slack: signature.ts, parse.ts, index.ts (OAuth helpers)
│   │       └── gmail/                ← Gmail: parse.ts, index.ts (OAuth helpers)
│   └── queue/                        ← BullMQ wrapper, ingest queue + types
└── docs/
    ├── slack-setup.md
    ├── gmail-setup.md
    └── m9-worker-setup.md
```

## Key design decisions worth knowing

1. **Resolver is three-stage by design.** Rules (cheap, deterministic) → Vector (medium, semantic) → LLM judge (expensive, slow). Most events resolve at stage 1 or 2. Stage 3 fires only when the first two are ambiguous.
2. **Confidence buckets:** ≥0.85 auto-attach · 0.65–0.85 needs-confirm · <0.65 inbox.
3. **Vector-support floor (M9.5):** Even when the LLM picks `existing`, we require the picked Problem's vector similarity ≥ 0.7. This catches small-LLM over-eagerness. See `LLM_EXISTING_VECTOR_FLOOR` in `resolve.ts`.
4. **Slack uses ONE webhook URL** (`/api/ingest/slack`) and routes by `team_id` from the payload — because Slack apps have a single Events URL across all installs. Stub etc. use the generic `/api/ingest/[connector]/[instanceId]` pattern.
5. **Gmail polls** (no native push) — manual Sync button today, auto-poll via BullMQ scheduled job is M8b.5.
6. **Workers concurrency=1** because Ollama on the dev M1 can't handle parallel LLM inference. Once on a cloud LLM (Claude Haiku), can crank to 5-10.
7. **OAuth tokens encrypted at rest** with AES-256-GCM, key from `PCS_ENCRYPTION_KEY` env var. Each connector adapter's bot/refresh token is decrypted on demand by the receiver/sync code.
8. **The `@/` import alias works in the worker** because it lives inside `apps/web/scripts/` and tsx reads `apps/web/tsconfig.json`. The one explicit `import '../lib/ingestion/ingest'` is intentional — avoids tsx path-alias edge cases.

## Services in use (and what they cost)

| Service | Purpose | Tier | Notes |
|---|---|---|---|
| Supabase | Postgres + pgvector | Free | DB credentials in `DATABASE_URL` |
| Upstash | Redis for BullMQ | Free | 10K commands/day. Plenty for dev. |
| Cloudflare | DNS + Tunnel | Free | `theseopilot.pro` mid-migration from Spaceship as of last session. |
| Ollama | Local LLM/embeddings | Free | Runs on the dev laptop. M1 8GB RAM is tight. |
| Google Workspace | Mail at admin@theseopilot.pro | Paid (Workspace subscription) | |
| Slack | Free tier workspace `TheSEOPilot` for testing | Free | Dev app installed there. |
| Vercel / Render | Production host for `theseopilot.pro` website | (Render currently) | Pointed at by A record |
| GitHub | Source control | Free | `Admin0TSP/problem-context-store` |

## Environment variables (without secrets)

A complete list lives in `.env.example`. The variables you must populate:

```
# Database
DATABASE_URL                       # Supabase Postgres
DIRECT_URL                         # Supabase Postgres direct (no pooling)

# Auth
AUTH_SECRET                        # 32-byte secret. Generate via `openssl rand -base64 32`
AUTH_URL                           # Public URL (tunnel URL during dev)
AUTH_TRUST_HOST=true               # Required when behind tunnel/proxy
NEXT_PUBLIC_APP_URL                # Same value as AUTH_URL
EMAIL_FROM                         # Resend "From" sender

# Resend (optional in dev — falls back to printing to terminal)
RESEND_API_KEY

# Intelligence
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
OLLAMA_LLM_MODEL=llama3.1:8b
OLLAMA_SUMMARY_MODEL=qwen2.5:3b-instruct   # better quality for summaries
# OR for paid:
# OPENAI_API_KEY, EMBEDDING_MODEL, ANTHROPIC_API_KEY, ANTHROPIC_MODEL

# Queue (M9)
REDIS_URL                          # Upstash: rediss://default:...@...upstash.io:6379

# Encryption
PCS_ENCRYPTION_KEY                 # 64-hex-char AES key. CRITICAL: same value on every machine that decrypts tokens. Generate via `openssl rand -hex 32`.

# Slack
SLACK_CLIENT_ID
SLACK_CLIENT_SECRET
SLACK_SIGNING_SECRET

# Gmail
GMAIL_CLIENT_ID
GMAIL_CLIENT_SECRET
```

**Critical**: `PCS_ENCRYPTION_KEY` decrypts OAuth refresh tokens stored in the DB. If you switch to a different key on the new laptop, every existing connector instance becomes unusable (you'll need to re-install Slack and Gmail). Bring this value across via password manager.

## How to resume on a new machine

1. Clone: `git clone https://github.com/Admin0TSP/problem-context-store.git && cd problem-context-store`
2. Install: `pnpm install`
3. Copy `.env` from your password manager (or recreate following `.env.example`)
4. Install Ollama + pull models:
   ```bash
   brew install ollama
   ollama serve  # in its own terminal
   ollama pull nomic-embed-text
   ollama pull llama3.1:8b
   ollama pull qwen2.5:3b-instruct
   ```
5. Install cloudflared: `brew install cloudflared`
6. Start tunnel: `cloudflared tunnel --url http://localhost:3000` — copy URL, update `NEXT_PUBLIC_APP_URL` + `AUTH_URL` in `.env` to match
7. Update Slack app dashboard's Redirect URL + Events URL to the new tunnel URL
8. Update Google Cloud Console's OAuth redirect URI similarly
9. Restart `pnpm dev`
10. Confirm both `[redis] connected` and `[worker] ready` print in terminal

If switching to the eventual **Named Tunnel** with `pcs.theseopilot.pro`:
- Cloudflare dashboard → Zero Trust → Tunnels → use the existing tunnel's token
- One-time install: `cloudflared service install <TOKEN>`
- Run with: `cloudflared tunnel run pcs-dev`
- No more updating tunnel URL anywhere

## Pending work (priorities)

### Immediately on resume

1. **Finish DNS migration to Cloudflare** (in progress at handoff time). After Cloudflare emails "domain is Active":
   - `dig +short NS theseopilot.pro` should show `carter.ns.cloudflare.com` + `ximena.ns.cloudflare.com`
   - Test mail delivery to `admin@theseopilot.pro` from another account
   - Click **Start Authentication** on the DKIM page in Google Admin
   - Optionally set up Cloudflare Named Tunnel for permanent `pcs.theseopilot.pro`

2. **Verify Gmail connector end-to-end.** Send a test email matching one of the seeded Problems (see `packages/db/sql/seed-tsp-workspace.sql`), click Sync now, verify `[resolver]` block in terminal matches expectations.

### Next modules

- **M8b.5 — Gmail auto-poll.** BullMQ repeating job every 5 minutes calling `syncGmailInstance` for each active Gmail instance. ~1 hour.
- **M8c — DevRev connector.** Same adapter contract. OAuth flow, webhook receiver for ticket events, ticket-to-Artifact linking. ~half-day.
- **M10a — Polish.** Profile editing, workspace rename, audit-log viewer page, optional Stripe wiring.
- **Demo deck + microsite** for stakeholder presentations.

### Known issues to address

- LLM judge over-attaches when vector sim is in 0.6-0.7 range with no good options. M9.5 mitigated but a stronger LLM (Claude Haiku) would solve it properly. ~$0.25/MTok input cost when switched.
- Cloudflare quick-tunnel URLs change on every restart. Migration to Named Tunnel solves it; do it as part of the DNS migration completion.
- `tsx watch` occasionally prints `[worker] ready` twice on hot reload. Doesn't cause duplicate processing because of BullMQ's job locks but is cosmetically odd.

## Test data state (for `tsp` workspace, signed in as admin@theseopilot.pro)

Two clients (TheSEOPilot, Acme Corp) and 4-6 Problems for TheSEOPilot. Three of those Problems were spawned during M9.5 testing from real Slack messages and have rich event timelines:

- `seed-tsp-problem-site-speed` — Site speed issues on theseopilot.pro homepage
- `seed-tsp-problem-gsc` — Google Search Console verification keeps failing
- `seed-tsp-problem-schema` — Schema markup not appearing in rich results
- `cmpp28lkc000p13j9zq8a0bnx` (spawned) — Contact form silently failing on /contact page
- `cmppbqvfj0001mdkex9v723y7` (spawned) — Massive 5xx error spike in Search Console
- `cmppbsgy80009mdkeup352mxu` (spawned) — SSL certificate expired on entire site

Slack workspace `theseopilotworkspace.slack.com` (team `T0B608XQQQ3`) has an installed bot and a `#pcs-test` channel — that's where test messages get posted.

## Useful commands

```bash
# Generate a secret
openssl rand -hex 32

# Inspect DNS during migration
dig +short NS theseopilot.pro
dig +short MX theseopilot.pro
dig +short TXT google._domainkey.theseopilot.pro

# Connect to Supabase directly
psql "$DATABASE_URL"

# Inspect BullMQ queue (in Upstash Web Console → Data Browser)
# Look for: pcs-ingest:wait, pcs-ingest:active, pcs-ingest:completed, pcs-ingest:failed

# Force re-embedding of all Problems (after schema/model change)
# Click "Backfill embeddings" on /settings — handled by app/actions/resolution.ts
```

## How to brief a fresh Claude session

After cloning the repo and reading this file, paste the following into a new Claude conversation:

> I'm continuing work on Problem Context Store, a SaaS memory-layer product for B2B customer-success teams. The repo is at https://github.com/Admin0TSP/problem-context-store. Read HANDOFF.md in the repo first — it has the full state, architecture, decisions, and pending work. Then I want to [resume Gmail testing / start M8c / etc.].

Claude will read the handoff and have full context. Far more reliable than re-explaining 100+ messages.

## Conventions

- Server Actions return `{ ok: true, ... } | { ok: false, error, code }` discriminated unions — never throw to the UI.
- Every action calls `getSession()` then `requireMinRole(session, MembershipRole.MEMBER)` (or higher).
- Every mutation writes an `AuditLog` row.
- Worker jobs THROW on failure — BullMQ uses the throw for retry/dead-letter machinery.
- Logs are prefixed by module: `[resolver]`, `[worker]`, `[redis]`, `[slack]`, `[gmail/sync]`, `[summarize]`.
- New connectors: implement `ConnectorAdapter` in `packages/connectors/src/<name>/`, register in `packages/connectors/src/index.ts`.

Last updated: end of M8b build, mid-DNS-migration.
