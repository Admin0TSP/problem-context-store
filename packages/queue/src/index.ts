/**
 * @pcs/queue — BullMQ + ioredis primitives shared by web (producer) and
 * worker (consumer). Business logic stays where it lives; this package only
 * exposes the queue, connection, and job shape.
 */

export { getRedisConnection, pingRedis, closeRedis } from './connection';
export {
  INGEST_QUEUE_NAME,
  getIngestQueue,
  addIngestJob,
  type IngestJobData,
  type IngestJobResult,
} from './ingest';
export {
  SYNC_QUEUE_NAME,
  SYNC_JOB_NAMES,
  getSyncQueue,
  registerGmailPollRepeating,
  triggerGmailPollNow,
  clearAllRepeating,
  type SyncJobName,
  type SyncJobData,
  type SyncJobResult,
} from './sync';

// Re-export the BullMQ classes we expect consumers (the worker) to use.
// Keeps version pinned to ours so worker + queue can't drift.
export { Worker, type WorkerOptions, type Job, QueueEvents } from 'bullmq';
