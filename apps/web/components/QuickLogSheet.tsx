'use client';

import { useEffect, useState } from 'react';
import { X, StickyNote } from 'lucide-react';
import { ManualChannel } from '@pcs/db';
import { createManualNote, type CreateNoteState } from '@/app/actions/notes';
import { Label, Input, Textarea, Select, FieldHint } from './ui/FormField';
import { Button } from './ui/Button';

type QuickLogProblem = { id: string; title: string; clientName?: string };

/**
 * Quick Log sheet — the first-class manual capture surface.
 *
 * Keep this fast and forgiving:
 *  - Body is the only required field.
 *  - Channel defaults to OTHER; user can tweak.
 *  - occurredAt defaults to "now" (handled server-side).
 *  - problemId optional — note can stand alone.
 */
export function QuickLogSheet({
  open,
  onOpenChange,
  defaultProblemId,
  problems = [],
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultProblemId?: string;
  problems?: QuickLogProblem[];
}) {
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<CreateNoteState | null>(null);
  const [body, setBody] = useState('');

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  // Reset form when re-opening
  useEffect(() => {
    if (open) {
      setBody('');
      setState(null);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      {/* Sheet */}
      <div className="absolute left-1/2 top-[12vh] w-[min(640px,92vw)] -translate-x-1/2 rounded-xl bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-ink-200 px-5 py-3">
          <StickyNote size={16} className="text-emerald-700" />
          <h2 className="text-sm font-semibold text-ink-900">Quick log</h2>
          <span className="text-xs text-ink-500">
            Capture a conversation that didn't happen in a tool.
          </span>
          <button
            onClick={() => onOpenChange(false)}
            className="ml-auto rounded-md p-1 text-ink-500 hover:bg-ink-100"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <form
          action={async (formData: FormData) => {
            setPending(true);
            try {
              const result = await createManualNote(null, formData);
              setState(result);
              if (result.ok) {
                setBody('');
                // Give the user a beat to see the confirmation, then close.
                setTimeout(() => onOpenChange(false), 600);
              }
            } finally {
              setPending(false);
            }
          }}
          className="space-y-3 px-5 py-4"
        >
          <div>
            <Label htmlFor="body">What happened?</Label>
            <Textarea
              id="body"
              name="body"
              rows={6}
              autoFocus
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Spoke with Rajesh at Acme — confirmed they'll hold off on RCA until our fix lands…"
              required
            />
            {state && !state.ok && state.fieldErrors?.body && (
              <FieldHint tone="danger">{state.fieldErrors.body}</FieldHint>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="channel">Channel</Label>
              <Select id="channel" name="channel" defaultValue={ManualChannel.OTHER}>
                <option value={ManualChannel.PHONE_CALL}>Phone call</option>
                <option value={ManualChannel.IN_PERSON_MEETING}>In-person meeting</option>
                <option value={ManualChannel.WHATSAPP}>WhatsApp</option>
                <option value={ManualChannel.HALLWAY}>Hallway</option>
                <option value={ManualChannel.CUSTOMER_VISIT}>Customer visit</option>
                <option value={ManualChannel.CONFERENCE}>Conference</option>
                <option value={ManualChannel.TEXT_MESSAGE}>Text message</option>
                <option value={ManualChannel.OTHER}>Other</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="problemId">Attach to problem (optional)</Label>
              <Select
                id="problemId"
                name="problemId"
                defaultValue={defaultProblemId ?? ''}
                disabled={problems.length === 0 && !defaultProblemId}
              >
                <option value="">— unattached —</option>
                {defaultProblemId && !problems.find((p) => p.id === defaultProblemId) && (
                  <option value={defaultProblemId}>This problem</option>
                )}
                {problems.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.clientName ? `[${p.clientName}] ` : ''}
                    {p.title}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="participants">Participants</Label>
              <Input
                id="participants"
                name="participants"
                placeholder="Rajesh (Acme), Priya"
              />
            </div>
            <div>
              <Label htmlFor="title">Title (optional)</Label>
              <Input id="title" name="title" placeholder="Call with Rajesh re: COD" />
            </div>
          </div>

          <input type="hidden" name="occurredAt" value={new Date().toISOString()} />

          <div className="flex items-center justify-between pt-2">
            {state?.ok ? (
              <p className="text-xs text-severity-low">Saved ✓</p>
            ) : state && !state.ok ? (
              <p className="text-xs text-red-600">{state.error}</p>
            ) : (
              <p className="text-xs text-ink-500">
                Press <kbd className="rounded bg-ink-100 px-1 py-0.5 text-[10px]">Esc</kbd> to
                cancel
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || body.trim().length < 2}>
                {pending ? 'Saving…' : 'Save note'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
