'use client';

import { useState, useTransition } from 'react';
import { AlertTriangleIcon, PlusIcon } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import type { SanctionStatus } from '@prisma/client';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { useToast } from '@/components/ui/Toast';
import { formatMoney } from '@/lib/money';
import {
  createSanctionAction,
  settleSanctionAction,
  updateSanctionAction,
  type SanctionActionResult,
} from '@/features/admin/sanction-actions';

export interface SanctionRow {
  id: string;
  amountCents: number;
  reason: string;
  notes: string | null;
  status: SanctionStatus;
  createdAt: string;
  createdByName: string | null;
  settledAt: string | null;
  settledByName: string | null;
  settlementNote: string | null;
  paidByBookingId: string | null;
  paidByBookingReference: string | null;
  lockedByPendingBooking: boolean;
}

interface Props {
  userId: string;
  sanctions: SanctionRow[];
  activeTotalCents: number;
}

const STATUS_TONE: Record<SanctionStatus, BadgeTone> = {
  ACTIVE: 'danger',
  PAID: 'success',
  WAIVED: 'info',
  CANCELLED: 'muted',
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: 'Please check the fields.',
  invalid_amount: 'Amount must be a positive number.',
  invalid_reason: 'Reason must be 3–500 characters.',
  invalid_notes: 'Notes are too long.',
  sanction_settled: 'This sanction is already settled.',
  sanction_locked: 'A booking is paying this sanction right now — try again shortly.',
  invalid_transition: 'This status change is not allowed.',
  conflict: 'The sanction changed concurrently — reload and retry.',
  user_not_found: 'Customer not found.',
  unknown: 'Something went wrong — please try again.',
};

/**
 * Admin sanctions panel for one customer: history, add form, and settle
 * controls (paid / waive / cancel) with confirmation + settlement note.
 */
export function SanctionsCard({ userId, sanctions, activeTotalCents }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(sanctions.length === 0 ? false : false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [settling, setSettling] = useState<{ id: string; status: SanctionStatus } | null>(null);
  const [settleNote, setSettleNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<SanctionActionResult>, successMsg: string) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(ERROR_MESSAGES[res.code] ?? ERROR_MESSAGES.unknown!);
        return;
      }
      toast(successMsg, 'success');
      setShowAdd(false);
      setEditingId(null);
      setSettling(null);
      setSettleNote('');
      router.refresh();
    });
  }

  function submitCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set('userId', userId);
    run(() => createSanctionAction(fd), 'Sanction added.');
  }

  function submitEdit(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => updateSanctionAction(id, fd), 'Sanction updated.');
  }

  function confirmSettle() {
    if (!settling) return;
    const fd = new FormData();
    fd.set('status', settling.status);
    fd.set('note', settleNote);
    const verb =
      settling.status === 'PAID' ? 'marked paid' : settling.status === 'WAIVED' ? 'waived' : 'cancelled';
    run(() => settleSanctionAction(settling.id, fd), `Sanction ${verb}.`);
  }

  return (
    <div className="space-y-3">
      {activeTotalCents > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">This customer has caused problems.</p>
            <p className="text-[12.5px] text-danger/80">
              Unpaid sanctions: {formatMoney(activeTotalCents, { locale: 'en', currency: 'EGP' })}{' '}
              — collected automatically on their next booking.
            </p>
          </div>
        </div>
      ) : null}

      {/* History */}
      {sanctions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sanctions on record.</p>
      ) : (
        <ul className="space-y-2">
          {sanctions.map((s) => (
            <li key={s.id} className="rounded-xl border border-border/40 bg-muted/20 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold tabular-nums text-foreground">
                  {formatMoney(s.amountCents, { locale: 'en', currency: 'EGP' })}
                </span>
                <span className="flex items-center gap-1.5">
                  {s.lockedByPendingBooking ? <Badge tone="warning">In checkout</Badge> : null}
                  <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                </span>
              </div>
              <p className="mt-1 text-foreground">{s.reason}</p>
              {s.notes ? (
                <p className="mt-0.5 text-xs text-muted-foreground">Internal: {s.notes}</p>
              ) : null}
              <p className="mt-1.5 text-xs text-muted-foreground">
                Added {s.createdAt}
                {s.createdByName ? ` by ${s.createdByName}` : ''}
              </p>
              {s.settledAt ? (
                <p className="text-xs text-muted-foreground">
                  {s.status === 'PAID' ? 'Paid' : 'Settled'} {s.settledAt}
                  {s.settledByName ? ` by ${s.settledByName}` : ''}
                  {s.paidByBookingReference ? (
                    <>
                      {' — booking '}
                      <a
                        href={`/admin/bookings/${s.paidByBookingId}`}
                        className="text-accent underline-offset-4 hover:underline"
                      >
                        {s.paidByBookingReference}
                      </a>
                    </>
                  ) : null}
                  {s.settlementNote ? ` · ${s.settlementNote}` : ''}
                </p>
              ) : null}

              {/* Active controls */}
              {s.status === 'ACTIVE' ? (
                editingId === s.id ? (
                  <form onSubmit={(e) => submitEdit(e, s.id)} className="mt-2 space-y-2">
                    <SanctionFields
                      defaultAmount={(s.amountCents / 100).toString()}
                      defaultReason={s.reason}
                      defaultNotes={s.notes ?? ''}
                    />
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" loading={pending}>
                        Save
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : settling?.id === s.id ? (
                  <div className="mt-2 space-y-2">
                    <Label htmlFor={`note-${s.id}`}>
                      {settling.status === 'PAID'
                        ? 'How was it paid? (note)'
                        : 'Settlement note (optional)'}
                    </Label>
                    <Input
                      id={`note-${s.id}`}
                      value={settleNote}
                      onChange={(e) => setSettleNote(e.target.value)}
                      placeholder={
                        settling.status === 'PAID' ? 'e.g. Paid in cash at the office' : 'Why?'
                      }
                      maxLength={1000}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={settling.status === 'PAID' ? 'primary' : 'danger'}
                        loading={pending}
                        onClick={confirmSettle}
                      >
                        Confirm {settling.status.toLowerCase()}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setSettling(null)}>
                        Back
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => { setSettling({ id: s.id, status: 'PAID' }); setSettleNote(''); }}
                    >
                      Mark paid
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => { setSettling({ id: s.id, status: 'WAIVED' }); setSettleNote(''); }}
                    >
                      Waive
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => { setSettling({ id: s.id, status: 'CANCELLED' }); setSettleNote(''); }}
                    >
                      Cancel it
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setEditingId(s.id)}
                    >
                      Edit
                    </Button>
                  </div>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p className="text-sm font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {/* Add */}
      {showAdd ? (
        <form onSubmit={submitCreate} className="space-y-2 rounded-xl border border-border/40 p-3">
          <SanctionFields />
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="danger" loading={pending}>
              Add sanction
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => setShowAdd(true)}>
          <PlusIcon className="size-4" />
          Add sanction
        </Button>
      )}
    </div>
  );
}

function SanctionFields({
  defaultAmount = '',
  defaultReason = '',
  defaultNotes = '',
}: {
  defaultAmount?: string;
  defaultReason?: string;
  defaultNotes?: string;
}) {
  return (
    <>
      <div>
        <Label htmlFor="sanction-amount">Amount (EGP)</Label>
        <Input
          id="sanction-amount"
          name="amount"
          type="number"
          inputMode="decimal"
          min={0.01}
          step={0.01}
          required
          defaultValue={defaultAmount}
          placeholder="e.g. 500"
          dir="ltr"
        />
      </div>
      <div>
        <Label htmlFor="sanction-reason">Reason (shown to reception &amp; the customer)</Label>
        <textarea
          id="sanction-reason"
          name="reason"
          rows={2}
          required
          minLength={3}
          maxLength={500}
          defaultValue={defaultReason}
          placeholder="What happened — e.g. damaged a cabana door on 10 June"
          className="block w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      <div>
        <Label htmlFor="sanction-notes">Internal notes (admins only, optional)</Label>
        <textarea
          id="sanction-notes"
          name="notes"
          rows={2}
          maxLength={1000}
          defaultValue={defaultNotes}
          placeholder="Evidence, incident report number, …"
          className="block w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
    </>
  );
}
