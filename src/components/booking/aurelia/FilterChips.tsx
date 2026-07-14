'use client';

/**
 * Horizontal filter rail. Each chip toggles a filter key; only one is active
 * at a time. `value` and `onChange` are owned by the parent so the same
 * state can drive both the chips and the card list.
 */
interface Filter {
  id: string;
  label: string;
}

interface Props {
  filters: Filter[];
  value: string;
  onChange: (id: string) => void;
}

export function FilterChips({ filters, value, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Filter experiences"
      className="flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {filters.map((f) => {
        const active = f.id === value;
        return (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(f.id)}
            className={[
              'whitespace-nowrap rounded-full px-3.5 py-2 font-aurelia-sans text-[12px] font-medium tracking-[0.025em] transition',
              active
                ? 'border border-accent bg-accent/10 text-accent'
                : 'border border-border bg-transparent text-muted-foreground hover:bg-muted',
            ].join(' ')}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
