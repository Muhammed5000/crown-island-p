/**
 * AURELIA price tier glyph — four dollar marks where the first `tier` are
 * solid and the rest dim. Mirrors the prototype's `PriceMark` exactly.
 */
interface Props {
  /** 1–4 inclusive. Values outside this range are clamped. */
  tier: number;
}

export function PriceMark({ tier }: Props) {
  const t = Math.max(1, Math.min(4, Math.round(tier)));
  return (
    <span className="font-aurelia-sans text-[10.5px] tracking-[0.12em]">
      <span className="font-semibold text-foreground/85">{'$'.repeat(t)}</span>
      <span className="text-foreground/25">{'$'.repeat(4 - t)}</span>
    </span>
  );
}
