'use client';

import { useState, useTransition } from 'react';
import { Check, ArrowRightLeft, Plus, X } from 'lucide-react';
import { Severity } from '@pcs/db';
import {
  confirmResolution,
  moveEventToProblem,
  dismissEvent,
  spawnProblemFromEvent,
} from '@/app/actions/resolution';
import { Select, Input, Label } from '@/components/ui/FormField';
import { Button } from '@/components/ui/Button';

type Client = { id: string; name: string };
type Problem = { id: string; title: string; client: { id: string; name: string } };

export function TriageActions({
  mode,
  eventId,
  clientId,
  currentProblemId,
  clients,
  candidateProblems,
}: {
  mode: 'attach' | 'confirm';
  eventId: string;
  clientId?: string;
  currentProblemId?: string;
  clients: Client[];
  candidateProblems: Problem[];
}) {
  const [pending, startTransition] = useTransition();
  const [overlay, setOverlay] = useState<null | 'spawn' | 'move'>(null);
  const [moveProblemId, setMoveProblemId] = useState('');

  function onConfirm() {
    const fd = new FormData();
    fd.set('eventId', eventId);
    startTransition(() => confirmResolution(fd));
  }
  function onDismiss() {
    if (!confirm('Dismiss this event? It stays in the audit log but disappears from the inbox.'))
      return;
    const fd = new FormData();
    fd.set('eventId', eventId);
    startTransition(() => dismissEvent(fd));
  }
  function onMove() {
    if (!moveProblemId) return;
    const fd = new FormData();
    fd.set('eventId', eventId);
    fd.set('problemId', moveProblemId);
    startTransition(() => moveEventToProblem(fd));
  }

  if (overlay === 'spawn') {
    return (
      <SpawnForm
        eventId={eventId}
        clients={clients}
        defaultClientId={clientId}
        onCancel={() => setOverlay(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Select
          value={moveProblemId}
          onChange={(e) => setMoveProblemId(e.target.value)}
          disabled={pending || candidateProblems.length === 0}
        >
          <option value="" disabled>
            {candidateProblems.length === 0 ? 'No matching problems' : 'Choose Problem…'}
          </option>
          {candidateProblems.map((p) => (
            <option key={p.id} value={p.id} disabled={p.id === currentProblemId}>
              [{p.client.name}] {p.title}
              {p.id === currentProblemId ? ' (current)' : ''}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          size="sm"
          onClick={onMove}
          disabled={pending || !moveProblemId || moveProblemId === currentProblemId}
        >
          <ArrowRightLeft size={12} />
          {mode === 'confirm' ? 'Move' : 'Attach'}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        {mode === 'confirm' && (
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-2.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:bg-emerald-300"
          >
            <Check size={12} /> Confirm
          </button>
        )}
        <button
          type="button"
          onClick={() => setOverlay('spawn')}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-white px-2.5 text-xs font-medium text-ink-900 ring-1 ring-inset ring-ink-200 hover:bg-ink-50"
        >
          <Plus size={12} /> New Problem
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-red-600 hover:bg-red-50"
        >
          <X size={12} /> Dismiss
        </button>
      </div>
    </div>
  );
}

function SpawnForm({
  eventId,
  clients,
  defaultClientId,
  onCancel,
}: {
  eventId: string;
  clients: Client[];
  defaultClientId?: string;
  onCancel: () => void;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData: FormData) => {
        startTransition(() => spawnProblemFromEvent(formData));
      }}
      className="space-y-2 rounded-md border border-ink-200 bg-ink-50 p-3"
    >
      <input type="hidden" name="eventId" value={eventId} />
      <div>
        <Label htmlFor="title">New Problem title</Label>
        <Input id="title" name="title" required placeholder="Short, customer-facing title" autoFocus />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="clientId">Client</Label>
          <Select id="clientId" name="clientId" required defaultValue={defaultClientId ?? ''}>
            <option value="" disabled>
              Choose…
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="severity">Severity</Label>
          <Select id="severity" name="severity" defaultValue={Severity.MEDIUM}>
            {Object.values(Severity).map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Spawning…' : 'Spawn'}
        </Button>
      </div>
    </form>
  );
}
