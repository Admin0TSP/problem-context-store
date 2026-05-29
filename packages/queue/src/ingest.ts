/**
 * The "ingest" queue — handles every incoming connector event.
 *
 * Job shape:
 *   {
 *     workspaceId: string,
 *     events: NormalizedEvent[],
 *     connectorInstanceId?: string,
 *   }
 *
 * The producer (webhook route) calls addIngestJob(...).
 * The consumer (apps/web/scripts/worker.ts) creates a Worker on this queue
 * and runs the existing ingestEvents() pipeline.
 *
 * Why a separate file: keeps the queue name and job shape colocated so any
 * future producer/consumer imports the same definition. No magic strings.
 */

import { Queue, type JobsOptions } from 'bullmq';
import type { NormalizedEvent } from '@pcs/connectors';
import { getRedisConnection } from './connection';

// BullMQ v5 forbids ':' in queue names (it uses ':' internally for Redis key
// namespacing). Hyphen-separated is the convention now.
export const INGEST_QUEUE_NAME = 'pcs-ingest';

/** What a single ingest job carries. */
export interface IngestJobData {
  workspaceId: string;
  /**
   * The normalized events to process. We serialize Date fields via JSON, which
   * BullMQ does for us. The worker re-hydrates timestamp back to Date.
   */
  events: NormalizedEvent[];
  connectorInstanceId?: string;
  /**
   * Source identifier purely for log readability — e.g. "slack:T08...",
   * "stub:cmpji5p...". Not used for routing.
   */
  source?: string;
}

/** What the worker returns when it finishes a job. Logged + auditable. */
export interface IngestJobResult {
  ingested: number;
  duplicates: number;
  resolved: number;
  spawned: number;
  needsConfirm: number;
  elapsedMs: number;
}

let _queue: Queue<IngestJobData, IngestJobResult> | null = null;

export function getIngestQueue(): Queue<IngestJobData, IngestJobResult> {
  if (_queue) return _queue;
  _queue = new Queue<IngestJobData, IngestJobResult>(INGEST_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      // BullMQ will retry the job up to 3 times with exponential backoff.
      // Backoff starts at 5s, then 10s, then 20s. Plenty for transient
      // Ollama/DB hiccups; terminal failures land in the "failed" set.
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      // Keep completed jobs for 1 hour in case we want to inspect them.
      // Keep failed jobs for 7 days (they're rare and the most useful to debug).
      removeOnComplete: { age: 60 * 60, count: 1000 },
      removeOnFail: { age: 60 * 60 * 24 * 7, count: 1000 },
    },
  });
  return _queue;
}

/**
 * Producer-side helper. Webhook routes call this after parsing N events,
 * then return 200 immediately to the source system.
 *
 * When called with an empty events array, we no-op rather than enqueueing
 * a useless job.
 */
export async function addIngestJob(
  data: IngestJobData,
  options?: JobsOptions,
): Promise<{ jobId: string | undefined; enqueued: number }> {
  if (!data.events.length) return { jobId: undefined, enqueued: 0 };
  const queue = getIngestQueue();
  const job = await queue.add('ingest', data, options);
  return { jobId: job.id, enqueued: data.events.length };
}
