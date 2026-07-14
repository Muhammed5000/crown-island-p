'use client';

import { cn } from '@/lib/cn';

/**
 * Switch / toggle — accessible (role="switch"), RTL-aware, theme-tokened.
 * Gold when on, muted when off. Controlled: pass `checked` + `onChange`.
 */
interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}

export function Toggle({ checked, onChange, disabled, id, ...aria }: ToggleProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-gold-500' : 'bg-muted-foreground/30',
      )}
      {...aria}
    >
      <span
        className={cn(
          'inline-block size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-transform',
          checked ? 'ltr:translate-x-[22px] rtl:-translate-x-[22px]' : 'ltr:translate-x-[3px] rtl:-translate-x-[3px]',
        )}
      />
    </button>
  );
}
