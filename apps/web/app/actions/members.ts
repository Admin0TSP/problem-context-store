'use server';

/**
 * Server Actions: members + invites.
 *
 *   - inviteMember — Owner/Admin invites someone by email. Creates an invite
 *     row and sends a magic-link-style accept URL.
 *   - changeRole — Owner can change any member's role; Admin can change
 *     non-Owner roles below their own level.
 *   - removeMember — Owner/Admin removes a member.
 *   - acceptInvite — claims an outstanding invite, creates the membership.
 *   - cancelInvite — Owner/Admin cancels a pending invite.
 */

import crypto from 'crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma, MembershipRole } from '@pcs/db';
import { auth } from '@/auth';
import { getSession, setActiveWorkspace } from '@/lib/auth';
import { requireMinRole, requireRole } from '@/lib/rbac';
import { sendEmail } from '@/lib/email';

// ---------------------------------------------------------------------------
// inviteMember
// ---------------------------------------------------------------------------

const InviteSchema = z.object({
  email: z.string().email().max(254),
  role: z.nativeEnum(MembershipRole).default(MembershipRole.MEMBER),
});

export type InviteState =
  | { ok: true; inviteId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function inviteMember(
  _prev: InviteState | null,
  formData: FormData,
): Promise<InviteState> {
  const session = await getSession();
  requireMinRole(session, MembershipRole.ADMIN);

  const parsed = InviteSchema.safeParse({
    email: String(formData.get('email') ?? '').trim().toLowerCase(),
    role: formData.get('role') || MembershipRole.MEMBER,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join('.')] = issue.message;
    return { ok: false, error: 'Invalid input', fieldErrors };
  }

  // Only Owners can invite Owners.
  if (parsed.data.role === MembershipRole.OWNER) {
    requireRole(session, MembershipRole.OWNER);
  }

  // If the email already belongs to a member of this workspace, no-op.
  const existingUser = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existingUser) {
    const existingMembership = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: existingUser.id, workspaceId: session.workspace.id } },
    });
    if (existingMembership) {
      return { ok: false, error: 'That person is already a member.' };
    }
  }

  // Upsert the invite (refresh token + role + expiry if they were re-invited).
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days

  const invite = await prisma.workspaceInvite.upsert({
    where: { workspaceId_email: { workspaceId: session.workspace.id, email: parsed.data.email } },
    update: { token, expiresAt, acceptedAt: null, role: parsed.data.role },
    create: {
      workspaceId: session.workspace.id,
      email: parsed.data.email,
      role: parsed.data.role,
      token,
      expiresAt,
    },
  });

  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const acceptUrl = `${base}/invite/${token}`;

  await sendEmail({
    to: parsed.data.email,
    subject: `You're invited to ${session.workspace.name} on Problem Context Store`,
    html: inviteHtml({
      workspaceName: session.workspace.name,
      inviterName: session.user.name ?? session.user.email,
      role: parsed.data.role,
      acceptUrl,
    }),
    text:
      `${session.user.name ?? session.user.email} invited you to join ${session.workspace.name} ` +
      `on Problem Context Store as ${parsed.data.role}.\n\nAccept: ${acceptUrl}\n\n` +
      `This link expires in 7 days.`,
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      action: 'invite.send',
      targetType: 'workspace_invite',
      targetId: invite.id,
      metadata: { email: parsed.data.email, role: parsed.data.role },
    },
  });

  revalidatePath('/settings/members');
  return { ok: true, inviteId: invite.id };
}

// ---------------------------------------------------------------------------
// cancelInvite
// ---------------------------------------------------------------------------

export async function cancelInvite(formData: FormData) {
  const session = await getSession();
  requireMinRole(session, MembershipRole.ADMIN);

  const inviteId = String(formData.get('inviteId') ?? '');
  const invite = await prisma.workspaceInvite.findFirst({
    where: { id: inviteId, workspaceId: session.workspace.id },
  });
  if (!invite) throw new Error('Invite not found');

  await prisma.workspaceInvite.delete({ where: { id: invite.id } });
  await prisma.auditLog.create({
    data: {
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      action: 'invite.cancel',
      targetType: 'workspace_invite',
      targetId: invite.id,
      metadata: { email: invite.email },
    },
  });

  revalidatePath('/settings/members');
}

// ---------------------------------------------------------------------------
// changeRole
// ---------------------------------------------------------------------------

export async function changeRole(formData: FormData) {
  const session = await getSession();
  requireMinRole(session, MembershipRole.ADMIN);

  const membershipId = String(formData.get('membershipId') ?? '');
  const role = String(formData.get('role') ?? '') as MembershipRole;
  if (!Object.values(MembershipRole).includes(role)) throw new Error('Invalid role');

  const target = await prisma.membership.findFirst({
    where: { id: membershipId, workspaceId: session.workspace.id },
  });
  if (!target) throw new Error('Member not found');
  if (target.userId === session.user.id) throw new Error("You can't change your own role.");

  // Only Owners can change roles to or from Owner.
  if (role === MembershipRole.OWNER || target.role === MembershipRole.OWNER) {
    requireRole(session, MembershipRole.OWNER);
  }

  await prisma.membership.update({ where: { id: target.id }, data: { role } });
  await prisma.auditLog.create({
    data: {
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      action: 'membership.change_role',
      targetType: 'membership',
      targetId: target.id,
      metadata: { from: target.role, to: role },
    },
  });

  revalidatePath('/settings/members');
}

// ---------------------------------------------------------------------------
// removeMember
// ---------------------------------------------------------------------------

export async function removeMember(formData: FormData) {
  const session = await getSession();
  requireMinRole(session, MembershipRole.ADMIN);

  const membershipId = String(formData.get('membershipId') ?? '');
  const target = await prisma.membership.findFirst({
    where: { id: membershipId, workspaceId: session.workspace.id },
  });
  if (!target) throw new Error('Member not found');
  if (target.userId === session.user.id) throw new Error("You can't remove yourself.");
  if (target.role === MembershipRole.OWNER) requireRole(session, MembershipRole.OWNER);

  await prisma.membership.delete({ where: { id: target.id } });
  await prisma.auditLog.create({
    data: {
      workspaceId: session.workspace.id,
      actorUserId: session.user.id,
      action: 'membership.remove',
      targetType: 'membership',
      targetId: target.id,
      metadata: { userId: target.userId, role: target.role },
    },
  });

  revalidatePath('/settings/members');
}

// ---------------------------------------------------------------------------
// acceptInvite — used by the /invite/[token] page
// ---------------------------------------------------------------------------

export async function acceptInvite(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');

  const token = String(formData.get('token') ?? '');
  if (!token) throw new Error('Missing invite token');

  const invite = await prisma.workspaceInvite.findUnique({ where: { token } });
  if (!invite) throw new Error('Invite not found');
  if (invite.acceptedAt) throw new Error('That invite has already been used.');
  if (invite.expiresAt < new Date()) throw new Error('That invite has expired.');

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) throw new Error('Not signed in');
  if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw new Error(
      `This invite was sent to ${invite.email}. Sign in as that user to accept it.`,
    );
  }

  // Create the membership (or no-op if it already exists).
  await prisma.membership.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: invite.workspaceId } },
    update: {},
    create: {
      userId: user.id,
      workspaceId: invite.workspaceId,
      role: invite.role,
    },
  });

  await prisma.workspaceInvite.update({
    where: { id: invite.id },
    data: { acceptedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: invite.workspaceId,
      actorUserId: user.id,
      action: 'invite.accept',
      targetType: 'workspace_invite',
      targetId: invite.id,
      metadata: { email: invite.email, role: invite.role },
    },
  });

  // Make the newly-joined workspace the active one.
  await setActiveWorkspace(invite.workspaceId);
  redirect('/dashboard');
}

// ---------------------------------------------------------------------------
// Email template
// ---------------------------------------------------------------------------

function inviteHtml(o: {
  workspaceName: string;
  inviterName: string;
  role: MembershipRole;
  acceptUrl: string;
}) {
  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#fafaf9; padding:32px; color:#0f0f0d;">
  <div style="max-width:480px; margin:0 auto; background:white; border-radius:12px; padding:32px; border:1px solid #e7e7e2;">
    <p style="font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:#71716a; margin:0 0 8px;">Problem Context Store</p>
    <h1 style="font-size:20px; margin:0 0 12px;">You're invited to ${escapeHtml(o.workspaceName)}</h1>
    <p style="margin:0 0 24px; color:#3a3a35;">
      <strong>${escapeHtml(o.inviterName)}</strong> invited you to join the
      <strong>${escapeHtml(o.workspaceName)}</strong> workspace as <strong>${o.role}</strong>.
    </p>
    <a href="${o.acceptUrl}" style="display:inline-block; background:#0f0f0d; color:white; padding:12px 20px; border-radius:8px; text-decoration:none; font-weight:500;">Accept invite →</a>
    <p style="margin:32px 0 0; font-size:12px; color:#71716a;">If the button doesn't work, paste this URL into your browser:</p>
    <p style="word-break:break-all; font-size:12px; color:#71716a; font-family:'SF Mono', monospace; margin:4px 0 0;">${o.acceptUrl}</p>
    <p style="margin:32px 0 0; font-size:12px; color:#71716a;">This invite expires in 7 days. If you weren't expecting it, you can ignore this email.</p>
  </div>
</body></html>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
