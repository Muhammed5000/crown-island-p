'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Button } from '@/components/ui/Button';
import {
  addZkCardsAction,
  setZkCardActiveAction,
  deleteZkCardAction,
} from '@/features/admin/zk-card-actions';

interface CardRow {
  id: string;
  cardNo: string;
  label: string | null;
  isActive: boolean;
  assignedBookingRef: string | null;
  assignedBookingStatus: string | null;
  assignedGuest: string | null;
  assignedAt: string | null;
}

interface Stats {
  total: number;
  active: number;
  assigned: number;
  free: number;
}

function errorText(code: string): string {
  switch (code) {
    case 'no_cards':
      return 'Enter at least one card number.';
    case 'too_many':
      return 'Too many numbers at once (max 2000).';
    case 'card_in_use':
      return 'That card is assigned to a booking — retire it instead of deleting.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

export function ZkCardsManager({ stats, cards }: { stats: Stats; cards: CardRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  function run(fn: () => Promise<{ ok: boolean; code?: string; added?: number; attempted?: number }>, form?: HTMLFormElement) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(errorText(res.code ?? 'unknown'));
        return;
      }
      if (typeof res.added === 'number') {
        const skipped = (res.attempted ?? res.added) - res.added;
        setNotice(
          `Added ${res.added} card${res.added === 1 ? '' : 's'}` +
            (skipped > 0 ? ` · ${skipped} already in the pool (skipped)` : ''),
        );
      }
      form?.reset();
      router.refresh();
    });
  }

  const rows = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return cards;
    return cards.filter(
      (c) =>
        c.cardNo.toLowerCase().includes(term) ||
        (c.label ?? '').toLowerCase().includes(term) ||
        (c.assignedBookingRef ?? '').toLowerCase().includes(term),
    );
  }, [cards, filter]);

  return (
    <div className="space-y-4">
      {error ? (
        <div role="alert" className="rounded-2xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-700">
          {notice}
        </div>
      ) : null}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total', value: stats.total },
          { label: 'Free', value: stats.free },
          { label: 'Assigned', value: stats.assigned },
          { label: 'Retired', value: stats.total - stats.active },
        ].map((s) => (
          <Card key={s.label}>
            <CardBody className="py-4 text-center">
              <p className="font-display text-2xl font-semibold text-foreground tabular-nums">{s.value}</p>
              <p className="mt-0.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{s.label}</p>
            </CardBody>
          </Card>
        ))}
      </div>
      {stats.free === 0 && stats.total > 0 ? (
        <div className="rounded-2xl border border-warning/20 bg-warning/5 p-3 text-sm text-warning">
          No free cards in the pool — new cabin bookings will provision a QR but wait for a card. Add
          more cards below.
        </div>
      ) : null}

      {/* Add cards */}
      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-600">register cards</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Paste the card numbers (one per line, or separated by spaces/commas). Numbers already in
            the pool are skipped.
          </p>
        </CardHeader>
        <CardBody>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              run(() => addZkCardsAction(fd), e.currentTarget);
            }}
            className="space-y-3"
          >
            <div>
              <Label htmlFor="zk-card-nos">card numbers</Label>
              <textarea
                id="zk-card-nos"
                name="cardNos"
                dir="ltr"
                rows={4}
                required
                placeholder={'0001234567\n0001234568\n0001234569'}
                className="block w-full rounded-2xl border border-border/60 bg-input px-3 py-2.5 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[180px] flex-1">
                <Label htmlFor="zk-card-label">label (optional)</Label>
                <Input id="zk-card-label" name="label" dir="ltr" placeholder="Blue batch, 2026" maxLength={64} />
              </div>
              <Button type="submit" variant="primary" size="md" loading={isPending}>
                add cards
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      {/* Pool table */}
      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-600">card pool · {cards.length}</h2>
          <div className="mt-2">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              dir="ltr"
              placeholder="Filter by number, label, or booking…"
              aria-label="Filter cards"
              className="h-9 w-64 rounded-xl text-sm"
            />
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {cards.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No cards yet. Register some above.</p>
          ) : (
            <div className="divide-y divide-border/40">
              {rows.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                  <span className="w-40 shrink-0 font-mono font-medium text-foreground" dir="ltr">
                    {c.cardNo}
                  </span>
                  <span className="min-w-[80px] flex-1 text-muted-foreground">{c.label ?? '—'}</span>
                  {c.assignedBookingRef ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-400/10 px-2.5 py-0.5 text-[11px] text-sky-700">
                      {c.assignedBookingRef}
                      {c.assignedGuest ? ` · ${c.assignedGuest}` : ''}
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-400/10 px-2.5 py-0.5 text-[11px] text-emerald-700">
                      free
                    </span>
                  )}
                  {!c.isActive ? (
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">
                      retired
                    </span>
                  ) : null}
                  <div className="ms-auto flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() => run(() => setZkCardActiveAction({ id: c.id, isActive: !c.isActive }))}
                    >
                      {c.isActive ? 'retire' : 'reactivate'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isPending || !!c.assignedBookingRef}
                      title={c.assignedBookingRef ? 'Assigned to a booking — retire instead' : 'Delete permanently'}
                      className="border-danger/40 text-danger hover:bg-danger/10 disabled:opacity-40"
                      onClick={() => run(() => deleteZkCardAction({ id: c.id }))}
                    >
                      delete
                    </Button>
                  </div>
                </div>
              ))}
              {rows.length === 0 ? (
                <p className="p-5 text-sm text-muted-foreground">No cards match the filter.</p>
              ) : null}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
