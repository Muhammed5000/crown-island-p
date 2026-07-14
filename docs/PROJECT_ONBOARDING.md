# Crown Island - Comprehensive Technical Onboarding

> **Verified project status (2026-07-12):** This onboarding note contains
> historical SQLite, Paymob, phone-OTP, seeded-admin, and handicap-overflow
> material — all obsolete. The current system is PostgreSQL-only, uses Crédit
> Agricole MPGS and email/password plus optional Google OAuth, provisions the
> first admin via `ADMIN_BOOTSTRAP_EMAIL` (no seeded credentials), and has no
> customer handicap-overflow path. Use `README.md`, `docs/SYNC.md`,
> `docs/DISASTER-RECOVERY.md`, `docs/OBSERVABILITY.md`, and the latest audit as the
> current runbooks; the older sections below are retained ONLY as history — do not
> follow their instructions.

Welcome to the Crown Island project! This document serves as the **master blueprint** of the entire application. It is written to give junior to mid-level developers absolute clarity on the project’s architecture, its data flow, how the security models operate, and exactly where to find everything. 

Take your time reading this. By the end, you should be able to confidently navigate, debug, and expand any part of the system.

---

## 1. Technologies & Architecture Stack

We built Crown Island using modern, scalable web technologies. It is entirely statically typed with **TypeScript**.

### The Core
- **Next.js (App Router):** We use Next.js `app/` directory for everything. This allows us to use React Server Components (RSC) to drastically reduce the JavaScript shipped to the client, and Server Actions for secure, API-free data mutations.
- **React (v19):** We use cutting-edge React features like `useTransition`, `useOptimistic`, and `useFormState`.

### Data Layer
- **Prisma (v6):** The ORM (Object-Relational Mapper) defining our database schema. It auto-generates a fully typed database client (`PrismaClient`).
- **PostgreSQL / SQLite:** Designed to run on PostgreSQL in production but fully supports SQLite locally.
- **Redux Toolkit:** We use Redux (`src/store/`) **only** for complex, multi-step client state that needs to persist across different screens (e.g., the booking wizard flow). For simple local state, we use `useState`.

### Security & Auth
- **Auth.js (NextAuth v5 beta):** Handles user sessions and authentication. We use the `@auth/prisma-adapter` to store sessions directly in our database, making it possible to instantly revoke sessions server-side.
- **Bcrypt:** Passwords are cryptographically hashed using `bcrypt.compare` and `bcrypt.hash` before touching the database.
- **Zod:** A schema declaration and validation library. It runs on **both** the client (validating forms as the user types) and the server (double-checking the payload before it touches Prisma).

### Styling & UI
- **Tailwind CSS:** All styling is utility-based. We heavily use `clsx` and `tailwind-merge` (via our `cn()` helper in `src/lib/cn.ts`) to dynamically merge classes.
- **next-intl:** Handles Arabic (RTL) and English (LTR) translations effortlessly.

---

## 2. Deep Dive: Folder & File Structure

Here is an inside-out look at the `src` folder structure:

```text
src/
├── app/
│   ├── [locale]/               # Next-intl wrapper for languages (en/ar)
│   │   ├── (app)/              # The Public Customer App Route Group
│   │   │   ├── auth/           # Login / Register
│   │   │   ├── booking/        # The Booking Wizard (Categories, Services, Review, Payment)
│   │   │   ├── profile/        # Customer Profile & KYC
│   │   │   └── page.tsx        # The Public Landing Page
│   │   ├── admin/              # The Staff / Admin Dashboard Route Group
│   │   │   ├── login/          # Admin-specific login page
│   │   │   └── (authed)/       # Protected dashboard pages (Bookings, Services, Reception, Gate)
│   ├── api/                    # Only used for external Webhooks (e.g. Paymob)
│
├── components/                 # Pure React UI components
│   ├── ui/                     # Primitives (Button, Input, Card, Modal)
│   ├── booking/                # Client components specifically for the booking wizard
│   └── admin/                  # Forms and tables used strictly in the admin panel
│
├── features/                   # "Domain Logic". Keeps the `app/` folder clean.
│   ├── admin/                  # Server Actions for admin mutations (catalog-actions.ts)
│   ├── auth/                   # Server Actions for login/registration (auth-actions.ts)
│   └── booking/                # Server Actions for creating/holding bookings
│
├── server/                     # STRICTLY SERVER-SIDE CODE (Never imported by client components)
│   ├── db/prisma.ts            # The singleton Prisma client connection
│   ├── auth/                   # Guards (requireUser, requireAdmin) and Role definitions
│   ├── services/               # Core business logic (pricing.ts, booking.ts)
│   └── paymob/                 # Payment gateway integration and webhook verifiers
│
├── store/                      # Redux Toolkit
│   └── slices/                 # bookingFlow.ts (cart state), preferences.ts
│
└── messages/                   # Translation JSON files (en.json, ar.json)
```

---

## 3. Core Feature: The Booking & Capacity Engine

The heart of Crown Island is its booking engine. It is not just a standard e-commerce cart; it has strict daily capacity limits and "Overflow" logic.

### 3.1. How Capacity Works
Inside `prisma/schema.prisma`, the `Service` model defines hard limits:
- `dailyCapacityPeople`
- `dailyCapacityHandicap`

When a booking is made, a row in the `BookingSlot` table is created or incremented for that specific `serviceId` + `date`. 

### 3.2. Overflow Logic (`src/server/services/pricing.ts`)
If a handicapped user tries to book but the `dailyCapacityHandicap` is completely full for that day, the system checks if there is room in the **Normal** pool (`dailyCapacityPeople`).
If so, it flags a `normal_overflow` warning, allowing the handicapped user to take a normal seat. The UI (`SelectionForm.tsx`) immediately alerts the user: *"Handicap capacity is full. You are booking from the normal capacity instead."*
This logic is identical in reverse for Normal users taking Handicap seats.

### 3.3. The Booking Lifecycle
1. **Selection:** User selects date/guests. Handled by Redux (`bookingFlow.ts`).
2. **Review:** User clicks "Pay". We execute the `createBookingAction`.
3. **Pending:** A `Booking` row is created with status `PENDING_PAYMENT`. It reserves **no capacity** (the `BookingHold` model in the schema is deprecated and unused).
4. **Checkout:** User pays in the hosted gateway checkout (Crédit Agricole MPGS Lightbox).
5. **Success:** The server verifies the order (RETRIEVE_ORDER / webhook / reconciler → `src/server/payments/sync.ts`). Inside a Serializable transaction it RE-CHECKS capacity against live `BookingSlot` counters, increments them, and flips the booking to `CONFIRMED`. If capacity filled while the user was paying, the charge is auto-refunded and the booking cancelled.

---

## 4. Security & Authorization Details

Security is a massive part of this application to ensure customer data is protected and that only authorised staff can access the admin dashboard. 

### A. Authentication (Who are you?)
1. **NextAuth (Auth.js):** We use a custom `CredentialsProvider`. In `src/server/auth/providers.ts`, when a user types their email/password, the system fetches the user and uses `bcrypt.compare()` to verify the hashed password.
2. **Session Storage:** We use the `@auth/prisma-adapter`. Sessions are stored securely in the `Session` table in the database.
3. **Dual Identity:** There are two distinct types of users: Customers (`User` role: `CUSTOMER`) and Staff (roles: `STAFF`, `SECURITY`, `ADMIN`). They use completely separate login pages to prevent customers from accidentally finding the admin panel.

### B. Authorization & Guards (What are you allowed to do?)
Even if a user is logged in, they might not have permission to view a specific page or run a specific action. We enforce this using **Guards** (`src/server/auth/guards.ts`):
- `requireUser()`: Ensures a regular customer is logged in.
- `requireAdmin()`: Ensures the user has an `ADMIN` or `SUPER_ADMIN` role. If a `SECURITY` guard tries to hit an admin endpoint, this guard immediately throws an error.
- `requireGateOrNull()`: Allows `STAFF` and `SECURITY` to access the QR scanner endpoint for ticket verification.

> **CRITICAL RULE:** Every single Server Action (which modifies the database) must call one of these strict guards at the very top of the function. If a hacker tries to bypass the UI and call an action directly, the guard will block them.

### C. Rate Limiting (Preventing Spam & Brute Force)
To prevent malicious users from spamming our systems (e.g., trying to guess a password 1000 times), we use a custom **Exponential Backoff Rate Limiter** (`src/server/auth/rate-limit.ts`):
- It tracks failed attempts or rapid actions by storing the user's `email` or `IP address` in the `AuthRateLimit` database table.
- The wait time increases exponentially: `0s -> 30s -> 1m -> 2m -> 5m -> 10m`... up to a maximum wait of 24 hours.
- Before sensitive actions run (like login or password reset), the system calls `consumeEmailAndIp()`. If the user is trying too fast, it returns `{ ok: false, retryAfterSeconds }` and blocks execution.

### D. Payment Security (Paymob HMAC)
When Paymob confirms a payment, it sends a Webhook to our server. To prevent attackers from sending fake webhooks to trick the system into confirming unpaid bookings, we use strict cryptographic verification:
- Paymob includes an **HMAC (Hash-based Message Authentication Code)** in the URL.
- Our webhook (`src/server/paymob/webhook.ts`) takes the transaction payload, encrypts it using our secret `PAYMOB_HMAC_SECRET`, and compares the result to the HMAC Paymob sent.
- If the HMACs do not perfectly match, the request is instantly rejected as a forgery.

---

## 5. Redux State Management

We use Redux (`@reduxjs/toolkit`) selectively. It is stored in `src/store/`.
- **`bookingFlow.ts`:** This is the most important slice. Because the booking process spans multiple pages (Select Service -> Pick Date -> Review Cart -> Pay), we store the selected `serviceId`, `date`, `people` count, and `cars` count here. 
- **Persistence:** We use a custom local storage sync mechanism so if the user refreshes the page, their cart is not lost.

---

## 6. How to Run and Work on the Project Locally

To get started on your own machine:

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Environment Variables:**
   Copy the `.env.example` file and rename it to `.env`. You will need to ask the lead developer for the development `PAYMOB_SECRET_KEY` and other secrets.

3. **Database Setup:**
   Generate the Prisma Client and push the schema to create the local SQLite database.
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. **Seed the Database:**
   Populate the database with sample categories, services, and a test admin account.
   ```bash
   npm run db:seed
   ```

5. **Start the Server:**
   ```bash
   npm run dev
   ```

6. **Important URLs:**
   - Public Customer App: `http://localhost:3000`
   - Admin Dashboard: `http://localhost:3000/admin` (Use the seeded admin credentials to log in).
   - Prisma Studio (Database Viewer): `npx prisma studio` (Opens an admin panel to view raw database rows).

> **IMPORTANT Prisma Warning on Windows:** If you ever edit `prisma/schema.prisma` and run `npx prisma db push`, you MUST completely stop the Next.js server (`Ctrl+C`) and start it again. Next.js caches the Prisma Client, and Windows locks the `.db` file. Restarting fixes all errors.

## Welcome Aboard!
We recommend you start by registering a test account on `localhost:3000` and placing a booking. Open the Redux DevTools extension to watch the `bookingFlow` state update as you move through the steps. Happy coding!
