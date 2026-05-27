import Link from 'next/link';
import { ExternalLink, StickyNote } from 'lucide-react';
import type { Event, ManualNote, ManualChannel, SourceKind, EventKind } from '@pcs/db';
import { SourceIcon, sourceLabel } from './SourceIcon';
import { relativeTime, absoluteTime } from '@/lib/format';
import { cn } from '@/lib/cn';

type TimelineEvent = Pick<
  Event,
  | 'id'
  | 'source'
  | 'sourceUrl'
  | 'kind'
  | 'timestamp'
  | 'actorName'
  | 'actorEmail'
  | 'body'
>;

type TimelineNote = Pick<
  ManualNote,
  'id' | 'title' | 'body' | 'channel' | 'occurredAt' | 'participants'
> & { authorName: string | null };

type Item =
  | { kind: 'event'; at: Date; event: TimelineEvent }
  | { kind: 'note'; at: Date; note: TimelineNote };

const CHANNEL_LABEL: Record<ManualChannel, string> = {
  HALLWAY: 'Hallway chat',
  PHONE_CALL: 'Phone call',
  WHATSAPP: 'WhatsApp',
  IN_PERSON_MEETING: 'In-person meeting',
  CUSTOMER_VISIT: 'Customer visit',
  CONFERENCE: 'Conference',
  TEXT_MESSAGE: 'Text message',
  OTHER: 'Other',
};

const EVENT_KIND_LABEL: Record<EventKind, string> = {
  MESSAGE: 'message',
  TICKET_CREATED: 'ticket created',
  TICKET_UPDATED: 'ticket updated',
  TICKET_RESOLVED: 'ticket resolved',
  PR_OPENED: 'PR opened',
  PR_MERGED: 'PR merged',
  PR_CLOSED: 'PR closed',
  COMMIT: 'commit',
  CALL_TRANSCRIPT: 'call transcript',
  EMAIL_SENT: 'email sent',
  EMAIL_RECEIVED: 'email received',
  DOC_UPDATED: 'doc updated',
  STATUS_CHANGE: 'status change',
  NOTE: 'note',
};

export function Timeline({
  events,
  notes,
}: {
  events: TimelineEvent[];
  notes: TimelineNote[];
}) {
  const items: Item[] = [
    ...events.map((e) => ({ kind: 'event' as const, at: new Date(e.timestamp), event: e })),
    ...notes.map((n) => ({ kind: 'note' as const, at: new Date(n.occurredAt), note: n })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
        No activity yet. Use Quick log (⌘K) to capture the first conversation.
      </div>
    );
  }

  return (
    <ol className="relative space-y-4 border-l-2 border-ink-200 pl-6">
      {items.map((item) => (
        <li key={`${item.kind}-${item.kind === 'event' ? item.event.id : item.note.id}`}>
          {item.kind === 'event' ? (
            <EventCard event={item.event} />
          ) : (
            <NoteCard note={item.note} />
          )}
        </li>
      ))}
    </ol>
  );
}

function EventCard({ event }: { event: TimelineEvent }) {
  return (
    <div className="relative">
      <span className="absolute -left-[33px] top-4">
        <SourceIcon source={event.source as SourceKind} />
      </span>
      <article className="rounded-lg border border-ink-200 bg-white p-4 shadow-sm">
        <header className="mb-2 flex items-baseline gap-2 text-xs text-ink-500">
          <span className="font-medium text-ink-900">{event.actorName ?? 'Unknown actor'}</span>
          <span>·</span>
          <span>{sourceLabel(event.source as SourceKind)}</span>
          <span>·</span>
          <span>{EVENT_KIND_LABEL[event.kind as EventKind]}</span>
          <span className="ml-auto" title={absoluteTime(event.timestamp)}>
            {relativeTime(event.timestamp)}
          </span>
        </header>
        <p className="whitespace-pre-wrap text-sm text-ink-700">{event.body}</p>
        {event.sourceUrl && (
          <a
            href={event.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
          >
            View in {sourceLabel(event.source as SourceKind)}
            <ExternalLink size={11} />
          </a>
        )}
      </article>
    </div>
  );
}

function NoteCard({ note }: { note: TimelineNote }) {
  const participants = Array.isArray(note.participants)
    ? (note.participants as Array<{ name?: string; role?: string }>)
    : [];

  return (
    <div className="relative">
      <span className="absolute -left-[33px] top-4">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
          <StickyNote size={14} strokeWidth={2.25} />
        </span>
      </span>
      <article
        className={cn(
          'rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 shadow-sm',
          'ring-1 ring-emerald-100',
        )}
      >
        <header className="mb-2 flex items-baseline gap-2 text-xs text-ink-500">
          <span className="font-medium text-ink-900">{note.authorName ?? 'Someone'}</span>
          <span>·</span>
          <span className="text-emerald-700">{CHANNEL_LABEL[note.channel as ManualChannel]}</span>
          <span className="ml-auto" title={absoluteTime(note.occurredAt)}>
            {relativeTime(note.occurredAt)}
          </span>
        </header>
        {note.title && <p className="mb-1 text-sm font-medium text-ink-900">{note.title}</p>}
        <p className="whitespace-pre-wrap text-sm text-ink-700">{note.body}</p>
        {participants.length > 0 && (
          <p className="mt-2 text-xs text-ink-500">
            <span className="font-medium">With:</span>{' '}
            {participants
              .map((p) => (p.role ? `${p.name} (${p.role})` : p.name))
              .filter(Boolean)
              .join(', ')}
          </p>
        )}
      </article>
    </div>
  );
}
