'use client';

import { useState, useTransition } from 'react';
import { updateCustomerNotesAction } from '@/features/admin/customer-actions';

interface Props {
  userId: string;
  locale: 'ar' | 'en';
  initialNotes: string;
  initialAdminNotes: string;
}

/** Inline editor for customer-facing + internal admin notes (audited on save). */
export function CustomerNotesForm({ userId, locale, initialNotes, initialAdminNotes }: Props) {
  const [notes, setNotes] = useState(initialNotes);
  const [adminNotes, setAdminNotes] = useState(initialAdminNotes);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = notes !== initialNotes || adminNotes !== initialAdminNotes;

  const save = () => {
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await updateCustomerNotesAction({ userId, notes, adminNotes, locale });
      if (res.ok) setSaved(true);
      else setError(res.code === 'forbidden' ? 'Not authorised.' : 'Could not save. Try again.');
    });
  };

  const ta =
    'min-h-[88px] w-full rounded-xl border border-border/60 bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent';
  const label = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

  return (
    <div className="space-y-4">
      <div>
        <label className={label}>Customer notes</label>
        <textarea
          className={ta}
          value={notes}
          onChange={(e) => { setNotes(e.target.value); setSaved(false); }}
          placeholder="Context about the guest (visible to staff)…"
        />
      </div>
      <div>
        <label className={label}>Internal admin notes 🔒</label>
        <textarea
          className={ta}
          value={adminNotes}
          onChange={(e) => { setAdminNotes(e.target.value); setSaved(false); }}
          placeholder="Private — never shown to the customer…"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="h-10 rounded-2xl bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save notes'}
        </button>
        {saved && !dirty ? <span className="text-sm text-success">✓ Saved</span> : null}
        {error ? <span className="text-sm text-danger">{error}</span> : null}
      </div>
    </div>
  );
}
