'use client';

import { useState, useTransition } from 'react';
import { Sparkles } from 'lucide-react';
import { backfillEmbeddings } from '@/app/actions/resolution';
import { Button } from '@/components/ui/Button';

export function BackfillEmbeddingsButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | { ok: true; problemsEmbedded: number; eventsEmbedded: number }
    | { ok: false; error: string }
    | null
  >(null);

  return (
    <div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const r = await backfillEmbeddings();
            setResult(r);
          });
        }}
      >
        <Sparkles size={14} />
        {pending ? 'Embedding…' : 'Backfill embeddings'}
      </Button>
      {result && (
        <p className="mt-2 text-xs">
          {result.ok ? (
            <span className="text-emerald-700">
              Embedded {result.problemsEmbedded} problems + {result.eventsEmbedded} events.
            </span>
          ) : (
            <span className="text-red-600">{result.error}</span>
          )}
        </p>
      )}
    </div>
  );
}
