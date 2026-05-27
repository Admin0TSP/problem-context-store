'use client';

import { useState, useTransition } from 'react';
import { createWorkspace, type CreateWorkspaceState } from '@/app/actions/workspaces';
import { Label, Input, FieldHint } from '@/components/ui/FormField';
import { Button } from '@/components/ui/Button';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function CreateWorkspaceForm() {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugDirty, setSlugDirty] = useState(false);
  const [state, setState] = useState<CreateWorkspaceState | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData: FormData) => {
        startTransition(async () => {
          const result = await createWorkspace(null, formData);
          setState(result);
        });
      }}
      className="mt-5 space-y-3"
    >
      <div>
        <Label htmlFor="name">Workspace name</Label>
        <Input
          id="name"
          name="name"
          required
          autoFocus
          placeholder="e.g. Shipsy"
          value={name}
          onChange={(e) => {
            const v = e.target.value;
            setName(v);
            if (!slugDirty) setSlug(slugify(v));
          }}
        />
        {state && !state.ok && state.fieldErrors?.name && (
          <FieldHint tone="danger">{state.fieldErrors.name}</FieldHint>
        )}
      </div>
      <div>
        <Label htmlFor="slug">URL slug</Label>
        <Input
          id="slug"
          name="slug"
          required
          placeholder="shipsy"
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugDirty(true);
          }}
        />
        <FieldHint>Lowercase letters, numbers, and dashes. Used in URLs.</FieldHint>
        {state && !state.ok && state.fieldErrors?.slug && (
          <FieldHint tone="danger">{state.fieldErrors.slug}</FieldHint>
        )}
      </div>
      {state && !state.ok && !state.fieldErrors && (
        <p className="text-xs text-red-600">{state.error}</p>
      )}
      <Button type="submit" className="w-full" disabled={pending || name.length < 2 || slug.length < 2}>
        {pending ? 'Creating…' : 'Create workspace'}
      </Button>
    </form>
  );
}
