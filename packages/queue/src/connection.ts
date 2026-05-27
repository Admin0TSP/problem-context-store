/**
 * Redis connection used by every Queue / Worker / QueueEvents instance.
 *
 * Single source of truth so we don't fan out connection logic. BullMQ
 * recommends sharing one ioredis connection per process.
 *
 * REDIS_URL examples:
 *   redis://default:password@us1-merry-mantis-1234.upstash.io:6379  (Upstash)
 *   redis://localhost:6379                                            (local)
 *
 * For Upstash specifically you can also use REDIS_TLS_URL or the
 * `rediss://` scheme which forces TLS — ioredis auto-detects this.
 */

import { Redis } from 'ioredis';

let _connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (_connection) return _connection;

  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      'REDIS_URL is not set. Sign up for a free Upstash Redis at https://upstash.com and put the connection URL in your .env.',
    );
  }

  // BullMQ requires maxRetriesPerRequest: null on connections used by workers
  // (otherwise the worker's blocking BRPOP/BLMOVE will error after the default
  // 20 retries, killing the worker). Both Queue and Worker share this config.
  _connection = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  _connection.on('error', (err) => {
    console.error('[redis] connection error:', err.message);
  });
  _connection.on('connect', () => {
    console.log('[redis] connected');
  });

  return _connection;
}

/** Test connectivity. Resolves true if PING works, false otherwise. */
export async function pingRedis(): Promise<{ ok: boolean; detail?: string }> {
  try {
    const conn = getRedisConnection();
    const reply = await conn.ping();
    return { ok: reply === 'PONG' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Graceful shutdown — call from worker on SIGINT/SIGTERM. */
export async function closeRedis(): Promise<void> {
  if (_connection) {
    await _connection.quit();
    _connection = null;
  }
}
