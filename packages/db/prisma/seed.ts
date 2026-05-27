/**
 * Seed script — boots the database with a realistic demo workspace so the UI
 * has something to render before we wire up real connectors in M5/M8.
 *
 * Run with: `pnpm db:seed`
 *
 * Idempotent: safe to re-run; uses upsert by deterministic slugs/IDs.
 */

import {
  PrismaClient,
  MembershipRole,
  ClientStatus,
  ProblemStatus,
  Severity,
  SourceKind,
  EventKind,
  ResolutionMethod,
  ArtifactKind,
  ManualChannel,
} from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Problem Context Store...');

  // ---------------------------------------------------------------------------
  // Workspace
  // ---------------------------------------------------------------------------
  const workspace = await prisma.workspace.upsert({
    where: { slug: 'shipsy' },
    update: {},
    create: {
      slug: 'shipsy',
      name: 'Shipsy',
    },
  });

  // ---------------------------------------------------------------------------
  // User + Membership
  // ---------------------------------------------------------------------------
  const nikhil = await prisma.user.upsert({
    where: { email: 'nikhil.nagaich@shipsy.io' },
    update: {},
    create: {
      email: 'nikhil.nagaich@shipsy.io',
      name: 'Nikhil Nagaich',
    },
  });

  await prisma.membership.upsert({
    where: { userId_workspaceId: { userId: nikhil.id, workspaceId: workspace.id } },
    update: { role: MembershipRole.OWNER },
    create: {
      userId: nikhil.id,
      workspaceId: workspace.id,
      role: MembershipRole.OWNER,
    },
  });

  // ---------------------------------------------------------------------------
  // Clients
  // ---------------------------------------------------------------------------
  const acme = await prisma.client.upsert({
    where: { workspaceId_slug: { workspaceId: workspace.id, slug: 'acme-logistics' } },
    update: {},
    create: {
      workspaceId: workspace.id,
      slug: 'acme-logistics',
      name: 'Acme Logistics',
      domain: 'acmelogistics.com',
      status: ClientStatus.ACTIVE,
      metadata: { tier: 'enterprise', arr: 240000, accountOwner: 'priya@shipsy.io' },
      externalIds: { devrev_account_id: 'don:identity:dvrv-us-1:devo/0:account/abc123' },
    },
  });

  const globex = await prisma.client.upsert({
    where: { workspaceId_slug: { workspaceId: workspace.id, slug: 'globex-freight' } },
    update: {},
    create: {
      workspaceId: workspace.id,
      slug: 'globex-freight',
      name: 'Globex Freight',
      domain: 'globexfreight.com',
      status: ClientStatus.ACTIVE,
      metadata: { tier: 'growth', arr: 96000, accountOwner: 'arjun@shipsy.io' },
    },
  });

  // ---------------------------------------------------------------------------
  // Problem #1 — open, multi-source timeline (Acme)
  // ---------------------------------------------------------------------------
  const problem1 = await prisma.problem.upsert({
    where: { id: 'seed-problem-acme-cod-mismatch' },
    update: {},
    create: {
      id: 'seed-problem-acme-cod-mismatch',
      workspaceId: workspace.id,
      clientId: acme.id,
      title: 'COD reconciliation mismatch for Mumbai hub',
      description:
        'Acme is reporting that COD amounts collected at the Mumbai hub do not match what is reflected in the daily reconciliation report. Discrepancies range from ₹500 to ₹12,000 per day over the last 5 days.',
      status: ProblemStatus.INVESTIGATING,
      severity: Severity.HIGH,
      firstSeenAt: daysAgo(5),
      createdById: nikhil.id,
      tags: ['cod', 'reconciliation', 'reports'],
      approachSummary:
        'Investigating whether the discrepancy is a timezone issue in the COD aggregation job, an issue with the hub-level cash settlement flow, or stale data in the reporting datamart.',
    },
  });

  // Events for problem1
  await upsertEvent({
    workspaceId: workspace.id,
    clientId: acme.id,
    problemId: problem1.id,
    source: SourceKind.SLACK,
    sourceId: 'slack-msg-1',
    sourceUrl: 'https://shipsy.slack.com/archives/C01ACME/p1700000001',
    kind: EventKind.MESSAGE,
    timestamp: daysAgo(5, 9),
    actorName: 'Rajesh (Acme)',
    actorEmail: 'rajesh@acmelogistics.com',
    body: "Hey team, our Mumbai hub is showing a COD shortfall again today — about ₹8,400. We've checked the manifests on our end and they match what we collected. Something looks off in your dashboard.",
  });

  await upsertEvent({
    workspaceId: workspace.id,
    clientId: acme.id,
    problemId: problem1.id,
    source: SourceKind.DEVREV,
    sourceId: 'devrev-tkt-9821',
    sourceUrl: 'https://app.devrev.ai/shipsy/tickets/TKT-9821',
    kind: EventKind.TICKET_CREATED,
    timestamp: daysAgo(5, 10),
    actorName: 'Priya Sharma',
    actorEmail: 'priya@shipsy.io',
    body: 'Created ticket TKT-9821: COD reconciliation mismatch — Acme Mumbai. Priority: P1. Assigned to Payments squad.',
  });

  await upsertEvent({
    workspaceId: workspace.id,
    clientId: acme.id,
    problemId: problem1.id,
    source: SourceKind.GITHUB,
    sourceId: 'gh-pr-2341',
    sourceUrl: 'https://github.com/shipsy/payments/pull/2341',
    kind: EventKind.PR_OPENED,
    timestamp: daysAgo(3, 14),
    actorName: 'Ankit Singh',
    actorEmail: 'ankit@shipsy.io',
    body: 'Opened PR #2341: "fix(cod): use hub-local timezone when bucketing daily reconciliation." Includes a backfill script for the last 30 days.',
  });

  await upsertEvent({
    workspaceId: workspace.id,
    clientId: acme.id,
    problemId: problem1.id,
    source: SourceKind.SLACK,
    sourceId: 'slack-msg-2',
    sourceUrl: 'https://shipsy.slack.com/archives/C01ACME/p1700000002',
    kind: EventKind.MESSAGE,
    timestamp: daysAgo(2, 11),
    actorName: 'Priya Sharma',
    actorEmail: 'priya@shipsy.io',
    body: "Update for Acme team: we've identified the root cause — the COD aggregation job was bucketing collections in UTC instead of IST. Fix is in review (PR #2341). We'll deploy tonight and run a backfill for the last 30 days.",
  });

  await upsertEvent({
    workspaceId: workspace.id,
    clientId: acme.id,
    problemId: problem1.id,
    source: SourceKind.GITHUB,
    sourceId: 'gh-pr-2341-merged',
    sourceUrl: 'https://github.com/shipsy/payments/pull/2341',
    kind: EventKind.PR_MERGED,
    timestamp: daysAgo(1, 22),
    actorName: 'Ankit Singh',
    actorEmail: 'ankit@shipsy.io',
    body: 'PR #2341 merged to main. Deployed via release-2026-05-22.1.',
  });

  // Artifacts for problem1
  await upsertArtifact({
    workspaceId: workspace.id,
    problemId: problem1.id,
    kind: ArtifactKind.TICKET,
    source: SourceKind.DEVREV,
    sourceId: 'devrev-tkt-9821',
    url: 'https://app.devrev.ai/shipsy/tickets/TKT-9821',
    title: 'TKT-9821: COD reconciliation mismatch — Acme Mumbai',
    status: 'in_progress',
    payload: { priority: 'P1', assignedTo: 'Payments squad', stage: 'in_dev' },
  });

  await upsertArtifact({
    workspaceId: workspace.id,
    problemId: problem1.id,
    kind: ArtifactKind.PR,
    source: SourceKind.GITHUB,
    sourceId: 'gh-pr-2341',
    url: 'https://github.com/shipsy/payments/pull/2341',
    title: 'fix(cod): use hub-local timezone when bucketing daily reconciliation',
    status: 'merged',
    payload: { author: 'ankit@shipsy.io', additions: 142, deletions: 38 },
  });

  // Manual note — captures the hallway conversation that never made it into a tool
  await prisma.manualNote.upsert({
    where: { id: 'seed-note-acme-call' },
    update: {},
    create: {
      id: 'seed-note-acme-call',
      workspaceId: workspace.id,
      problemId: problem1.id,
      authorId: nikhil.id,
      title: 'Call with Rajesh (Acme COO)',
      body:
        'Quick 15-min call with Rajesh. He confirmed Acme will hold off on their internal RCA until our fix lands and the backfill finishes. He pushed for a credit on this month\'s invoice — said he\'d email finance separately. Mood: tense but constructive. Action: Priya to draft a goodwill credit memo by Friday.',
      channel: ManualChannel.PHONE_CALL,
      occurredAt: daysAgo(2, 15),
      participants: [
        { name: 'Rajesh', role: 'COO, Acme' },
        { name: 'Nikhil Nagaich', role: 'CS Lead, Shipsy' },
      ],
    },
  });

  // ---------------------------------------------------------------------------
  // Problem #2 — resolved (Globex)
  // ---------------------------------------------------------------------------
  const problem2 = await prisma.problem.upsert({
    where: { id: 'seed-problem-globex-webhook' },
    update: {},
    create: {
      id: 'seed-problem-globex-webhook',
      workspaceId: workspace.id,
      clientId: globex.id,
      title: 'Webhook delivery failures from status-update events',
      description:
        'Globex was missing ~12% of status-update webhooks for the last week. Their downstream BI pipeline was reporting stale shipment states.',
      status: ProblemStatus.RESOLVED,
      severity: Severity.MEDIUM,
      firstSeenAt: daysAgo(14),
      resolvedAt: daysAgo(7),
      createdById: nikhil.id,
      tags: ['webhooks', 'integration'],
      rootCauseSummary:
        'Our webhook delivery service was retrying on 5xx responses but not on connection timeouts. Globex’s endpoint occasionally hit a 30s timeout, causing the event to be silently dropped.',
      resolutionSummary:
        'Added connection-timeout to the retry classification and replayed the missing events for the last 14 days.',
      approachSummary:
        'Compared their internal event count to ours, isolated the 12% gap, and traced it to the webhook delivery worker logs.',
      summaryGeneratedAt: daysAgo(7),
    },
  });

  await upsertEvent({
    workspaceId: workspace.id,
    clientId: globex.id,
    problemId: problem2.id,
    source: SourceKind.GMAIL,
    sourceId: 'gmail-thread-globex-1',
    kind: EventKind.EMAIL_RECEIVED,
    timestamp: daysAgo(14),
    actorName: 'Sara Mendes (Globex)',
    actorEmail: 'sara@globexfreight.com',
    body: 'Hi team — our shipment dashboard is showing stale data again. Our pipeline ingests your webhooks; we think some are missing. Can you check?',
  });

  await upsertEvent({
    workspaceId: workspace.id,
    clientId: globex.id,
    problemId: problem2.id,
    source: SourceKind.GITHUB,
    sourceId: 'gh-pr-2298',
    sourceUrl: 'https://github.com/shipsy/integrations/pull/2298',
    kind: EventKind.PR_MERGED,
    timestamp: daysAgo(8),
    actorName: 'Meera Patel',
    actorEmail: 'meera@shipsy.io',
    body: 'PR #2298 merged: classify connection-timeout as retryable in webhook delivery.',
  });

  // ---------------------------------------------------------------------------
  // Connector instances — stubbed
  // ---------------------------------------------------------------------------
  await prisma.connectorInstance.upsert({
    where: {
      workspaceId_kind_displayName: {
        workspaceId: workspace.id,
        kind: SourceKind.SLACK,
        displayName: 'Shipsy Slack',
      },
    },
    update: {},
    create: {
      workspaceId: workspace.id,
      kind: SourceKind.SLACK,
      displayName: 'Shipsy Slack',
      status: 'PENDING',
      config: { watchedChannels: ['#cs-acme', '#cs-globex'] },
    },
  });

  await prisma.connectorInstance.upsert({
    where: {
      workspaceId_kind_displayName: {
        workspaceId: workspace.id,
        kind: SourceKind.DEVREV,
        displayName: 'Shipsy DevRev',
      },
    },
    update: {},
    create: {
      workspaceId: workspace.id,
      kind: SourceKind.DEVREV,
      displayName: 'Shipsy DevRev',
      status: 'PENDING',
    },
  });

  console.log('✅ Seed complete.');
  console.log(`   Workspace: ${workspace.name} (${workspace.slug})`);
  console.log(`   Clients: ${acme.name}, ${globex.name}`);
  console.log(`   Problems: 2 (1 investigating, 1 resolved)`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(days: number, hour: number = 12): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

type EventInput = {
  workspaceId: string;
  clientId: string;
  problemId: string;
  source: SourceKind;
  sourceId: string;
  sourceUrl?: string;
  kind: EventKind;
  timestamp: Date;
  actorName?: string;
  actorEmail?: string;
  body: string;
};

async function upsertEvent(e: EventInput) {
  return prisma.event.upsert({
    where: { workspaceId_source_sourceId: { workspaceId: e.workspaceId, source: e.source, sourceId: e.sourceId } },
    update: {},
    create: {
      ...e,
      resolutionMethod: ResolutionMethod.EXPLICIT,
      clientResolutionConfidence: 1.0,
      problemResolutionConfidence: 1.0,
    },
  });
}

type ArtifactInput = {
  workspaceId: string;
  problemId: string;
  kind: ArtifactKind;
  source: SourceKind;
  sourceId: string;
  url?: string;
  title?: string;
  status?: string;
  payload?: object;
};

async function upsertArtifact(a: ArtifactInput) {
  return prisma.artifact.upsert({
    where: { workspaceId_source_sourceId: { workspaceId: a.workspaceId, source: a.source, sourceId: a.sourceId } },
    update: {},
    create: a,
  });
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
