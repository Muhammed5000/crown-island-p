# Booking Insurance (Refundable Deposit) — Architecture

Status: implemented 2026-07. This document is the agreed final architecture from the
dual-proposal + mutual-criticism design review (two independent designs, cross-criticized,
disagreements resolved by code evidence). It is the reference for how insurance money and
state move through the system.

## 1. Concept

A service may require an **insurance deposit** collected together with the booking payment
and returned (or retained) at reception checkout. Insurance is a **separate financial
balance**: no voucher, promo code, or manual discount may ever reduce, cover, or consume it.

```
insurance base            = calc.subtotalCents            (eligible service total BEFORE discounts)
insurance amount          = round(base × percent / 100)   (PERCENT)  |  fixedCents (FIXED)
discounted service        = max(0, serviceTotal − discounts)
final payable             = discounted service + penalties + FULL insurance
maximum refundable        = collected insurance − Σ RefundLine(kind = INSURANCE)
```

A 100% service discount still collects the full insurance. Voucher excess never pays it.

## 2. Configuration (per service, admin-only)

`Service.insuranceEnabled` (default false), `insuranceType` (`PERCENT | FIXED`),
`insurancePercent` (integer 1..100 when PERCENT), `insuranceFixedCents` (> 0 when FIXED).
Edited on the service management form; validated by `validateInsuranceConfig` in
`src/server/services/insurance-core.ts`; catalog mutation follows the existing
`adminUpdateService` pattern (audit + `revalidateTag(CATALOG_CACHE_TAG,'max')` +
`assertNotLocalNode`). Config changes NEVER affect existing bookings (snapshot rule).

## 3. Data model

- **`BookingInsurance`** (1:1 Booking; **absence of a row = not applicable** — zero backfill):
  frozen snapshot (`type`, `percent`, `fixedCents`, `baseCents`, `amountCents`),
  collection machine (`collectionStatus PENDING | COLLECTED | VOIDED`, `collectedAt`, `paidVia`),
  decision machine (`decision UNDECIDED | REFUND | NO_REFUND`, `decidedById/At`,
  `noRefundReason` — mandatory for NO_REFUND, server-enforced).
- **`InsuranceRefund`** (append-only workflow rows, many per BookingInsurance — history of
  attempts/rejections/corrections is queryable state, never overwritten):
  `method PROVIDER | CASH | INSTAPAY`, `status AWAITING_ADMIN | PENDING_DESK | PROCESSING |
  COMPLETED | FAILED | REJECTED | MANUAL_ATTENTION`, frozen `amountCents`, `requestedById`,
  `approvedById`, `providerRefundRef` (deterministic gateway leg id `insref-{rowId}-{attempt}`),
  `attempt`, `proofUrl` (InstaPay payout proof), `failureMessage`, `completedAt`.
  A **partial unique index** (raw SQL) allows at most one ACTIVE
  (`AWAITING_ADMIN|PENDING_DESK|PROCESSING`) row per BookingInsurance; transitions are
  atomic-claim `updateMany` conditioned on the from-state (0 rows ⇒ 409), the same proven
  pattern as cancellation-requests and the H2 payment claim.
- **`RefundLine.kind`** (`SERVICE | INSURANCE`, default SERVICE): RefundLine remains the ONE
  append-only money-out ledger (sync, reports, netting) — `kind` keeps the pools disjoint.
  Every insurance payout (provider, cash, InstaPay) writes a RefundLine kind INSURANCE with a
  unique `paymobRefundId` (real gateway leg id, or `INS_DESK:{refundRowId}` desk marker).
  Σ RefundLine(kind=INSURANCE) per invoice is the single source of refunded-insurance truth
  (no duplicated counter column).
- The insurance charge also appears as an **InvoiceLine** `meta.kind='INSURANCE'`
  (label key `services.insurance`), like SANCTION lines. `Invoice.subtotalCents` stays
  service-only pre-discount; `Invoice.totalCents` = grand payable including insurance.

## 4. Calculation and collection

- `calcBooking()` computes `insuranceCents` + `insuranceSnapshot` as EXTRA output fields on
  `BookingCalcResult` (both the unit-regime and LEGACY return branches). `calc.subtotalCents`
  and `calc.totalCents` are **unchanged** (service-only) — the discount base and
  `reverify.ts` comparison survive untouched, which makes discounting insurance structurally
  impossible.
- One helper assembles every grand total (`assembleFinalTotalCents` in insurance-core):
  online commit, online quote/review surfaces, and reception commit all use it — no surface
  hand-adds insurance. `expectedTotalCents` compares against the insurance-inclusive grand
  total. `payment.amountCents` = grand total, so the MPGS capture equality check is unchanged.
- Reception: `finalTotalCents = max(0, calc.totalCents − discountCents) + penalties + insurance`
  — insurance sits OUTSIDE the discount clamp; a belt-and-braces assert rejects any total
  below `insurance + penalties`.
- Collection: online — the capture-confirm transaction flips `PENDING → COLLECTED`
  (only on provider confirmation). Reception — row is created `COLLECTED` in the same
  Serializable commit as the SUCCEEDED CASH/INSTAPAY payment. Discounts/vouchers are never a
  collection method.
- VOIDED: every path that terminalizes an unpaid booking flips PENDING insurance to VOIDED
  (gateway FAILED, admin cancel-payment, customer self-cancel of unpaid, full-capture
  auto-refund) + the insurance sweep is the backstop for any missed path.

## 5. Refund flows

**Checkout decision (reception)**: the checkout window (`/gate/reception/checkout/[bookingId]`)
forces REFUND or NO_REFUND (+ mandatory stored reason). Gate: atomic
`updateMany(decision:'UNDECIDED', collectionStatus:'COLLECTED')` — the claim winner creates
the InsuranceRefund row. Method derives from the ORIGINAL payment (server-side, from the
Payment row, never client input): card ⇒ PROVIDER/AWAITING_ADMIN; CASH/INSTAPAY ⇒ PENDING_DESK.
Cross-method is rejected (no cash refunds of card payments and vice versa).

**Online (PROVIDER)**: AWAITING_ADMIN → admin queue `/admin/insurance-refunds` → approve:
(1) atomic claim → PROCESSING (+approvedById; two admins race, loser 409);
(2) headroom check `payment.amountCents − Σ RefundLine(invoice) ≥ amount`;
(3) persist `providerRefundRef = insref-{rowId}-{attempt}` BEFORE the gateway call;
(4) MPGS partial refund with that caller-supplied leg id (`refundMpgsTransaction` extended);
(5) finalize tx: RefundLine(kind INSURANCE, paymobRefundId = leg id) + COMPLETED.
Transient failure → released to AWAITING_ADMIN (retry reuses the SAME leg id until gateway
evidence proves the leg failed; only then attempt++). "Already refunded" style gateway errors
are NEVER trusted as completion — the sweep verifies by RETRIEVE_ORDER refund-leg evidence.
`Payment.status` and `Payment.REFUND_PENDING` are never touched by insurance refunds
(that claim belongs to the booking-refund machine). Executor accepts payment status
SUCCEEDED **or** REFUNDED (a fully service-refunded payment still has captured insurance).

**Cash (desk)**: PENDING_DESK → desk confirms physical payout → single tx: claim → COMPLETED
+ RefundLine(kind INSURANCE, `INS_DESK:{rowId}`) + audit.

**InstaPay (desk)**: same, plus MANDATORY proof image: uploaded via the existing
`POST /api/reception/upload` (magic-byte validated, private storage), `validateProofUrl`
re-checked server-side, stored on `InsuranceRefund.proofUrl`; served only through
`/api/secure-media` with a `resolveOwner` branch + `decideSecureMediaAccess` policy
(reception + admin; customers denied), VIEW-audited. Checkout cannot complete without it.

**Booking cancellation interplay**: when `adminRefundBooking` fully cancel-refunds a booking
whose insurance is COLLECTED+UNDECIDED, the same tx auto-sets `decision = REFUND`
(reason `booking_cancelled`) and creates the refund request — routed through the normal
approval/desk flow, NEVER auto-executed (no second gateway call inside the cancel action;
no fabricated desk payouts). The admin queue also lists PENDING_DESK rows (age-flagged) so
remotely-cancelled desk-paid deposits are visible, with an admin INSTAPAY-with-proof
completion path for guests who can't return to the desk.

**Corrections**: REJECTED (admin, note required) resets decision to UNDECIDED for
re-decision; NO_REFUND→REFUND is admin-only; completed refunds are immutable — every
correction appends rows + audit entries.

## 6. Netting invariants (double-count prevention)

- `adminRefundBooking`: tier base = `refundableBaseCents(totalCents, sanctions + insuranceAmount)`
  (deposit excluded from tiered service refunds exactly like sanctions); service remaining cap
  = `serviceTotal − Σ RefundLine(kind=SERVICE)`; payment-level hard cap
  `Σ RefundLine(all kinds) ≤ payment.amountCents`.
- `applyRefundToDb` / `refundDisposition` are kind-aware internally (all callers):
  full ⇔ Σ(SERVICE) ≥ serviceTotal (= totalCents − insurance amount). A 100% service refund
  with the deposit still held/retained correctly terminalizes the booking, reactivates
  sanctions, and un-burns the promo. Full-capture auto-refund (never-confirmed booking)
  writes one SERVICE line for the whole captured amount and VOIDs the PENDING insurance.
- `requestCancellation` freezes `lockedRefundCents` on the **service-only** base
  (insurance excluded); the deposit returns separately in full via the auto-opened request.
- `sweepStuckRefundPending` evidence extraction ignores refund legs already recorded as
  RefundLines and legs with the `insref-`/`INS_DESK:` insurance prefixes; ambiguous residual
  evidence → MANUAL_ATTENTION, never a blind REFUND_PENDING→REFUNDED flip.

## 7. Ledger identity

`collected = held + refunded + retained + voided-in-transition`, concretely:
- collected = Σ BookingInsurance.amountCents where collectionStatus = COLLECTED
- refunded = Σ RefundLine(kind = INSURANCE)
- retained = Σ amountCents where decision = NO_REFUND (own income category, never service revenue)
- held = collected − refunded − retained
Reports: service net revenue = `totalCents − insuranceAmount − Σ RefundLine(kind=SERVICE)`
(insurance sourced from the 1:1 BookingInsurance row, not InvoiceLine meta scans).
Historical data is arithmetically identical (no insurance rows/lines exist; all old
RefundLines default SERVICE). Desk deposit payouts appear as their own drawer/report figures
so cash-drawer reconciliation balances.

## 8. Sync (APP_MODE online/local)

`BookingInsurance` + `InsuranceRefund` are **online-owned**, pulled in the booking subtree
(updatedAt windows, FK order after Booking/Invoice/Payment); never PUSHABLE.
`assertNotLocalNode` guards every mutator. Local reception proxies checkout decisions and
desk executions through `POST /api/sync/insurance-action` (same auth/off-line semantics as
the reception-booking proxy — an offline desk cannot take bookings today either).

## 9. Reconciliation sweep

`sweepInsurance()` (in-process interval + `/api/cron/insurance` with `isCronAuthorized`):
- PROCESSING older than threshold → RETRIEVE_ORDER leg evidence by `providerRefundRef`
  → finalize COMPLETED / release for retry / MANUAL_ATTENTION.
- PENDING collection on terminal bookings → VOIDED (backstop).
- COLLECTED + UNDECIDED past visit end → staff notification (forgotten checkout).
- Invariant checks (anomaly classifier, pure core): refunded > collected; INSTAPAY COMPLETED
  without proof; decision REFUND with no active/completed refund row; PENDING_DESK aged.

## 10. Permissions

- Customer: read own insurance/refund status only.
- Reception (`canAccessReception`): decide eligibility, execute desk payouts, upload proof.
  Cannot configure insurance, cannot trigger provider refunds, cannot discount insurance.
- Admin (`requireAdmin`): configure per-service insurance, approve/reject/retry provider
  refunds, view proofs, run reconciliation, correct decisions (audited).
All enforced server-side; every mutation writes AuditLog rows in the same transaction.
