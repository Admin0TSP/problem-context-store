'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { QuickLogSheet } from './QuickLogSheet';

/**
 * Inline "Add manual note" button on a Problem detail page. Pre-attaches
 * the note to this problem.
 */
export function ProblemQuickLogButton({ problemId }: { problemId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-7 items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 text-xs font-medium text-white hover:bg-emerald-700"
      >
        <Plus size={13} />
        Add manual note
      </button>
      <QuickLogSheet open={open} onOpenChange={setOpen} defaultProblemId={problemId} />
    </>
  );
}
