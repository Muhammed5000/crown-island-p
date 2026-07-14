'use client';

import { useState } from 'react';
import { BellIcon, CheckIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Support — "notify me when live chat is available" toggle.
 *
 * The only interactive bit of the (otherwise server-rendered) support page, so
 * it lives in its own client island. Labels are passed in already-translated —
 * no strings are hardcoded here. Colours use theme tokens (`.bg-gold-button` /
 * `.text-ink` / `success`) so it reads correctly in both light and dark.
 */
interface Props {
  notifyLabel: string;
  notifiedLabel: string;
}

export function NotifyButton({ notifyLabel, notifiedLabel }: Props) {
  const [notified, setNotified] = useState(false);

  return (
    <button
      type="button"
      onClick={() => setNotified((v) => !v)}
      aria-pressed={notified}
      className={cn(
        'mt-7 inline-flex h-[52px] items-center justify-center gap-2.5 rounded-full px-7',
        'text-[15px] font-bold transition-all duration-200 active:scale-[0.98]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        notified
          ? 'border border-success/45 bg-success/10 text-foreground'
          : 'bg-gold-button text-ink shadow-gold hover:brightness-[1.03]',
      )}
    >
      {notified ? (
        <>
          <CheckIcon className="size-[18px] text-success" strokeWidth={2.4} aria-hidden />
          {notifiedLabel}
        </>
      ) : (
        <>
          <BellIcon className="size-[18px]" strokeWidth={2} aria-hidden />
          {notifyLabel}
        </>
      )}
    </button>
  );
}
