import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'outline' | 'gold' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  loading?: boolean;
}

/**
 * Primary action button.
 *
 * Colours from the Crown Island light reference:
 *  - primary = deep navy fill, white text (the "احجز الآن" pills),
 *  - outline = turquoise ring + text (the "اكتشف الجزيرة" pill),
 *  - gold    = champagne premium CTA (the "اكتشف أكثر" button).
 * Pill radius, soft low-opacity shadow, gentle hover lift.
 */
const base =
  'group inline-flex select-none items-center justify-center gap-2 rounded-2xl font-semibold ' +
  'tracking-[-0.01em] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
  'disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.985]';

const variants: Record<Variant, string> = {
  // Deep navy — the reference's main call-to-action pill.
  primary:
    'relative overflow-hidden bg-primary text-primary-foreground ' +
    'shadow-[0_12px_28px_-12px_rgba(22,48,79,0.45)] hover:shadow-[0_18px_40px_-14px_rgba(22,48,79,0.50)] ' +
    'hover:-translate-y-[2px] active:translate-y-0',
  // Turquoise outline — secondary / "explore" action.
  outline:
    'border border-accent/40 bg-transparent text-accent ' +
    'hover:border-accent hover:bg-accent/[0.07]',
  // Champagne gold — premium highlight CTA.
  gold:
    'relative overflow-hidden bg-[linear-gradient(135deg,#d8be7e_0%,#c2a14e_55%,#a8893b_100%)] text-[#2a2410] ' +
    'shadow-gold hover:shadow-[0_16px_38px_-14px_rgba(194,161,78,0.55)] hover:-translate-y-[2px] active:translate-y-0',
  ghost: 'bg-transparent text-foreground/75 hover:bg-foreground/[0.05] hover:text-foreground',
  danger: 'bg-danger/90 text-white hover:bg-danger',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-12 px-5 text-base',
  lg: 'h-[52px] px-6 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'lg',
    fullWidth = false,
    loading = false,
    disabled,
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(base, variants[variant], sizes[size], fullWidth && 'w-full', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {(variant === 'primary' || variant === 'gold') && !disabled && !loading && (
        <span
          className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-[1100ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-full"
          aria-hidden="true"
        />
      )}
      {loading ? <Spinner /> : children}
    </button>
  );
});

function Spinner() {
  return (
    <span
      className="inline-block size-5 animate-spin rounded-full border-2 border-current border-r-transparent"
      aria-hidden
    />
  );
}
