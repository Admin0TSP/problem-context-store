import * as React from 'react';
import { cn } from '@/lib/cn';

export function Label({
  children,
  htmlFor,
  className,
}: {
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn('mb-1.5 block text-sm font-medium text-ink-700', className)}
    >
      {children}
    </label>
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn(
        'block w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900',
        'placeholder:text-ink-500',
        'focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent',
        'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-500',
        className,
      )}
      {...props}
    />
  );
});
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        'block w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900',
        'placeholder:text-ink-500',
        'focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent',
        'disabled:cursor-not-allowed disabled:bg-ink-50',
        className,
      )}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => {
  return (
    <select
      ref={ref}
      className={cn(
        'block w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900',
        'focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent',
        'disabled:cursor-not-allowed disabled:bg-ink-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});
Select.displayName = 'Select';

export function FieldHint({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'danger';
}) {
  return (
    <p
      className={cn(
        'mt-1 text-xs',
        tone === 'danger' ? 'text-red-600' : 'text-ink-500',
      )}
    >
      {children}
    </p>
  );
}
