# Problem Context Store

The customer-problem memory layer for B2B software companies.

Sits over Slack, DevRev, GitHub, Gmail, and your call transcripts. Turns every customer problem into a living, cross-tool timeline — every ticket, conversation, decision, and fix, linked to one canonical **Problem**. First-class manual capture for the hallway conversations that never make it into a tool.

Built first for Shipsy. Architected from day one as a multi-tenant SaaS.

---

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript end-to-end |
| Web | Next.js 14 (App Router, RSC + Server Actions) |
| DB | Postgres 16 + `pgvector` |
| ORM | Prisma |
| Auth | Auth.js v5 — magic links (Resend or console fallback) + optional Google OAuth |
| Queue | BullMQ + Redis (added in M5) |
| LLM | Anthropic Claude (added in M6) |
| Styling | Tailwind CSS |
| Monorepo | pnpm workspaces + Turborepo |

---

## Folder structure

```
.
├── apps/
│   └── web/                  Next.js app (UI + Server Actions)
│       ├── app/
│       │   ├── (workspace)/      Authed workspace routes (sidebar shell)
│       │   │   ├── dashboard/        Problem list + filters
│       │   │   ├── problems/[id]/    Hero screen — cross-source timeline
│       │   │   ├── problems/new/     Create-problem form
│       │   │   ├── clients/          Clients list + detail
│       │   │   ├── notes/            All manual notes
│       │   │   ├── connectors/       Connector inventory
│       │   │   ├── activity/         Audit log
│       │   │   └── settings/
│       │   └── actions/          Server Actions (mutations)
│       ├── components/
│       │   ├── ui/               Badge, Button, Card, FormField
│       │   ├── Sidebar.tsx
│       │   ├── Topbar.tsx
│       │   ├── Timeline.tsx
│       │   ├── ProblemHeader.tsx
│       │   ├── QuickLogSheet.tsx     ⌘K manual capture
│       │   └── …
│       └── lib/                  cn, format, auth (dev session)
├── packages/
│   ├── db/                   Prisma schema, client, seed
│   └── core/                 Shared types & business logic
├── docs/
│   └── ARCHITECTURE.md       Module-by-module deep dive
└── …root configs
```

---

## Quick start (testable)

### 1. Prerequisites

- Node.js 20+
- pnpm 9+ (`npm install -g pnpm`)
- Docker (for Postgres with `pgvector`)

### 2. Start Postgres

```bash
docker run -d \
  --name pcs-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=problem_context_store \
  -p 5432:5432 \
  pgvector/pgvector:pg16
```

### 3. Install, configure, migrate, seed

```bash
pnpm install
cp .env.example .env

# Generate AUTH_SECRET and paste it into .env
openssl rand -base64 32

pnpm db:generate     # generate Prisma client
pnpm db:push         # push schema to Postgres
pnpm db:seed         # load Shipsy + Acme + Globex demo state
```

### 4. Run

```bash
pnpm dev             # → http://localhost:3000
```

### 5. Sign in

You'll land on `/signin`. Type your email (use `nikhil.nagaich@shipsy.io` to sign into the seeded Shipsy workspace) and hit "Email me a sign-in link."

- **If `RESEND_API_KEY` is set:** the magic link arrives by email.
- **If not (default for dev):** the magic link is printed to your `pnpm dev` terminal. Copy/paste it into your browser to sign in.

If you sign in as a new email that isn't in the seed, you'll be sent to `/workspaces/new` to create your first workspace.

#### Optional: enable Google OAuth

Add to `.env`:
```
AUTH_GOOGLE_ID="..."
AUTH_GOOGLE_SECRET="..."
```
Create these credentials at [Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs](https://console.cloud.google.com/apis/credentials), with `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI.

The "Continue with Google" button only appears when both vars are set.

---

## What to test

The fastest way to walk the whole product:

1. **Problem list** — `/dashboard`. Try the status / severity / client filters. Click a row.
2. **Problem detail** — `/problems/seed-problem-acme-cod-mismatch`. The hero screen.
   - Look at the chronological timeline interleaving Slack messages, the DevRev ticket, the GitHub PR, and the phone-call manual note.
   - Change the **Status** dropdown in the header — it persists.
   - Change the **Severity** dropdown — it persists.
   - Click **Add manual note** to capture a new note pinned to this problem.
3. **Quick Log (⌘K / Ctrl+K)** — works from any page. Type a note, optionally attach to a problem, save. It appears in the Notes page and (if attached) on the Problem timeline.
4. **Create a new problem** — `/dashboard` → "New problem" or `/problems/new`. Required: client + title. After save you land on the detail page.
5. **Clients** — `/clients`. Click into one to see its problems.
6. **Notes** — `/notes`. Every manual note ever captured.
7. **Activity** — `/activity`. The audit log (your mutations show up here).
8. **Connectors** — `/connectors`. Lists seeded `PENDING` connectors; install button is disabled until M8.
9. **Settings** — `/settings`. Shows workspace + you.

### What to look for / give feedback on

- Does the **information density** feel right on the Problem detail page, or too sparse / too cramped?
- Is the Quick Log fast enough to feel like "just type and go"?
- Does the **Problem-as-noun** orientation feel intuitive when you scan the list?
- Anything you'd want surfaced on the right rail that isn't there?
- Naming: "Problem" / "Client" / "Manual note" — any of those feel wrong?

---

## Module status

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the full breakdown.

- [x] **M1** — Foundation scaffolding
- [x] **M2** — Auth & multi-tenancy (Auth.js v5, magic links + optional Google, invites, RBAC)
- [x] **M3** — Data model (Prisma schema, 16 models including Auth.js adapter tables)
- [x] **M4** — Problem timeline UI + manual capture
- [x] **M5** — Ingestion framework (adapter interface, webhook receiver, Stub connector, inbox triage)
- [x] **M6** — Resolution layer (rules + vector + LLM judge, pluggable providers — free Ollama by default)
- [ ] **M7** — Intelligence layer (embeddings, summary regen, Q&A)
- [ ] **M8** — Connectors (Slack, DevRev, GitHub, Gmail)
- [ ] **M9** — Surfaces (Slack bot, email-in, browser ext)
- [ ] **M10** — Admin, billing, audit UI, observability

---

## Intelligence: free local with Ollama (recommended)

The resolver uses two AI capabilities — text embeddings (for semantic similarity matching) and an LLM "judge" (for ambiguous cases). Both have free local implementations via [Ollama](https://ollama.com).

### One-time Ollama setup

```bash
# Install (Mac)
brew install ollama
ollama serve &   # start the background service

# Pull the two models we need (~5.5GB total disk)
ollama pull nomic-embed-text   # embeddings — 137MB, 8192-token context, 768 dims
ollama pull llama3.1:8b        # LLM judge — ~5GB, runs JSON mode reliably
```

### Wire it into the app

Add to `.env`:

```
OLLAMA_BASE_URL="http://localhost:11434"
OLLAMA_EMBEDDING_MODEL="nomic-embed-text"
OLLAMA_LLM_MODEL="llama3.1:8b"
```

Refresh the subdir copies and restart:

```bash
cp .env packages/db/.env
cp .env apps/web/.env
pnpm dev
```

### Backfill existing embeddings

Once Ollama is wired, go to **Settings → Intelligence → Backfill embeddings.** This embeds your seeded Problems and any pre-Ollama events so vector search has data to compare against. Subsequent ingests embed automatically.

### Want paid quality instead?

The same pipeline supports OpenAI for embeddings and Anthropic for the judge. Set `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` in `.env`. If both Ollama and a paid provider are configured, the explicit `EMBEDDINGS_PROVIDER` / `LLM_PROVIDER` env vars decide.

### Want neither?

The resolver still runs — rules-only. Ambiguous events land in `/inbox` for manual triage. That's the M5 behavior.

---

## Troubleshooting

**"No users found. Run `pnpm db:seed`"** on the dashboard
→ The seed didn't run. `pnpm db:seed`.

**Prisma error: extension "vector" is not available**
→ You're on plain Postgres, not pgvector. Use the Docker command in step 2.

**Port 5432 already in use**
→ Stop your existing Postgres or change the port in `docker run` *and* in `DATABASE_URL`.

**Hot reload shows "PrismaClient is already in use"**
→ The singleton in `packages/db/src/index.ts` handles this; if you still see it, restart `pnpm dev`.

---

## License

Proprietary — Shipsy internal until further notice.
