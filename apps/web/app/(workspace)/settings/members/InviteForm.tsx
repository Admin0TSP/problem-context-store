'use client';

import { useState, useTransition } from 'react';
import { MembershipRole } from '@pcs/db';
import { inviteMember, type InviteState } from '@/app/actions/members';
import { Label, Input, Select, FieldHint } from '@/components/ui/FormField';
import { Button } from '@/components/ui/Button';

export function InviteForm({ canInviteOwner }: { canInviteOwner: boolean }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<InviteState | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData: FormData) => {
        startTransition(async () => {
          const result = await inviteMember(null, formData);
          setState(result);
          if (result.ok) setEmail('');
        });
      }}
      className="mt-4 flex flex-wrap items-end gap-3"
    >
      <div className="flex-1 min-w-[200px]">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          placeholder="teammate@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="w-32">
        <Label htmlFor="role">Role</Label>
        <Select id="role" name="role" defaultValue={MembershipRole.MEMBER}>
          <option value={MembershipRole.VIEWER}>Viewer</option>
          <option value={MembershipRole.MEMBER}>Member</option>
          <option value={MembershipRole.ADMIN}>Admin</option>
          {canInviteOwner && <option value={MembershipRole.OWNER}>Owner</option>}
        </Select>
      </div>
      <Button type="submit" disabled={pending || email.length < 3}>
        {pending ? 'Sending…' : 'Send invite'}
      </Button>
      {state && (
        <div className="w-full">
          {state.ok ? (
            <FieldHint>Invite sent.</FieldHint>
          ) : (
            <FieldHint tone="danger">{state.error}</FieldHint>
          )}
        </div>
      )}
    </form>
  );
}
