'use server';

/**
 * M7 — generateProblemSummary server action.
 *
 *   - Authenticates via getSession() and enforces MEMBER+ role.
 *   - Calls summarizeProblem() from lib/intelligence/summarize.ts.
 *   - Persists the three summary fields + summaryGeneratedAt.
 *   - Writes an AuditLog row so we know who refreshed and when.
 *   - Revalidates /problems/[id] and /dashboard so the UI picks up immediately.
 *
 * The action returns a discriminated union so the client component can render
 * a friendly error inline rather than throwing.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, MembershipRole } from '@pcs/db';
import { getSession } from '@/lib/auth';
import { requireMinRole } from '@/lib/rbac';
import { summarizeProblem, SummarizeError } from '@/lib/intelligence/summarize';

const Schema = z.object({ problemId: z.string().min(1) });

export type GenerateSummaryResult =
  | {
      ok: true;
      problemId: string;
      rootCause: string | null;
      approach: string | null;
      resolution: string | null;
      confidence: number;
      basis: string;
      elapsedMs: number;
    }
  | {
      ok: false;
      error: string;
      code: 'no_llm' | 'no_evidence' | 'llm_failed' | 'parse_failed' | 'forbidden';
    };

export async function generateProblemSummary(
  formData: FormData,
): Promise<GenerateSummaryResult> {
  const session = await getSession();
  requireMinRole(session, MembershipRole.MEMBER);

  const parsed = Schema.safeParse({ problemId: formData.get('problemId') });
  if (!parsed.success) {
    return { ok: false, error: 'Missing problemId', code: 'parse_failed' };
  }

  const t0 = Date.now();
  try {
    const summary = await summarizeProblem({
      workspaceId: session.workspace.id,
      problemId: parsed.data.problemId,
    });

    await prisma.problem.update({
      where: { id: parsed.data.problemId },
      data: {
        rootCauseSummary: summary.rootCause,
        approachSummary: summary.approach,
        resolutionSummary: summary.resolution,
        summaryGeneratedAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        workspaceId: session.workspace.id,
        actorUserId: session.user.id,
        action: 'problem.summarize',
        targetType: 'problem',
        targetId: parsed.data.problemId,
        metadata: {
          confidence: summary.confidence,
          basis: summary.basis,
          elapsedMs: Date.now() - t0,
        },
      },
    });

    revalidatePath(`/problems/${parsed.data.problemId}`);
    revalidatePath('/dashboard');

    return {
      ok: true,
      problemId: parsed.data.problemId,
      rootCause: summary.rootCause,
      approach: summary.approach,
      resolution: summary.resolution,
      confidence: summary.confidence,
      basis: summary.basis,
      elapsedMs: Date.now() - t0,
    };
  } catch (err) {
    if (err instanceof SummarizeError) {
      return { ok: false, error: err.message, code: err.code };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, code: 'llm_failed' };
  }
}
