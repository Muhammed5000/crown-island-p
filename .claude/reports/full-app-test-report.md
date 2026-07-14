# Full App Test Report

## Overall result
**PARTIAL PASS** — Production build, unit tests, and all critical smoke flows pass. Blocking concerns are limited to pre-existing code-quality debt (lint/typecheck scripts red but non-blocking for the Next 16 build), one high-severity dependency advisory with no fix, and a few minor hardening items.

## Environment
- Date: 2026-06-01
- Branch/commit: `main` @ `77071e8`
- Stack detected: Next.js 16.2.6 (App Router, `proxy.ts` middleware), React 18, TypeScript, Prisma + SQLite (`prisma/dev.db`), NextAuth (Auth.js), next-intl (ar/en), TailwindCSS, Redux Toolkit. Payments: Paymob. Email: Resend. QR: `qrcode` + `jsqr`.
- Package manager: npm
- Services used: local SQLite dev.db only. No external/production services contacted. Prod server booted locally on port 3100 for smoke tests.

## Commands run
| Check | Command | Result | Notes |
|---|---|---|---|
| Lint | `npm run lint` (`eslint .`) | ❌ FAIL | 18 errors, 26 warnings — all pre-existing, repo-wide. None in recently changed files. Not run by `next build` in Next 16. |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | ❌ FAIL | 2 errors, both in `src/server/audit/sanitize.test.ts` (TS2532). Pre-existing; did not block the build. |
| Unit tests | `npx tsx --test` ×3 files | ✅ PASS | 26/26 pass (sanitize 11, breadcrumbs 11, auth-bootstrap 4). No `test` script; uses Node `node:test`. |
| Build | `npm run build` (`next build`) | ✅ PASS | Exit 0. All 51 routes compiled (all dynamic / server-rendered). |
| Dependency audit | `npm audit --audit-level=moderate` | ⚠️ 3 vulns | 1 high (`xlsx`, no fix), 2 moderate (`postcss` via `next`). |
| Secret scan (manual) | `git grep` + `.env` tracking check | ⚠️ minor | `.env` correctly gitignored (not committed). 1 hardcoded password in a dev script. |
| gitleaks / osv-scanner / trivy / semgrep | — | ⏭️ SKIPPED | Not installed on this machine. |

## Functional test results
- **App startup:** ✅ Booted via `next start` in ~2s, no crash.
- **Health check:** N/A (no dedicated health endpoint).
- **Main user flows (HTTP smoke):**
  - `/` → 307 (locale redirect) ✅
  - `/en` landing → 200 ✅
  - `/en/login` → 200 ✅
  - `/en/admin/login` → 200 ✅
  - `/en/booking` (gated) → 307 redirect to auth ✅
  - `/en/gate/scan` (gated) → 307 ✅
- **API checks / access control:**
  - `POST /api/gate/verify` (no auth) → **401** ✅ staff-only enforced
  - `POST /api/gate/check-in` (no auth) → **401** ✅
  - `GET /api/gate/verify` → **405** ✅ (POST-only)
  - `POST /api/paymob/webhook` (bad/missing HMAC) → **401 invalid_signature** ✅ signature verification working
  - `GET /api/admin/export` (no auth) → **500** ⚠️ access denied but wrong status (see Failures)
- **E2E/browser checks:** ⏭️ none — no Playwright/Cypress installed. Camera-based gate scanning and authenticated booking→payment→QR flows not exercised end-to-end (need sandbox creds / live camera).

## Security smoke results
- **Secret scan:** `.env` is gitignored and not committed ✅. No live API keys found in tracked source. One hardcoded dev-script password (`scripts/create-developer.ts`).
- **Dependency audit:**
  - `xlsx` **HIGH** — Prototype Pollution + ReDoS, **no fix available**. Used for admin XLSX *export* (writing), authenticated/admin-only; real-world exposure is low unless it ever parses untrusted uploads.
  - `postcss` <8.5.10 **MODERATE** (XSS in stringify) — pulled via `next`'s nested copy; build-time only.
- **Security headers** (verified on `/en/login`): `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(self)` ✅. No `Content-Security-Policy` or `Strict-Transport-Security` (recommended additions).
- **Auth/access control observations:** Gate + admin + webhook endpoints all reject unauthenticated/invalid requests. NextAuth gating redirects protected pages. `auth-bootstrap.test.ts` actively guards against the historical "env-email → SUPER_ADMIN" privilege-escalation regression ✅.

## Failures and evidence
1. **Lint script fails — 18 errors (pre-existing, repo-wide)**
   - Command: `npm run lint`
   - Representative errors: `@typescript-eslint/no-explicit-any` (`Chart.tsx`, `booking/review/page.tsx`, `api/admin/export/route.ts`, `PremiumBookingExport.tsx`, `capacity/page.tsx`); `react/no-unescaped-entities` (`CategoryForm.tsx`, `ProfessionalReport.tsx`); React-Compiler rules `react-hooks/purity` + `react-hooks/set-state-in-effect` in `NotificationCenter.tsx` (lines 82, 148, 157, 313 — `Date.now()` in render & setState-in-effect).
   - Likely cause: React Compiler ESLint ruleset is stricter than the code predates; `any` usage in chart/export utilities.
   - Recommended fix: address `NotificationCenter.tsx` purity issues (compute `Date.now()` in an effect/ref), type the chart/export `any`s, escape JSX quotes. Not build-blocking, but should be burned down.

2. **Typecheck script fails — 2 errors in a test file**
   - Command: `npm run typecheck`
   - Evidence: `src/server/audit/sanitize.test.ts(141,142): error TS2532: Object is possibly 'undefined'`.
   - Likely cause: test indexes an array without a non-null assertion under `strict`.
   - Recommended fix: add guards/`!` in the test; or exclude `*.test.ts` from the typecheck tsconfig. (Did not block `next build`.)

3. **`GET /api/admin/export` returns 500 instead of 401/403 when unauthenticated**
   - Evidence: route calls `requireAdmin()` which **throws** on no session, so the `if (!admin) return 401` branch is dead code; the throw is caught by the `try/catch` → 500.
   - Impact: access is correctly denied (no data returned) — this is a status-code/error-handling correctness issue, **not** a data leak.
   - Recommended fix: catch `AuthorizationError` and return 401/403, or make `requireAdmin()` return null and keep the guard branch.

4. **`xlsx` high-severity advisory, no upstream fix**
   - Recommended fix: ensure `xlsx` is never used to parse untrusted/user-supplied files; consider migrating exports to `exceljs` (maintained) or isolating xlsx behind admin-only writes (current usage). Track the advisory.

5. **Hardcoded password in dev script**
   - Evidence: `scripts/create-developer.ts:8` → `const password = 'DeveloperPassword123!'`.
   - Impact: low (manual dev tooling, not shipped in the app), but a predictable default credential.
   - Recommended fix: read from env / prompt, and ensure such accounts aren't created in production.

## Untested areas
- Authenticated end-to-end journeys: booking creation → Paymob payment → QR issuance → **gate QR scan/check-in** (needs sandbox Paymob keys + a live camera; external-service rule). The QR-decode robustness fix in `Viewfinder.tsx` compiled and is included in the build, but was not exercised against a real camera here.
- Email sending (Resend) — not triggered (would hit a real provider).
- Role-based access for the full admin surface (only API-level auth gating was probed, not per-role UI).
- Browser/UI rendering, accessibility, and the recent desktop redesigns (history/settings/confirmation/details) — no E2E framework installed.
- i18n RTL (Arabic) rendering.

## Recommended next steps (by priority)
1. **Fix `/api/admin/export` 500 → 401/403** (quick, correctness/clarity).
2. **Add a real test runner + smoke E2E** (Vitest for the existing `node:test` files + Playwright for login/booking/gate). Wire a `test` script and a CI workflow (none exists today).
3. **Burn down lint/type errors** so `npm run lint`/`typecheck` are green and can gate CI; fix `NotificationCenter.tsx` purity issues first (these are genuine React correctness smells).
4. **Address dependency advisories**: confirm `xlsx` only writes (never parses untrusted input) or migrate off it; let `postcss` resolve via a `next` minor bump.
5. **Harden headers**: add `Content-Security-Policy` and `Strict-Transport-Security` (HSTS) in `next.config.mjs`.
6. **Manually verify the gate QR scan** end-to-end on the target kiosk/device (the area the user just reported), since automated camera testing isn't possible here.
