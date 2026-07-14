# Crown Island Repository Review

Date: 2026-07-03
Scope: Read-only architecture, code quality, security, performance, testing, DevOps, database, frontend, backend, and product review.

No application code was changed during this review.

## 1. Executive Summary

Crown Island is a strong, production-shaped resort operations platform. The core booking, payment, reception, gate, refund, sanctions, notifications, and admin reporting workflows are materially beyond a prototype.

The codebase shows good engineering instincts in the critical areas: server-side price recalculation, payment confirmation checks, role helpers, audit logging, private sensitive uploads, Auth.js session rehydration, and a meaningful unit test suite.

The main risks are operational and maintainability risks rather than basic implementation gaps:

- Large components and services make change risky.
- Some documentation no longer matches the implementation.
- Sensitive media authorization is still broad.
- Production deployment needs stronger storage, monitoring, and worker strategy.
- Integration and end-to-end tests are missing around the highest-value flows.

Overall score: 7.2 / 10.

## 2. Architecture

Score: 7.5 / 10.

The architecture is a pragmatic modular monolith built on Next.js App Router, Prisma, Auth.js, and server-side service modules. The shape is good for the current product stage because it keeps booking, payments, reception, gate operations, and admin reporting in one deployable while still separating domain logic from route handlers and UI components.

Strong architecture areas:

- Central service layer under `src/server/services`.
- Central auth and RBAC helpers in `src/server/auth`.
- Payment provider abstraction in `src/server/payments/provider.ts`.
- Payment-specific engines under `src/server/paymob` and `src/server/credit-agricole`.
- Server actions in feature folders, with most important business logic pushed into services.
- Prisma schema and migrations are mature enough for real operations.
- Graph report indicates no import cycles in the analyzed server graph.

Main architecture risks:

- Several modules are doing too much.
- The app mixes server actions, route handlers, and large client components without a consistently documented boundary.
- In-process schedulers and cron endpoints need a clearer production worker model.
- Docs describe some flows that no longer match implementation.

Important files:

- `src/server/services/booking.ts`
- `src/server/services/booking-calc.ts`
- `src/server/paymob/webhook.ts`
- `src/server/payments/provider.ts`
- `src/server/auth/roles.ts`
- `src/server/auth/guards.ts`
- `src/proxy.ts`

## 3. System Design

The primary flow is:

1. Browser or PWA reaches the Next.js app.
2. `src/proxy.ts` applies locale, pathname, and auth handling.
3. App routes, server actions, or API routes receive the request.
4. Guards and Zod validators check identity, role, and input shape.
5. Server services execute business logic.
6. Prisma persists state to PostgreSQL.
7. External systems handle payments, email, push, ZK access control, and file storage.

The booking and payment design is especially important:

1. User calculates a quote.
2. Server recalculates price and availability.
3. Booking and pending payment are created transactionally.
4. Provider checkout is created only after re-verification.
5. Webhook or MPGS verify flow confirms the booking.
6. Capacity is updated in a transaction.
7. Invoice, payment, audit, email, QR, and ZK follow-up logic runs.

This is a good design because the server remains the source of truth for price and capacity.

The main design concern is the absence of active pending holds in source code. `BookingHold` exists in Prisma and documentation, but `src/` does not appear to use it. Current behavior seems to protect against overbooking at confirmation time, but a customer may pay and then need an auto-refund if capacity disappears before confirmation.

## 4. Code Quality

Score: 7 / 10.

Strengths:

- TypeScript is used throughout.
- Domain code generally uses typed inputs and server-only modules.
- Core pure logic has tests.
- Critical business services are readable and purposeful.
- Security and payment code is more careful than average.

Main issues:

- `src/components/gate/ReceptionDesk.tsx` is about 1,945 lines.
- `src/components/gate/GuestIdCheckIn.tsx` is about 1,357 lines.
- `src/app/[locale]/admin/(authed)/reports/page.tsx` is about 1,338 lines.
- `src/server/services/ops-tickets.ts` is about 1,278 lines.
- `src/server/services/gate-scan.ts` is about 1,130 lines.
- `src/app/[locale]/(app)/booking/[categorySlug]/SelectServiceWizard.tsx` is about 1,072 lines.
- `src/features/auth/actions.ts` is about 892 lines.

These files are not automatically bad, but they are too large for comfortable change review. They should be split by workflow, state, data loading, mutation actions, and presentational components.

Lint passed, but with 39 warnings. The warning set includes unused variables/imports, `no-explicit-any`, set-state-in-effect warnings, and missing hook dependency warnings.

## 5. Frontend

Score: 7 / 10.

Strengths:

- Rich PWA-oriented experience.
- Arabic and English internationalization.
- RTL-aware product surface.
- Booking wizard, gate desk, admin reports, ops tickets, restaurant tools, and notification center are feature-rich.
- Toast and accessibility primitives exist in parts of the UI.

Weak spots:

- Large components make UX changes expensive.
- Some flows still use `alert()` instead of the app toast/dialog system.
- Hook warnings should be cleaned up before broader frontend changes.
- Heavy libraries such as charts, PDF/export tooling, maps, and image capture should be dynamically loaded where possible.
- Accessibility should be checked with automated and manual passes, especially gate/reception/admin tools.

Priority frontend improvements:

1. Split `ReceptionDesk.tsx` and `GuestIdCheckIn.tsx`.
2. Replace raw alerts with consistent dialogs/toasts.
3. Add Playwright coverage for booking, reception check-in, gate scan, and admin reports.
4. Run bundle analysis and lazy-load export/chart/map modules.
5. Audit icon-only buttons, image alt text, focus order, and form error announcements.

## 6. Backend/API

Score: 7 / 10.

Strengths:

- Most sensitive operations go through server-side guards.
- Zod validation is widely used.
- Payment webhooks and verification flows are careful.
- Auth routes rehydrate user state from the database.
- Mobile API has a central disabled switch and bearer-token guard design.
- Cron endpoints refuse to run when `CRON_SECRET` is unset.

Concerns:

- API response formats are inconsistent across route families.
- Mobile API is currently disabled, so mobile product readiness is paused.
- Sensitive media access is role-based rather than object relationship-based.
- Some route handlers and server actions should be backed by integration tests.
- Public API documentation/versioning is limited.

Important files:

- `src/app/api/paymob/webhook/route.ts`
- `src/app/api/secure-media/[...path]/route.ts`
- `src/app/api/reception/upload/route.ts`
- `src/app/api/ops/upload/route.ts`
- `src/app/api/admin/backup/route.ts`
- `src/server/mobile/guard.ts`
- `src/server/mobile/disabled.ts`

## 7. Database

Score: 8 / 10.

The Prisma schema is broad and operationally realistic. It covers users, profiles, roles, catalog, services, places, price rules, bookings, units, slots, invoices, invoice lines, payments, refunds, audit logs, guest ID documents, gate scan events, work sessions, notifications, push subscriptions, ops tickets, restaurant data, ZK cards, promos, and settings.

Strengths:

- The model supports real resort operations, not just booking checkout.
- There are meaningful unique constraints and indexes.
- Payment and booking records are distinct, which helps reconciliation.
- Audit and soft-delete patterns exist.
- `userId + clientRequestId` idempotency is a good booking design choice.

Concerns:

- `BookingHold` exists in schema/docs, but current source code does not appear to use it.
- Documentation still describes hold consumption and cleanup.
- Backup/import is generic and powerful, so it needs strong operational controls.
- Large reporting/export flows need production query observation.

Recommendation:

Either implement the documented hold model with TTL cleanup, or explicitly document that the system confirms capacity only at payment confirmation time and can auto-refund losing races.

## 8. Security

Score: 7 / 10.

Strong areas:

- Sensitive reception and ops uploads now use private storage.
- Uploads validate MIME and file signatures in the critical reception/ops paths.
- Safe redirect helper rejects dangerous redirects.
- Auth tokenVersion invalidates sessions after sensitive user changes.
- OAuth linking is restricted for privileged accounts.
- Paymob HMAC checks and payment amount/currency validation are present.
- Cron endpoints require `CRON_SECRET` and refuse unconfigured execution.
- Admin password update now increments tokenVersion.

Main remaining risks:

1. Forwarded host trust
   - `src/app/api/auth/[...nextauth]/route.ts` rebuilds Auth.js URLs from forwarded host headers.
   - `src/lib/origin.ts` trusts host headers if `NEXT_PUBLIC_APP_URL` is unset and `TRUSTED_HOSTS` is empty.
   - Production should require a canonical app URL or explicit trusted hosts.

2. Coarse sensitive media authorization
   - `src/app/api/secure-media/[...path]/route.ts` checks staff/gate role, but not whether the user is assigned to that booking, ticket, or document.
   - Sensitive media reads should be audited.

3. Backup sensitivity
   - Developer-only backup exports can include sensitive operational data and password hashes.
   - Backup download/import should create audit records, and backups should be encrypted and access-controlled.

4. Private upload persistence
   - Docker compose mounts `public/uploads`, but not `private-uploads`.
   - Sensitive uploaded files may be lost across container rebuilds/recreates unless backed by a volume or object storage.

5. Dependency audit
   - Production audit reports two moderate findings through `exceljs -> uuid`.

6. Restaurant image upload validation
   - Restaurant PDF magic-byte validation exists.
   - Restaurant image uploads should get the same image signature validation as admin/reception/ops images.

## 9. Critical Risks

Highest-priority risks:

1. Host poisoning / forwarded host trust in production.
2. Sensitive media lateral access by any broadly authorized staff user.
3. Missing persistent storage for `private-uploads` in Docker deployment.
4. Lack of integration tests around booking/payment confirmation races.
5. Backup export sensitivity without explicit audit/encryption policy.

Recommended order:

1. Enforce canonical origin configuration.
2. Add relationship-aware checks to secure media.
3. Add Docker volume or object storage for private media.
4. Add DB-backed payment and booking integration tests.
5. Add audit records for backup export/import and sensitive media reads.

## 10. Payments

The payment layer is one of the strongest areas of the project.

Strengths:

- Server creates payment intents only after re-verifying pending payment state.
- Webhook handling validates HMAC.
- Amount and currency are checked.
- Provider transaction IDs are tracked.
- Confirmation rechecks capacity.
- Idempotency and replay handling are considered.
- Auto-refund behavior exists for unconfirmable payments.
- MPGS reconciliation path exists for browser-return failures.

Important files:

- `src/server/paymob/webhook.ts`
- `src/server/paymob/payments.ts`
- `src/server/payments/reverify.ts`
- `src/server/payments/provider.ts`
- `src/server/credit-agricole/verify.ts`
- `src/app/api/paymob/webhook/route.ts`

Main payment recommendation:

Add integration tests with a test database for webhook replay, mismatched amount, late confirmation, capacity race, failed refund path, and MPGS reconciliation.

## 11. Booking Logic

Score: 8 / 10 for business depth.

Strengths:

- Server recalculates all quote and booking values.
- Client-provided price is not trusted.
- Availability checks are centralized.
- Booking creation is transactional.
- Idempotency is handled with `clientRequestId`.
- Capacity cost calculation is centralized.
- Cancellation/refund paths distinguish pending and paid bookings.

Concerns:

- Docs describe active `BookingHold` capacity reservation, but source code does not appear to use it.
- Current model may allow a user to reach payment and later be auto-refunded due to a capacity race.
- This is safe from overbooking, but can be unpleasant for customers.

Recommendation:

Make a product decision:

- Use confirmed-only capacity and document auto-refund race behavior.
- Or implement real pending holds with TTL cleanup and confirmation consumption.

## 12. Access Control

Strengths:

- Central role helpers are a good design.
- Admin, gate, reception, ops, and money-view abilities are separated.
- Gate-only roles are confined away from admin areas.
- Server guards exist for user/admin/gate/reception/ops flows.
- Auth callback rechecks DB user state.

Concerns:

- Admin credential provider allows only selected staff/admin roles, while role helpers describe a broader staff/gate ladder.
- Confirm whether roles such as SECURITY, HOUSEKEEPING, and MAINTENANCE should be able to sign in through the staff/admin credential path.
- Secure media checks should verify object relationship, not only role class.

Important files:

- `src/server/auth/roles.ts`
- `src/server/auth/guards.ts`
- `src/server/auth/providers.ts`
- `src/server/auth/index.ts`
- `src/server/auth/config.ts`

## 13. Uploads and Media

Strengths:

- Sensitive reception and ops uploads use private storage.
- Secure media is served through an authenticated API route.
- Size checks and MIME validation exist.
- Image signature validation exists for the most sensitive upload paths.
- Public catalog/admin media is intentionally public.

Concerns:

- `private-uploads` needs persistent production storage.
- Secure media access is too broad.
- Secure media reads should be audited.
- Restaurant image upload should validate image signatures.
- Some comments still mention public paths even after private storage migration.

Important files:

- `src/lib/upload-paths.ts`
- `src/app/api/secure-media/[...path]/route.ts`
- `src/app/api/reception/upload/route.ts`
- `src/app/api/ops/upload/route.ts`
- `src/app/api/admin/upload/route.ts`
- `src/app/api/restaurant/upload/route.ts`

## 14. DevOps

Score: 6 / 10.

Strengths:

- Dockerfile exists.
- Compose setup includes Postgres, app, and cron sidecar.
- CI runs typecheck, lint, and unit tests.
- Deployment docs and systemd timer/service artifacts exist.
- Prisma migrations are part of deployment thinking.

Concerns:

- `npm run build` runs `prisma migrate deploy`, which makes build non-pure.
- CI skips `next build`, likely because build has migration side effects.
- `private-uploads` is not mounted as a compose volume.
- Monitoring, tracing, alerting, and Sentry-style error capture are still missing or incomplete.
- Backup/restore process needs a stronger operational policy.

Recommendation:

Split build and migrate into separate commands:

- `build`: generate Prisma client and build Next.js.
- `migrate:deploy`: apply migrations explicitly during deploy.
- CI should run a real production build against a safe test database or no-op migration setup.

## 15. Performance

Score: 6.5 / 10.

Strengths:

- Core calculation logic is server-side and testable.
- Booking confirmation performs important checks inside transactions.
- The schema appears to include useful indexes.
- Reports use server-side data access rather than doing everything in the browser.

Risks:

- Large client components can increase bundle and hydration cost.
- Export/report flows can be memory-heavy.
- Backup export serializes broad database content.
- Upload handlers buffer files in memory.
- Public remote image configuration allows any HTTPS host.
- Background jobs need a production strategy beyond single-process assumptions.

Recommendations:

1. Add bundle analyzer and split heavy reporting/export/chart/map modules.
2. Stream large uploads or move to object storage.
3. Add query timing and slow-query logging.
4. Add pagination/streaming for large exports.
5. Introduce a queue or externally coordinated worker model for production background jobs.

## 16. Testing

Score: 6.5 / 10.

Verification performed:

- `npm.cmd run typecheck`: passed.
- `npm.cmd run test`: passed, 253 tests across 26 suites.
- `npm.cmd run lint`: passed with 39 warnings.
- `npm.cmd audit --omit=dev --audit-level=moderate`: found 2 moderate production dependency findings through `exceljs -> uuid`.

Build was not run because the current `build` script applies Prisma migrations via `prisma migrate deploy`.

Strong test areas:

- Booking calculation core.
- Capacity cost logic.
- Auth bootstrap.
- Role helpers.
- Safe redirects.
- Audit sanitization.
- Customer prefill IDOR logic.
- Refund math.
- ZK helper logic.

Missing test areas:

- End-to-end booking checkout.
- Payment webhook and MPGS reconciliation against a test DB.
- Route-level auth tests.
- Upload security tests.
- Secure media object authorization tests.
- Admin backup/import tests.
- Gate/reception browser flows.
- Accessibility tests.
- Production build in CI.

## 17. Dependencies

Current audit result:

- 2 moderate vulnerabilities.
- Source: `exceljs@4.4.0` depends on `uuid@8.3.2`.
- The reported issue is a uuid buffer bounds-check advisory.
- `npm audit fix --force` suggests downgrading `exceljs` to `3.4.0`, which may be a breaking downgrade.

Recommendation:

Do not blindly force-fix. Track upstream, evaluate whether the vulnerable uuid API surface is reachable through project usage, and consider replacing or isolating export code if the dependency cannot be updated safely.

Other dependency observations:

- Next.js and React are modern.
- Prisma is modern.
- `xlsx`, `dompurify`, `postcss`, and Next were not flagged by the production audit run.

## 18. Documentation

Strengths:

- README exists.
- Architecture documentation exists.
- Booking flow documentation exists.
- Audit remediation backlog exists.
- Graph report exists.
- Onboarding docs exist.

Issues:

- `docs/architecture.md` mentions an older Next version.
- README still contains stale SQLite-oriented wording while the schema is PostgreSQL.
- Booking docs describe `BookingHold` behavior that source code does not appear to implement.
- Some docs contain encoding corruption.
- `docs/tasks.md` appears stale relative to the current implementation.

Recommendation:

Create a documentation refresh pass with three goals:

1. Align docs to current production architecture.
2. Mark obsolete plans as historical.
3. Convert security and audit backlog into a prioritized release checklist.

## 19. Business and Product

Score: 8 / 10 for product value.

The product has meaningful business value because it models more than checkout. It supports resort operations across customer booking, reception, gate access, ops tickets, reporting, payments, refunds, sanctions, notifications, and restaurant workflows.

Strong business capabilities:

- Multi-role operations.
- Booking and payment lifecycle.
- Gate validation and visit codes.
- Reception document capture.
- Refund policy machinery.
- Reports and exports.
- Notifications and campaigns.
- Restaurant management.
- Ops ticket workflows.

Likely next product opportunities:

- CRM and customer history views.
- Loyalty and membership tiers.
- Staff performance analytics.
- Demand forecasting.
- Automated WhatsApp/SMS workflows.
- Stronger mobile app roadmap.
- More self-service customer changes and cancellation flows.
- Operational dashboards for live occupancy and incidents.

## 20. Recommendations

This codebase should be hardened, not rewritten.

Immediate priorities:

1. Enforce canonical origin and trusted hosts in production.
2. Add relationship-aware authorization and audit logs for secure media.
3. Persist `private-uploads` with a Docker volume or object storage.
4. Decide whether `BookingHold` is real or obsolete, then update code or docs.
5. Split build from migration so CI can run production builds safely.
6. Add integration tests for booking/payment/webhook/capacity races.
7. Clean up large components and hook lint warnings.
8. Add monitoring, structured logging, and alerting.
9. Add backup export/import audit records and encryption policy.
10. Address the `exceljs -> uuid` audit finding deliberately.

Suggested target scores after remediation:

- Architecture: 8.5 / 10
- Code quality: 8 / 10
- Security: 8.5 / 10
- Testing: 8 / 10
- DevOps: 8 / 10
- Overall: 8.3 / 10

## Source Notes

Local review sources included repository files under:

- `src/`
- `prisma/`
- `docs/`
- `deploy/`
- `.github/workflows/`
- `Dockerfile`
- `docker-compose.yml`
- `package.json`
- `next.config.mjs`

External reference used for UI guideline alignment:

- https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
