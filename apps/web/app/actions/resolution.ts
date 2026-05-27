'use server';

/**
 * Server Actions for the triage queue.
 *
 *   - confirmResolution: human confirms the auto-attach was correct.
 *   - moveEventToProblem: human overrides the resolver's choice.
 *   - dismissEvent: marks the event as "not relevant" (kept for audit but
 *     hidden from the inbox).
 *   - spawnProblemFromEvent: when triaging unattached events, create a new
 *     Problem and attach this event as its first piece of evidence.
 *   - backfillEmbeddings: one-shot job to embed all existing Problems +
 *     unembedded Events. Useful after enabling OPENAI_API_KEY.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  prisma,
  MembershipRole,
  ProblemStatus,
  ResolutionMethod,
  Severity,
} from '@pcs/db';
import { getSession } from '@/lib/auth';
import { requireMinRole } from '@/lib/rbac';
import { embedText, embeddingsAvailable, embedBatch } from '@/lib/intelligence/embeddings';
import { persistEventEmbedding, persistProblemEmbedding } from '@/lib/resolution/vector';

// ---------------------------------------------------------------------------
// confirmResolution
// ---------------------------------------------------------------------------

const ConfirmSchema = z.object({ eventId: z.string().min(1) });

export async function confirmResolution(formData: FormData) {
  const session = await getSession();
  requireMinRole(session, MembershipRole.MEMBER);
  const { eventId } = ConfirmSchema.parse({ eventId: formData.get('eventId') });

  const event = await prisma.event.findFirst({
    where: { id: eventId, workspaceId: session.workspace.id },
  });
  if (!event) throw new Error('Event not found');
  if (!event.problemId) throw new Error('Event is not attached to a problem');

  await prisma.event.update({
    where: { id: event.id },
    data: {
      problemResolutionConfidence: 1,
      clientResolutionConfidence: 1,
      resolutionMethod: ResolutionMethod.MANUAL_CONFIRM,
      resolutionReason:
        (event.resolutionReason ? event.resolutionReason + ' · ' : '') + 'Human confirmed.',
    },
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      action: 'resolution.confirm',
      targetType: 'event',
      targetId: event.id,
      metadata: { problemId: event.problemId },
    },
  });

  revalidatePath('/inbox');
  revalidatePath(`/problems/${event.problemId}`);
}

// ---------------------------------------------------------------------------
// moveEventToProblem
// ---------------------------------------------------------------------------

const MoveSchema = z.object({
  eventId: z.string().min(1),
  problemId: z.string().min(1),
});

export async function moveEventToProblem(formData: FormData) {
  const session = await getSession();
  requireMinRole(session, MembershipRole.MEMBER);
  const { eventId, problemId } = MoveSchema.parse({
    eventId: formData.get('eventId'),
    problemId: formData.get('problemId'),
  });

  const [event, problem] = await Promise.all([
    prisma.event.findFirst({
      where: { id: eventId, workspaceId: session.workspace.id },
    }),
    prisma.problem.findFirst({
      where: { id: problemId, workspaceId: session.workspace.id },
      select: { id: true, clientId: true },
    }),
  ]);
  if (!event || !problem) throw new Error('Not found');

  const wasAttachedTo = event.problemId;
  await prisma.event.update({
    where: { id: event.id },
    data: {
      problemId: problem.id,
      clientId: problem.clientId,
      problemResolutionConfidence: 1,
      clientResolutionConfidence: 1,
      resolutionMethod: ResolutionMethod.MANUAL_CONFIRM,
      resolutionReason: wasAttachedTo
        ? `Moved from problem ${wasAttachedTo} by ${session.user.email}`
        : `Attached manually by ${session.user.email}`,
    },
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      action: wasAttachedTo ? 'resolution.move' : 'resolution.attach',
      targetType: 'event',
      targetId: event.id,
      metadata: {
        from: wasAttachedTo,
        to: problem.id,
        clientId: problem.clientId,
      },
    },
  });

  revalidatePath('/inbox');
  if (wasAttachedTo) revalidatePath(`/problems/${wasAttachedTo}`);
  revalidatePath(`/problems/${problem.id}`);
}

// ---------------------------------------------------------------------------
// dismissEvent
// ---------------------------------------------------------------------------

const DismissSchema = z.object({ eventId: z.string().min(1) });

export async function dismissEvent(formData: FormData) {
  const session = await getSession();
  requireMinRole(session, MembershipRole.MEMBER);
  const { eventId } = DismissSchema.parse({ eventId: formData.get('eventId') });

  const event = await prisma.event.findFirst({
    where: { id: eventId, workspaceId: session.workspace.id },
  });
  if (!event) throw new Error('Event not found');

  // We mark dismissals by setting resolutionMethod and a strong confidence
  // value, AND by attaching the event nowhere. To prevent it from re-appearing
  // in the inbox, we set problemResolutionConfidence to 1 with a clear reason
  // and add a workspace-scoped "dismissed" mention. The inbox query filters
  // those out.
  await prisma.event.update({
    where: { id: event.id },
    data: {
      problemId: null,
      problemResolutionConfidence: 1,
      resolutionMethod: ResolutionMethod.MANUAL_CONFIRM,
      resolutionReason:
        (event.resolutionReason ? event.resolutionReason + ' · ' : '') +
        `Dismissed by ${session.user.email}`,
      mentions: {
        create: [{ kind: 'HASHTAG', value: 'pcs:dismissed' }],
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      action: 'resolution.dismiss',
      targetType: 'event',
      targetId: event.id,
    },
  });

  revalidatePath('/inbox');
}

// ---------------------------------------------------------------------------
// spawnProblemFromEvent
// ---------------------------------------------------------------------------

const SpawnSchema = z.object({
  eventId: z.string().min(1),
  clientId: z.string().min(1),
  title: z.string().min(3).max(200),
  severity: z.nativeEnum(Severity).default(Severity.MEDIUM),
});

export async function spawnProblemFromEvent(formData: FormData) {
  const session = await getSession();
  requireMinRole(session, MembershipRole.MEMBER);

  const parsed = SpawnSchema.parse({
    eventId: formData.get('eventId'),
    clientId: formData.get('clientId'),
    title: formData.get('title'),
    severity: formData.get('severity') || Severity.MEDIUM,
  });

  const event = await prisma.event.findFirst({
    where: { id: parsed.eventId, workspaceId: session.workspace.id },
  });
  if (!event) throw new Error('Event not found');

  const client = await prisma.client.findFirst({
    where: { id: parsed.clientId, workspaceId: session.workspace.id },
  });
  if (!client) throw new Error('Client not found');

  const problem = await prisma.problem.create({
    data: {
      workspaceId: session.workspace.id,
      clientId: client.id,
      title: parsed.title,
      severity: parsed.severity,
      status: ProblemStatus.OPEN,
      firstSeenAt: event.timestamp,
      createdById: session.user.id,
    },
    select: { id: true },
  });

  // Best-effort embedding for the new Problem.
  if (embeddingsAvailable()) {
    try {
      const vec = await embedText(parsed.title);
      if (vec) await persistProblemEmbedding(problem.id, vec);
    } catch (err) {
      console.error('spawnProblemFromEvent: embedding failed (non-fatal):', err);
    }
  }

  await prisma.event.update({
    where: { id: event.id },
    data: {
      problemId: problem.id,
      clientId: client.id,
      problemResolutionConfidence: 1,
      clientResolutionConfidence: 1,
      resolutionMethod: ResolutionMethod.MANUAL_CONFIRM,
      resolutionReason: `Spawned new Problem from this event`,
    },
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      action: 'resolution.spawn_problem',
      targetType: 'problem',
      targetId: problem.id,
      metadata: { fromEventId: event.id, clientId: client.id, title: parsed.title },
    },
  });

  revalidatePath('/inbox');
  revalidatePath(`/problems/${problem.id}`);
  revalidatePath('/dashboard');
}

// ---------------------------------------------------------------------------
// backfillEmbeddings — one-shot helper, useful after enabling OPENAI_API_KEY.
// ---------------------------------------------------------------------------

export async function backfillEmbeddings() {
  const session = await getSession();
  requireMinRole(session, MembershipRole.ADMIN);
  if (!embeddingsAvailable()) {
    return {
      ok: false as const,
      error:
        'No embeddings provider configured. Set OLLAMA_BASE_URL (free) or OPENAI_API_KEY in your .env.',
    };
  }

  // Find Problems without embeddings — raw query because Prisma can't filter on Unsupported columns.
  const problemRows = await prisma.$queryRawUnsafe<
    Array<{ id: string; title: string; description: string | null }>
  >(
    `SELECT id, title, description
     FROM problem
     WHERE "workspaceId" = $1
       AND embedding IS NULL
     ORDER BY "firstSeenAt" DESC
     LIMIT 200`,
    session.workspace.id,
  );

  let problemsEmbedded = 0;
  try {
    if (problemRows.length > 0) {
      const texts = problemRows.map((p) => `${p.title}\n\n${p.description ?? ''}`);
      const vecs = await embedBatch(texts);
      for (let i = 0; i < problemRows.length; i++) {
        const v = vecs[i];
        if (v) {
          await persistProblemEmbedding(problemRows[i]!.id, v);
          problemsEmbedded++;
        }
      }
    }

    const eventRows = await prisma.$queryRawUnsafe<Array<{ id: string; body: string }>>(
      `SELECT id, body
       FROM event
       WHERE "workspaceId" = $1
         AND embedding IS NULL
       ORDER BY "createdAt" DESC
       LIMIT 200`,
      session.workspace.id,
    );

    let eventsEmbedded = 0;
    if (eventRows.length > 0) {
      const texts = eventRows.map((e) => e.body);
      const vecs = await embedBatch(texts);
      for (let i = 0; i < eventRows.length; i++) {
        const v = vecs[i];
        if (v) {
          await persistEventEmbedding(eventRows[i]!.id, v);
          eventsEmbedded++;
        }
      }
    }

    await prisma.auditLog.create({
      data: {
        workspaceId: session.workspace.id,
        actorUserId: session.user.id,
        action: 'embeddings.backfill',
        metadata: { problemsEmbedded, eventsEmbedded },
      },
    });

    revalidatePath('/settings');
    return { ok: true as const, problemsEmbedded, eventsEmbedded };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false as const,
      error: `Embedding provider failed: ${message}. Check that Ollama is running (\`ollama serve\`) and the model is pulled (\`ollama pull nomic-embed-text\`).`,
    };
  }
}
