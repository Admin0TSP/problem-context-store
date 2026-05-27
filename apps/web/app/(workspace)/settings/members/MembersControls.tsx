'use client';

import { MembershipRole } from '@pcs/db';
import { changeRole, removeMember } from '@/app/actions/members';
import { Badge } from '@/components/ui/Badge';

export function MembersControls({
  membershipId,
  userIsSelf,
  targetRole,
  currentUserRole,
  canManage,
}: {
  membershipId: string;
  userIsSelf: boolean;
  targetRole: MembershipRole;
  currentUserRole: MembershipRole;
  canManage: boolean;
}) {
  const isOwner = currentUserRole === MembershipRole.OWNER;
  const canEdit = canManage && !userIsSelf && (isOwner || targetRole !== MembershipRole.OWNER);

  if (!canEdit) {
    return <Badge tone={targetRole === MembershipRole.OWNER ? 'info' : 'muted'}>{targetRole.toLowerCase()}</Badge>;
  }

  return (
    <div className="flex items-center gap-2">
      <form action={changeRole} className="flex items-center">
        <input type="hidden" name="membershipId" value={membershipId} />
        <select
          name="role"
          defaultValue={targetRole}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="h-7 rounded-md border border-ink-200 bg-white px-2 text-xs text-ink-700 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value={MembershipRole.VIEWER}>Viewer</option>
          <option value={MembershipRole.MEMBER}>Member</option>
          <option value={MembershipRole.ADMIN}>Admin</option>
          {isOwner && <option value={MembershipRole.OWNER}>Owner</option>}
        </select>
      </form>
      <form action={removeMember}>
        <input type="hidden" name="membershipId" value={membershipId} />
        <button
          type="submit"
          className="text-xs text-red-600 hover:underline"
          onClick={(e) => {
            if (!confirm('Remove this member from the workspace?')) e.preventDefault();
          }}
        >
          Remove
        </button>
      </form>
    </div>
  );
}
