'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BellIcon, MailOpenIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relative-time';
import { CrownIcon } from '@/components/brand/CrownIcon';
import { markCustomerNotificationsReadAction } from '@/features/notifications/actions';
import type { CustomerNotificationRow } from '@/server/services/customer-notifications';
import { NotificationReader } from './NotificationReader';

type Filter = 'all' | 'unread';
type GroupKey = 'today' | 'yesterday' | 'week' | 'earlier';
const GROUP_ORDER: GroupKey[] = ['today', 'yesterday', 'week', 'earlier'];

/** Day buckets in the DEVICE-local day (matches the list's relativeTime, which
 *  is also device-local) — intentionally not the resort civil day. */
function bucketOf(createdAt: Date | string, now: number): GroupKey {
  const ms = new Date(createdAt).getTime();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const startToday = start.getTime();
  if (ms >= startToday) return 'today';
  if (ms >= startToday - 86_400_000) return 'yesterday';
  if (ms >= startToday - 6 * 86_400_000) return 'week';
  return 'earlier';
}

/**
 * Customer notification inbox. Mobile: a date-grouped column where a tap opens
 * the detail page. Desktop (≥ lg): a master-detail — the same grouped list on
 * the left, a sticky reading pane on the right that crossfades to the selected
 * notification. Refined to the Crown Island language (display serif, champagne
 * gold accents, generous whitespace), accessible (reduced-motion, AA contrast,
 * single h1, ≥44px targets), and RTL-aware.
 */
export function NotificationsView({
  initialRows,
  now,
}: {
  initialRows: CustomerNotificationRow[];
  now: number;
}) {
  const t = useTranslations('notifications');
  const locale = useLocale();
  const router = useRouter();
  const reduce = useReducedMotion();
  const isAr = locale === 'ar';

  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => {
      const d = mq.matches;
      setIsDesktop(d);
      // The pane is hidden below lg — don't strand a selection there.
      if (!d) setSelectedId(null);
    };
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const unread = rows.filter((r) => !r.readAt).length;
  const title = (r: CustomerNotificationRow) => (isAr ? r.titleAr : r.titleEn);
  const body = (r: CustomerNotificationRow) => (isAr ? r.bodyAr : r.bodyEn);

  const groups = useMemo(() => {
    const list = filter === 'unread' ? rows.filter((r) => !r.readAt) : rows;
    const map = new Map<GroupKey, CustomerNotificationRow[]>();
    for (const r of list) {
      const k = bucketOf(r.createdAt, now);
      const arr = map.get(k);
      if (arr) arr.push(r);
      else map.set(k, [r]);
    }
    return GROUP_ORDER.filter((k) => map.has(k)).map((k) => ({ key: k, items: map.get(k)! }));
  }, [rows, filter, now]);

  const markReadLocal = (id: string) =>
    setRows((rs) => rs.map((x) => (x.id === id ? { ...x, readAt: x.readAt ?? new Date() } : x)));

  const open = (r: CustomerNotificationRow) => {
    if (!r.readAt) {
      markReadLocal(r.id);
      void markCustomerNotificationsReadAction([r.id]);
    }
    if (isDesktop) setSelectedId(r.id);
    else router.push(`/notifications/${r.id}`);
  };

  const markAll = async () => {
    setRows((rs) => rs.map((r) => ({ ...r, readAt: r.readAt ?? new Date() })));
    await markCustomerNotificationsReadAction('all');
  };

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  if (rows.length === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <EmptyState title={t('title')} message={t('inboxEmpty')} />
      </div>
    );
  }

  const groupLabel: Record<GroupKey, string> = {
    today: t('groupToday'),
    yesterday: t('groupYesterday'),
    week: t('groupWeek'),
    earlier: t('groupEarlier'),
  };

  const list = (
    <div>
      {groups.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          {filter === 'unread' ? t('allCaughtUp') : t('inboxEmpty')}
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="mb-5">
            <div className="mb-2 flex items-center gap-3 px-1">
              <h2
                className={cn(
                  'text-[11px] font-bold text-muted-foreground',
                  !isAr && 'uppercase tracking-[0.18em]',
                )}
              >
                {groupLabel[g.key]}
              </h2>
              <span
                className="h-px flex-1 bg-gradient-to-r from-gold-400/35 to-transparent rtl:bg-gradient-to-l"
                aria-hidden
              />
            </div>
            <ul className="overflow-hidden rounded-2xl border border-border bg-card">
              {g.items.map((r) => {
                const isSelected = isDesktop && r.id === selectedId;
                const unreadRow = !r.readAt;
                return (
                  <li key={r.id} className="border-b border-border/60 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => open(r)}
                      aria-current={isSelected ? 'true' : undefined}
                      className={cn(
                        'relative flex w-full items-start gap-4 px-4 py-4 text-start transition-colors',
                        isSelected
                          ? 'bg-accent/10 ring-1 ring-inset ring-accent/25'
                          : 'hover:bg-muted/50',
                      )}
                    >
                      {unreadRow ? (
                        <span
                          className="absolute inset-y-3 start-0 w-[3px] rounded-e-full bg-gold-400"
                          aria-hidden
                        />
                      ) : null}

                      {r.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- admin media
                        <img
                          src={r.imageUrl}
                          alt=""
                          className="size-12 shrink-0 rounded-xl object-cover ring-1 ring-border/60"
                        />
                      ) : (
                        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/[0.07] text-primary">
                          <CrownIcon size={20} />
                        </span>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p
                            className={cn(
                              'truncate text-sm',
                              unreadRow
                                ? 'font-semibold text-foreground'
                                : 'font-medium text-foreground/70',
                            )}
                          >
                            {title(r)}
                          </p>
                          <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
                            {unreadRow ? (
                              <span className="size-1.5 rounded-full bg-gold-400" aria-hidden />
                            ) : null}
                            <time className="text-xs tabular-nums text-muted-foreground">
                              {relativeTime(r.createdAt, locale)}
                            </time>
                          </span>
                        </div>
                        {body(r) ? (
                          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                            {body(r)}
                          </p>
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:py-10">
      {/* Editorial header */}
      <header className="border-b border-border/70 pb-5">
        <p
          className={cn(
            'text-[11px] font-bold text-gold-700',
            !isAr && 'uppercase tracking-[0.28em]',
          )}
        >
          {t('eyebrow')}
        </p>
        <div className="mt-2 flex items-end justify-between gap-4">
          <h1 className="font-display text-[32px] font-semibold leading-none tracking-[-0.01em] text-foreground lg:text-[40px]">
            {t('title')}
          </h1>
          {unread > 0 ? (
            <button
              type="button"
              onClick={markAll}
              className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap text-sm font-medium text-accent transition-colors hover:text-accent/80"
            >
              <MailOpenIcon className="size-4" aria-hidden />
              {t('markAllRead')}
            </button>
          ) : null}
        </div>

        {/* Filter pills */}
        <div className="mt-3 inline-flex rounded-full border border-border bg-card p-1">
          {(['all', 'unread'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn(
                'inline-flex min-h-11 items-center justify-center rounded-full px-4 text-xs font-semibold transition-colors',
                filter === f
                  ? 'bg-primary text-primary-foreground shadow-sm ring-1 ring-gold-400/30'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f === 'all' ? t('filterAll') : t('filterUnread')}
              {f === 'unread' && unread > 0 ? (
                <span className="ms-1 tabular-nums opacity-80">{unread}</span>
              ) : null}
            </button>
          ))}
        </div>
      </header>

      {/* Master-detail (≥ lg) / single column (mobile) */}
      <div className="mt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:items-start lg:gap-8">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          {list}
        </motion.div>

        {/* Reading pane — desktop only */}
        <aside className="hidden lg:sticky lg:top-8 lg:block">
          <div className="flex min-h-[480px] flex-col overflow-hidden rounded-2xl border border-border bg-card p-7 shadow-[0_2px_6px_rgba(20,32,46,0.06),0_28px_60px_-26px_rgba(20,32,46,0.22)]">
            {selected ? (
              <AnimatePresence mode="wait">
                <motion.div
                  key={selected.id}
                  initial={reduce ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  transition={reduce ? { duration: 0 } : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                >
                  <NotificationReader notification={selected} />
                </motion.div>
              </AnimatePresence>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <span className="grid size-14 place-items-center rounded-full bg-gold-400/10 text-gold-700 ring-1 ring-gold-400/25">
                  <BellIcon className="size-6" strokeWidth={1.5} aria-hidden />
                </span>
                <p className="font-display text-xl font-semibold text-foreground">
                  {t('selectTitle')}
                </p>
                <p className="max-w-[16rem] text-sm leading-relaxed text-muted-foreground">
                  {t('selectHint')}
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-20 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-gold-400/10 text-gold-700 ring-1 ring-gold-400/25">
        <BellIcon className="size-7" strokeWidth={1.5} aria-hidden />
      </span>
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">{title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
