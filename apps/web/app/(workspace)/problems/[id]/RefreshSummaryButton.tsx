'use client';

import { useState, useTransition } from 'react';
import { Sparkles } from 'lucide-react';
import { generateProblemSummary, type GenerateSummaryResult } from '@/app/actions/summarize';
import { Button } from '@/components/ui/Button';

export function RefreshSummaryButton({
  problemId,
  hasSummary,
  isStale,
}: {
  problemId: string;
  hasSummary: boolean;
  isStale: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<GenerateSummaryResult | null>(null);

  const label = pending
    ? 'Summarizing…'
    : hasSummary
      ? isStale
        ? 'Regenerate (stale)'
        : 'Regenerate summary'
      : 'Generate summary';

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const fd = new FormData();
            fd.append('problemId', problemId);
            const r = await generateProblemSummary(fd);
            setResult(r);
          });
        }}
      >
        <Sparkles size={14} />
        {label}
      </Button>
      {result && !result.ok && (
        <p className="text-xs text-red-600">
          {humanizeError(result)}
        </p>
      )}
      {result && result.ok && (
        <p className="text-xs text-emerald-700">
          Done in {(result.elapsedMs / 1000).toFixed(1)}s · confidence {(result.confidence * 100).toFixed(0)}% ·{' '}
          {result.basis}
        </p>
      )}
    </div>
  );
}

function humanizeError(r: { error: string; code: string }): string {
  switch (r.code) {
    case 'no_llm':
      return 'No LLM provider configured. Set OLLAMA_BASE_URL (free, local) or ANTHROPIC_API_KEY in .env.';
    case 'no_evidence':
      return 'Nothing to summarize yet. Attach at least one event or manual note first.';
    case 'llm_failed':
      return `LLM call failed: ${r.error}`;
    case 'parse_failed':
      return `Could not parse the LLM response — model may have rambled. ${r.error.slice(0, 200)}`;
    case 'forbidden':
      return 'You do not have permission to summarize Problems in this workspace.';
    default:
      return r.error;
  }
}
