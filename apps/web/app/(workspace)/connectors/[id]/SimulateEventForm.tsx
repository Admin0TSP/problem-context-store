'use client';

import { useState, useTransition } from 'react';
import { SourceKind } from '@pcs/db';
import { simulateEvent, type SimulateState } from '@/app/actions/ingest';
import { Label, Input, Textarea, Select, FieldHint } from '@/components/ui/FormField';
import { Button } from '@/components/ui/Button';

const SOURCES: SourceKind[] = [
  'STUB' as SourceKind,
  'SLACK' as SourceKind,
  'DEVREV' as SourceKind,
  'GITHUB' as SourceKind,
  'GMAIL' as SourceKind,
  'EMAIL_IN' as SourceKind,
  'WEB_CLIP' as SourceKind,
  'PHONE_CALL' as SourceKind,
];

const KINDS = [
  'MESSAGE',
  'TICKET_CREATED',
  'TICKET_UPDATED',
  'TICKET_RESOLVED',
  'PR_OPENED',
  'PR_MERGED',
  'EMAIL_RECEIVED',
  'EMAIL_SENT',
  'STATUS_CHANGE',
  'NOTE',
];

export function SimulateEventForm({
  instanceId,
  clients,
  problems,
}: {
  instanceId: string;
  clients: Array<{ id: string; name: string }>;
  problems: Array<{ id: string; title: string; client: { name: string } }>;
}) {
  const [state, setState] = useState<SimulateState | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData: FormData) => {
        startTransition(async () => {
          const result = await simulateEvent(null, formData);
          setState(result);
          if (result.ok) (document.getElementById('body') as HTMLTextAreaElement).value = '';
        });
      }}
      className="mt-4 space-y-3"
    >
      <input type="hidden" name="instanceId" value={instanceId} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="source">Source</Label>
          <Select id="source" name="source" defaultValue="STUB">
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {String(s)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="kind">Event kind</Label>
          <Select id="kind" name="kind" defaultValue="MESSAGE">
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k.toLowerCase().replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="body">Body</Label>
        <Textarea
          id="body"
          name="body"
          rows={4}
          required
          placeholder="Hi team, hitting the COD reconciliation issue again on the Mumbai hub…"
        />
        <FieldHint>
          Include <code>#PRB-&lt;problemId&gt;</code> to test the explicit-reference rule.
        </FieldHint>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="actorName">Actor name</Label>
          <Input id="actorName" name="actorName" placeholder="Rajesh (Acme)" />
        </div>
        <div>
          <Label htmlFor="actorEmail">Actor email</Label>
          <Input
            id="actorEmail"
            name="actorEmail"
            type="email"
            placeholder="rajesh@acmelogistics.com"
          />
          <FieldHint>Domain auto-matches to a Client.</FieldHint>
        </div>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-ink-500 hover:text-ink-700">
          Optional: explicit hints (forces resolution)
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="clientHint">Client</Label>
            <Select id="clientHint" name="clientHint" defaultValue="">
              <option value="">(auto-detect)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="problemHint">Problem</Label>
            <Select id="problemHint" name="problemHint" defaultValue="">
              <option value="">(auto-detect)</option>
              {problems.map((p) => (
                <option key={p.id} value={p.id}>
                  [{p.client.name}] {p.title}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </details>

      <div className="flex items-center justify-between pt-1">
        {state?.ok ? (
          <p className="text-xs text-severity-low">
            Ingested {state.ingested} · resolved {state.resolved} · duplicates {state.duplicates}
          </p>
        ) : state && !state.ok ? (
          <p className="text-xs text-red-600">{state.error}</p>
        ) : (
          <span className="text-xs text-ink-500">Submit to send through the pipeline.</span>
        )}
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Sending…' : 'Send through pipeline'}
        </Button>
      </div>
    </form>
  );
}
