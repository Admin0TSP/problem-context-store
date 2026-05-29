'use client';

import { useState, useTransition } from 'react';
import { RefreshCcw } from 'lucide-react';
import { syncGmailInstance, type SyncGmailResult } from '@/app/actions/gmail';
import { Button } from '@/components/ui/Button';

export function SyncGmailButton({ instanceId }: { instanceId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SyncGmailResult | null>(null);

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
            fd.append('instanceId', instanceId);
            const r = await syncGmailInstance(fd);
            setResult(r);
          });
        }}
      >
        <RefreshCcw size={14} className={pending ? 'animate-spin' : ''} />
        {pending ? 'Syncing…' : 'Sync now'}
      </Button>
      {result && result.ok && (
        <p className="text-xs text-emerald-700">
          Fetched {result.fetched} message{result.fetched === 1 ? '' : 's'} · enqueued{' '}
          {result.enqueued} for processing · {(result.durationMs / 1000).toFixed(1)}s
        </p>
      )}
      {result && !result.ok && (
        <p className="text-xs text-red-600">{humanize(result)}</p>
      )}
    </div>
  );
}

function humanize(r: { error: string; code: string }): string {
  switch (r.code) {
    case 'not_found':
      return 'Gmail instance not found in this workspace.';
    case 'no_token':
      return `${r.error} — re-install via "Add to Gmail" on /connectors/new.`;
    case 'forbidden':
      return 'You do not have permission to sync this connector.';
    case 'gmail_api':
      return `Gmail API error: ${r.error}`;
    default:
      return r.error;
  }
}
