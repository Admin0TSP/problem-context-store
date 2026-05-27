'use server';

/**
 * Server Actions: ManualNote mutations.
 *
 * The "Quick Log" is the single most important capture surface in this product
 * — it's where off-tool context becomes durable. Keep it fast and forgiving:
 * minimal required fields, default the channel sensibly, and don't make the
 * user think.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma, ManualChannel, MembershipRole } from '@pcs/db';
import { getSession } from '@/lib/auth';
import { requireMinRole } from '@/lib/rbac';

const CreateManualNoteSchema = z.object({
  problemId: z.string().optional(),
  title: z.string().max(200).optional(),
  body: z.string().min(2, 'Tell us what happened').max(20_000),
  channel: z.nativeEnum(ManualChannel).default(ManualChannel.OTHER),
  occurredAt: z.string().optional(), // ISO from a datetime-local input
  participants: z.string().optional(), // comma-separated names
});

export type CreateNoteState =
  | { ok: true; noteId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function createManualNote(
  _prev: CreateNoteState | null,
  formData: FormData,
): Promise<CreateNoteState> {
  const session = await getSession();
  requireMinRole(session, MembershipRole.MEMBER);

  const parsed = CreateManualNoteSchema.safeParse({
    problemId: formData.get('problemId') || undefined,
    title: formData.get('title') || undefined,
    body: formData.get('body'),
    channel: formData.get('channel') || ManualChannel.OTHER,
    occurredAt: formData.get('occurredAt') || undefined,
    participants: formData.get('participants') || undefined,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join('.')] = issue.message;
    }
    return { ok: false, error: 'Invalid input', fieldErrors };
  }

  // If problemId given, verify it belongs to this workspace.
  if (parsed.data.problemId) {
    const problem = await prisma.problem.findFirst({
      where: { id: parsed.data.problemId, workspaceId: session.workspace.id },
    });
    if (!problem) return { ok: false, error: 'Problem not found in this workspace' };
  }

  const occurredAt = parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : new Date();
  const participants = parsed.data.participants
    ? parsed.data.participants
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name) => ({ name }))
    : null;

  const note = await prisma.manualNote.create({
    data: {
      workspaceId: session.workspace.id,
      problemId: parsed.data.problemId ?? null,
      authorId: session.user.id,
      title: parsed.data.title ?? null,
      body: parsed.data.body,
      channel: parsed.data.channel,
      occurredAt,
      participants: participants ?? undefined,
    },
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      action: 'manual_note.create',
      targetType: 'manual_note',
      targetId: note.id,
      metadata: { problemId: note.problemId, channel: note.channel },
    },
  });

  if (note.problemId) {
    revalidatePath(`/problems/${note.problemId}`);
  }
  revalidatePath('/dashboard');
  revalidatePath('/notes');

  return { ok: true, noteId: note.id };
}

const DeleteNoteSchema = z.object({ noteId: z.string().min(1) });

export async function deleteManualNote(formData: FormData) {
  const session = await getSession();
  requireMinRole(session, MembershipRole.MEMBER);
  const parsed = DeleteNoteSchema.parse({ noteId: formData.get('noteId') });

  const note = await prisma.manualNote.findFirst({
    where: { id: parsed.noteId, workspaceId: session.workspace.id },
  });
  if (!note) throw new Error('Note not found');

  await prisma.manualNote.delete({ where: { id: note.id } });
  await prisma.auditLog.create({
    data: {
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      action: 'manual_note.delete',
      targetType: 'manual_note',
      targetId: note.id,
      metadata: { problemId: note.problemId },
    },
  });

  if (note.problemId) revalidatePath(`/problems/${note.problemId}`);
  revalidatePath('/dashboard');
}
