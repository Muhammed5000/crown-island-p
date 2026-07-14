import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

interface Props {
  href: string;
  /** Top serif word, e.g. "CROWN" */
  title: string;
  /** Bottom serif word, e.g. "SURGE" */
  name: string;
  /** Subtle tagline below, e.g. "Feel The Energy" */
  tag?: string;
  variant?: 'sunset' | 'cabana';
}

/**
 * Pair of small experience cards shown on the landing page below the CTAs.
 * Matches the design source's `MiniExperience` card exactly: 78px tall, gold
 * border, full-bleed image, warm overlay, two-line serif title with tagline.
 */
export function MiniExperience({ href, title, name, tag, variant = 'sunset' }: Props) {
  const src =
    variant === 'cabana'
      ? 'https://images.unsplash.com/photo-1540541338287-41700207dee6?auto=format&fit=crop&w=900&q=70'
      : 'https://images.unsplash.com/photo-1506929562872-bb421503ef21?auto=format&fit=crop&w=900&q=70';
  return (
    <Link
      href={href}
      className={cn(
        'group relative block h-[78px] flex-1 overflow-hidden rounded-xl border border-gold-400/[0.28]',
        'transition-transform hover:-translate-y-0.5 hover:shadow-glow',
      )}
    >
      <Image
        src={src}
        alt=""
        fill
        sizes="(max-width: 768px) 50vw, 25vw"
        className="object-cover transition-transform duration-500 group-hover:scale-105"
      />
      <div
        aria-hidden
        className={cn(
          'absolute inset-0',
          variant === 'sunset'
            ? 'bg-[linear-gradient(135deg,rgba(200,114,47,0.55),rgba(40,28,40,0.65))]'
            : 'bg-[linear-gradient(135deg,rgba(28,46,68,0.55),rgba(20,34,58,0.7))]',
        )}
      />
      <div className="absolute inset-0 flex flex-col justify-between p-3">
        <div>
          <p className="font-display text-[13px] font-bold leading-tight tracking-[0.1em] text-gold-400 [text-shadow:0_1px_4px_rgba(0,0,0,0.5)]">
            {title}
          </p>
          <p className="font-display text-[13px] font-bold leading-tight tracking-[0.1em] text-gold-400 [text-shadow:0_1px_4px_rgba(0,0,0,0.5)]">
            {name}
          </p>
        </div>
        {tag ? (
          <p className="text-[9px] tracking-wide text-gold-300/90 [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
            {tag}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
