/**
 * @pcs/core — shared business logic and domain types.
 *
 * This package is the lingua franca between apps/web, the worker, and the
 * connector framework. It depends on @pcs/db so it can speak in Prisma types,
 * but it must never depend on Next.js, Auth.js, or any web-only library.
 */

export * from './types';
export * from './errors';
export * from './constants';
