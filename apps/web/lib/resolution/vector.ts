/**
 * Stage 2: vector similarity matching using pgvector.
 *
 * Two important notes on raw SQL here:
 *
 *   1. Prisma's parameter binder infers `jsonb` for strings that look like
 *      JSON arrays (e.g. our `[0.1,0.2,...]` vector literals), and Postgres
 *      can't cast `jsonb → vector`. So we use $queryRawUnsafe /
 *      $executeRawUnsafe and inline the literal as raw SQL. Safe because
 *      the literal is `number[]` we produced.
 *
 *   2. Prisma maps fields like `workspaceId` to *camelCase, double-quoted*
 *      columns in Postgres ("workspaceId"), not snake_case. Unquoted
 *      identifiers in Postgres are folded to lowercase, so you must
 *      double-quote them in raw SQL.
 */

import { prisma } from '@pcs/db';
import { embedText, pgvectorLiteral, embeddingsAvailable } from '@/lib/intelligence/embeddings';

const OPEN_STATUSES = ['OPEN', 'INVESTIGATING', 'IN_PROGRESS', 'AWAITING_CUSTOMER'];
const OPEN_STATUSES_SQL = OPEN_STATUSES.map((s) => `'${s}'`).join(',');

export interface ProblemCandidate {
  id: string;
  title: string;
  similarity: number;
}

export async function findCandidateProblems(
  workspaceId: string,
  clientId: string,
  text: string,
  limit = 5,
): Promise<ProblemCandidate[]> {
  if (!embeddingsAvailable()) return [];

  const vec = await embedText(text);
  if (!vec) return [];
  const vecLit = pgvectorLiteral(vec);

  const sql = `
    SELECT id, title, 1 - (embedding <=> '${vecLit}'::vector) AS similarity
    FROM problem
    WHERE "workspaceId" = $1
      AND "clientId" = $2
      AND status::text IN (${OPEN_STATUSES_SQL})
      AND embedding IS NOT NULL
    ORDER BY embedding <=> '${vecLit}'::vector
    LIMIT ${Math.max(1, Math.min(50, Math.floor(limit)))}
  `;
  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; title: string; similarity: number | string }>
  >(sql, workspaceId, clientId);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    similarity: Number(r.similarity),
  }));
}

export interface ClientCandidate {
  id: string;
  name: string;
  similarity: number;
}

export async function guessClientFromText(
  workspaceId: string,
  text: string,
  limit = 3,
): Promise<ClientCandidate[]> {
  if (!embeddingsAvailable()) return [];

  const vec = await embedText(text);
  if (!vec) return [];
  const vecLit = pgvectorLiteral(vec);

  const sql = `
    SELECT c.id, c.name,
           MAX(1 - (e.embedding <=> '${vecLit}'::vector)) AS similarity
    FROM client c
    JOIN event e ON e."clientId" = c.id
    WHERE c."workspaceId" = $1
      AND e.embedding IS NOT NULL
      AND e."createdAt" > NOW() - INTERVAL '90 days'
    GROUP BY c.id, c.name
    ORDER BY similarity DESC
    LIMIT ${Math.max(1, Math.min(20, Math.floor(limit)))}
  `;
  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; name: string; similarity: number | string }>
  >(sql, workspaceId);

  return rows.map((r) => ({ id: r.id, name: r.name, similarity: Number(r.similarity) }));
}

export async function persistEventEmbedding(eventId: string, vec: number[]): Promise<void> {
  const vecLit = pgvectorLiteral(vec);
  await prisma.$executeRawUnsafe(
    `UPDATE event SET embedding = '${vecLit}'::vector WHERE id = $1`,
    eventId,
  );
}

export async function persistProblemEmbedding(problemId: string, vec: number[]): Promise<void> {
  const vecLit = pgvectorLiteral(vec);
  await prisma.$executeRawUnsafe(
    `UPDATE problem SET embedding = '${vecLit}'::vector WHERE id = $1`,
    problemId,
  );
}
