'use server';

/**
 * Gmail sync server action — the user-facing wrapper.
 *
 * Thin wrapper around syncGmailInstanceCore() in lib/connectors/gmail-sync.ts.
 * Adds:
 *   - getSession() + requireMinRole() auth gating
 *   - revalidatePath() so the UI picks up new events without a hard reload
 *   - Maps the result to a UI-friendly union type
 *
 * The actual sync logic lives in the core so the background worker (M8b.5)
 * can call it without faking an HTTP session.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { MembershipRole } from '@pcs/db';
import { getSession } from '@/lib/auth';
import { requireMinRole } from '@/lib/rbac';
import {
  syncGmailInstanceCore,
  type SyncGmailCoreResult,
} from '@/lib/connectors/gmail-sync';

const Schema = z.object({ instanceId: z.string().min(1) });

export type SyncGmailResult =
  | {
      ok: true;
      fetched: number;
      enqueued: number;
      durationMs: number;
      ownerEmail: string;
      windowStart: string;
    }
  | { ok: false; error: string; code: 'not_found' | 'no_token' | 'gmail_api' | 'forbidden' };

export async function syncGmailInstance(formData: FormData): Promise<SyncGmailResult> {
  const session = await getSession();
  requireMinRole(session, MembershipRole.MEMBER);

  const parsed = Schema.safeParse({ instanceId: formData.get('instanceId') });
  if (!parsed.success) {
    return { ok: false, error: 'Missing instanceId', code: 'not_found' };
  }

  const result: SyncGmailCoreResult = await syncGmailInstanceCore({
    instanceId: parsed.data.instanceId,
    workspaceId: session.workspace.id,
    actorUserId: session.user.id,
    source: 'manual',
  });

  if (result.ok) {
    revalidatePath(`/connectors/${parsed.data.instanceId}`);
    revalidatePath('/inbox');
  }

  return result;
}
