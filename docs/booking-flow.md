# Crown Island — ACID Booking & Payment Flow

> **Verified project status (2026-07-11):** The Paymob-specific sections below
> are preserved as historical design context and must not be used as an
> implementation/runbook. The current gateway is Crédit Agricole MPGS: Hosted
> Checkout → webhook/browser check/reconciler → authoritative RETRIEVE_ORDER →
> `src/server/payments/sync.ts`. The current invariants remain server-computed
> price, Serializable confirmation-time capacity checks, idempotency, and
> auto-refund when a capture cannot confirm.

This document is the authoritative spec for how a booking moves from "user tapped Book" to "QR ticket in hand," with the invariants that protect against double-booking, price drift, and payment desync.

---

## 1. Invariants (must always hold)

1. **No double booking** — for a given `(serviceId, date, slot)` the sum of confirmed people/cars never exceeds capacity.
2. **No client-trusted price** — the price stored on the invoice is computed by the server from rule rows at booking-creation time.
3. **No client-confirmed booking** — `BookingStatus.CONFIRMED` is only ever set inside a verified Paymob webhook handler (or an admin override that writes an audit log).
4. **No duplicate charge** — Paymob intentions are looked up by `Payment.paymobOrderId`; webhook arrivals are deduped by `paymobTransactionId`.
5. **Booking ↔ payment status sync** — `Booking.status` and `Payment.status` transition together in one DB transaction.
6. **Immutable invoice** — once `InvoiceStatus.PAID`, the invoice rows (lines, totals) are never mutated. Refunds add new rows.

---

## 2. States

```
BookingStatus:   PENDING_PAYMENT ─► CONFIRMED ─► ACTIVE ─► EXPIRED
                       │            (= ACTIVE
                       │             until date passes)
                       ├─► FAILED       (payment failed)
                       └─► CANCELLED    (user/admin)

PaymentStatus:   PENDING ─► SUCCEEDED
                       └─► FAILED   ─► REFUNDED

InvoiceStatus:   DRAFT   ─► ISSUED ─► PAID
                                  └─► FAILED / CANCELLED
```

> "ACTIVE" is a derived view of `CONFIRMED` bookings whose date is today or future. It is computed on read, *not* persisted, to avoid a write race; "EXPIRED" is persisted by a periodic job and also lazily on read.

---

## 3. Step-by-step (happy path)

### Step 1 — Selection (UI only)

User picks category → service → date → people → cars. State lives in Redux. **No server call yet** that holds capacity.

### Step 2 — Review (server price quote)

UI calls `bookingActions.quote({ serviceId, date, people, cars })`. Server:

1. Loads `Service`, `Category`, and active `PriceRule` rows.
2. Computes the price breakdown (`computePrice`).
3. Returns `{ total, lines, taxes }` — **never** echoes a client-supplied price.

The quote is not persisted; if the user reloads, we recompute.

### Step 3 — Create booking (transactional)

UI calls `bookingActions.create({ ... , clientRequestId })`. Server runs:

```
prisma.$transaction(async (tx) => {
  // (a) Re-validate inputs (Zod) and re-check that service+category are ACTIVE.

  // (b) Recompute price from PriceRule rows. Compare to last quote ID if supplied;
  //     if they differ, throw PriceChangedError.

  // (c) Capacity check WITH transaction-isolated row locks:
  //     SELECT remaining FROM availability WHERE service=? AND date=? FOR UPDATE
  //     If insufficient → throw CapacityError.

  // (d) Insert Booking with status=PENDING_PAYMENT and a unique (userId, clientRequestId)
  //     constraint so a retried request returns the SAME booking (idempotency).

  // (e) Insert Invoice (DRAFT) + InvoiceLines snapshotting the computed price.

  // (f) Insert Payment row (PENDING) but DO NOT call Paymob yet.

  return booking;
});
```

Key DB constructs:

- `Booking.uq_user_clientRequestId` — `UNIQUE(userId, clientRequestId)` so retries collapse.
- `BookingSlot.uq_service_date_slot` — one confirmed-capacity counter row per service/day. **Pending bookings reserve NOTHING**: capacity is re-validated inside the Serializable payment-confirm transaction (the C-1 guard in `src/server/payments/sync.ts`), and the unlucky second payer whose capacity filled while paying is automatically refunded (`src/server/payments/auto-refund.ts`) with the booking cancelled. (`BookingHold` still exists in the schema but is deprecated and entirely unused — no code creates, consumes, or expires holds.)

If the transaction throws, nothing is left behind. If it commits, the user has a `PENDING_PAYMENT` booking with a frozen price.

### Step 4 — Paymob intention (idempotent)

Server creates a Paymob intention **outside** the transaction (Paymob is an external system):

```
const response = await fetch('https://accept.paymob.com/v1/intention/', {
  method: 'POST',
  headers: { Authorization: `Token ${PAYMOB_SECRET_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    amount: invoice.totalCents,
    currency: 'EGP',
    payment_methods: PAYMOB_INTEGRATION_IDS,
    special_reference: `${booking.reference}:${payment.id}`,
    notification_url: '<absolute-origin>/api/paymob/webhook',
    redirection_url: '<absolute-origin>/booking/success?bid=...',
    billing_data: { ... },
    extras: { bookingId, paymentId, userId, invoiceId },
  }),
});
// Persist response.id → Payment.paymobOrderId; the response.client_secret is what
// the unified-checkout iframe consumes.
```

If Paymob is unreachable, the booking remains `PENDING_PAYMENT` and the user retries the page to create a fresh intention.

### Step 5 — User pays (client)

The Paymob unified-checkout iframe (loaded from `https://accept.paymob.com/unifiedcheckout/?publicKey=…&clientSecret=…`) collects the card / wallet. The client **never** writes booking status. On success, Paymob redirects to `/booking/success?bid=…`.

The success screen renders an **optimistic** "payment processing" state but waits for the webhook before showing the QR.

### Step 6 — Webhook (authoritative confirmation)

`POST /api/paymob/webhook` verifies the HMAC-SHA512 signature, then dispatches the Paymob transaction object:

- `obj.success === true` → transactional confirm
- `obj.success === false` (and not pending) → transactional fail
- `obj.is_refunded === true` (or has a parent transaction) → transactional refund

The success handler:

```
prisma.$transaction(async (tx) => {
  const payment = await tx.payment.findUnique({ where: { paymobOrderId }, include: { booking: { include: { invoice: true } } } });
  if (!payment) return; // unknown intention → ignore (idempotent)
  if (payment.status === 'SUCCEEDED') return; // already processed

  await tx.payment.update({ where: { id: payment.id }, data: { status: 'SUCCEEDED', paidAt: new Date(), paymobTransactionId } });
  await tx.invoice.update({ where: { id: payment.booking.invoice.id }, data: { status: 'PAID' } });
  await tx.booking.update({ where: { id: payment.booking.id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });

  // Re-validate capacity against LIVE confirmed counters (C-1 guard), then
  // increment BookingSlot — see src/server/payments/sync.ts handleSucceeded
  await tx.bookingSlot.upsert({ ... });

  // QR is *derived* — store a signed payload but no QR image is precomputed.
});
```

The handler is **idempotent**: receiving the same event twice is a no-op after the first commit.

### Step 7 — QR & success

Once the webhook has run, the client (which is polling `/api/bookings/:id` or has been re-rendered) sees `status=CONFIRMED` and the success screen renders the QR:

- The QR encodes a signed JWT-like payload: `{ bookingId, userId, exp }`.
- The QR PNG/SVG is generated on demand by `/api/bookings/:id/qr` after re-checking ownership and status.
- An admin scanning the QR hits a verification endpoint that re-reads the booking and refuses if `status !== CONFIRMED` or the date has passed.

### Step 8 — Booking history

`/bookings/history` lists the user's bookings. `Booking.status` is rendered as-is, with the special case:

```
displayStatus(b) = b.status === 'CONFIRMED' && b.bookingDate < today ? 'EXPIRED' : b.status
```

A nightly job (or on-demand when listing) updates the persisted status from `CONFIRMED → EXPIRED`.

---

## 4. Failure modes & how they're handled

| Scenario                                              | Behaviour                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| User taps "Pay" twice quickly                         | Same `clientRequestId` → same booking; same intention call returns the same checkout URL.  |
| Webhook arrives twice                                 | First commit transitions status; second commit is a no-op (`if (status==='SUCCEEDED') return`). |
| Webhook lost / delayed                                | Booking stays `PENDING_PAYMENT`. The customer can also be re-routed to the success URL Paymob redirects to; a background reconciler replays the webhook handler if needed. |
| Card declined                                         | Webhook marks `Payment.FAILED`, `Invoice.FAILED`, `Booking.FAILED`. Nothing to release (pending bookings hold no capacity). User can start a new booking. |
| Price changed between Step 2 and Step 3               | Server recomputes in transaction; if total differs from the user's last seen quote, returns `PRICE_CHANGED` so UI re-shows the review. |
| Capacity disappeared between Step 2 and Step 3        | Capacity check throws inside transaction; nothing is persisted; UI shows "no longer available." |
| Admin edits price while booking pending               | The pending booking already has its snapshot in `InvoiceLine`. Admin edits affect *future* bookings only. Audit log records the change. |
| User abandons after Step 3 (no payment)               | The booking simply stays `PENDING_PAYMENT` (it holds no capacity, so nothing leaks). History display expires it visually after the visit date; the payment reconciler flags payments still PENDING after 72h for manual review. |
| Capacity filled while the user was paying             | The confirm-time C-1 re-check refuses confirmation, the captured charge is auto-refunded, and the booking is cancelled — the payer lands on the failed page with a refund notice. |
| Paymob webhook arrives but Booking already CANCELLED  | Refund flow is triggered (or the payment is left as orphaned + logged for manual review).  |
| Duplicate webhook race                                | DB unique constraint on `Payment.paymobTransactionId` collapses replays. |

---

## 5. Concurrency primitives in the schema

- `Booking.uq_user_clientRequestId UNIQUE(userId, clientRequestId)` — idempotent booking creation.
- `Payment.uq_paymobTransactionId UNIQUE(paymobTransactionId)` — idempotent webhook replays.
- Confirmed capacity is enforced by re-checking the live `BookingSlot` counters inside the **Serializable** confirm transaction and refusing (→ auto-refund) if exceeded. There is no soft-hold table in use (`BookingHold` is deprecated/unused).
- All multi-row writes use `prisma.$transaction([...])` or the interactive `prisma.$transaction(async tx => …)` form.

---

## 6. Refunds (admin)

1. Admin issues refund via dashboard → `adminRefundBooking(bookingId, reason)`.
2. Server calls `POST /api/acceptance/void_refund/refund` against Paymob with the original `paymobTransactionId` and the invoice total.
3. The refund webhook lands at `/api/paymob/webhook` (`obj.is_refunded === true`) → transactional update: `Payment.REFUNDED`, `Booking.CANCELLED`, audit log written.
4. The original invoice is **not** mutated; a `RefundLine` is appended.

---

## 7. What is *never* allowed

- Setting `Booking.status` from a route handler outside the webhook path (except admin cancel).
- Trusting `price`, `userId`, `bookingId`, or `status` from the request body.
- Generating a QR for a booking with `status != CONFIRMED`.
- Reading another user's booking without `session.user.role === 'ADMIN'`.
- Committing an admin price change without an `AuditLog` row in the same transaction.
