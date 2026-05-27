# Problem Context Store — User Guide

A complete walkthrough of the dashboard, written for someone opening it for the first time.

If you're a developer, the [Architecture doc](./ARCHITECTURE.md) is a better starting point. This guide is for the *operator* — the customer success lead, account manager, support engineer, or product person who actually *uses* the tool to keep track of what's happening with customers.

---

## Table of contents

1. [What this tool is for](#1-what-this-tool-is-for)
2. [The one idea you need to understand](#2-the-one-idea-you-need-to-understand)
3. [What's on the screen](#3-whats-on-the-screen)
4. [The Problem — the central object](#4-the-problem--the-central-object)
5. [Page tour](#5-page-tour)
   - [Dashboard](#dashboard--list-of-problems)
   - [Problem detail](#problem-detail--the-hero-screen)
   - [Clients](#clients--list--detail)
   - [Manual notes](#manual-notes)
   - [Activity (audit log)](#activity)
   - [Connectors](#connectors)
   - [Settings](#settings)
6. [Quick Log — your most-used tool](#6-quick-log--your-most-used-tool)
7. [Common workflows](#7-common-workflows)
8. [Keyboard shortcuts](#8-keyboard-shortcuts)
9. [Glossary](#9-glossary)
10. [What's not in the dashboard yet](#10-whats-not-in-the-dashboard-yet)
11. [FAQ & troubleshooting](#11-faq--troubleshooting)

---

## 1. What this tool is for

When a customer hits a problem, the context of that problem ends up scattered across five or six different places: a Slack thread, a DevRev ticket, a GitHub pull request, a Gmail thread, a phone call you took at 3pm, and maybe a hallway chat with engineering.

Six months later, when the same customer hits "that thing again," you can't reconstruct what happened. You re-investigate. You ask the dev who fixed it last time, who doesn't remember either. You read three Slack threads and a ticket. You waste two hours.

The Problem Context Store fixes this by giving every customer problem **one durable home** where all of that context lives — automatically gathered from your tools, plus a first-class way to capture the conversations that never made it into a tool.

In short: it's your **institutional memory for customer problems**.

---

## 2. The one idea you need to understand

There is one core noun: the **Problem**.

Everything else hangs off it:

```
                          ┌─────────┐
                          │ Client  │   "Acme Logistics"
                          └────┬────┘
                               │ has many
                               ▼
                          ┌─────────┐
                          │ Problem │   "COD reconciliation mismatch"
                          └────┬────┘
                               │
       ┌───────────────┬───────┼───────┬───────────────┐
       ▼               ▼       ▼       ▼               ▼
  ┌─────────┐   ┌─────────┐  ┌───┐  ┌──────────┐  ┌──────────┐
  │ Events  │   │ Manual  │  │…│  │ Artifacts │  │ Related  │
  │ (Slack, │   │ notes   │      │ (tickets, │  │ problems │
  │ DevRev, │   │ (calls, │      │ PRs, docs)│  └──────────┘
  │ GitHub) │   │ hallway)│      └──────────┘
  └─────────┘   └─────────┘
```

Every ticket, message, PR, call, and conversation is **evidence about a Problem**. You're not organizing tickets. You're organizing problems. The Problem is the thing your future self will need to find.

That mental shift is the whole product.

---

## 3. What's on the screen

When you open the dashboard, you see three regions:

```
┌─────────────────┬─────────────────────────────────────────────┐
│                 │                                             │
│                 │  ◀── Topbar (page title, Quick Log button) ─│
│                 │                                             │
│                 │ ─────────────────────────────────────────── │
│                 │                                             │
│    Sidebar      │                                             │
│   (navigation)  │           Main content area                 │
│                 │                                             │
│                 │           (the actual page)                 │
│                 │                                             │
│                 │                                             │
│                 │                                             │
└─────────────────┴─────────────────────────────────────────────┘
```

### Sidebar (left, always visible)

- **Workspace tile** (top) — shows which workspace you're in. For Shipsy users, this says "Shipsy".
- **Primary nav** — Problems, Clients, Manual notes, Activity.
- **Setup** — Connectors, Settings.
- **Your user tile** (bottom) — your name and email.

### Topbar (above the page content)

- **Page title** — e.g. "Problems", "Acme Logistics", or "Problem · Acme Logistics".
- **Subtitle** — quick counts (e.g. "12 open · 100 shown").
- **Quick Log button** — the green-grey "Quick log" button is everywhere. Press `⌘K` (Mac) or `Ctrl+K` (Win/Linux) to open it from any page.
- **Primary action** — e.g. on the Dashboard, this is "New problem".

### Main content area

The page itself. Most pages are read-only (you look at things) with a couple of buttons or dropdowns for the actions specific to that page.

---

## 4. The Problem — the central object

Every Problem has these fields. Knowing what they mean is the difference between using the tool well and using it poorly.

### Title

A short, scannable description of what the customer is experiencing — not what *we* are investigating. Examples:

- Good: *"COD reconciliation mismatch for Mumbai hub"*
- Less good: *"investigating COD"* (vague)
- Bad: *"TKT-9821"* (it's just a ticket number)

The Problem belongs to the customer's world. The ticket number lives in DevRev. Don't confuse them.

### Status

The Problem's lifecycle stage. There are seven statuses, in a roughly time-ordered flow:

| Status | What it means | When to set it |
|---|---|---|
| **Open** | New, no one has picked it up | The moment you log the problem |
| **Investigating** | Someone is actively figuring out what's wrong | Triage call has happened |
| **In progress** | Root cause found, fix being built | Dev work has started |
| **Awaiting customer** | Blocked on the customer (info, decision, retest) | When the ball is in their court |
| **Resolved** | Fix shipped, customer confirmed | After deploy + customer sign-off |
| **Closed** | Resolved + paperwork done (credit memo issued, etc.) | Optional — many teams stop at Resolved |
| **Archived** | Hidden from default views | Old issues you don't want to see daily |

Changing status writes to the audit log so you can prove who moved it and when.

### Severity

How bad it is for the customer right now. Four levels:

| Severity | Examples |
|---|---|
| **Critical** | Production down, money being lost in real time, multiple customers affected |
| **High** | One customer significantly impacted but operations continuing; data integrity issue |
| **Medium** | Annoying bug, workaround exists, no immediate revenue risk |
| **Low** | Cosmetic, nice-to-have, no operational impact |

Severity should reflect *current customer impact*, not "how interesting the engineering problem is."

### First seen / Resolved

- **First seen** — when the problem first surfaced. The dashboard sorts by this.
- **Resolved** — auto-filled when you flip the status to Resolved. Cleared if you reopen.

### Summaries (Approach, Root cause, Resolution)

Three short paragraphs that get **regenerated by an LLM** every time the Problem accumulates significant new events. Right now (until M7 is built) these are seeded by hand or written manually.

- **Approach** — "What is the team trying?" Useful while the problem is open.
- **Root cause** — "What was actually wrong?" Useful after diagnosis.
- **Resolution** — "What did we ship to fix it?" Useful at and after closure.

This trio is the most important read-it-six-months-later artifact in the whole tool. When the problem is closed, these are what you remember.

### Tags

Free-form labels. You'll see them on the Problem detail page once they're populated (the seeded problem uses `cod`, `reconciliation`, `reports`).

### Linked artifacts

The enduring source-system objects attached to this Problem — tickets, PRs, docs, meetings, recordings. Distinct from Events: a ticket is one Artifact, but it generates many Events (created, commented, updated, resolved).

### Related problems

Other Problems linked to this one. Five kinds of link:

- **Related** — broadly similar, helpful to see together.
- **Duplicate** — same problem captured twice.
- **Parent / Child** — one problem is a component of a bigger one.
- **Caused by** — this problem is a downstream effect of another.

---

## 5. Page tour

### Dashboard — list of problems

**URL:** `/dashboard`

The home screen. Shows every Problem in your workspace.

**Columns:**

- **Problem** — title and a one-line description preview. Click anywhere on the row to open it.
- **Client** — which customer.
- **Status** — the lifecycle pill (Open, Investigating, etc.).
- **Severity** — Low / Medium / High / Critical.
- **Activity** — event count and manual-note count, side by side. Useful at a glance.
- **First seen** — relative time (e.g. "3 days ago").

**Filters** (in the bar above the table):

- **Status chips** — quick toggles for All / Open / Investigating / In progress / Awaiting customer / Resolved. Click one.
- **Severity dropdown** — filter to Critical / High / Medium / Low.
- **Client dropdown** — narrow to one client.
- **Apply** — applies the current dropdown selections to the URL.
- **Reset** — clears all filters.

The header subtitle tells you "X open · Y shown." X is the *true* count of open problems in the workspace; Y is how many match your current filter.

**Empty state:** if you have no problems, you see a "Create a problem" call-to-action.

**Right-side action:** the "New problem" button in the topbar (top right) — takes you to `/problems/new`.

---

### Problem detail — the hero screen

**URL:** `/problems/[id]`

This is where you'll spend most of your time. Five regions, all on one page:

#### Region 1: Breadcrumb + title

- Client name (link — click to see all problems for that client).
- The big Problem title.

#### Region 2: Header controls

Two inline dropdowns + meta:

- **Status** — change it; saves automatically as soon as you select.
- **Severity** — same. Saves on change.
- Right-aligned: "First seen X ago. Resolved Y ago" (the second part only appears if resolved).

You don't need to click a "save" button. The select acts as the form trigger.

#### Region 3: Description

A paragraph block. The longer "what's the customer experiencing in their own words" text. Only shows if a description exists.

#### Region 4: Three summary cards — Approach / Root cause / Resolution

Side-by-side cards. Each shows either:

- Generated text (if the LLM has been run, or if a human filled them in), or
- An italic placeholder hint ("What's the team trying?", "Filled in when we know.", "Filled in on resolve.")

These cards are the *answer* to "what is this problem and how was it handled" — written for your future self.

#### Region 5: Timeline (the heart of the tool)

A chronological, vertical list of everything that happened on this Problem. Each row is one of:

- **An Event** — a message, ticket update, PR action, email. Color-coded by source (purple for Slack, indigo for DevRev, ink for GitHub, red for Gmail, etc.). Shows the actor, the source, the kind ("PR opened", "message"), and an "Open in [Source]" link if available.
- **A Manual Note** — green-tinted, with a sticky-note icon. Shows the channel ("Phone call", "Hallway", "WhatsApp"…), the participants, and the body.

Events and Manual notes are interleaved by timestamp. You read the Problem the way you'd read a journal: top to bottom in time.

The "Add manual note" button at the top of this section is a shortcut to log a note pre-attached to this Problem.

#### Region 6: Right rail (three cards stacked)

- **Linked artifacts** — tickets, PRs, docs, meetings tied to this Problem. Each shows source, kind, status, and an "Open" link.
- **Related problems** — problems linked via duplicate / related / parent-child / caused-by edges. Click to navigate.
- **Meta** — created / updated / first seen / resolved timestamps.

---

### Clients — list & detail

#### Clients list (`/clients`)

A table of every Client (customer) in the workspace.

**Columns:** Client name, Domain, Status (Active / Churned / Prospect / Archived), Problem count, Event count.

Click a row (or the "Open" link) to drill into a Client.

#### Client detail (`/clients/[slug]`)

For each Client you see:

- **Four stat cards** — Tier (enterprise / growth / etc.), ARR (annual recurring revenue), Domain, Account owner. These come from the Client's free-form metadata.
- **Problems table** — every Problem this Client has ever had. Same columns as the dashboard.

Useful when prepping for a customer call: open the Client page, scan their open problems, then scan their recent resolved ones to see what you've fixed lately.

---

### Manual notes

**URL:** `/notes`

Every note you've ever captured via Quick Log, regardless of which Problem (if any) it's attached to.

Each note card shows:

- Author + relative time.
- Channel pill — "Phone call", "WhatsApp", etc.
- Optional title.
- Body (truncated to four lines in the list view).
- "Attached to [Problem] · [Client]" if it's linked to a Problem.

This page is your scratchpad of off-tool customer conversations. Particularly useful when you've captured something **without** attaching it to a Problem yet ("note to self: customer hinted at churn risk during dinner") and want to come back to it later.

---

### Activity

**URL:** `/activity`

The audit log for the workspace. Every state-changing action your team has taken appears here:

- "Nikhil Nagaich problem.create · problem · 5 minutes ago"
- "Nikhil Nagaich problem.status_change · problem · 12 minutes ago"
- "Nikhil Nagaich manual_note.create · manual_note · 30 minutes ago"

It's a trust artifact. When a customer asks "who marked this resolved and when?" — this page is the answer. (A friendlier "diff" view is planned for M10.)

---

### Connectors

**URL:** `/connectors`

Two sections:

- **Installed** — your active connectors (currently Shipsy's seeded Slack + DevRev, both `PENDING` because no real OAuth has been done).
- **Available** — connectors you can install once M8 ships. Currently disabled with "Coming in M8."

Until M8 is built, this page is mostly informational. After M8, this is where you'll connect your real Slack workspace, DevRev org, GitHub org, and Gmail.

---

### Settings

**URL:** `/settings`

Workspace info (name, slug, created date, your role) and your user info (name, email).

Currently read-only. M2 brings invites, profile editing, workspace renames. M10 brings billing.

---

## 6. Quick Log — your most-used tool

Quick Log is the **most important capture surface** in the tool, because it solves the problem nothing else does: the conversation that never made it into a tool.

**Open it three ways:**

1. Press `⌘K` (Mac) or `Ctrl+K` (Win/Linux) from any page.
2. Click "Quick log" in the topbar.
3. From a Problem detail page, click "Add manual note" — same sheet, but pre-attached to the current Problem.

**The sheet has:**

| Field | Required? | Notes |
|---|---|---|
| **What happened?** | Yes | The body. The only thing you must fill in. Type free-form. |
| **Channel** | No (defaults to Other) | Phone call / In-person meeting / WhatsApp / Hallway / Customer visit / Conference / Text message / Other |
| **Attach to problem** | No | Pick a Problem to link this note to. Leave unattached for scratchpad-style notes. |
| **Participants** | No | Comma-separated names. E.g. `Rajesh (Acme), Priya` |
| **Title** | No | A short label. Helpful for skimming the Notes page later. |

**Behavior:**

- Hit `Esc` or click outside the sheet to cancel.
- Click "Save note" — saves, shows "Saved ✓", auto-closes after a beat.
- If you submit twice with `Cmd+Enter` or by clicking too fast, only one note is created (the button is disabled while saving).

**Pro tips:**

- **Don't aim for perfection.** A 2-line note is better than no note. You can always edit later.
- **Use channel honestly.** Future you will thank you for knowing whether the context came from a phone call or a casual hallway chat.
- **Attach to a Problem when you can.** If you logged a note unattached, you can always re-log it (or wait — M9 will add inline editing).

---

## 7. Common workflows

### "A customer just emailed me about an issue. What do I do?"

1. Press `⌘K` to open Quick Log.
2. Channel: "Other" (or "Phone call" if you also called them).
3. Body: paste a summary of what they said.
4. Leave "Attach to problem" as "— unattached —" for now.
5. Save.

Then: go to `/problems/new`, create a Problem for the customer's issue, paste the same summary into the description, and set severity. Once the Problem exists, you can attach the note to it (re-log it for now; inline edit comes later).

> When connectors are live (M8), this whole flow gets shorter: the email itself becomes an Event and the resolution layer attaches it to the right Problem automatically. The Quick Log step only remains for things that didn't happen in a tool.

### "We just had a triage call. How do I record what was decided?"

1. From the Problem detail page, click "Add manual note".
2. Channel: "Phone call".
3. Participants: who was on the call.
4. Body: write the decisions, not the chat. E.g. *"Decided to prioritize the timezone bug over the report caching one. Priya owns. ETA Friday."*
5. Update the Problem's status to "In progress" (the dropdown in the header).

### "An issue is fixed — how do I close it?"

1. Open the Problem.
2. Change Status to "Resolved" using the dropdown.
3. The "Resolved" timestamp auto-fills.
4. (Once the LLM layer ships) the Resolution summary regenerates from the timeline.

If a credit memo or other paperwork is needed, you can move it to "Closed" once that's done.

### "Show me every open Critical issue across all clients."

On `/dashboard`:

1. Click the "Open" status chip.
2. Change severity dropdown to "Critical".
3. Click Apply.

URL becomes `/dashboard?status=OPEN&severity=CRITICAL&client=ALL`. Bookmark it.

### "Show me everything for Acme Logistics."

Three ways:

1. From `/clients`, click "Acme Logistics."
2. Or on `/dashboard`, set the client dropdown to Acme and Apply.
3. Or visit `/clients/acme-logistics` directly.

### "Has this same problem happened before?"

For now: open the Problem, look at "Related problems" in the right rail. Until M6 (resolution layer) and M7 (vector similarity) ship, this is manually curated.

After M7 ships: the tool will suggest related problems automatically based on event content similarity.

---

## 8. Keyboard shortcuts

| Shortcut | What it does |
|---|---|
| `⌘K` / `Ctrl+K` | Open Quick Log from anywhere |
| `Esc` | Close Quick Log (without saving) |

More shortcuts are planned (`G P` to go to Problems, `G C` to Clients, etc. — Linear-style).

---

## 9. Glossary

| Term | Meaning |
|---|---|
| **Workspace** | The tenant boundary. Shipsy is one workspace. Every Client, Problem, and Event belongs to a workspace. |
| **User** | A human with an account. Can belong to many workspaces. |
| **Membership** | The join between User and Workspace. Carries the user's role (Owner / Admin / Member / Viewer). |
| **Client** | The customer your workspace serves. Acme, Globex, etc. |
| **Problem** | The canonical noun. A thing the customer is experiencing that you're tracking, resolving, or have resolved. |
| **Event** | A normalized cross-source activity record — one Slack message, one ticket comment, one PR merge. |
| **Manual note** | A first-class capture of an off-tool conversation. Has a "channel" (Hallway, Phone call, etc.). |
| **Artifact** | An enduring object in a source system that's linked to a Problem — a ticket, PR, doc, meeting. Distinct from Events. |
| **Connector** | A per-workspace install of a source system (Slack workspace, DevRev org, etc.). Brings Events in. |
| **Audit log** | The append-only history of who did what when. |
| **Resolution layer** | The component (M6) that decides which Client and which Problem an incoming Event belongs to. |
| **Embedding** | A vector representation of text used for semantic search and problem clustering. |
| **Severity** | How bad the Problem is for the customer right now. Low / Medium / High / Critical. |
| **Status** | Where the Problem is in its lifecycle. Open / Investigating / In progress / Awaiting customer / Resolved / Closed / Archived. |

---

## 10. What's not in the dashboard yet

Being transparent about what you'll see and what you won't:

| Feature | Status |
|---|---|
| Real Slack / DevRev / GitHub / Gmail ingestion | Not yet — M5 + M8 |
| LLM-generated Approach / Root cause / Resolution summaries | Not yet — M7 |
| Semantic search across all Problems | Not yet — M7 |
| Auto-suggested related Problems | Not yet — M6/M7 |
| Real authentication (magic links / Google / SSO) | Not yet — M2 |
| Workspace invites + RBAC | Not yet — M2 |
| Editing a manual note in place | Not yet — M4.5 refinement |
| Deleting a Problem | Not yet — coming with admin panel |
| Slack bot (`/log`, 🔖 reactions) | Not yet — M9 |
| Email-in address per workspace | Not yet — M9 |
| Browser extension | Not yet — M9 |
| Billing | Not yet — M10 |

What you *can* test today: creating Problems, updating their status and severity, logging manual notes (attached or unattached), filtering the dashboard, browsing clients, and watching the audit log fill up as you act.

---

## 11. FAQ & troubleshooting

### "I don't see any data on the dashboard."

If you just set this up, run `pnpm db:seed` from the project root. That loads the demo workspace (Shipsy + Acme + Globex with two example problems).

If you've already seeded, check the filters — you might have a stale `?status=…` in the URL. Click "Reset."

### "I made a change but the page didn't update."

The page should auto-refresh after a Server Action runs (status change, severity change, note save). If it doesn't, hit refresh once. If that becomes a recurring issue, that's a bug — report it.

### "Where is the data physically stored?"

In your Supabase Postgres instance (or whatever Postgres you pointed `DATABASE_URL` at). You can see the raw rows in Supabase's Table Editor. The schema is in `packages/db/prisma/schema.prisma`.

### "How do I add a new client?"

Not exposed in the UI yet. For now, edit `packages/db/prisma/seed.ts` and re-run `pnpm db:seed`, or insert directly via Supabase's Table Editor. Inline client creation lands when M2 ships.

### "Quick Log saved a note but I want to attach it to a Problem after the fact."

For now: re-log the note from the Problem detail page (which auto-attaches), and delete the unattached one from Supabase. A proper "attach this note to a problem" action is a planned refinement.

### "I can't tell the difference between an Event and a Manual Note. Why does it matter?"

Both appear on the Problem timeline. The visual difference: Events are white cards, Manual Notes are green-tinted with a sticky-note icon. The conceptual difference:

- An **Event** came from a tool. It has a source (Slack, DevRev, etc.), an actor who lives in that tool, and an "Open in [tool]" link.
- A **Manual Note** came from a human typing into Quick Log. It has a channel (Phone, WhatsApp, Hallway), a list of participants, and was authored by a workspace user.

When connectors are live, Events will flow in automatically; Manual Notes will always be by-hand.

### "What's the difference between Status: Closed and Status: Resolved?"

- **Resolved** = the customer's problem is fixed.
- **Closed** = Resolved *plus* any wrap-up (credit memo, post-mortem doc, customer email confirming, etc.).

If your team doesn't have wrap-up steps, just use Resolved. Closed is optional.

### "I changed the status but Activity still shows the old status."

The activity log records that you changed it — it shows the action, not the current state. Click into the Problem to see the current status.

### "Why are there two storage spots in the schema (Event and Artifact)?"

Because they answer different questions. An Event answers "what happened?" (a point in time). An Artifact answers "what object lives in the source system?" (an enduring thing). A single DevRev ticket is one Artifact, but as it gets created, commented on, and resolved, it generates multiple Events.

---

## You're set.

If anything in this guide is unclear, that's a documentation bug — flag it. If the *tool* itself does something that contradicts this guide, that's a tool bug — flag it. Either way, capture it as a Quick Log note tagged "internal feedback" and we'll work through it.

The most important habit you can build: **press `⌘K` whenever a customer conversation happens off-tool.** Even a one-line note is enough. Six months from now, the version of you sitting on a call with that customer will be grateful.
