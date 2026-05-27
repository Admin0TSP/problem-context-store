'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { switchWorkspace } from '@/app/actions/workspaces';
import { initials } from '@/lib/format';

type WorkspaceOption = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

export function WorkspaceSwitcher({
  active,
  workspaces,
}: {
  active: WorkspaceOption;
  workspaces: WorkspaceOption[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-ink-100"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-ink-900 text-xs font-semibold text-white">
          {initials(active.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink-900">{active.name}</span>
          <span className="block truncate text-[11px] text-ink-500">/{active.slug}</span>
        </span>
        <ChevronsUpDown size={14} className="text-ink-500" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 rounded-lg border border-ink-200 bg-white p-1 shadow-lg">
          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Workspaces
          </p>
          {workspaces.map((w) => (
            <form
              key={w.id}
              action={async (formData) => {
                await switchWorkspace(formData);
              }}
            >
              <input type="hidden" name="workspaceId" value={w.id} />
              <button
                type="submit"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-ink-100"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded bg-ink-100 text-[10px] font-semibold text-ink-700">
                  {initials(w.name)}
                </span>
                <span className="flex-1 truncate text-ink-900">{w.name}</span>
                <span className="text-[10px] uppercase tracking-wider text-ink-500">{w.role.toLowerCase()}</span>
                {w.id === active.id && <Check size={14} className="text-accent" />}
              </button>
            </form>
          ))}
          <div className="my-1 h-px bg-ink-200" />
          <Link
            href="/workspaces/new"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
          >
            <Plus size={14} />
            Create workspace
          </Link>
        </div>
      )}
    </div>
  );
}
