import type { ReactNode } from 'react';

/**
 * AURELIA detail-sheet meta tile — small uppercase label on top, value below
 * inside a translucent card. Matches the prototype's `<InfoBlock>` exactly.
 */
export function InfoBlock({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-muted px-3.5 py-3">
      <div className="mb-1 font-aurelia-sans text-[9.5px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
        {label}
      </div>
      <div className="font-aurelia-sans text-[13px] font-medium text-foreground">
        {value}
      </div>
    </div>
  );
}
