import type { ProblemStatus, Severity } from '@pcs/db';
import { Badge } from './ui/Badge';

const STATUS: Record<ProblemStatus, { label: string; tone: 'neutral' | 'info' | 'warn' | 'success' | 'muted' }> = {
  OPEN: { label: 'Open', tone: 'warn' },
  INVESTIGATING: { label: 'Investigating', tone: 'info' },
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  AWAITING_CUSTOMER: { label: 'Awaiting customer', tone: 'muted' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'muted' },
  ARCHIVED: { label: 'Archived', tone: 'muted' },
};

const SEVERITY: Record<Severity, { label: string; tone: 'neutral' | 'info' | 'warn' | 'success' | 'muted' | 'danger' }> = {
  LOW: { label: 'Low', tone: 'muted' },
  MEDIUM: { label: 'Medium', tone: 'warn' },
  HIGH: { label: 'High', tone: 'warn' },
  CRITICAL: { label: 'Critical', tone: 'danger' },
};

export function StatusBadge({ status }: { status: ProblemStatus }) {
  const s = STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
