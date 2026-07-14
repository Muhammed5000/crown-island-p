interface Props {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Cream-on-dark variant — for dark backgrounds (exports, dark theme). */
  light?: boolean;
}

const widths = { sm: 150, md: 200, lg: 240 } as const;

/**
 * Crown Island wordmark — the full logo (crown + "CROWN ISLAND" + "EL MONTAZAH").
 * Brand SVG, so it stays crisp at any size. `light` swaps to the cream variant
 * for dark backgrounds (premium exports, dark theme). Plain <img> because SVG
 * doesn't need the next/image optimizer (and next/image gates SVG by default).
 */
export function CrownLogo({ size = 'lg', className, light = false }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={light ? '/brand/crown-island-logo-light.svg' : '/brand/crown-island-logo.svg'}
      alt="Crown Island · El Montazah"
      style={{ width: widths[size], height: 'auto' }}
      className={className}
    />
  );
}
