/**
 * Auto-spawn a new Problem when the LLM judge decides one is warranted.
 * Embeds the Problem and persists the embedding.
 */

import { prisma, ProblemStatus, Severity } from '@pcs/db';
import { embedText, embeddingsAvailable } from '@/lib/intelligence/embeddings';
import { persistProblemEmbedding } from './vector';

export async function spawnProblem({
  workspaceId,
  clientId,
  title,
  severity = Severity.MEDIUM,
  firstSeenAt,
  spawnReason,
  createdById,
}: {
  workspaceId: string;
  clientId: string;
  title: string;
  severity?: Severity;
  firstSeenAt?: Date;
  spawnReason?: string;
  createdById?: string;
}): Promise<{ id: string }> {
  const problem = await prisma.problem.create({
    data: {
      workspaceId,
      clientId,
      title,
      severity,
      status: ProblemStatus.OPEN,
      firstSeenAt: firstSeenAt ?? new Date(),
      createdById: createdById ?? null,
    },
    select: { id: true, title: true, description: true },
  });

  // Best-effort embedding — non-fatal.
  if (embeddingsAvailable()) {
    try {
      const vec = await embedText(`${problem.title}\n\n${problem.description ?? ''}`);
      if (vec) await persistProblemEmbedding(problem.id, vec);
    } catch (err) {
      console.error('spawnProblem: failed to embed new problem', err);
    }
  }

  await prisma.auditLog.create({
    data: {
      workspaceId,
      actorUserId: createdById ?? null,
      action: 'problem.spawn',
      targetType: 'problem',
      targetId: problem.id,
      metadata: { title, severity, spawnReason: spawnReason ?? null },
    },
  });

  return { id: problem.id };
}
