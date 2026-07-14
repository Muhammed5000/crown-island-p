'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClockIcon, CircleSlash2Icon, PlusIcon, WrenchIcon, XIcon } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import {
  setPlaceActiveAction,
  setPlaceHandicapAction,
  createPlaceOutageAction,
  deletePlaceOutageAction,
} from '@/features/admin/place-actions';

export interface OutageRow {
  id: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  reason: string | null;
}
export interface InventoryPlace {
  id: string;
  label: string;
  type: string;
  zone: string | null;
  isActive: boolean;
  isHandicap: boolean;
  outages: OutageRow[];
}

type Status = 'online' | 'offline' | 'out';

const ERRORS: Record<string, string> = {
  invalid_range: 'The end time must be after the start time.',
  not_found: 'That place no longer exists.',
  invalid_input: 'Please fill in both the start and end time.',
};

function statusOf(p: InventoryPlace, now: number): { status: Status; active?: OutageRow; next?: OutageRow } {
  if (!p.isActive) return { status: 'offline' };
  const active = p.outages.find((o) => Date.parse(o.startsAt) <= now && now < Date.parse(o.endsAt));
  if (active) return { status: 'out', active };
  const next = p.outages
    .filter((o) => Date.parse(o.endsAt) > now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  return { status: 'online', next };
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function until(iso: string, now: number): string {
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return 'now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

export function PlaceInventory({ serviceId, places }: { serviceId: string; places: InventoryPlace[] }) {
  // `now` only after mount → no SSR/hydration mismatch on the time-based pills.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const initial = window.setTimeout(() => setNow(Date.now()), 0);
    const h = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.clearTimeout(initial);
      clearInterval(h);
    };
  }, []);

  const [filter, setFilter] = useState<'all' | Status>('all');

  const counts = useMemo(() => {
    const c = { online: 0, offline: 0, out: 0 };
    for (const p of places) c[statusOf(p, now).status]++;
    return c;
  }, [places, now]);

  const filtered = filter === 'all' ? places : places.filter((p) => statusOf(p, now).status === filter);

  const tabs: { key: 'all' | Status; label: string; n: number }[] = [
    { key: 'all', label: 'All', n: places.length },
    { key: 'online', label: 'Online', n: counts.online },
    { key: 'offline', label: 'Offline', n: counts.offline },
    { key: 'out', label: 'Out of service', n: counts.out },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base text-gold-600">availability</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Toggle a place online/offline, or schedule it out of service for a window — it can&rsquo;t be booked while it&rsquo;s down.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                filter === t.key
                  ? 'border-gold-400/50 bg-gold-400/15 text-gold-700'
                  : 'border-border bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
              <span className="tabular-nums opacity-70">{t.n}</span>
            </button>
          ))}
        </div>
      </CardHeader>
      <CardBody>
        {places.length === 0 ? (
          <p className="text-sm text-muted-foreground">No places yet. Add a batch above, then manage availability here.</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No places in this view.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p) => (
              <PlaceCard key={p.id} serviceId={serviceId} place={p} now={now} />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

const STATUS_META: Record<Status, { dot: string; ring: string; label: string; text: string }> = {
  online: { dot: 'bg-emerald-500', ring: 'border-emerald-400/30', label: 'Online', text: 'text-emerald-700' },
  offline: { dot: 'bg-slate-400', ring: 'border-border', label: 'Offline', text: 'text-muted-foreground' },
  out: { dot: 'bg-amber-500', ring: 'border-amber-400/35', label: 'Out of service', text: 'text-amber-700' },
};

function PlaceCard({ serviceId, place, now }: { serviceId: string; place: InventoryPlace; now: number }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [scheduling, setScheduling] = useState(false);

  const { status, active, next } = statusOf(place, now);
  const meta = STATUS_META[status];

  function act(fn: () => Promise<{ ok: boolean; code?: string }>, okMsg?: string) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        if (okMsg) toast(okMsg, 'success');
        router.refresh();
      } else {
        toast(ERRORS[res.code ?? ''] ?? 'Something went wrong.', 'error');
      }
    });
  }

  return (
    <div className={cn('rounded-2xl border bg-card p-4 transition-colors', meta.ring)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display text-lg font-semibold tabular-nums text-foreground">{place.label}</span>
            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', meta.ring, meta.text)}>
              <span className={cn('size-1.5 rounded-full', meta.dot)} />
              {meta.label}
            </span>
            {place.isHandicap ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/35 bg-sky-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-700">
                <span aria-hidden>♿</span> Accessible
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {place.type}
            {place.zone ? ` · ${place.zone}` : ''}
          </p>
        </div>

        {/* Online / Offline switch */}
        <button
          type="button"
          role="switch"
          aria-checked={place.isActive}
          aria-label={place.isActive ? `Take ${place.label} offline` : `Bring ${place.label} online`}
          disabled={pending}
          onClick={() =>
            act(
              () => setPlaceActiveAction({ serviceId, placeId: place.id, isActive: !place.isActive }),
              !place.isActive ? `${place.label} is online` : `${place.label} is offline`,
            )
          }
          className={cn(
            'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
            place.isActive ? 'bg-emerald-500/80' : 'bg-muted',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform',
              place.isActive ? 'translate-x-[22px]' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      {/* Active downtime banner */}
      {active ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2 text-[12px] text-amber-700">
          <WrenchIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            Down until <span className="font-semibold">{fmt(active.endsAt)}</span>
            {active.reason ? ` · ${active.reason}` : ''}
          </span>
          <button
            type="button"
            aria-label="End downtime now"
            disabled={pending}
            onClick={() => act(() => deletePlaceOutageAction({ serviceId, outageId: active.id }), 'Back in service')}
            className="rounded-md px-1.5 py-0.5 text-amber-700 hover:bg-amber-400/15 hover:text-amber-800"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      ) : null}

      {/* Footer actions */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setScheduling((s) => !s)}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-gold-600 transition-colors hover:text-gold-700"
          >
            {scheduling ? <XIcon className="size-3.5" /> : <CalendarClockIcon className="size-3.5" />}
            {scheduling ? 'Close' : 'Out of service'}
          </button>
          {/* Accessibility (handicap) toggle — advisory; colours the cell blue at the desk. */}
          <button
            type="button"
            disabled={pending}
            aria-pressed={place.isHandicap}
            onClick={() =>
              act(
                () => setPlaceHandicapAction({ serviceId, placeId: place.id, isHandicap: !place.isHandicap }),
                place.isHandicap ? `${place.label} is no longer accessible` : `${place.label} marked accessible`,
              )
            }
            className={cn(
              'inline-flex items-center gap-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50',
              place.isHandicap ? 'text-sky-700 hover:text-sky-800' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span aria-hidden>♿</span>
            {place.isHandicap ? 'Accessible' : 'Mark accessible'}
          </button>
        </div>
        {!active && next ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <CircleSlash2Icon className="size-3" />
            down in {until(next.startsAt, now)}
          </span>
        ) : null}
      </div>

      {/* Inline scheduler */}
      {scheduling ? (
        <OutageScheduler
          serviceId={serviceId}
          placeId={place.id}
          onDone={() => {
            setScheduling(false);
            router.refresh();
          }}
          onError={(code) => toast(ERRORS[code] ?? 'Could not schedule downtime.', 'error')}
        />
      ) : null}

      {/* Upcoming windows */}
      {place.outages.filter((o) => Date.parse(o.startsAt) > now).length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {place.outages
            .filter((o) => Date.parse(o.startsAt) > now)
            .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
            .map((o) => (
              <li key={o.id} className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground">
                <CalendarClockIcon className="size-3 shrink-0 text-amber-600" />
                <span className="min-w-0 flex-1 truncate">
                  {fmt(o.startsAt)} → {fmt(o.endsAt)}
                  {o.reason ? ` · ${o.reason}` : ''}
                </span>
                <button
                  type="button"
                  aria-label="Cancel scheduled downtime"
                  disabled={pending}
                  onClick={() => act(() => deletePlaceOutageAction({ serviceId, outageId: o.id }), 'Downtime cancelled')}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-danger"
                >
                  <XIcon className="size-3" />
                </button>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}

function OutageScheduler({
  serviceId,
  placeId,
  onDone,
  onError,
}: {
  serviceId: string;
  placeId: string;
  onDone: () => void;
  onError: (code: string) => void;
}) {
  const [pending, start] = useTransition();
  const inputCls =
    'h-10 w-full rounded-xl border border-border bg-input px-2.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent';

  return (
    <form
      className="mt-3 space-y-2.5 rounded-xl border border-border bg-muted p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await createPlaceOutageAction({
            serviceId,
            placeId,
            startsAt: fd.get('startsAt'),
            endsAt: fd.get('endsAt'),
            reason: (fd.get('reason') as string)?.trim() || null,
          });
          if (res.ok) onDone();
          else onError(res.code ?? 'unknown');
        });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">From</span>
          <input type="datetime-local" name="startsAt" required className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Until</span>
          <input type="datetime-local" name="endsAt" required className={inputCls} />
        </label>
      </div>
      <input name="reason" maxLength={200} placeholder="Reason (optional) — e.g. deep clean, repair" className={inputCls} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-gold-button text-[13px] font-bold text-ink shadow-gold transition-transform hover:-translate-y-px disabled:opacity-60"
      >
        <PlusIcon className="size-4" />
        {pending ? 'Scheduling…' : 'Schedule downtime'}
      </button>
    </form>
  );
}
