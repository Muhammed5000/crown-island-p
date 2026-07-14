# Crown Island — System Architecture

> Premium booking PWA for **Crown Island — El Montazah**.
> Single Next.js (App Router) deployment hosting both the public PWA and the admin dashboard.

> **Verified 2026-07-11:** The running stack is Next.js 16 and Crédit Agricole
> MPGS Hosted Checkout. Paymob paths and Next.js 15 references in older history
> are obsolete; current payment code lives in `src/server/credit-agricole/` and
> confirmation converges through `src/server/payments/sync.ts`.

---

## 1. Goals

- **Mobile-first** premium dark-navy / gold experience inspired by `docs/reference/ui-reference.png`.
- **PWA** — installable, offline fallback, app-feel.
- **ACID booking & payment** — never overbook, never charge twice, never desynchronize booking ↔ payment state.
- **i18n (AR / EN)** with RTL flip for Arabic. Zero hardcoded UI strings.
- **Single deployable** — `/` user app + `/admin` dashboard, RBAC-gated.

---

## 2. High-level architecture

```
                ┌───────────────────────────────────────────────┐
   Browser ────►│  Next.js 16 (App Router)                      │
   (PWA)        │  ┌─────────────┐   ┌──────────────────────┐   │
                │  │ RSC / pages │   │ Server Actions /     │   │
                │  │ Tailwind UI │   │ Route Handlers (API) │   │
                │  └─────┬───────┘   └─────────┬────────────┘   │
                │        │                     │                 │
                │        ▼                     ▼                 │
                │  ┌──────────────────────────────────────┐      │
                │  │   Service layer (use-cases)          │      │
                │  │   - BookingService                   │      │
                │  │   - PricingService                   │      │
                │  │   - PaymentService                   │      │
                │  │   - AuthService / RBAC               │      │
                │  └──────────────┬───────────────────────┘      │
                │                 ▼                              │
                │  ┌──────────────────────────────────────┐      │
                │  │  Repository layer (Prisma)           │      │
                │  └──────────────┬───────────────────────┘      │
                └─────────────────┼──────────────────────────────┘
                                  ▼
                          ┌───────────────┐
                          │  PostgreSQL    │ (ACID, FK, unique constraints)
                          └───────────────┘
                                  ▲
                                  │ webhook
                  ┌────────────────────────────────┐
                  │  Crédit Agricole MPGS          │
                  └────────────────────────────────┘
```

### Why these choices

| Concern         | Choice                          | Reason                                                                                    |
| --------------- | ------------------------------- | ----------------------------------------------------------------------------------------- |
| Framework       | **Next.js 16 (App Router)**     | Single deployable for SSR PWA + admin; server actions; RSC.                               |
| DB              | **PostgreSQL** via **Prisma**   | Strong relational + ACID guarantees, unique partial indexes for double-book prevention.   |
| Auth            | **NextAuth v5 (Auth.js)**       | First-class App Router support; OAuth (Google/FB/Apple) + Credentials for OTP placeholder.|
| State (client)  | **Redux Toolkit**               | Booking-flow wizard state across steps; theme / language UI preferences.                  |
| Payments        | **Crédit Agricole MPGS**        | Hosted Checkout + server-side RETRIEVE_ORDER; notifications trigger verification.         |
| i18n            | **next-intl**                   | App Router-native, supports RTL, message routing, type-safe keys.                         |
| Maps            | **Leaflet + react-leaflet**     | OSS, no API key, easy markers/routes.                                                     |
| PWA             | Manual manifest + SW            | Avoids `next-pwa` lock-in; small surface.                                                 |
| Animations      | **Framer Motion**               | Tween/spring page transitions; mobile gestures.                                           |
| Validation      | **Zod**                         | Same schema reused for client form + server action.                                       |
| QR              | **qrcode**                      | Server-rendered PNG/SVG QR after webhook success.                                         |

---

## 3. Folder structure

```
.
├── docs/                          # Architecture, flow, tasks, UI reference
├── prisma/
│   ├── schema.prisma              # Source of truth for DB
│   ├── seed.ts                    # Seeds Crown Surge / Solace / Club + services
│   └── migrations/                # Generated migrations
├── public/
│   ├── icons/                     # PWA icons
│   ├── manifest.webmanifest
│   └── offline.html
└── src/
    ├── app/                       # Next.js App Router
    │   ├── (marketing)/           # Public landing
    │   ├── (app)/                 # Authenticated user PWA
    │   │   ├── booking/
    │   │   ├── bookings/
    │   │   ├── map/
    │   │   ├── menu/
    │   │   ├── settings/
    │   │   └── support/
    │   ├── (auth)/                # Login + profile completion
    │   ├── admin/                 # Admin dashboard (RBAC-guarded)
    │   ├── api/                   # Route handlers (Paymob webhook, etc.)
    │   ├── layout.tsx             # Root layout w/ providers
    │   └── globals.css            # Tailwind + design tokens
    ├── components/
    │   ├── ui/                    # Generic primitives (Button, Card, Input, …)
    │   ├── layout/                # Header, BottomNav, AdminShell, …
    │   ├── booking/               # Step-specific components
    │   ├── admin/                 # Admin-specific components
    │   └── icons/                 # Logo, brand marks
    ├── features/                  # Feature slices (Redux + hooks)
    │   ├── booking/
    │   ├── auth/
    │   └── preferences/
    ├── server/                    # Server-only code (never imported by client)
    │   ├── services/              # Use-cases (BookingService, PricingService, …)
    │   ├── repositories/          # Prisma data access
    │   ├── auth/                  # NextAuth config, callbacks, RBAC guards
    │   ├── paymob/                # Paymob client + helpers
    │   ├── audit/                 # Audit-log writer
    │   └── db/                    # Prisma client singleton
    ├── lib/                       # Pure utilities (date, money, qr, cn)
    ├── i18n/                      # next-intl config + locales
    ├── messages/                  # ar.json + en.json
    ├── store/                     # Redux store + slices
    ├── styles/                    # Token CSS variables
    ├── types/                     # Shared TS types
    └── middleware.ts              # i18n + auth middleware
```

---

## 4. Layered responsibility

- **App Router pages / route handlers** — thin. Parse input, call a service, render.
- **Services** (`src/server/services/*`) — own the *use case*. Wrap multi-step DB work in `prisma.$transaction`. Enforce invariants. Server-side price calc lives here.
- **Repositories** (`src/server/repositories/*`) — Prisma queries. No business logic.
- **Audit** — every admin mutation goes through `auditService.record(...)`.
- **Client (Redux + RSC)** — owns *UI state only* (the in-progress wizard, theme, locale). Authoritative data always comes from the server.

---

## 5. Source-of-truth rule

> Anything money-related, status-related, or capacity-related is **owned by the server**.

| Concern                  | Authoritative source             |
| ------------------------ | -------------------------------- |
| Price                    | `PricingService` server-side     |
| Available capacity       | DB (unique + transaction)        |
| Booking status           | DB row + Paymob webhook          |
| Payment status           | Paymob webhook → DB              |
| User identity / role     | NextAuth session + DB user row   |
| QR / ticket validity     | DB (only emitted post-webhook)   |

The frontend may **display** these values but never **decide** them.

---

## 6. Internationalization

- Two locales: `ar` (default, RTL) and `en` (LTR).
- `<html lang>` and `dir` are set by `src/app/layout.tsx` based on the active locale.
- All strings live in `src/messages/{ar,en}.json` keyed by feature.
- `next-intl` middleware handles locale negotiation; users may switch via `/settings`.

---

## 7. Theming

- CSS variables in `src/app/globals.css` define both `:root` (light) and `[data-theme="dark"]` palettes.
- Tailwind tokens (`tailwind.config.ts`) reference `rgb(var(--ci-*))` for runtime theme swap.
- Default is dark navy + gold; light mode is a softer linen + navy ink.

---

## 8. PWA

- `public/manifest.webmanifest` advertises icons, name, theme color (navy `#0a132a`).
- `src/app/layout.tsx` renders `<meta>` and links manifest.
- Service worker (`public/sw.js`) caches the shell and serves `public/offline.html` on network failure.
- Booking and payment endpoints **never** serve from cache.

---

## 9. Security

- All admin routes require `session.user.role in {ADMIN, SUPER_ADMIN}` — enforced in middleware **and** in the service layer (defense in depth).
- Booking ownership checks: any read/write of `Booking#X` verifies `booking.userId === session.user.id` (or admin).
- Paymob secret key never reaches the client; only `NEXT_PUBLIC_PAYMOB_PUBLIC_KEY` is exposed.
- Webhook signature is verified with `PAYMOB_HMAC_SECRET` (HMAC-SHA512 over the canonical transaction fields).
- All form input goes through Zod schemas on both sides.
- File uploads (cover images) go through a server route that validates MIME + size.

---

## 10. Audit

Every admin mutation writes an `AuditLog` row:

```
{ id, actorUserId, action, entityType, entityId, before, after, ipAddress, userAgent, createdAt }
```

The audit writer participates in the same transaction as the mutation, so an admin change either commits with its log or doesn't commit at all.

---

## 11. Observability (future)

- Structured logging via `pino` is reserved for a later phase.
- Paymob webhook events are mirrored to `Payment` + `AuditLog` rows for replayability.
