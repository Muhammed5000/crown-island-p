'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/Input';
import {
  searchCustomersForPickerAction,
  type PickerCustomer,
} from '@/features/admin/notification-actions';

export interface SelectedCustomer {
  id: string;
  label: string;
}

/**
 * Searchable multi-select for the SPECIFIC audience. Emits selected ids as
 * hidden `recipientIds` inputs so the surrounding form submits them with no
 * extra wiring, and calls `onChange` so the form can preview the audience count.
 */
export function CustomerPicker({
  initial,
  onChange,
}: {
  initial: SelectedCustomer[];
  onChange?: (selected: SelectedCustomer[]) => void;
}) {
  const [selected, setSelected] = useState<SelectedCustomer[]>(initial);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PickerCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      const res = await searchCustomersForPickerAction(q);
      setLoading(false);
      if (res.ok) setResults(res.customers);
    }, 250);
    return () => clearTimeout(debounce.current);
  }, [q]);

  const label = (c: PickerCustomer) => c.name || c.email || c.phone || c.id;

  function commit(next: SelectedCustomer[]) {
    setSelected(next);
    onChange?.(next);
  }

  return (
    <div>
      {selected.map((s) => (
        <input key={s.id} type="hidden" name="recipientIds" value={s.id} />
      ))}

      {selected.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-xs text-accent"
            >
              {s.label}
              <button
                type="button"
                onClick={() => commit(selected.filter((x) => x.id !== s.id))}
                aria-label={`Remove ${s.label}`}
                className="text-accent/70 hover:text-accent"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search customers by name, email, or phone…"
      />

      <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-border">
        {loading ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">Searching…</p>
        ) : results.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">No customers found.</p>
        ) : (
          results.map((c) => {
            const picked = selected.some((s) => s.id === c.id);
            return (
              <button
                key={c.id}
                type="button"
                disabled={picked}
                onClick={() => commit([...selected, { id: c.id, label: label(c) }])}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm transition-colors hover:bg-muted/50 disabled:opacity-40"
              >
                <span className="truncate text-foreground">{label(c)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {picked ? 'added' : c.email || c.phone || ''}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
