# Crown Island — Audit Remediation Backlog

Tracks everything surfaced by the 2026-06-08 commercial/technical audit: what's **done**, what's **blocked on a decision**, and what's **queued**. Work through the "Blocked" section once the open decisions are confirmed.

Legend: ✅ done · ⏳ pending (manual) · 🔒 blocked on decision · 📋 queued

---

## ✅ Done (code changes, in working tree — not yet committed)

| Item | Files |
|---|---|
| C1 — `.env` & `prisma/dev.db` untracked from git; `.gitignore` env rules re-enabled + SQLite DB ignored | `.gitignore`, `git rm --cached` |
| C2 — OAuth account-linking refused for privileged roles (`signIn` callback) | `src/server/auth/index.ts`, `src/server/auth/roles.ts` (`isPrivilegedRole`) |
| QR token verify hardened with `crypto.timingSafeEqual` | `src/lib/qr.ts` |
| National ID / passport masked (last-4 only) in admin XLSX export | `src/app/api/admin/export/route.ts` (`maskId`) |
| Upload rate-limiting (fixed-window DoS containment) on reception + admin upload routes | `src/lib/upload-rate-limit.ts`, `src/app/api/reception/upload/route.ts`, `src/app/api/admin/upload/route.ts` |
| Paymob webhook: stop logging full body (PII) on HMAC failure — log only transaction id | `src/app/api/paymob/webhook/route.ts` |
| Failed-login auditing for real accounts (bad password / customer-at-admin-door); not logged for unknown emails | `src/server/auth/providers.ts` |
| `/api/health` liveness+readiness probe (DB ping, 200/503, leak-free) | `src/app/api/health/route.ts` |
| DB-hygiene migration (6 missing indexes + 2 CHECK constraints) — **APPLIED** (verified `prisma migrate status` clean 2026-07-05; the Docker entrypoint and `npm run build` both run `migrate deploy`, so any environment deployed since carries it). On a NEW prod environment simply confirm with `npx prisma migrate status`. | `prisma/schema.prisma`, `prisma/migrations/20260608030000_perf_indexes_and_checks/` |

---

## ⏳ Pending — manual, cannot be automated (BLOCKING for launch)

These complete C1. Untracking the file does **not** invalidate the leaked values.

1. **Rotate every leaked secret** at its provider dashboard:
   - `AUTH_SECRET` (regenerate; invalidates existing sessions/JWTs — expected)
   - `PAYMOB_SECRET_KEY` + `PAYMOB_HMAC_SECRET`
   - `RESEND_API_KEY`
   - `AUTH_GOOGLE_SECRET` (Google Cloud console) — also rotate Facebook/Apple if ever real
2. **Scrub git history**: `git filter-repo --path .env --invert-paths` (or BFG), then force-push. Destructive / rewrites history — coordinate with anyone who has a clone. Hold until explicitly approved.

---

## 🔒 Blocked on a decision

### C3 — Move guest-ID images out of `public/` (PII exposure)
**Problem:** Guest national-ID / passport images are written to `public/uploads/YYYY/MM/<hex>.<ext>` and served as static files with **no auth** — anyone with the URL can fetch them.

**Decision captured:** Approach = **auth-gate now, encrypt at rest later.**
**Still needed:** deployment target (determines the storage driver).

- **If self-hosted / VPS (persistent FS):** write ID images to a private dir *outside* `public/` (e.g. `var/id-uploads/`), serve via an authenticated + audited route (`/api/secure/id/[ref]`) gated to reception/admin, log a `VIEW` audit row per access.
- **If Vercel / serverless (ephemeral FS):** local disk writes are lost — must use a blob store (Vercel Blob or S3-compatible) with short-lived signed URLs; route ID access through auth.
- **If undecided:** build a storage abstraction with a local-disk driver now + a clean seam for S3/Blob later; authenticated serving route either way.

**Touch list when unblocked:**
- New private upload path / storage driver (separate from public catalog media)
- `src/server/services/guest-id.ts` — `UPLOAD_URL_RE`, the `stat` path under `public/`, `storagePath`/`imageUrl` handling
- Split reception ID uploads from public payment-proof/catalog uploads (shared route today: `src/app/api/reception/upload/route.ts`)
- New authenticated serving route + `VIEW` audit logging
- UI components that render the stored image URLs
- **Fast-follow:** AES-256-GCM encryption at rest + key management (decrypt only in the serving route)

---

## 📋 Queued — roadmap items not yet started (from the audit)

### Week-1 security (remainder)
- ✅ ~~Audit failed-login attempts~~ — done (`providers.ts`)
- ✅ ~~Redact Paymob webhook body on HMAC failure~~ — done. _Note:_ `payments.ts` still logs a truncated Paymob **API error response** (intention/refund failures, `errText.slice(0,500/240)`). Kept intentionally — it's Paymob's own error text (no customer PII, no secrets) and operators rely on it to diagnose 4xx config issues. Revisit only if a structured logger lands.
- ✅ ~~`/api/health` endpoint~~ — done. 📋 Sentry + structured logging (pino) still queued — Sentry needs a DSN/account from you (`@sentry/nextjs` + `SENTRY_DSN`).

### Short-term (trust / safety net / revenue)
- 📋 **Test harness (C4):** Vitest + Playwright covering booking ACID, pricing, webhook HMAC, RBAC, e2e booking flow; wire CI (typecheck + lint + test)
- ✅ ~~Transactional emails: booking confirmation + refund notice~~ — done. Bilingual (ar/en from the booking's `locale` snapshot), best-effort (never blocks/​retries payment), idempotent (fire once on fresh confirm/refund), wired into the Paymob webhook + admin refund. Online bookings only (reception/walk-ins have no email). Files: `src/server/email/templates.ts`, `src/server/email/booking-emails.ts`, `webhook.ts`, `refunds.ts`, `admin-bookings.ts`. 📋 Still queued: **payment-failure notice**, **24h pre-visit reminder** (needs a scheduled job), receipt PDF attachment. Note: real delivery needs `RESEND_API_KEY` + a verified `RESEND_FROM_EMAIL` domain (else the dev mock just logs).
- 📋 WhatsApp / SMS for confirmations + payment links (Egypt-critical channel)
- ✅ ~~Promo / voucher codes~~ — done (percentage-only, staff/reception-applied). Schema + migration `20260608050000_promo_codes`; race-safe redemption (cap via conditional increment, one-per-customer via unique constraint) wired into the reception money-path; admin CRUD page at `/admin/promos` (create/activate/deactivate/delete, delete refused once used) + nav + ar/en labels; promo input in the reception wizard with friendly error mapping. 53/53 tests pass. 📋 Still open: booking add-ons (upsell); promo support on the online checkout (deliberately out of scope — staff-applied only).
- ✅ ~~DB hygiene: missing indexes + CHECK constraints~~ — prepared as migration `20260608030000_perf_indexes_and_checks` (apply with `prisma migrate deploy`).
- ✅ ~~Soft-delete on `User`~~ — done. `deletedAt` column + migration `20260608040000_user_soft_delete`; `adminDeleteUser` now archives instead of CASCADE-deleting (preserves booking/payment/audit history). Archived accounts can't authenticate (credential + admin-password providers, JWT re-hydration, and the OAuth `signIn` guard all reject `deletedAt`), are excluded from customer/user listings + export, and get no password-reset emails. Email/phone preserved on the row (re-registration of an archived email is blocked by design; releasing for reuse = separate purge flow). 44/44 unit tests pass (incl. updated auth-bootstrap deny-guard test).
  - **Two migrations now pending** — apply both with `npx prisma migrate deploy`: `20260608030000_perf_indexes_and_checks`, `20260608040000_user_soft_delete`.
- 📋 Standardize dev on PostgreSQL (drop committed SQLite parity gap)
- ✅ ~~Toast system~~ — done (`Toast.tsx`: `ToastProvider`/`useToast`, `aria-live` polite region, `role=alert` for errors, framer-motion animated; replaces `alert()` in tag/promo admin flows). ✅ ~~skip-link~~ (customer `AppShell` → `#main-content`). ✅ ~~`aria-describedby` on errors~~ (`Input` `errorId` prop + wired in `UserForm`). 📋 Still open: roll the `errorId` pattern out to the remaining forms; alt text on gallery/cover images.
- ✅ ~~Remove dead deps (Zustand, react-hook-form, @hookform/resolvers)~~; ✅ ~~consolidate theme/locale state~~ (removed the dead Redux `preferences` slice — theme lives in `ThemeProvider`/localStorage, locale in next-intl). 📋 Still open: `revalidatePath` after admin mutations; code-split jsPDF/recharts/leaflet/xlsx.

### Medium-term (CRM layer)
- ✅ ~~Tags + manual segmentation~~ — done. Admin-curated tag library (`CustomerTag` + `CustomerTagAssignment`, migration `20260608060000_customer_tags`); `/admin/tags` library page (create/colour/delete, audited; delete warns on attached customers) + nav + ar/en labels; tag chips + add/remove on the customer 360 (`TagEditor`); tag filter + chips on the customer list (filtering by tag = the manual-segment view). `Badge` now exports `BadgeTone`. 53/53 tests pass. 📋 Still open in CRM: **rule-based/saved segments**, **loyalty (points + tiers)**, **communication log**.
- 📋 Loyalty / membership ("Crown Club") + referral program
- 📋 Automation engine (abandoned-payment reminder, win-back, post-visit NPS)
- 📋 Executive analytics dashboard (occupancy, RevPAB, cohorts, churn)
- ✅ ~~Exit/checkout scan + live on-site headcount~~ — done. `Booking.checkedOutCount/At/ById` + `EXITED` scan result (migration `20260608070000`); `checkOutBooking()` (partial exits, audited); `getGateSummary.onSite` now live = Σ(in − out) + an `exited` total; gate scanner Admit/Exit toggle (mobile + desktop) + exit-aware action card + Exited stat; `POST /api/gate/check-out`; activity report counts exits separately. 📋 Consent / GDPR log + data export/delete still open.
- 📋 Background jobs (queue) for emails, hold-expiry, retries

### Long-term (platform / scale)
- 📋 Multi-tenant / white-label (tenant model, Postgres RLS, per-tenant branding) — only if selling the platform
- 📋 Predictive analytics (churn/LTV); dynamic/seasonal pricing; public API + webhooks; offline-capable gate app

---

_Source: full-codebase audit, 2026-06-08. Update statuses as items are picked up._
