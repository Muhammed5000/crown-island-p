/**
 * Pure scan-shape routing for readVisitByScan (gate-scan.ts) — no Prisma / crypto,
 * so the precedence between the accepted scan shapes is unit-testable.
 *
 * The cryptographic verification (verifyQrToken) and the "V-…" code pattern
 * (looksLikeVisitCode) already live in their own tested cores; this owns only the
 * ORDER in which a scanned value is interpreted, which was previously untested:
 *   1. a valid signed token wins — visit vs booking by its payload
 *   2. then the raw visit-code pattern ("V-…" bracelet barcodes)
 *   3. then a bare booking reference ("CI-…" / manual entry)
 * A regression that reordered these (e.g. treating a signed token as a plain
 * reference) would silently break bracelet/QR admission — this pins the contract.
 */
import { looksLikeVisitCode } from './visit-code-core';

export type ScanKind = 'visitToken' | 'bookingToken' | 'visitCode' | 'reference' | 'unknown';

export function classifyScan(
  raw: string,
  /** The already-verified token payload's shape, or null when the value is not a valid signed token. */
  token: { isVisit: boolean } | null,
): ScanKind {
  const value = raw.trim();
  if (!value) return 'unknown';
  if (token) return token.isVisit ? 'visitToken' : 'bookingToken';
  if (looksLikeVisitCode(value)) return 'visitCode';
  return 'reference';
}
