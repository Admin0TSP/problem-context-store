'use client';

import { useEffect, useRef, useState } from 'react';
import { LogOut, ChevronUp } from 'lucide-react';
import { signOutAction } from '@/app/actions/auth';
import { initials } from '@/lib/format';

export function UserMenu({
  user,
}: {
  user: { name: string | null; email: string };
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
        className="flex w-full items-center gap-2.5 rounded-md p-1.5 hover:bg-ink-100"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white">
          {initials(user.name ?? user.email)}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-xs font-medium text-ink-900">{user.name ?? 'You'}</span>
          <span className="block truncate text-[11px] text-ink-500">{user.email}</span>
        </span>
        <ChevronUp size={14} className="text-ink-500" />
      </button>

      {open && (
        <div className="absolute bottom-[calc(100%+4px)] left-0 right-0 z-30 rounded-lg border border-ink-200 bg-white p-1 shadow-lg">
          <form action={signOutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-700 hover:bg-ink-100"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
