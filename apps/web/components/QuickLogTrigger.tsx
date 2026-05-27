'use client';

import { useEffect, useState } from 'react';
import { StickyNote } from 'lucide-react';
import { QuickLogSheet } from './QuickLogSheet';

/**
 * Topbar button that opens the Quick Log sheet.
 * Also listens for Cmd/Ctrl+K to open from anywhere.
 */
export function QuickLogTrigger({ defaultProblemId }: { defaultProblemId?: string } = {}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-white px-3 text-sm font-medium text-ink-900 ring-1 ring-inset ring-ink-200 hover:bg-ink-50"
      >
        <StickyNote size={14} />
        Quick log
        <kbd className="ml-1.5 hidden rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-mono text-ink-500 sm:inline">
          ⌘K
        </kbd>
      </button>

      <QuickLogSheet
        open={open}
        onOpenChange={setOpen}
        defaultProblemId={defaultProblemId}
      />
    </>
  );
}
