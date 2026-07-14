# Crown Island — El Montazah

Premium booking PWA for Crown Island — El Montazah.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind · Prisma + PostgreSQL · Redux Toolkit · Crédit Agricole / MPGS Hosted Checkout · Auth.js v5 · Leaflet · next-intl (AR/EN with RTL) · Framer Motion. Optionally deployed as two nodes (online master + on-prem local venue node with an offline sync layer — see `docs/SYNC.md`).

**Visual design** sourced from the Claude Design handoff in [`docs/reference/`](./docs/reference/) — dark navy `#0d1a2b`, warm gold `#d4a557`, cream cream `#f3ecdc` on Tajawal + Playfair Display.

> See [`docs/architecture.md`](./docs/architecture.md) for system design and [`docs/booking-flow.md`](./docs/booking-flow.md) for the ACID booking & payment flow.

---

## Quick start

You need **Node.js ≥ 20**, **npm** (the repo's lockfile is `package-lock.json` — don't use pnpm/yarn), and a reachable **PostgreSQL** server (local install or Docker). See [Prerequisites](#prerequisites).

### 1. Install dependencies

```bash
npm install
```

> ⚠️ This must be a **full** install. Do **not** pass `--production` / `--omit=dev`,
> and make sure `NODE_ENV` is not set to `production` in your shell — either skips
> devDependencies (`tsx` for the seed/admin scripts, TypeScript, Tailwind, …) and
> historically left the Prisma CLI out entirely, which is what produced the
> classic `'prisma' is not recognized` error (see [Troubleshooting](#troubleshooting)).
> `npm install` also runs `prisma generate` automatically via `postinstall`.

### 2. Configure environment

Copy the example env file and fill in the required values:

```bash
cp .env.example .env            # PowerShell: Copy-Item .env.example .env
```

The minimum needed to boot in development:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/crown_island?schema=public"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/crown_island?schema=public"
AUTH_SECRET="<any long random string>"
```

For a plain (non-pooled) local Postgres, `DATABASE_URL` and `DIRECT_URL` are the
same value; `DIRECT_URL` is what Prisma Migrate connects through. Everything else
in `.env.example` (OAuth, MPGS, sync, push) is optional in development.

### 3. Start PostgreSQL

Any running Postgres works. If you don't have one, Docker is the fastest:

```bash
docker run -d --name crown-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
```

You don't need to create the `crown_island` database yourself — the next step
creates it if it doesn't exist.

### 4. Initialise the database

```bash
npm run prisma:migrate           # applies the committed migrations to your Postgres DB
npm run db:seed                  # seeds Crown Surge / Solace / Club + services
```

### 5. Create your first admin user

```bash
# interactive — you'll be prompted for a password
npm run admin:create -- you@example.com
```

### 6. Run the dev server

```bash
npm run dev
```

App is served at <http://localhost:3000>. Sign in to the admin panel at `/admin/login` with the email + password you just chose.

### Creating admins

There is **no default admin account** and the app does **not** auto-promote any
user based on environment variables. Privileged accounts are minted only via
two scripts:

| Script                                                                                    | Use it when                                                                                                                        |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm run admin:create -- <email> [<password>] [--role=SUPER_ADMIN\|ADMIN\|STAFF]`         | Creating a new admin from scratch, or resetting an existing one's password. Role defaults to `SUPER_ADMIN` if `--role` is omitted. |
| `npm run admin:promote -- <email-or-phone> [--role=ADMIN\|SUPER_ADMIN\|STAFF\|DEVELOPER]` | An existing CUSTOMER signed in via OAuth or email + password, and you want to elevate them.                                        |

Run these on a trusted shell with database access — they bypass the normal
RBAC checks by design. After a promotion, the user must sign out and sign
back in so the new role lands in their JWT.

---

## Prerequisites

- **Node.js ≥ 20** (tested on 22 / 24)
- **npm** — the repo ships a `package-lock.json`; installing with pnpm or yarn is unsupported
- **PostgreSQL** for local/runtime data (local install, a plain `postgres:16` container, or the full Docker Compose stack which includes it)
- A Crédit Agricole **MPGS** merchant in test mode for card checkout — optional in development; checkout shows "not configured" when credentials are absent

## Database

The app uses **PostgreSQL** in all environments (the Prisma schema `provider` is `"postgresql"`). Point `DATABASE_URL` (runtime, may be pooled) and `DIRECT_URL` (direct connection — used by Prisma Migrate) at a Postgres instance, then run `npm run prisma:migrate` (dev) or `npm run prisma:deploy` (prod). The Prisma CLI ships in `dependencies`, so both commands work on dev and production installs alike.

## Environment variables

See [`.env.example`](./.env.example). Keep real credentials in an untracked local/runtime environment; the checked-in example contains placeholders only.

| Variable                                      | Purpose                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL` / `DIRECT_URL`                 | PostgreSQL runtime / direct migration URLs                                                                                     |
| `AUTH_SECRET`                                 | NextAuth session secret (any long random string)                                                                               |
| `AUTH_URL`                                    | Optional fixed origin; remove it when dynamic forwarded-host handling is required                                              |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`       | Google OAuth (optional)                                                                                                        |
| `AUTH_FACEBOOK_ID` / `AUTH_FACEBOOK_SECRET`   | Facebook OAuth (optional)                                                                                                      |
| `AUTH_APPLE_ID` / `AUTH_APPLE_SECRET`         | Apple OAuth (optional)                                                                                                         |
| `MPGS_GATEWAY_HOST` / `MPGS_VERSION`          | Mastercard gateway endpoint and API version                                                                                    |
| `MPGS_MERCHANT_ID` / `MPGS_PASSWORD`          | Crédit Agricole MPGS merchant credentials                                                                                      |
| `MPGS_WEBHOOK_SECRET`                         | Notification secret for `/api/credit-agricole/webhook`                                                                         |
| `APP_MODE` / `ONLINE_API_URL` / `SYNC_SECRET` | Optional online/local dual-node mode and authenticated sync channel                                                            |
| `ADMIN_BOOTSTRAP_EMAIL`                       | Fallback recipient for new-booking notification emails when `Settings.adminNotifyEmail` is blank. **Does not grant any role.** |

## Scripts

| Command                                                    | Purpose                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| `npm run dev`                                              | Start dev server                                              |
| `npm run build`                                            | Production build                                              |
| `npm run start`                                            | Run the production build                                      |
| `npm run lint`                                             | ESLint                                                        |
| `npm run typecheck`                                        | `tsc --noEmit`                                                |
| `npm run test`                                             | Run unit tests (Node `node:test` runner via `tsx`)            |
| `npm run test:integration`                                 | Run DB-backed sync tests against explicit `TEST_DATABASE_URL` |
| `npm run prisma:generate`                                  | Generate Prisma client                                        |
| `npm run prisma:migrate`                                   | Create + apply a migration                                    |
| `npm run prisma:deploy`                                    | Apply existing migrations (prod)                              |
| `npm run prisma:studio`                                    | Open Prisma Studio at <http://localhost:5555>                 |
| `npm run db:seed`                                          | Run `prisma/seed.ts` (idempotent)                             |
| `npm run admin:create -- <email> [<password>]`             | Create or upgrade an admin user with email + password         |
| `npm run admin:promote -- <email-or-phone> [--role=ADMIN]` | Promote an existing user to a role                            |

## Troubleshooting

### `'prisma' is not recognized` / "prisma is not available"

The Prisma CLI binary is missing from `node_modules\.bin`. Causes, in order of likelihood:

1. **Dependencies were installed without devDependencies** — `npm install --production`, `npm install --omit=dev`, or a shell where `NODE_ENV=production` is set. The `prisma` package now lives in `dependencies` so the CLI survives production installs, but a partial/dev-less install still breaks `tsx`-based scripts (`db:seed`, `admin:*`). Fix:

   ```powershell
   Remove-Item -Recurse -Force node_modules
   $env:NODE_ENV = $null          # bash: unset NODE_ENV
   npm install
   ```

2. **An earlier `npm install` was interrupted or partially failed**, leaving `node_modules` incomplete. Same fix as above.

3. **You typed `prisma migrate dev` directly in a terminal.** The CLI is a local dependency, not a global one, so the bare command isn't on your PATH outside npm scripts. Use `npm run prisma:migrate` or `npx prisma migrate dev`.

### `P1001: Can't reach database server`

PostgreSQL isn't running, or `DATABASE_URL` / `DIRECT_URL` point to the wrong host/port/credentials. Start Postgres (see [Quick start §3](#3-start-postgresql)) and re-check `.env`.

### `P2022: The column ... does not exist` after switching git branches

The generated Prisma client is stale, not the database. Regenerate — do **not** create a new migration:

```bash
npx prisma generate
npm run dev:clean        # also clears the stale .next cache
```

### `EPERM: operation not permitted, rename ... query_engine-windows.dll.node` (Windows)

The running dev server has the Prisma query-engine DLL locked, so `prisma generate` (including the one `npm install` runs via `postinstall`) can't replace it. Stop `npm run dev`, run `npm run prisma:generate` (or re-run `npm install`), then start the dev server again.

### Dev server serves stale routes / static pages 404 while dynamic ones work

Stale `.next` build cache. Run `npm run dev:clean` (deletes `.next` and starts dev fresh).

## Unit tests

Unit tests use Node's built-in `node:test` runner, executed through `tsx` (no extra
test framework). They cover the pure business logic — pricing/`calcBooking`,
capacity reserve/release, date/money helpers, auth role predicates, etc.

```bash
npm run test                       # run the whole suite
npx tsx --test src/lib/date.test.ts  # run a single file
```

Test files live next to the code they cover as `*.test.ts`.

The four sync integration files write to PostgreSQL and are excluded from the
default command. To run them, migrate and catalog-seed a disposable database,
set `TEST_DATABASE_URL` to that database, then run `npm run test:integration`.
The integration tests create and remove their own user, booking, and queue
fixtures; never point the variable at development or production data.

## Docker (production-like stack)

A `Dockerfile` + `docker-compose.yml` bring up PostgreSQL and the app together.
`docker-entrypoint.sh` runs `prisma migrate deploy` (and seeds on first boot)
before starting the server, so the database is migrated automatically.

```bash
docker compose up --build      # Postgres + app; app on http://localhost:3000
docker compose down            # stop (keep data)
docker compose down -v         # stop and wipe the database volume
```

Provide the same environment variables as local dev (see **Environment variables**);
in compose they're supplied via the `app` service's `environment`/`env_file`.

## MPGS webhook (local/test)

MPGS delivers notifications server-to-server, so a local test endpoint must be
reachable from the public internet. Expose the dev server with an HTTPS tunnel
and configure the Crédit Agricole / Mastercard merchant notification URL as:

```
https://<your-tunnel>/api/credit-agricole/webhook
```

The route compares `X-Notification-Secret` with `MPGS_WEBHOOK_SECRET`, then
retrieves the order from MPGS; the notification body is never trusted as payment proof.

## Testing the booking flow (test mode)

1. Sign in at `/login` with a configured OAuth provider or verified email/password account.
2. Pick **Crown Surge** → **Day Use** → date / people / cars.
3. Review the server-computed price on `/booking/review`.
4. On `/booking/payment`, the MPGS hosted checkout loads in the isolated payment frame. Use an MPGS test card.
5. The webhook, browser check, or reconciler retrieves the authoritative MPGS order → booking becomes `CONFIRMED` → QR appears on `/booking/success`.

## Testing the admin panel

1. Sign in at `/admin/login` with the credentials above.
2. You land on `/admin` (dashboard). The sidebar has Bookings / Categories / Services / Pricing / Users / Invoices / Payments / Audit logs / Settings.
3. Every CRUD action writes an `AuditLog` row inside the same transaction as the mutation.

## Project layout

See [`docs/architecture.md` §3 Folder structure](./docs/architecture.md#3-folder-structure).

## PWA

The app is installable and works offline for the shell:

- `public/manifest.webmanifest` declares the icons, theme, and start URL
- `public/sw.js` runs a stale-while-revalidate cache for static assets, network-first for HTML, with `/offline.html` as the fallback
- The SW only registers in **production builds** (`NODE_ENV === 'production'`) — `npm run build && npm run start` to try it

## Roadmap

See [`docs/tasks.md`](./docs/tasks.md).

## License

Proprietary — Crown Island / El Montazah.
