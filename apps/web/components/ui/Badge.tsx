import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'info' | 'warn' | 'success' | 'muted' | 'danger';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-700 ring-ink-200',
  info: 'bg-blue-50 text-blue-800 ring-blue-200',
  warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  success: 'bg-green-50 text-green-800 ring-green-200',
  muted: 'bg-ink-100 text-ink-500 ring-ink-200',
  danger: 'bg-red-50 text-red-800 ring-red-200',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
