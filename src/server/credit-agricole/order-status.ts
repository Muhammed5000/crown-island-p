/**
 * Pure MPGS order-state classification (no server-only/Prisma deps, so it is
 * directly unit-testable and reusable).
 */

export type MpgsVerifyStatus =
  | 'success'
  | 'declined'
  | 'failed'
  | 'pending'
  | 'not_found'
  /**
   * The gateway CAPTURED the money but the booking can never confirm (capacity
   * filled by another payer, amount mismatch, booking cancelled/expired) — the
   * charge was/is being automatically refunded. Routes to the failed page, never
   * the success page.
   */
  | 'refunded';

/** The terminal outcome the verifier acts on for a RETRIEVE_ORDER response. */
export type MpgsOrderDecision = 'success' | 'declined' | 'failed' | 'pending';

/**
 * Decide what an MPGS order means from its `result` + `status`.
 *
 * CRITICAL: `result === 'SUCCESS'` only means the LAST gateway operation
 * succeeded (e.g. 3-D Secure was *initiated*) — it is NOT proof of payment. An
 * order is actually paid ONLY when its status is CAPTURED. Confirming on `result`
 * alone falsely marks a booking paid when the shopper merely started (and
 * abandoned) 3-D Secure.
 *
 *  - success  → status CAPTURED (funds actually captured — this, not `result`,
 *               is the source of truth)
 *  - failed   → order reached a terminal failure (CANCELLED / EXPIRED / FAILED)
 *  - declined → a plain transaction FAILURE — a card decline, no funds, retryable
 *  - pending  → anything still in flight (AUTHENTICATION_INITIATED, AUTHORIZED,
 *               PENDING, …) — keep polling, do not confirm or fail
 */
export function classifyMpgsOrder(result: string, status: string): MpgsOrderDecision {
  if (status === 'CAPTURED') return 'success';
  if (status === 'CANCELLED' || status === 'EXPIRED' || status === 'FAILED') return 'failed';
  if (result === 'FAILURE') return 'declined';
  return 'pending';
}

/**
 * Map a CAPTURED order's confirm outcome to the caller-facing verify status.
 *
 * A capture normally means 'success', with two exceptions reported by the sync
 * engine (`handleEvent`):
 *  - `unconfirmable` set → the booking can never confirm and the charge is being
 *    auto-refunded → 'refunded' (the payer must NOT land on the success page).
 *  - no outcome at all (the confirm race lost every retry) → 'success': the
 *    winning transaction (or the reconciler) confirms the booking; reporting
 *    failure here dumped a PAID customer on /booking/failed (the original race
 *    bug this module exists to prevent).
 */
export function resolveCapturedOutcome(outcome: { unconfirmable?: string } | null): Extract<
  MpgsVerifyStatus,
  'success' | 'refunded'
> {
  return outcome?.unconfirmable ? 'refunded' : 'success';
}
