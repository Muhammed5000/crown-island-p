/**
 * Crown Island gate scanner — shared design tokens.
 *
 * Ported verbatim from the Claude Design handoff (`scan-shared.jsx`), with the
 * font families pointed at the self-hosted next/font CSS variables instead of a
 * render-blocking Google Fonts request. Midnight + gold luxury palette,
 * consistent with the AURELIA booking screens.
 */
export const CROWN = {
  bg: '#f4f6f7',
  panel: '#ffffff',
  panel2: 'rgba(28,43,64,0.04)',
  line: 'rgba(28,43,64,0.12)',
  cream: '#1c2b40',
  dim: 'rgba(28,43,64,0.62)',
  faint: 'rgba(28,43,64,0.45)',
  gold: '#9c7d34',
  goldGlow: 'rgba(194,161,78,0.35)',
  ok: '#1f9d63',
  okGlow: 'rgba(31,157,99,0.30)',
  warn: '#b7791f',
  warnGlow: 'rgba(183,121,31,0.30)',
  bad: '#c0392b',
  badGlow: 'rgba(192,57,43,0.30)',
  /** Foreground (ink) for text/icons that sit ON a filled gold/ok/warn/bad button. */
  onFill: '#ffffff',
  serif: 'var(--font-aurelia-display), "Cormorant Garamond", serif',
  sans: 'var(--font-aurelia-sans), "Manrope", system-ui, sans-serif',
} as const;

export type ScanState = 'valid' | 'used' | 'invalid';

export interface ScanTheme {
  c: string;
  glow: string;
  word: string;
  head: string;
  mark: 'check' | 'warn' | 'cross';
}

export const SCAN_THEME: Record<ScanState, ScanTheme> = {
  valid: { c: CROWN.ok, glow: CROWN.okGlow, word: 'ADMIT', head: 'Verified', mark: 'check' },
  used: { c: CROWN.warn, glow: CROWN.warnGlow, word: 'OVERRIDE', head: 'Already admitted', mark: 'warn' },
  invalid: { c: CROWN.bad, glow: CROWN.badGlow, word: 'DENY', head: 'Pass not valid', mark: 'cross' },
};

/** Shape returned by the gate verify/check-in API (mirrors GatePass server-side). */
export interface GatePass {
  bookingId: string;
  invoice: string;
  date: string;
  customer: string;
  phone: string;
  status: string;
  package: string;
  tier: string;
  // `amount` / `total` / `currency` are money-related and are OMITTED by the
  // server for SECURITY operators — hence optional on the client too.
  services: { code: string; label: string; qty: number; amount?: number }[];
  total?: number;
  currency?: string;
  guests: number;
  vehicles: number;
  scan: ScanState;
  /** Signed QR token for this pass — used to re-print the ticket QR at the gate. */
  qrToken: string;
  reason?: string;
  usedAt?: string;
  usedGate?: string;
  // ── Place assignment (Phase 3) — present from the server, optional so the
  //    synthetic "unknown pass" object doesn't need to set them. ──
  adults?: number;
  children?: number;
  unitsPerDay?: number;
  bookingDates?: string[];
  requiresPlacement?: boolean;
  placementStatus?: 'NOT_REQUIRED' | 'PENDING' | 'PARTIAL' | 'COMPLETE';
  unitsTotal?: number;
  placedUnits?: number;
  // ── Guest ID collection — every guest needs an uploaded ID before admit. ──
  idDocsRequired?: boolean;
  idDocsTotal?: number;
  idDocsUploaded?: number;
  idDocsComplete?: boolean;
  // Partial check-in by headcount.
  enteredCount?: number;
  remaining?: number;
  // Exit / live headcount.
  exitedCount?: number;
  onSite?: number;
  /** Per-guest roster (uploaded IDs) for selecting who enters by photo + name. */
  guestRoster?: { seq: number; name: string; imageUrl: string; entered: boolean }[];
}

/**
 * The daily visit group one scan opens — every booking the customer made for
 * the day (mirrors the server's GateVisit). `passes` keeps per-booking
 * verdicts; the scanner shows one pass at a time with a group switcher.
 */
export interface GateVisit {
  date: string;
  customer: string;
  phone: string;
  bookingCount: number;
  scanCount: number;
  passes: GatePass[];
}

/** A physical place returned by the placement API. */
export interface AvailablePlace {
  id: string;
  label: string;
  type: 'CABIN' | 'CABANA' | 'UMBRELLA' | 'SEAT' | 'SPOT';
  zone: string | null;
  position: number;
  gridX: number;
  gridY: number;
  isAvailable: boolean;
  /** Accessibility (handicap) cell — shown in a distinct colour at the desk. */
  isHandicap?: boolean;
  /** True when blocked by a scheduled out-of-service window (vs taken). */
  outOfService?: boolean;
  /** Reason for the outage (admin-entered), when out of service. */
  outageReason?: string | null;
  /** ISO instant the place returns to service, when out of service. */
  outageUntil?: string;
}

/** A booking's placement view returned by GET /api/gate/places. */
export interface PlacementView {
  bookingId: string;
  reference: string;
  serviceId: string;
  placeType: string;
  required: boolean;
  status: 'NOT_REQUIRED' | 'PENDING' | 'PARTIAL' | 'COMPLETE';
  unitsPerDay: number;
  dates: string[];
  units: { unitIndex: number; placeId: string | null; placeLabel: string | null }[];
  available: AvailablePlace[];
  recommended: string[];
}

export const fmtEGP = (n: number): string => 'EGP ' + n.toLocaleString('en-US');
