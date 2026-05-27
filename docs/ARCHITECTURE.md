# Architecture

This document is the single source of truth for how Problem Context Store is structured. Every module below corresponds to a phase of the build; each one is described here as it stands today and as it will be when complete.

## Design principles

1. **Problem is the noun.** Everything in the system attaches to a `Problem` row. Tickets, conversations, PRs, calls, and manual notes are not the unit of organization — they are evidence about a Problem.
2. **Observe, don't own.** We never replace anyone's tool. Source systems remain the system of record for their artifacts. We hold the cross-tool *graph*.
3. **Multi-tenant from row one.** Every row carries `workspaceId`. Tenant scoping is enforced at the application layer (queries always filter by `workspaceId`).
4. **Connectors are pluggable.** Adding a new source means implementing one interface, not branching core logic.
5. **Human-in-the-loop on low confidence.** Auto-resolution is conservative; everything below threshold is queued for human review.
6. **Permission inheritance.** A user can only see events whose source ACLs they have access to in the source system.

## Module map

```
┌────────────────────────────────────────────────────────────────────────┐
│                         apps/web  (Next.js)                            │
│  - Marketing & landing                                                  │
│  - Authed workspace UI: Problem list, Problem detail, search           │
│  - Route Handlers (API): tRPC procedures, webhook receivers            │
└─────────────────┬─────────────────────────────────────────┬────────────┘
                  │                                         │
                  ▼                                         ▼
┌──────────────────────────────┐         ┌──────────────────────────────┐
│      apps/worker  (M5)       │         │        @pcs/core              │
│  - BullMQ queues             │         │  - Shared types               │
│  - Connector polling jobs    │ ◀────── │  - Domain errors              │
│  - Resolution jobs           │         │  - Constants/tuneables        │
│  - Summary regen jobs        │         │  - Resolution heuristics      │
└──────────────┬───────────────┘         └──────────────┬───────────────┘
               │                                         │
               ▼                                         ▼
                    ┌───────────────────────────────────┐
                    │           @pcs/db (Prisma)        │
                    │  - schema.prisma                  │
                    │  - Singleton PrismaClient         │
                    │  - Seed                           │
                    └─────────────────┬─────────────────┘
                                      │
                                      ▼
                          ┌──────────────────────┐
                          │  Postgres + pgvector │
                          │  Redis (M5+)         │
                          │  S3 (raw payloads)   │
                          └──────────────────────┘
```

## M1 — Foundation (DONE)

pnpm workspaces + Turborepo orchestration. Root `tsconfig.base.json` extended by each package. `.env.example` declares every env var the system needs across its full lifecycle, with later modules' vars commented until they're used.

## M2 — Auth & multi-tenancy (NEXT)

- Auth.js v5 with Email (magic link via Resend) + Google OAuth.
- `User` and `Workspace` rows are decoupled — a user can belong to many workspaces.
- `Membership.role` enforces RBAC at the API boundary (server-side guard helper in `@pcs/core`).
- Middleware sets `x-workspace-id` on every authenticated request; every Prisma query in API code receives it as a required parameter.
- Invite flow with token + expiry.

## M3 — Data model (DONE)

See `packages/db/prisma/schema.prisma`. Key entities:

- **Workspace**, **User**, **Membership**, **WorkspaceInvite** — tenancy.
- **Client** — the customer your workspace serves. `externalIds` JSON holds the cross-tool identity (DevRev account ID, Salesforce ID, etc.) used by the resolver.
- **Problem** — the canonical noun. Holds title, status, severity, the three generated summaries (rootCause/resolution/approach), embedding, tags.
- **Event** — normalized cross-source activity log. Has `source` + `sourceId` for idempotency. `clientId` and `problemId` are nullable until resolution attaches them.
- **Artifact** — the enduring source-system objects (ticket, PR, doc, meeting). Distinct from Event: an Event is an activity *point*, an Artifact is an *object*.
- **ManualNote** — first-class capture for off-tool conversations. Channel enum (HALLWAY, PHONE_CALL, WHATSAPP, IN_PERSON_MEETING, …) makes provenance explicit.
- **ProblemEdge** — Problem-to-Problem relationships (DUPLICATE, RELATED, PARENT/CHILD, CAUSED_BY).
- **ConnectorInstance** — per-workspace install of a source. Encrypted credentials.
- **AuditLog** — every state-changing action.

## M4 — Problem timeline UI

The hero screen. Three views:

1. **Workspace home** — Problems grouped by client, filterable by status/severity/tags.
2. **Problem detail** — title, status, severity, the three summaries up top; chronological cross-source timeline below interleaving Events + ManualNotes + Artifacts. Right rail with linked Artifacts + related Problems.
3. **Quick-log** — keyboard-shortcut sheet (`Cmd+K`-style) for capturing a ManualNote from anywhere. Optional: attach to existing Problem, file under new, or leave unattached.

Built with Next.js Server Components reading from `@pcs/db` directly. Mutations through tRPC. Form state with React Hook Form + Zod.

## M5 — Ingestion framework

Three layers:

- **ConnectorAdapter interface** (in a new `packages/connectors`): each connector implements `webhook(payload): NormalizedEvent[]`, `pollSince(cursor): { events, nextCursor }`, and `verifySignature(req)`.
- **Webhook receiver** (`apps/web/app/api/ingest/[connector]/route.ts`): verifies signature, enqueues to BullMQ, returns 200 fast.
- **Worker** (`apps/worker`): consumes the queue, normalizes the payload, archives the raw to S3, persists the Event with `clientId/problemId = null`, then enqueues a resolution job.

## M6 — Resolution layer

Decides which Client and Problem an Event belongs to. Three strategies, tried in order:

1. **Rule-based** (cheapest): Slack channel name → client mapping, email domain → client lookup, ticket subject pattern, DevRev account ID, explicit `@client:acme` tag.
2. **Vector match**: embed the event body + recent thread context, search against open Problems for that client; if cosine similarity ≥ threshold, attach.
3. **LLM judge**: when vector match is ambiguous, ask Claude with the top-K candidate Problems' summaries; LLM returns either an existing Problem ID, "new problem" with a proposed title, or "uncertain → queue for human."

Confidence below `RESOLUTION_AUTO_THRESHOLD` queues to a human review surface (built in M4).

## M7 — Intelligence layer

- **Embedding pipeline**: every Event and Problem gets an embedding. Stored in pgvector columns. Backfill job for historical events.
- **Summary regen**: when a Problem accumulates N new events or M hours pass since the last regen, enqueue a summary job that updates `rootCauseSummary`, `resolutionSummary`, `approachSummary`.
- **Q&A endpoint**: scoped semantic search + LLM grounded answer over the workspace's Problems and Events.

## M8 — Connectors

Each lives in `packages/connectors/<source>/`. Built atop M5's adapter interface.

- **Slack** — Events API + Web API for thread expansion. Channel allow-list. Permission inheritance: store the Slack user's permission scope at ingest, re-check at read.
- **DevRev** — Webhooks + REST for backfill. Maps DevRev `parts` → tags, `accounts` → Clients.
- **GitHub** — Webhooks (PR, issue, push). Resolves linked tickets via PR description scans.
- **Gmail** — Workspace-wide via service account + delegated access.

## M9 — Surfaces

The product is only as useful as it is easy to feed.

- **Slack bot** — `/log <text>` opens a modal pre-filled with the channel's client. 🔖 emoji reaction on any message attaches that thread to a Problem of your choice.
- **Email-in** — `<workspace>.in@pcs.app` parses inbound email into a ManualNote with the From-domain as a client signal.
- **Browser extension** — sidebar that recognizes when you're on a DevRev ticket, Slack thread, or GitHub PR, and one-clicks "attach to Problem X."
- **Public API** — `GET /api/v1/problems`, webhooks for Problem state changes.

## M10 — Admin & ops

- **Settings**: workspace, members, invites, connectors, billing.
- **Billing**: Stripe subscriptions. Per-seat + per-event metering tier.
- **Audit log UI** with filters.
- **Observability**: Sentry for errors, structured logs via pino, OpenTelemetry traces on the worker.
- **Data residency** options (US/EU) become a workspace-creation choice when we go SaaS.

## What "production-ready" means for the skeleton

Right now (end of M1+M3) the skeleton has:

- ✅ Real Prisma schema, ready to migrate against a real Postgres.
- ✅ Multi-tenant table design from day one.
- ✅ Deterministic seed for repeatable demos.
- ✅ Type-safe monorepo with shared packages.
- ✅ Tailwind + design tokens placeholder.
- ⏳ No auth yet — that's M2.
- ⏳ No real UI yet — that's M4.

The schema and module boundaries are the parts you can't easily change later, and those are locked in.
