/**
 * The "sync" queue — for source-system polling that runs on a schedule.
 *
 * Job shape: empty data (the handler iterates over connector instances).
 *
 * Repeating jobs:
 *   At worker startup we call `registerGmailPollRepeating(intervalMin)`
 *   which uses BullMQ's repeat option. BullMQ dedups by job name + repeat
 *   pattern, so calling it on every startup is safe — the schedule is
 *   created once and re-attached.
 *
 * Why a separate queue from ingest:
 *   - Different retry policy: a failed poll shouldn't retry the whole batch;
 *     per-instance failures bubble up to lastError instead.
 *   - Different cleanup TTLs: keep only the latest few completed records.
 *   - Easier to pause polling independently of ingestion.
 */

import { Queue, type JobsOptions } from 'bullmq';
import { getRedisConnection } from './connection';

export const SYNC_QUEUE_NAME = 'pcs-sync';

/** Names of every job type that lives in the sync queue. */
export const SYNC_JOB_NAMES = {
  /** Polls every active Gmail ConnectorInstance and syncs each. */
  GMAIL_POLL_ALL: 'gmail.poll-all',
} as const;

export type SyncJobName = (typeof SYNC_JOB_NAMES)[keyof typeof SYNC_JOB_NAMES];

export interface SyncJobData {
  /** Reserved for future per-instance triggering. Empty for the global poll. */
  instanceId?: string;
}

export interface SyncJobResult {
  /** Number of instances actually processed (active only). */
  processed: number;
  /** Total fetched messages across instances. */
  fetched: number;
  /** Total enqueued ingest jobs across instances. */
  enqueued: number;
  /** Per-instance failures (errors are logged, run continues). */
  errors: number;
  elapsedMs: number;
}

let _queue: Queue<SyncJobData, SyncJobResult> | null = null;

export function getSyncQueue(): Queue<SyncJobData, SyncJobResult> {
  if (_queue) return _queue;
  _queue = new Queue<SyncJobData, SyncJobResult>(SYNC_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      // Polls are tolerable to drop — don't retry the whole batch. The
      // per-instance code marks failed instances with lastError so the user
      // sees the problem in the UI.
      attempts: 1,
      removeOnComplete: { age: 60 * 60, count: 50 }, // keep 1hr / 50 latest
      removeOnFail: { age: 60 * 60 * 24, count: 100 },
    },
  });
  return _queue;
}

/**
 * Register the gmail.poll-all repeating job. Idempotent — BullMQ dedups
 * the repeat entry by name + pattern, so calling on every worker boot is
 * safe.
 */
export async function registerGmailPollRepeating(intervalMinutes: number): Promise<void> {
  const q = getSyncQueue();
  const everyMs = Math.max(1, Math.floor(intervalMinutes)) * 60 * 1000;
  const opts: JobsOptions = {
    repeat: { every: everyMs },
    // The repeat-job system creates child jobs internally — give them a
    // stable jobId prefix so we can identify them in the dashboard.
    jobId: `repeat:${SYNC_JOB_NAMES.GMAIL_POLL_ALL}:every-${everyMs}`,
  };
  await q.add(SYNC_JOB_NAMES.GMAIL_POLL_ALL, {}, opts);
}

/**
 * Helper for tests / admin: kick off a one-shot Gmail poll right now,
 * separate from the repeating schedule. The handler is the same.
 */
export async function triggerGmailPollNow(): Promise<{ jobId: string | undefined }> {
  const q = getSyncQueue();
  const job = await q.add(SYNC_JOB_NAMES.GMAIL_POLL_ALL, {}, { jobId: `manual-${Date.now()}` });
  return { jobId: job.id };
}

/**
 * Remove ALL repeating schedules on this queue. Useful when switching
 * intervals or shutting down for maintenance. Not called automatically.
 */
export async function clearAllRepeating(): Promise<void> {
  const q = getSyncQueue();
  const repeatables = await q.getRepeatableJobs();
  for (const r of repeatables) {
    await q.removeRepeatableByKey(r.key);
  }
}
