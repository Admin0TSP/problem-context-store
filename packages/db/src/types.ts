/**
 * Convenience type aliases over the generated Prisma types.
 *
 * As the schema grows, expose curated shapes here so app code doesn't reach
 * into Prisma's generated namespace.
 */

import type { Prisma } from '@prisma/client';

export type ProblemWithRelations = Prisma.ProblemGetPayload<{
  include: {
    client: true;
    events: { orderBy: { timestamp: 'desc' } };
    artifacts: true;
    manualNotes: true;
    edgesFrom: { include: { to: true } };
    edgesTo: { include: { from: true } };
  };
}>;

export type EventWithProblem = Prisma.EventGetPayload<{
  include: { problem: true; client: true };
}>;

export type ClientWithStats = Prisma.ClientGetPayload<{
  include: {
    _count: { select: { problems: true; events: true } };
  };
}>;
