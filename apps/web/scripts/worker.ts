/**
 * Background worker — drains the ingest queue + runs scheduled polls.
 *
 *   Queues handled:
 *     - pcs-ingest  → resolver pipeline (M9)
 *     - pcs-sync    → scheduled polling for sources without push webhooks (M8b.5)
 *
 * Producers:
 *   - Webhook routes in apps/web/app/api/ingest/* enqueue ingest jobs
 *   - The repeating gmail.poll-all job (registered below) enqueues itself
 *     every GMAIL_POLL_INTERVAL_MINUTES, calls the Gmail sync core, which
 *     in turn enqueues ingest jobs as it discovers messages
 *
 * Run with:
 *   pnpm --filter @pcs/web worker:dev   (watch mode for hot reload)
 *   pnpm --filter @pcs/web worker       (production-ish)
 *
 * Concurrency = 1 by default — Ollama on the M1 8GB can't handle parallel
 * inference. Cloud LLMs let you crank WORKER_CONCURRENCY higher.
 */

import {
  Worker,
  type Job,
  type IngestJobData,
  type IngestJobResult,
  type SyncJobData,
  type SyncJobResult,
  INGEST_QUEUE_NAME,
  SYNC_QUEUE_NAME,
  SYNC_JOB_NAMES,
  getRedisConnection,
  pingRedis,
  closeRedis,
  registerGmailPollRepeating,
} from '@pcs/queue';
import { prisma, ConnectorStatus, SourceKind } from '@pcs/db';
import { ingestEvents } from '../lib/ingestion/ingest';
import { syncGmailInstanceCore } from '../lib/connectors/gmail-sync';

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? '1');
const GMAIL_POLL_INTERVAL_MIN = Number(process.env.GMAIL_POLL_INTERVAL_MINUTES ?? '5');
const GMAIL_POLL_ENABLED = process.env.GMAIL_POLL_ENABLED !== 'false';

async function main() {
  const ping = await pingRedis();
  if (!ping.ok) {
    console.error(
      `\n[worker] cannot reach Redis: ${ping.detail}\n[worker] set REDIS_URL in .env. See README.\n`,
    );
    process.exit(1);
  }
  console.log(`[worker] Redis reachable. Booting workers (concurrency=${CONCURRENCY})…`);

  // -------------------------------------------------------------------------
  // Ingest worker (M9) — drains pcs-ingest, runs ingestEvents()
  // -------------------------------------------------------------------------
  const ingestWorker = new Worker<IngestJobData, IngestJobResult>(
    INGEST_QUEUE_NAME,
    async (job) => handleIngest(job),
    {
      connection: getRedisConnection(),
      concurrency: CONCURRENCY,
      lockDuration: 5 * 60 * 1000,
    },
  );

  ingestWorker.on('completed', (job, res) => {
    console.log(
      `[worker] ✓ job=${job.id} (${job.data.source ?? 'unknown'}) → ` +
        `${res.ingested} ingested, ${res.duplicates} dup, ${res.resolved} resolved, ` +
        `${res.spawned} spawned, ${res.needsConfirm} need-confirm  (${res.elapsedMs}ms)`,
    );
  });
  ingestWorker.on('failed', (job, err) => {
    console.error(
      `[worker] ✗ job=${job?.id} attempt=${job?.attemptsMade}/${job?.opts.attempts ?? 1} ` +
        `error: ${err.message}`,
    );
  });
  ingestWorker.on('error', (err) => console.error('[worker] uncaught:', err));
  ingestWorker.on('ready', () => console.log('[worker] ingest worker ready — waiting for jobs'));

  // -------------------------------------------------------------------------
  // Sync worker (M8b.5) — drains pcs-sync, dispatches by job name
  // -------------------------------------------------------------------------
  const syncWorker = new Worker<SyncJobData, SyncJobResult>(
    SYNC_QUEUE_NAME,
    async (job) => {
      switch (job.name) {
        case SYNC_JOB_NAMES.GMAIL_POLL_ALL:
          return handleGmailPollAll();
        default:
          throw new Error(`[sync] unknown job name: ${job.name}`);
      }
    },
    {
      connection: getRedisConnection(),
      concurrency: 1, // polls are batch operations — one at a time is correct
      // Polls can take a while if there are many instances. Generous lock.
      lockDuration: 15 * 60 * 1000,
    },
  );

  syncWorker.on('completed', (job, res) => {
    console.log(
      `[sync] ✓ ${job.name} → processed=${res.processed} fetched=${res.fetched} ` +
        `enqueued=${res.enqueued} errors=${res.errors}  (${res.elapsedMs}ms)`,
    );
  });
  syncWorker.on('failed', (job, err) => {
    console.error(`[sync] ✗ ${job?.name ?? '?'} error: ${err.message}`);
  });
  syncWorker.on('error', (err) => console.error('[sync] uncaught:', err));
  syncWorker.on('ready', () => console.log('[sync] sync worker ready — waiting for jobs'));

  // -------------------------------------------------------------------------
  // Register the Gmail repeating poll
  // -------------------------------------------------------------------------
  if (GMAIL_POLL_ENABLED) {
    try {
      await registerGmailPollRepeating(GMAIL_POLL_INTERVAL_MIN);
      console.log(
        `[sync] registered gmail.poll-all repeating every ${GMAIL_POLL_INTERVAL_MIN} minute(s)`,
      );
    } catch (err) {
      console.error('[sync] failed to register Gmail repeating job (non-fatal):', err);
    }
  } else {
    console.log('[sync] GMAIL_POLL_ENABLED=false — auto-poll disabled');
  }

  // -------------------------------------------------------------------------
  // Graceful shutdown — let both workers drain in-flight before exit
  // -------------------------------------------------------------------------
  const shutdown = async (signal: string) => {
    console.log(`\n[worker] received ${signal} — closing workers…`);
    try {
      await Promise.all([ingestWorker.close(), syncWorker.close()]);
      await closeRedis();
      await prisma.$disconnect();
      console.log('[worker] clean shutdown complete');
      process.exit(0);
    } catch (err) {
      console.error('[worker] error during shutdown', err);
      process.exit(1);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// ---------------------------------------------------------------------------
// Ingest handler (M9)
// ---------------------------------------------------------------------------

async function handleIngest(job: Job<IngestJobData, IngestJobResult>): Promise<IngestJobResult> {
  const { workspaceId, events: rawEvents, connectorInstanceId, source } = job.data;
  const startedAt = Date.now();

  const events = rawEvents.map((e) => ({
    ...e,
    timestamp: e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp as unknown as string),
  }));

  console.log(
    `[worker] ⇢ job=${job.id} (${source ?? 'unknown'}) processing ${events.length} event${events.length === 1 ? '' : 's'}` +
      ` (attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1})`,
  );

  try {
    const r = await ingestEvents(workspaceId, events, { connectorInstanceId });
    if (connectorInstanceId) {
      const inst = await prisma.connectorInstance.findUnique({
        where: { id: connectorInstanceId },
        select: { status: true },
      });
      if (inst) {
        await prisma.connectorInstance.update({
          where: { id: connectorInstanceId },
          data: {
            lastSyncAt: new Date(),
            ...(inst.status !== ConnectorStatus.ACTIVE
              ? { status: ConnectorStatus.ACTIVE, lastError: null }
              : {}),
          },
        });
      }
    }
    return {
      ingested: r.ingested.length,
      duplicates: r.duplicates,
      resolved: r.resolved,
      spawned: r.spawned,
      needsConfirm: r.needsConfirm,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (isLastAttempt && connectorInstanceId) {
      await prisma.connectorInstance
        .update({
          where: { id: connectorInstanceId },
          data: {
            status: ConnectorStatus.ERROR,
            lastError: err instanceof Error ? err.message : String(err),
          },
        })
        .catch(() => {});
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Sync handler — Gmail "poll all" (M8b.5)
// ---------------------------------------------------------------------------

/**
 * Find every ACTIVE Gmail ConnectorInstance across all workspaces and
 * sync each one sequentially. We DON'T parallelize because Google's API
 * rate-limits are per-account and the bottleneck is usually Ollama
 * downstream — running 10 polls in parallel just floods the ingest queue.
 *
 * Per-instance failures are logged but don't fail the whole job. The
 * instance's `lastError` is updated so admins see it in /connectors.
 */
async function handleGmailPollAll(): Promise<SyncJobResult> {
  const startedAt = Date.now();
  let processed = 0;
  let fetched = 0;
  let enqueued = 0;
  let errors = 0;

  const instances = await prisma.connectorInstance.findMany({
    where: {
      kind: SourceKind.GMAIL,
      status: ConnectorStatus.ACTIVE,
    },
    select: { id: true, workspaceId: true, displayName: true },
  });

  if (instances.length === 0) {
    console.log('[sync] gmail.poll-all → 0 active Gmail instances to poll');
    return { processed: 0, fetched: 0, enqueued: 0, errors: 0, elapsedMs: Date.now() - startedAt };
  }

  console.log(`[sync] gmail.poll-all → polling ${instances.length} active Gmail instance(s)`);

  for (const inst of instances) {
    try {
      const result = await syncGmailInstanceCore({
        instanceId: inst.id,
        workspaceId: inst.workspaceId,
        actorUserId: null, // system-driven, no user
        source: 'auto-poll',
      });
      processed++;
      if (result.ok) {
        fetched += result.fetched;
        enqueued += result.enqueued;
        if (result.fetched > 0) {
          console.log(
            `[sync] gmail "${inst.displayName}" → fetched=${result.fetched} enqueued=${result.enqueued} (${result.durationMs}ms)`,
          );
        }
      } else {
        errors++;
        console.warn(
          `[sync] gmail "${inst.displayName}" → ${result.code}: ${result.error}`,
        );
      }
    } catch (err) {
      errors++;
      console.error(`[sync] gmail "${inst.displayName}" threw:`, err);
    }
  }

  return { processed, fetched, enqueued, errors, elapsedMs: Date.now() - startedAt };
}

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
