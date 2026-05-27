/**
 * @pcs/db — shared Prisma client.
 *
 * Use the singleton `prisma` export everywhere; never instantiate PrismaClient
 * directly in app code. This avoids exhausting Postgres connections during
 * Next.js hot reloads.
 */

import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __pcs_prisma__: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  global.__pcs_prisma__ ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__pcs_prisma__ = prisma;
}

// Re-export Prisma types so app code only needs to import from @pcs/db.
export * from '@prisma/client';
export type { Prisma } from '@prisma/client';
