import {
  MessageSquare,
  TicketCheck,
  GitPullRequest,
  Mail,
  FileText,
  Mic,
  StickyNote,
  Inbox,
  Globe,
  Phone,
  CircleDot,
} from 'lucide-react';
import type { SourceKind } from '@pcs/db';
import { cn } from '@/lib/cn';

const ICONS: Record<SourceKind, { icon: typeof MessageSquare; tone: string; label: string }> = {
  SLACK: { icon: MessageSquare, tone: 'text-purple-600 bg-purple-50', label: 'Slack' },
  DEVREV: { icon: TicketCheck, tone: 'text-indigo-600 bg-indigo-50', label: 'DevRev' },
  GITHUB: { icon: GitPullRequest, tone: 'text-ink-900 bg-ink-100', label: 'GitHub' },
  GMAIL: { icon: Mail, tone: 'text-red-600 bg-red-50', label: 'Gmail' },
  GOOGLE_DRIVE: { icon: FileText, tone: 'text-amber-600 bg-amber-50', label: 'Drive' },
  MEETING_TRANSCRIPT: { icon: Mic, tone: 'text-blue-600 bg-blue-50', label: 'Meeting' },
  MANUAL_NOTE: { icon: StickyNote, tone: 'text-emerald-700 bg-emerald-50', label: 'Note' },
  EMAIL_IN: { icon: Inbox, tone: 'text-cyan-700 bg-cyan-50', label: 'Email-in' },
  WEB_CLIP: { icon: Globe, tone: 'text-slate-600 bg-slate-100', label: 'Web' },
  PHONE_CALL: { icon: Phone, tone: 'text-teal-700 bg-teal-50', label: 'Call' },
};

export function SourceIcon({
  source,
  size = 'md',
  withLabel = false,
}: {
  source: SourceKind;
  size?: 'sm' | 'md';
  withLabel?: boolean;
}) {
  const meta = ICONS[source] ?? { icon: CircleDot, tone: 'text-ink-500 bg-ink-100', label: source };
  const Icon = meta.icon;
  const sizes = size === 'sm' ? 'h-5 w-5' : 'h-7 w-7';
  const iconSize = size === 'sm' ? 12 : 14;

  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-md',
          sizes,
          meta.tone,
        )}
        title={meta.label}
      >
        <Icon size={iconSize} strokeWidth={2.25} />
      </span>
      {withLabel && <span className="text-xs text-ink-500">{meta.label}</span>}
    </span>
  );
}

export function sourceLabel(source: SourceKind): string {
  return ICONS[source]?.label ?? source;
}
