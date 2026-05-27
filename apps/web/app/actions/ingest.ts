'use server';

/**
 * Server Actions: connector install/uninstall + manual event simulation.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  prisma,
  ConnectorStatus,
  MembershipRole,
  SourceKind,
} from '@pcs/db';
import { getAdapter } from '@pcs/connectors';
import { getSession } from '@/lib/auth';
import { requireMinRole } from '@/lib/rbac';
import { ingestEvents, generateWebhookToken } from '@/lib/ingestion/ingest';

// ---------------------------------------------------------------------------
// installConnector — for adapters with authFlow=none (currently just Stub).
// Real OAuth flows (Slack, Google) will land in M8 and use a different action.
// ---------------------------------------------------------------------------

const InstallSchema = z.object({
  slug: z.string().min(1).max(50),
  displayName: z.string().min(2).max(80),
});

export async function installConnector(formData: FormData) {
  const session = await getSession();
  requireMinRole(session, MembershipRole.ADMIN);

  const parsed = InstallSchema.parse({
    slug: formData.get('slug'),
    displayName: formData.get('displayName'),
  });

  const adapter = getAdapter(parsed.slug);
  if (!adapter) throw new Error('Unknown connector');
  if (adapter.descriptor.capabilities.authFlow !== 'none') {
    throw new Error(`Connector ${parsed.slug} requires OAuth — coming in M8.`);
  }

  // Friendly collision check (the DB has a unique constraint on
  // (workspaceId, kind, displayName), but we want a readable message rather
  // than a P2002 stacktrace).
  const existing = await prisma.connectorInstance.findFirst({
    where: {
      workspaceId: session.workspace.id,
      kind: adapter.descriptor.kind,
      displayName: parsed.displayName,
    },
    select: { id: true },
  });
  if (existing) {
    throw new Error(
      `You already have a ${adapter.descriptor.displayName} connector named "${parsed.displayName}". ` +
        `Pick a different name to install another.`,
    );
  }

  const token = generateWebhookToken();

  const instance = await prisma.connectorInstance.create({
    data: {
      workspaceId: session.workspace.id,
      kind: adapter.descriptor.kind,
      displayName: parsed.displayName,
      status: ConnectorStatus.PENDING,
      config: { webhookToken: token },
    },
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      action: 'connector.install',
      targetType: 'connector_instance',
      targetId: instance.id,
      metadata: { kind: adapter.descriptor.kind, slug: parsed.slug },
    },
  });

  revalidatePath('/connectors');
  redirect(`/connectors/${instance.id}`);
}

// ---------------------------------------------------------------------------
// uninstallConnector
// ---------------------------------------------------------------------------

export async function uninstallConnector(formData: FormData) {
  const session = await getSession();
  requireMinRole(session, MembershipRole.ADMIN);

  const instanceId = String(formData.get('instanceId') ?? '');
  const instance = await prisma.connectorInstance.findFirst({
    where: { id: instanceId, workspaceId: session.workspace.id },
  });
  if (!instance) throw new Error('Connector not found');

  await prisma.connectorInstance.delete({ where: { id: instance.id } });
  await prisma.auditLog.create({
    data: {
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      action: 'connector.uninstall',
      targetType: 'connector_instance',
      targetId: instance.id,
      metadata: { kind: instance.kind, displayName: instance.displayName },
    },
  });

  revalidatePath('/connectors');
  redirect('/connectors');
}

// ---------------------------------------------------------------------------
// regenerateWebhookToken — useful if you suspect leakage.
// ---------------------------------------------------------------------------

export async function regenerateWebhookToken(formData: FormData) {
  const session = await getSession();
  requireMinRole(session, MembershipRole.ADMIN);

  const instanceId = String(formData.get('instanceId') ?? '');
  const instance = await prisma.connectorInstance.findFirst({
    where: { id: instanceId, workspaceId: session.workspace.id },
  });
  if (!instance) throw new Error('Connector not found');

  const newToken = generateWebhookToken();
  await prisma.connectorInstance.update({
    where: { id: instance.id },
    data: {
      config: { ...((instance.config as object) ?? {}), webhookToken: newToken },
    },
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      action: 'connector.rotate_token',
      targetType: 'connector_instance',
      targetId: instance.id,
    },
  });

  revalidatePath(`/connectors/${instance.id}`);
}

// ---------------------------------------------------------------------------
// simulateEvent — push a fake event through the pipeline as if it had come
// from a real source. Useful for testing resolution.
// ---------------------------------------------------------------------------

const SimulateSchema = z.object({
  instanceId: z.string().min(1),
  source: z.nativeEnum(SourceKind).default(SourceKind.STUB),
  kind: z.string().default('MESSAGE'),
  body: z.string().min(2).max(20_000),
  actorName: z.string().optional(),
  actorEmail: z.string().email().optional().or(z.literal('')),
  clientHint: z.string().optional(),
  problemHint: z.string().optional(),
});

export type SimulateState =
  | { ok: true; ingested: number; resolved: number; duplicates: number }
  | { ok: false; error: string };

export async function simulateEvent(
  _prev: SimulateState | null,
  formData: FormData,
): Promise<SimulateState> {
  const session = await getSession();
  requireMinRole(session, MembershipRole.MEMBER);

  const parsed = SimulateSchema.safeParse({
    instanceId: formData.get('instanceId'),
    source: formData.get('source') || SourceKind.STUB,
    kind: formData.get('kind') || 'MESSAGE',
    body: formData.get('body'),
    actorName: formData.get('actorName') || undefined,
    actorEmail: formData.get('actorEmail') || undefined,
    clientHint: formData.get('clientHint') || undefined,
    problemHint: formData.get('problemHint') || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const instance = await prisma.connectorInstance.findFirst({
    where: { id: parsed.data.instanceId, workspaceId: session.workspace.id },
  });
  if (!instance) return { ok: false, error: 'Connector not found' };

  const result = await ingestEvents(
    session.workspace.id,
    [
      {
        source: parsed.data.source,
        sourceId: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: parsed.data.kind as never,
        timestamp: new Date(),
        actor: {
          name: parsed.data.actorName,
          email: parsed.data.actorEmail || undefined,
        },
        body: parsed.data.body,
        resolutionHints: {
          clientId: parsed.data.clientHint || undefined,
          problemId: parsed.data.problemHint || undefined,
        },
      },
    ],
    { connectorInstanceId: instance.id, actorUserId: session.user.id },
  );

  await prisma.connectorInstance.update({
    where: { id: instance.id },
    data: {
      lastSyncAt: new Date(),
      status: instance.status === ConnectorStatus.PENDING ? ConnectorStatus.ACTIVE : instance.status,
    },
  });

  revalidatePath(`/connectors/${instance.id}`);
  revalidatePath('/inbox');
  revalidatePath('/dashboard');

  return {
    ok: true,
    ingested: result.ingested.length,
    duplicates: result.duplicates,
    resolved: result.resolved,
  };
}

// ---------------------------------------------------------------------------
// attachEventToProblem — used by the inbox to manually triage events.
// (M6 makes this rare by auto-resolving most events.)
// ---------------------------------------------------------------------------

const AttachSchema = z.object({
  eventId: z.string().min(1),
  problemId: z.string().min(1),
});

export async function attachEventToProblem(formData: FormData) {
  const session = await getSession();
  requireMinRole(session, MembershipRole.MEMBER);

  const parsed = AttachSchema.parse({
    eventId: formData.get('eventId'),
    problemId: formData.get('problemId'),
  });

  const [event, problem] = await Promise.all([
    prisma.event.findFirst({
      where: { id: parsed.eventId, workspaceId: session.workspace.id },
    }),
    prisma.problem.findFirst({
      where: { id: parsed.problemId, workspaceId: session.workspace.id },
      select: { id: true, clientId: true },
    }),
  ]);
  if (!event || !problem) throw new Error('Not found');

  await prisma.event.update({
    where: { id: event.id },
    data: {
      problemId: problem.id,
      clientId: problem.clientId,
      problemResolutionConfidence: 1,
      clientResolutionConfidence: 1,
      resolutionMethod: 'MANUAL_CONFIRM',
      resolutionReason: 'Attached manually from inbox',
    },
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      action: 'event.attach',
      targetType: 'event',
      targetId: event.id,
      metadata: { problemId: problem.id, clientId: problem.clientId },
    },
  });

  revalidatePath('/inbox');
  revalidatePath(`/problems/${problem.id}`);
}
