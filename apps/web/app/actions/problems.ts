'use server';

/**
 * Server Actions: Problem mutations.
 *
 * All actions:
 *   - Authenticate via `getSession()`.
 *   - Enforce tenant scoping (every query filters by workspaceId).
 *   - Validate input with Zod.
 *   - Write an AuditLog row.
 *   - Revalidate affected paths.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma, ProblemStatus, Severity, MembershipRole } from '@pcs/db';
import { getSession } from '@/lib/auth';
import { requireMinRole } from '@/lib/rbac';
import { embedText, embeddingsAvailable } from '@/lib/intelligence/embeddings';
import { persistProblemEmbedding } from '@/lib/resolution/vector';

// ---------------------------------------------------------------------------
// createProblem
// ---------------------------------------------------------------------------

const CreateProblemSchema = z.object({
  clientId: z.string().min(1, 'Pick a client'),
  title: z.string().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().max(10_000).optional(),
  severity: z.nativeEnum(Severity).default(Severity.MEDIUM),
});

export type CreateProblemState =
  | { ok: true; problemId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function createProblem(
  _prev: CreateProblemState | null,
  formData: FormData,
): Promise<CreateProblemState> {
  const session = await getSession();
  requireMinRole(session, MembershipRole.MEMBER);

  const parsed = CreateProblemSchema.safeParse({
    clientId: formData.get('clientId'),
    title: formData.get('title'),
    description: formData.get('description') || undefined,
    severity: formData.get('severity') || Severity.MEDIUM,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join('.')] = issue.message;
    }
    return { ok: false, error: 'Invalid input', fieldErrors };
  }

  // Verify client belongs to workspace (tenant scoping).
  const client = await prisma.client.findFirst({
    where: { id: parsed.data.clientId, workspaceId: session.workspace.id },
  });
  if (!client) {
    return { ok: false, error: 'Client not found in this workspace' };
  }

  const problem = await prisma.problem.create({
    data: {
      workspaceId: session.workspace.id,
      clientId: client.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      severity: parsed.data.severity,
      status: ProblemStatus.OPEN,
      firstSeenAt: new Date(),
      createdById: session.user.id,
    },
  });

  // Best-effort embedding so the resolver can vector-match future events against
  // this Problem immediately — no manual Backfill required. Non-fatal: if the
  // embedding provider is down, the Problem still gets created and can be
  // backfilled later from /settings.
  if (embeddingsAvailable()) {
    try {
      const text = `${problem.title}\n\n${problem.description ?? ''}`;
      const vec = await embedText(text);
      if (vec) await persistProblemEmbedding(problem.id, vec);
    } catch (err) {
      console.error('createProblem: embedding failed (non-fatal):', err);
    }
  }

  await prisma.auditLog.create({
    data: {
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      action: 'problem.create',
      targetType: 'problem',
      targetId: problem.id,
      metadata: { title: problem.title, clientId: client.id },
    },
  });

  revalidatePath('/dashboard');
  revalidatePath(`/clients/${client.slug}`);
  redirect(`/problems/${problem.id}`);
}

// ---------------------------------------------------------------------------
// updateProblemStatus
// ---------------------------------------------------------------------------

const UpdateStatusSchema = z.object({
  problemId: z.string().min(1),
  status: z.nativeEnum(ProblemStatus),
});

export async function updateProblemStatus(formData: FormData) {
  const session = await getSession();
  requireMinRole(session, MembershipRole.MEMBER);
  const parsed = UpdateStatusSchema.parse({
    problemId: formData.get('problemId'),
    status: formData.get('status'),
  });

  // Tenant check
  const existing = await prisma.problem.findFirst({
    where: { id: parsed.problemId, workspaceId: session.workspace.id },
  });
  if (!existing) throw new Error('Problem not found');

  const becomingResolved =
    parsed.status === ProblemStatus.RESOLVED && existing.status !== ProblemStatus.RESOLVED;
  const reopening =
    existing.status === ProblemStatus.RESOLVED && parsed.status !== ProblemStatus.RESOLVED;

  await prisma.problem.update({
    where: { id: parsed.problemId },
    data: {
      status: parsed.status,
      resolvedAt: becomingResolved ? new Date() : reopening ? null : existing.resolvedAt,
    },
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      action: 'problem.status_change',
      targetType: 'problem',
      targetId: parsed.problemId,
      metadata: { from: existing.status, to: parsed.status },
    },
  });

  revalidatePath(`/problems/${parsed.problemId}`);
  revalidatePath('/dashboard');
}

// ---------------------------------------------------------------------------
// updateProblemSeverity
// ---------------------------------------------------------------------------

const UpdateSeveritySchema = z.object({
  problemId: z.string().min(1),
  severity: z.nativeEnum(Severity),
});

export async function updateProblemSeverity(formData: FormData) {
  const session = await getSession();
  requireMinRole(session, MembershipRole.MEMBER);
  const parsed = UpdateSeveritySchema.parse({
    problemId: formData.get('problemId'),
    severity: formData.get('severity'),
  });

  const existing = await prisma.problem.findFirst({
    where: { id: parsed.problemId, workspaceId: session.workspace.id },
  });
  if (!existing) throw new Error('Problem not found');

  await prisma.problem.update({
    where: { id: parsed.problemId },
    data: { severity: parsed.severity },
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      action: 'problem.severity_change',
      targetType: 'problem',
      targetId: parsed.problemId,
      metadata: { from: existing.severity, to: parsed.severity },
    },
  });

  revalidatePath(`/problems/${parsed.problemId}`);
  revalidatePath('/dashboard');
}
