'use client';

import { BellIcon, CheckIcon, XIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relative-time';
import {
  listCustomerNotificationsAction,
  markCustomerNotificationsReadAction,
  type CustomerNotificationsResult,
} from '@/features/notifications/actions';
import type { Locale } from '@/i18n/config';
import type { BookingStatus } from '@prisma/client';

export interface UpcomingBookingForNotification {
  id: string;
  reference: string;
  status: BookingStatus;
  serviceNameEn: string;
  serviceNameAr: string;
  categoryNameEn: string;
  categoryNameAr: string;
  bookingAtIso: string;
}

interface Props {
  bookings: UpcomingBookingForNotification[];
  locale: Locale;
}

type InboxRow = Extract<CustomerNotificationsResult, { ok: true }>['rows'][number];
type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

const FIRED_KEY = 'ci.notifications.fired.v1';
const POLL_MS = 30_000;

function readFired(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(FIRED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeFired(map: Record<string, number>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FIRED_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / privacy-mode failures — notifications still render in-panel.
  }
}

/**
 * Notification bell + dropdown for the AURELIA top bar (the mobile home).
 *
 * Shows BOTH:
 *  - **Announcements** — the customer notification inbox (admin broadcasts),
 *    polled via `listCustomerNotificationsAction`, the same data the rest of the
 *    app's bell shows; clicking one opens its link and marks it read, and
 *    drives the unread badge.
 *  - **Upcoming bookings** — booking-time reminders: every 30 s (and on mount)
 *    the component fires a browser Notification when a booking's start time
 *    arrives (once per booking, tracked in localStorage) and marks it "ready".
 */
export function NotificationCenter({ bookings, locale }: Props) {
  const t = useTranslations('notifications');
  const router = useRouter();

  const [permission, setPermission] = useState<NotificationPermissionState>('default');
  const [open, setOpen] = useState(false);
  const [enableDismissed, setEnableDismissed] = useState(false);
  const [firedIds, setFiredIds] = useState<Record<string, number>>({});
  const rootRef = useRef<HTMLDivElement>(null);

  // Admin notification inbox (broadcasts) — same source as the app-wide bell.
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [inboxUnread, setInboxUnread] = useState(0);

  const refreshInbox = useCallback(async () => {
    const res = await listCustomerNotificationsAction();
    if (res.ok) {
      setInbox(res.rows);
      setInboxUnread(res.unread);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshInbox(), 0);
    const id = window.setInterval(refreshInbox, POLL_MS);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(id);
    };
  }, [refreshInbox]);

  // Detect Notification API support + current permission once on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const initial = window.setTimeout(() => {
      setPermission(
        'Notification' in window
          ? (window.Notification.permission as NotificationPermissionState)
          : 'unsupported',
      );
      setFiredIds(readFired());
    }, 0);
    return () => window.clearTimeout(initial);
  }, []);

  // Close panel on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Current time, refreshed on an interval. Kept in state (set from an effect)
  // rather than calling Date.now() during render, so render stays pure.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const initial = window.setTimeout(() => setNow(Date.now()), 0);
    const id = window.setInterval(() => setNow(Date.now()), POLL_MS);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(id);
    };
  }, []);

  // Side-effect: fire OS-level Notification for any booking whose time has
  // arrived and that we haven't fired before.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const nowMs = Date.now();
    const fired = readFired();
    let changed = false;
    for (const b of bookings) {
      const at = new Date(b.bookingAtIso).getTime();
      if (Number.isNaN(at)) continue;
      if (at > nowMs) continue;
      if (fired[b.id]) continue;
      fired[b.id] = nowMs;
      changed = true;
      if (permission === 'granted' && 'Notification' in window) {
        const serviceName = locale === 'ar' ? b.serviceNameAr : b.serviceNameEn;
        const categoryName = locale === 'ar' ? b.categoryNameAr : b.categoryNameEn;
        const fullTitle = `${categoryName} - ${serviceName}`;
        try {
          new window.Notification(t('bookingReadyTitle'), {
            body: t('bookingReadyBody', { service: fullTitle, reference: b.reference }),
            tag: `ci-booking-${b.id}`,
            icon: '/icons/icon.svg',
          });
        } catch {
          // Some browsers throw when called without user gesture — ignore.
        }
      }
    }
    if (changed) {
      writeFired(fired);
      queueMicrotask(() => setFiredIds(fired));
    }
  }, [bookings, permission, now, locale, t]);

  const sorted = useMemo(
    () =>
      [...bookings].sort(
        (a, b) => new Date(a.bookingAtIso).getTime() - new Date(b.bookingAtIso).getTime(),
      ),
    [bookings],
  );
  const readyCount = useMemo(
    () => sorted.filter((b) => new Date(b.bookingAtIso).getTime() <= now).length,
    [sorted, now],
  );

  function handleBellClick() {
    const next = !open;
    setOpen(next);
    // Refresh in the event handler — NOT inside the setState updater, which runs
    // during render and would dispatch the server action's Router update mid-render
    // ("Cannot update Router while rendering NotificationCenter").
    if (next) void refreshInbox();
  }

  async function handleEnable() {
    if (!('Notification' in window)) return;
    try {
      const result = await window.Notification.requestPermission();
      setPermission(result as NotificationPermissionState);
      setEnableDismissed(true);
    } catch {
      setEnableDismissed(true);
    }
  }

  const inboxTitle = (r: InboxRow) => (locale === 'ar' ? r.titleAr : r.titleEn);
  const inboxBody = (r: InboxRow) => (locale === 'ar' ? r.bodyAr : r.bodyEn);

  async function openInbox(r: InboxRow) {
    setOpen(false);
    if (!r.readAt) {
      setInbox((rs) => rs.map((x) => (x.id === r.id ? { ...x, readAt: new Date() } : x)));
      setInboxUnread((n) => Math.max(0, n - 1));
      void markCustomerNotificationsReadAction([r.id]).then(refreshInbox);
    }
    router.push(`/notifications/${r.id}`);
  }

  async function markAllInbox() {
    setInbox((rs) => rs.map((r) => ({ ...r, readAt: r.readAt ?? new Date() })));
    setInboxUnread(0);
    await markCustomerNotificationsReadAction('all');
    void refreshInbox();
  }

  // Badge: a count when there are unread announcements; otherwise a small dot
  // when a booking is ready (red) or upcoming bookings exist (gold).
  const badgeCount = inboxUnread;
  const showDot = badgeCount === 0 && (readyCount > 0 || sorted.length > 0);
  const showEnable = permission === 'default' && !enableDismissed;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t('ariaLabelCount', { count: badgeCount })}
        aria-expanded={open}
        onClick={handleBellClick}
        className="relative inline-flex size-[34px] items-center justify-center rounded-full bg-muted transition hover:bg-border"
      >
        <BellIcon className="size-4 text-foreground/85" strokeWidth={1.6} />
        {badgeCount > 0 ? (
          <span className="absolute -end-1 -top-1 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-background">
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        ) : showDot ? (
          <span
            aria-hidden
            className={cn(
              'absolute end-[7px] top-[7px] size-1.5 rounded-full ring-2 ring-background',
              readyCount > 0 ? 'bg-red-500' : 'bg-gold-500',
            )}
          />
        ) : null}
      </button>

      {open ? (
        <NotificationsPanel
          locale={locale}
          now={now}
          onClose={() => setOpen(false)}
          bookings={sorted}
          firedIds={firedIds}
          inbox={inbox}
          inboxUnread={inboxUnread}
          inboxTitle={inboxTitle}
          inboxBody={inboxBody}
          onOpenInbox={openInbox}
          onMarkAllInbox={markAllInbox}
          showEnable={showEnable}
          permission={permission}
          onEnable={handleEnable}
          onDismissEnable={() => setEnableDismissed(true)}
        />
      ) : null}
    </div>
  );
}

function NotificationsPanel({
  locale,
  now,
  onClose,
  bookings,
  firedIds,
  inbox,
  inboxUnread,
  inboxTitle,
  inboxBody,
  onOpenInbox,
  onMarkAllInbox,
  showEnable,
  permission,
  onEnable,
  onDismissEnable,
}: {
  locale: Locale;
  now: number;
  onClose: () => void;
  bookings: UpcomingBookingForNotification[];
  firedIds: Record<string, number>;
  inbox: InboxRow[];
  inboxUnread: number;
  inboxTitle: (r: InboxRow) => string;
  inboxBody: (r: InboxRow) => string | null;
  onOpenInbox: (r: InboxRow) => void;
  onMarkAllInbox: () => void;
  showEnable: boolean;
  permission: NotificationPermissionState;
  onEnable: () => void;
  onDismissEnable: () => void;
}) {
  const t = useTranslations('notifications');
  const intl = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [locale],
  );
  const relative = useMemo(
    () =>
      new Intl.RelativeTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { numeric: 'auto' }),
    [locale],
  );

  const isEmpty = inbox.length === 0 && bookings.length === 0;

  return (
    <div
      role="dialog"
      aria-label={t('panelTitle')}
      // `end-0` anchors to the bell's logical end edge — correct in LTR and RTL.
      className="absolute end-0 top-[44px] z-[60] w-[320px] max-w-[calc(100vw-2.5rem)] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl backdrop-blur-xl"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
          {t('panelTitle')}
        </h3>
        <Link
          href="/notifications"
          onClick={onClose}
          className="text-[11px] font-semibold uppercase tracking-[0.15em] text-gold-700 hover:text-gold-600"
        >
          {t('seeAll')}
        </Link>
      </header>

      {showEnable ? (
        <EnableBanner permission={permission} onEnable={onEnable} onDismiss={onDismissEnable} />
      ) : null}

      <div className="max-h-[60vh] overflow-y-auto">
        {/* Announcements (admin broadcasts) */}
        {inbox.length > 0 ? (
          <section>
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {t('announcements')}
              </span>
              {inboxUnread > 0 ? (
                <button
                  type="button"
                  onClick={onMarkAllInbox}
                  className="text-[11px] font-medium text-accent hover:underline"
                >
                  {t('markAllRead')}
                </button>
              ) : null}
            </div>
            <ul className="divide-y divide-border">
              {inbox.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onOpenInbox(r)}
                    className={cn(
                      'block w-full px-4 py-3 text-start transition hover:bg-muted',
                      !r.readAt && 'bg-accent/5',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {!r.readAt ? (
                        <span className="size-2 shrink-0 rounded-full bg-gold-500" aria-hidden />
                      ) : null}
                      <span className="truncate text-[13px] font-semibold text-foreground">
                        {inboxTitle(r)}
                      </span>
                    </div>
                    {inboxBody(r) ? (
                      <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                        {inboxBody(r)}
                      </p>
                    ) : null}
                    <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                      {relativeTime(r.createdAt, locale)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Upcoming bookings (booking-time reminders) */}
        {bookings.length > 0 ? (
          <section>
            <div className="px-4 pb-1 pt-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {t('upcoming')}
              </span>
            </div>
            <ul className="divide-y divide-border">
              {bookings.map((b) => {
                const at = new Date(b.bookingAtIso);
                const atMs = at.getTime();
                const isReady = atMs <= now;
                const serviceName = locale === 'ar' ? b.serviceNameAr : b.serviceNameEn;
                const categoryName = locale === 'ar' ? b.categoryNameAr : b.categoryNameEn;
                const diffMin = Math.round((atMs - now) / 60_000);
                const rel = formatRelative(relative, diffMin);
                return (
                  <li key={b.id}>
                    <Link
                      href={`/bookings/${b.id}`}
                      className="block px-4 py-3 transition hover:bg-muted"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          aria-hidden
                          className={cn(
                            'mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full',
                            isReady
                              ? 'bg-emerald-500/15 text-emerald-700'
                              : 'bg-gold-400/15 text-gold-700',
                          )}
                        >
                          {isReady ? (
                            <CheckIcon className="size-3.5" strokeWidth={2.4} />
                          ) : (
                            <BellIcon className="size-3.5" strokeWidth={1.8} />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-foreground">
                            {isReady ? t('bookingReadyTitle') : t('bookingScheduledTitle')}
                          </p>
                          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                            {categoryName} - {serviceName}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {intl.format(at)} · {rel}
                          </p>
                          {firedIds[b.id] ? (
                            <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-emerald-700">
                              {t('delivered')}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {isEmpty ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[12px] text-muted-foreground">{t('inboxEmpty')}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EnableBanner({
  permission,
  onEnable,
  onDismiss,
}: {
  permission: NotificationPermissionState;
  onEnable: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('notifications');
  const isUnsupported = permission === 'unsupported';
  const isDenied = permission === 'denied';

  return (
    <div className="flex items-start gap-3 border-b border-border bg-muted/40 px-4 py-3">
      <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-gold-400/15 text-gold-700">
        <BellIcon className="size-3.5" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {isUnsupported ? t('enableUnsupported') : isDenied ? t('enableDenied') : t('enableBody')}
        </p>
        {!isUnsupported && !isDenied ? (
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onEnable}
              className="rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition hover:bg-primary/90"
            >
              {t('enableButton')}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-full border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:bg-muted"
            >
              {t('notNow')}
            </button>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={t('dismiss')}
        onClick={onDismiss}
        className="-m-1 inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

function formatRelative(rtf: Intl.RelativeTimeFormat, diffMinutes: number): string {
  const abs = Math.abs(diffMinutes);
  if (abs < 60) return rtf.format(diffMinutes, 'minute');
  const hours = Math.round(diffMinutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  const days = Math.round(hours / 24);
  return rtf.format(days, 'day');
}
