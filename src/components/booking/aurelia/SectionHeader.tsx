/**
 * AURELIA section header: large serif title on the start edge, uppercase
 * accent-coloured action on the end edge ("SORT ›"). Padding matches the
 * 20px gutter the prototype uses.
 */
interface Props {
  title: string;
  action?: string;
}

export function SectionHeader({ title, action }: Props) {
  return (
    <div className="flex items-baseline justify-between px-5">
      <h3 className="m-0 font-aurelia-display text-[22px] font-medium tracking-[0.015em] text-foreground">
        {title}
      </h3>
      {action ? (
        <span className="font-aurelia-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-700">
          {action} ›
        </span>
      ) : null}
    </div>
  );
}
