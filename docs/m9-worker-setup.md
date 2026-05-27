# M9 — Background Worker Setup

Run **once per environment** (dev / staging / prod) to wire up the BullMQ ingest queue.

## 1. Sign up for a free Upstash Redis

Local Redis is fine if you want it, but Upstash is the path of least resistance — no Docker, no Homebrew service, works the same in dev and prod.

1. Go to https://upstash.com → Sign up (Google / GitHub login). Free, no credit card.
2. Click **Create Database**:
   - Name: `pcs-dev` (anything works)
   - Type: Regional (Global also works but costs more once you scale)
   - Region: pick one close to you (e.g. `ap-south-1` for India, `eu-west-1` for EU, `us-east-1` for US)
   - Eviction: leave default
3. After creation, on the database overview page, scroll to **Connect to your database**.
4. Copy the **Redis URL** that starts with `rediss://default:...@...upstash.io:6379`. (The `rediss://` — note the double `s` — means TLS-encrypted; ioredis handles that automatically.)

## 2. Put it in `.env`

Add at the bottom of `.env`:

```env
REDIS_URL="rediss://default:<your-password>@<host>.upstash.io:6379"
```

(Keep the quotes — the URL has special characters in the password.)

## 3. Install + restart

```bash
pnpm install     # picks up the new @pcs/queue + bullmq + ioredis + tsx deps
pnpm dev         # now boots web AND worker together (turbo --parallel)
```

You should see in the terminal, alongside the usual `@pcs/web:dev` lines:

```
@pcs/web:worker:dev: [redis] connected
@pcs/web:worker:dev: [worker] Redis reachable. Booting worker (concurrency=1)…
@pcs/web:worker:dev: [worker] ready — waiting for jobs
```

If `[redis] connection error: ...` shows up instead, the URL is wrong or the Upstash database is paused (free databases sleep after 14 days of no use; just wake it from the dashboard).

## 4. Smoke test

In your `theseopilotworkspace.slack.com` (or any installed Slack workspace), post a message in `#pcs-test`.

**What you should now see in the terminal:**

```
@pcs/web:dev:        POST /api/ingest/slack 200 in 47ms          ← webhook returns FAST
@pcs/web:worker:dev: [worker] ⇢ job=42 (slack:T0B608XQQQ3) processing 1 event
@pcs/web:worker:dev: [resolver] ───── SLACK/MESSAGE "..."
@pcs/web:worker:dev: [resolver] ✓ DECISION: ...
@pcs/web:worker:dev: [worker] ✓ job=42 → 1 ingested, 0 dup, 1 resolved, 0 spawned, 0 need-confirm  (28453ms)
```

The key wins:

- The **`POST /api/ingest/slack`** line shows ~50ms instead of 54000ms. Slack is happy.
- The `[worker]` and `[resolver]` lines run in the worker, not the web request thread.
- If the worker takes 28 seconds because the LLM judge ran — that's fine, no one is waiting.

## 5. Test the retry machinery

Optional but worth seeing once: while a job is in flight, kill the worker terminal (Ctrl+C on the `@pcs/web:worker:dev` task). The job goes back to the queue. Restart `pnpm dev` and the worker picks it up automatically, re-processes from scratch.

To see what's in the queue right now from psql-style, use Upstash's web console (Database → Data Browser). You'll see `pcs:ingest:wait`, `pcs:ingest:active`, `pcs:ingest:completed`, `pcs:ingest:failed` lists.

## 6. Inspecting failed jobs

If a job fails 3 times in a row (transient Ollama error, malformed event, etc.), it lands in the `failed` set. To inspect:

```bash
# From a Node REPL or scratch script:
import { getIngestQueue } from '@pcs/queue';
const q = getIngestQueue();
const failures = await q.getFailed();
console.log(failures[0]?.failedReason);
```

Or use the Upstash console.

## Production notes

- For prod, set `REDIS_URL` to a dedicated database (not the free dev one).
- For real volume, increase `WORKER_CONCURRENCY` to 5–10 (only if you've moved off Ollama to Anthropic/OpenAI — local LLM can't parallel).
- Consider running the worker as a separate process (e.g. Railway/Fly worker, AWS ECS task) rather than in the same `pnpm dev` setup. The split is already clean — `pnpm worker` runs it standalone.
