'use server';

/**
 * Server Actions: workspace lifecycle.
 *   - createWorkspace — first sign-in or "add another workspace" flow.
 *   - switchWorkspace — set the active workspace cookie.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma, MembershipRole } from '@pcs/db';
import { auth } from '@/auth';
import { setActiveWorkspace } from '@/lib/auth';

const CreateWorkspaceSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(80),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .max(40)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Slug must be lowercase letters, numbers, and dashes'),
});

export type CreateWorkspaceState =
  | { ok: true; workspaceId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function createWorkspace(
  _prev: CreateWorkspaceState | null,
  formData: FormData,
): Promise<CreateWorkspaceState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: 'Not signed in' };
  }

  const parsed = CreateWorkspaceSchema.safeParse({
    name: formData.get('name'),
    slug: formData.get('slug'),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join('.')] = issue.message;
    }
    return { ok: false, error: 'Invalid input', fieldErrors };
  }

  // Ensure slug is unique
  const existing = await prisma.workspace.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) {
    return {
      ok: false,
      error: 'That slug is taken',
      fieldErrors: { slug: 'That slug is taken' },
    };
  }

  const workspace = await prisma.workspace.create({
    data: {
      name: parsed.data.name,
      slug: parsed.data.slug,
      memberships: {
        create: { userId: session.user.id, role: MembershipRole.OWNER },
      },
    },
  });

  await setActiveWorkspace(workspace.id);

  await prisma.auditLog.create({
    data: {
      workspaceId: workspace.id,
      actorUserId: session.user.id,
      action: 'workspace.create',
      targetType: 'workspace',
      targetId: workspace.id,
      metadata: { name: workspace.name, slug: workspace.slug },
    },
  });

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

const SwitchSchema = z.object({ workspaceId: z.string().min(1) });

export async function switchWorkspace(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');

  const parsed = SwitchSchema.parse({ workspaceId: formData.get('workspaceId') });

  // Verify the user has a membership in the target workspace.
  const m = await prisma.membership.findFirst({
    where: { userId: session.user.id, workspaceId: parsed.workspaceId },
  });
  if (!m) throw new Error('Not a member of that workspace');

  await setActiveWorkspace(parsed.workspaceId);
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}
