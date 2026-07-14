# Crown Island — Implementation Phases

> **Historical plan:** Paymob and Next.js 15 tasks below describe the original
> build. Verified current state (2026-07-11) is Next.js 16 + Crédit Agricole MPGS.

> Each phase ends with `npm run lint`, `npm run typecheck`, and `npm run build` green.
> A phase is "done" only when all three pass.

---

## Phase 0 — Foundation & Documentation ✅ *current*

- [x] Inspect existing project / capture reference image to `docs/reference/`.
- [x] Bootstrap Next.js 15 + TypeScript + Tailwind 3 + App Router.
- [x] Configure `tsconfig`, `next.config.mjs`, `tailwind.config.ts`, `.eslintrc`, `.prettierrc`.
- [x] Write `docs/architecture.md` (this folder).
- [x] Write `docs/booking-flow.md` (ACID flow).
- [x] Write `docs/tasks.md` (this file).
- [x] Add `.env.example`, `.gitignore`, README skeleton.
- [ ] `npm install` — pull deps.
- [ ] `npm run typecheck && npm run build` baseline.

## Phase 1 — Core Infrastructure

- [ ] `prisma/schema.prisma` with: `User`, `Account`, `Session`, `CustomerProfile`, `AdminRole`, `Category`, `Service`, `PriceRule`, `Booking`, `BookingHold`, `BookingSlot`, `Invoice`, `InvoiceLine`, `Payment`, `RefundLine`, `AuditLog`, `Media`.
- [ ] Enums: `BookingStatus`, `PaymentStatus`, `InvoiceStatus`, `UserRole`, `ServiceKind`.
- [ ] `prisma/seed.ts` (Crown Surge / Solace / Club + Day Use / Cabana / Event).
- [ ] `src/server/db/prisma.ts` Prisma singleton.
- [ ] `src/i18n/request.ts`, `src/messages/{ar,en}.json` skeleton.
- [ ] `src/middleware.ts` (next-intl + auth).
- [ ] `src/store/` Redux Toolkit store + slices (`bookingFlow`, `preferences`).
- [ ] `src/app/globals.css` design tokens (light + dark).
- [ ] `public/manifest.webmanifest` + icons placeholder.

## Phase 2 — Design System & Layout

- [ ] `src/components/ui/`: `Button`, `Card`, `Input`, `Label`, `Select`, `Sheet`, `Modal`, `Badge`, `Skeleton`, `Avatar`, `Switch`.
- [ ] `src/components/layout/`: `Header`, `BottomNav`, `AppShell`, `AdminShell`.
- [ ] Landing page `/` matching reference (logo, Book Now / Explore, category preview cards).
- [ ] Framer Motion page transitions wrapper.
- [ ] Theme toggle + locale toggle (in `/settings`).

## Phase 3 — Authentication

- [ ] NextAuth v5 wired with Google / Facebook / Apple / Credentials(OTP-mock).
- [ ] `/login` mobile-first UI matching reference.
- [ ] `/profile/complete` — full name, phone, email (if missing).
- [ ] Middleware: require auth on `/booking/**`, `/bookings/**`, `/admin/**`.
- [ ] RBAC: `requireUser`, `requireAdmin` helpers.

## Phase 4 — Booking Flow

- [ ] `/booking` home (category cards).
- [ ] `/booking/[categorySlug]` service list.
- [ ] `/booking/[categorySlug]/[serviceSlug]` date + people + cars.
- [ ] `/booking/review` server-priced review screen.
- [ ] `BookingService.create()` (transactional, idempotent, capacity-locked).
- [ ] `PricingService.quote()` server-only.
- [ ] Zod validation shared between client + server.

## Phase 5 — Paymob Payment + QR

- [ ] `/booking/payment` page hosting the Paymob unified-checkout iframe.
- [ ] `POST /api/paymob/create-intent` — idempotent intention creation.
- [ ] `POST /api/paymob/webhook` — HMAC-SHA512-verified, transactional state transitions.
- [ ] `/booking/success`, `/booking/failed`.
- [ ] `GET /api/bookings/:id/qr` — only when `CONFIRMED`.
- [ ] Download/share-to-phone affordance.

## Phase 6 — Booking History + Map

- [ ] `/bookings/history` list.
- [ ] `/bookings/[id]` detail with status badge + QR (if eligible).
- [ ] `/map/[bookingId]` Leaflet (dynamic import, `ssr: false`).
- [ ] External directions link (Google Maps).
- [ ] Expiry job/lazy update.

## Phase 7 — Admin Dashboard

- [ ] `/admin/login` (reuses NextAuth, role-gated).
- [ ] `/admin` overview metrics.
- [ ] `/admin/bookings` + `/admin/bookings/[id]` (search/filter).
- [ ] `/admin/categories` CRUD + cover upload + map picker.
- [ ] `/admin/services` CRUD + pricing rules.
- [ ] `/admin/pricing` rule table.
- [ ] `/admin/users`, `/admin/invoices`, `/admin/payments`.
- [ ] `/admin/audit-logs`.
- [ ] `/admin/settings`.

## Phase 8 — Polish, PWA, Seed, README ✅

- [x] Menu placeholder (`/menu` — "Coming Soon").
- [x] `/settings` (language, theme, sign out).
- [x] `/support` placeholder.
- [x] Service worker (`public/sw.js`) + `public/offline.html` + `ServiceWorkerRegister`.
- [x] Seed data executed (3 categories, 9 services, 15 price rules, 1 admin).
- [x] `README.md` complete with setup, run, env, scripts, admin credentials.
- [x] Final lint / typecheck / build pass (50 routes).

## Post-MVP work (not in original phases)

- [x] Apply Claude Design handoff visual system (`/docs/reference/`).
- [x] Fix admin redirect-loop via `(authed)` route group.
- [x] Email + password admin sign-in via Credentials provider.
- [x] SQLite default for zero-config dev; Postgres swap-in for prod.
- [x] `npm run admin:create` and `npm run admin:promote` CLIs.
