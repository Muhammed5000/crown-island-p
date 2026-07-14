import {
  canAccessAdmin,
  canAccessOps,
  canAccessReception,
  canViewGateMoney,
} from '@/server/auth/roles';

/**
 * Pure object-level authorization for the secure-media route (no
 * server-only/Prisma deps — testable; roles.ts is edge-safe).
 *
 * Why: `/api/secure-media/**` URLs carry no entity info (`/YYYY/MM/<hex>.<ext>`),
 * so the route reverse-looks-up the URL in the referencing tables and asks this
 * policy whether THIS staff member may see THAT object. Before this, the check
 * was role-only: any gate-authorised account could fetch any guest's ID photo
 * by URL (lateral access across every guest who ever visited).
 *
 * Policy (product decision, 2026-07-05):
 *  - ADMIN tiers: everything.
 *  - Guest ID images: reception ladder (STAFF…DIRECTOR) keeps BROAD access —
 *    the returning-guest prefill flow legitimately browses past guests' saved
 *    IDs — every access is audit-logged by the route. SECURITY (gate scanner)
 *    is scoped to what the gate needs: IDs it uploaded itself, or IDs of a
 *    CONFIRMED booking whose visit window is current (±1 day of today).
 *    HOUSEKEEPING/MAINTENANCE have no business need → denied.
 *  - Payment proofs: money-visible roles only (mirrors the gate money-blind
 *    policy); no time scope — reception reviews old invoices.
 *  - Ops proofs: ops-authorised roles (everything gate-side except SECURITY).
 *  - Unattached (in the Media manifest, referenced by nothing yet — the
 *    reception wizard's deferred-commit window): the UPLOADER themself only.
 *  - Unowned URL (no referencing row, no Media row): admin-only, fail closed.
 */
export type SecureMediaOwner =
  | {
      type: 'guestId';
      uploadedById: string;
      bookingStatus: string;
      /** Booking day keys — UTC-midnight ms of the resort-local civil day. */
      visitStartDayUTC: number;
      visitEndDayUTC: number;
    }
  | { type: 'paymentProof' }
  | { type: 'opsProof' }
  /**
   * In the Media manifest but not yet referenced by any entity — the reception
   * wizard's deferred-commit window: IDs/proofs are uploaded BEFORE the booking
   * exists, so no GuestIdDocument/Payment row points at the URL yet.
   */
  | { type: 'unattached'; uploadedById: string | null }
  | { type: 'unowned' };

const DAY_MS = 86_400_000;

export function decideSecureMediaAccess(input: {
  role: string | null | undefined;
  userId: string;
  owner: SecureMediaOwner;
  /** Today as a resort-local civil-day key (resortCivilDayUTC()). */
  todayDayUTC: number;
}): boolean {
  const { role, userId, owner, todayDayUTC } = input;

  if (canAccessAdmin(role)) return true;

  switch (owner.type) {
    case 'guestId': {
      // Reception ladder: broad (audited) access — prefill needs history.
      if (canAccessReception(role)) return true;
      // Gate scanner (SECURITY): own uploads, or a current CONFIRMED visit.
      if (role === 'SECURITY') {
        if (owner.uploadedById === userId) return true;
        return (
          owner.bookingStatus === 'CONFIRMED' &&
          todayDayUTC >= owner.visitStartDayUTC - DAY_MS &&
          todayDayUTC <= owner.visitEndDayUTC + DAY_MS
        );
      }
      // HOUSEKEEPING / MAINTENANCE (and anything else): no business need.
      return false;
    }
    case 'paymentProof':
      return canViewGateMoney(role);
    case 'opsProof':
      return canAccessOps(role);
    case 'unattached':
      // Mid-wizard upload (deferred commit — booking not created yet): only the
      // staff member who uploaded it may preview it. Once the booking commits,
      // the URL becomes referenced and flows through the branches above.
      return owner.uploadedById !== null && owner.uploadedById === userId;
    case 'unowned':
      // A sensitive file nothing references (its DB write failed, or the row
      // was deleted) — admin-only until someone investigates. Fail closed.
      return false;
  }
}
