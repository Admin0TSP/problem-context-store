/**
 * Background worker — drains the ingest queue.
 *
 *   Producer: webhook routes in apps/web/app/api/ingest/*  → addIngestJob()
 *   Consumer: this process                                  → ingestEvents()
 *
 * Run with:
 *   pnpm --filter @pcs/web worker:dev   (watch mode for hot reload)
 *   pnpm --filter @pcs/web worker       (production-ish)
 *
 * Why this lives inside apps/web rather than apps/worker:
 *   The ingest pipeline (ingestEvents) and its dependencies (resolver,
 *   embeddings, llm, vector) all live under apps/web/lib/* and use the
 *   "@/" path alias. Living inside apps/web means we can import them
 *   directly with no refactor. Functionally still a separate Node process.
 *
 * Concurrency = 1:
 *   Ollama on this user's M1 cannot handle parallel inference (8GB RAM
 *   barely fits llama3.1:8b + nomic-embed-text alone). One job at a time
 *   is the only safe setting. Once you graduate to Anthropic/OpenAI you
 *   can crank this up.
 */

import {
  Worker,
  type Job,
  type IngestJobData,
  type IngestJobResult,
  INGEST_QUEUE_NAME,
  getRedisConnection,
  pingRedis,
  closeRedis,
} from '@pcs/queue';
import { prisma, ConnectorStatus } from '@pcs/db';
import { ingestEvents } from '../lib/ingestion/ingest';

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? '1');

async function main() {
  const ping = await pingRedis();
  if (!ping.ok) {
    console.error(
      `\n[worker] cannot reach Redis: ${ping.detail}\n[worker] set REDIS_URL in .env. See README.\n`,
    );
    process.exit(1);
  }
  console.log(`[worker] Redis reachable. Booting worker (concurrency=${CONCURRENCY})…`);

  const worker = new Worker<IngestJobData, IngestJobResult>(
    INGEST_QUEUE_NAME,
    async (job) => handleIngest(job),
    {
      connection: getRedisConnection(),
      concurrency: CONCURRENCY,
      // BullMQ pulls jobs in batches; with concurrency=1 this is conservative.
      lockDuration: 5 * 60 * 1000, // 5 min — long enough for an Ollama LLM judge call
    },
  );

  worker.on('completed', (job, res) => {
    console.log(
      `[worker] ✓ job=${job.id} (${job.data.source ?? 'unknown'}) → ` +
        `${res.ingested} ingested, ${res.duplicates} dup, ${res.resolved} resolved, ` +
        `${res.spawned} spawned, ${res.needsConfirm} need-confirm  (${res.elapsedMs}ms)`,
    );
  });
  worker.on('failed', (job, err) => {
    console.error(
      `[worker] ✗ job=${job?.id} attempt=${job?.attemptsMade}/${job?.opts.attempts ?? 1} ` +
        `error: ${err.message}`,
    );
  });
  worker.on('error', (err) => {
    console.error('[worker] uncaught:', err);
  });
  worker.on('ready', () => {
    console.log('[worker] ready — waiting for jobs');
  });

  // Graceful shutdown so in-flight jobs aren't yanked. BullMQ will let the
  // current job finish before .close() resolves.
  const shutdown = async (signal: string) => {
    console.log(`\n[worker] received ${signal} — closing worker…`);
    try {
      await worker.close();
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

/**
 * The actual work for one ingest job. Re-hydrates Date fields that BullMQ
 * serialized through JSON, then calls the existing ingestEvents() pipeline.
 *
 * Failures THROW — BullMQ uses the throw to drive its retry / dead-letter
 * machinery. Don't catch and swallow.
 */
async function handleIngest(job: Job<IngestJobData, IngestJobResult>): Promise<IngestJobResult> {
  const { workspaceId, events: rawEvents, connectorInstanceId, source } = job.data;
  const startedAt = Date.now();

  // BullMQ serialized to JSON — timestamps came back as ISO strings.
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
    // Bump lastSyncAt on the connector. Mark ACTIVE if it was PENDING.
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
    // On terminal failure (last attempt), mark the connector as ERROR so the
    // user can see it in /connectors.
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

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
