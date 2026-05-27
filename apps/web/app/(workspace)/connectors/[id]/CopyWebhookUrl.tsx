'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export function CopyWebhookUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-3 flex items-center gap-2 rounded-md border border-ink-200 bg-ink-50 px-3 py-2">
      <code className="flex-1 truncate font-mono text-xs text-ink-700">{url}</code>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="inline-flex h-7 items-center gap-1 rounded bg-white px-2 text-xs font-medium text-ink-700 ring-1 ring-inset ring-ink-200 hover:bg-ink-100"
      >
        {copied ? (
          <>
            <Check size={12} /> Copied
          </>
        ) : (
          <>
            <Copy size={12} /> Copy
          </>
        )}
      </button>
    </div>
  );
}
