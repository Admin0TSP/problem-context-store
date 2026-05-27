/**
 * Auth.js v5 route handler.
 *
 * Covers /api/auth/signin, /api/auth/signout, /api/auth/callback/[provider],
 * /api/auth/session, etc. All driven by the config in `auth.ts`.
 */

import { handlers } from '@/auth';

export const { GET, POST } = handlers;
