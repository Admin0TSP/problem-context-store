'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { QuickLogTrigger } from './QuickLogTrigger';

export function Topbar({
  title,
  subtitle,
  primaryAction,
}: {
  title: string;
  subtitle?: string;
  primaryAction?: { label: string; href: string };
}) {
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-ink-200 bg-white/80 px-6 backdrop-blur">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold text-ink-900">{title}</h1>
        {subtitle && <p className="truncate text-xs text-ink-500">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        <QuickLogTrigger />
        {primaryAction && (
          <Link
            href={primaryAction.href}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-ink-900 px-3.5 text-sm font-medium text-white hover:bg-ink-700"
          >
            <Plus size={14} />
            {primaryAction.label}
          </Link>
        )}
      </div>
    </header>
  );
}
