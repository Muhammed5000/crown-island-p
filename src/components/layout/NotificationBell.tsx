'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BellIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relative-time';
import {
  listCustomerNotificationsAction,
  markCustomerNotificationsReadAction,
  type CustomerNotificationsResult,
} from '@/features/notifications/actions';

/**
 * Customer notification bell + dropdown. Mirrors the staff OpsBell but uses the
 * app's theme tokens and locale. Self-fetches on mount and polls every 60s;
 * clicking a row marks it read and follows its deep link. Mounted in the app
 * header and the desktop rail for signed-in customers.
 */
const POLL_MS = 60_000;

type Row = Extract<CustomerNotificationsResult, { ok: true }>['rows'][number];

export function NotificationBell({
  className,
  variant = 'menu',
}: {
  className?: string;
  /** 'menu' = dropdown (top bar); 'link' = badge that opens the full page (rail). */
  variant?: 'menu' | 'link';
}) {
  const t = useTranslations('notifications');
  const locale = useLocale();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const res = await listCustomerNotificationsAction();
    if (res.ok) {
      setRows(res.rows);
      setUnread(res.unread);
    }
  }, []);

  useEffect(() => {
    // Legitimate external sync: fetch the inbox on mount and poll every 60s.
    // setState happens after the await, not synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const h = setInterval(refresh, POLL_MS);
    return () => clearInterval(h);
  }, [refresh]);

  // Dismiss on outside click / Escape (menu variant only).
  useEffect(() => {
    if (variant !== 'menu' || !open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, variant]);

  const title = (r: Row) => (locale === 'ar' ? r.titleAr : r.titleEn);
  const body = (r: Row) => (locale === 'ar' ? r.bodyAr : r.bodyEn);

  const markAll = async () => {
    setUnread(0);
    setRows((rs) => rs.map((r) => ({ ...r, readAt: r.readAt ?? new Date() })));
    await markCustomerNotificationsReadAction('all');
    void refresh();
  };

  const openRow = (r: Row) => {
    setOpen(false);
    if (!r.readAt) void markCustomerNotificationsReadAction([r.id]).then(refresh);
    router.push(`/notifications/${r.id}`);
  };

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => {
          if (variant === 'link') {
            router.push('/notifications');
            return;
          }
          setOpen((o) => !o);
          if (!open) void refresh();
        }}
        aria-label={t('ariaLabelCount', { count: unread })}
        aria-haspopup={variant === 'menu' ? 'menu' : undefined}
        aria-expanded={variant === 'menu' ? open : undefined}
        className="relative grid size-9 place-items-center rounded-full bg-muted text-foreground transition-colors hover:bg-muted/70"
      >
        <BellIcon className="size-4" aria-hidden />
        {unread > 0 ? (
          <span className="absolute -end-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>

      {variant === 'menu' && open ? (
        <div
          role="menu"
          className="absolute end-0 top-11 z-[80] max-h-[460px] w-[min(360px,90vw)] overflow-y-auto rounded-2xl border border-border bg-card shadow-[0_16px_50px_rgba(20,33,50,0.18)]"
        >
          <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {t('heading')}
            </span>
            {unread > 0 ? (
              <button
                type="button"
                onClick={markAll}
                className="text-xs font-medium text-accent hover:underline"
              >
                {t('markAllRead')}
              </button>
            ) : null}
          </div>

          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t('inboxEmpty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => openRow(r)}
                    className={cn(
                      'block w-full px-4 py-3 text-start transition-colors hover:bg-muted/60',
                      !r.readAt && 'bg-accent/5',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {!r.readAt ? (
                        <span className="size-2 shrink-0 rounded-full bg-gold-500" aria-hidden />
                      ) : null}
                      <span className="truncate text-sm font-semibold text-foreground">
                        {title(r)}
                      </span>
                    </div>
                    {body(r) ? (
                      <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {body(r)}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-muted-foreground/80">
                      {relativeTime(r.createdAt, locale)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-border p-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push('/notifications');
              }}
              className="block w-full rounded-lg px-3 py-2 text-center text-xs font-semibold text-accent hover:bg-muted/60"
            >
              {t('seeAll')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
