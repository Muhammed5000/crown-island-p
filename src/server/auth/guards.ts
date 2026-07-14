import { cache } from 'react';
import { redirect } from 'next/navigation';
import { auth } from './index';
import type { UserRole } from '@prisma/client';
import {
  ADMIN_PANEL_ROLES,
  GATE_ROLES,
  canAccessReception,
  canAccessOps,
  isRestaurantOwner,
} from './roles';
import { log, errFields } from '@/lib/log';
import { isDynamicServerUsageError } from './error-core';

/**
 * Server-only guards. Call from server components / server actions / API routes.
 */

export interface SessionUser {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  role: UserRole;
  termsAcceptedAt: Date | null;
}

const ADMIN_ROLES = ADMIN_PANEL_ROLES;

/**
 * Request-scoped memo via `React.cache()`: every `auth()` call runs the JWT
 * re-hydration callback, which costs one `prisma.user.findUnique` — and a
 * single request typically asks for the session several times (layout guard +
 * page guard + data helpers). Memoising collapses those to ONE `auth()` / DB
 * query per request while keeping the next request fully fresh, so role
 * changes / blocks still take effect on the user's very next request.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // `auth()` can throw (e.g. JWTSessionError when the database is unreachable
  // in local dev). Resolving to an anonymous session keeps public pages like
  // the landing page rendering instead of crashing the whole route.
  try {
    const session = await auth();
    const u = session?.user;
    if (!u?.id) return null;
    return {
      id: u.id,
      email: u.email ?? null,
      name: u.name ?? null,
      image: u.image ?? null,
      role: (u.role as UserRole | undefined) ?? 'CUSTOMER',
      termsAcceptedAt: u.termsAcceptedAt ? new Date(u.termsAcceptedAt) : null,
    };
  } catch (err) {
    // This is Next.js control flow, not an authentication failure. Re-throw so
    // the build marks the route dynamic instead of logging dozens of false
    // anonymous-session warnings and obscuring real auth incidents.
    if (isDynamicServerUsageError(err)) throw err;
    log.warn('auth getSessionUser falling back to anonymous', { ...errFields(err) });
    return null;
  }
});

export async function requireUser(opts: { next?: string } = {}): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    const target = opts.next ? `?next=${encodeURIComponent(opts.next)}` : '';
    redirect(`/login${target}`);
  }
  return user;
}

/**
 * Admin gate.
 *
 * - Unauthenticated → redirect to /admin/login (which shows the sign-in UI).
 * - Authenticated but not admin → return `null` so the caller renders a 403
 *   page. Earlier versions redirected, which produced an opaque loop because
 *   the user couldn't see *why* they weren't allowed in.
 */
export async function requireAdminOrNull(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user) {
    redirect('/admin/login');
  }
  if (!ADMIN_ROLES.has(user.role)) {
    return null;
  }
  return user;
}

/**
 * Gate scanner gate.
 *
 * Permits STAFF plus the admin tiers (supervisors may work the gate). Mirrors
 * `requireAdminOrNull`: unauthenticated → bounce to /admin/login; signed in but
 * not gate-authorised (e.g. a customer) → return `null` so the layout renders a
 * 403 panel instead of looping the user through sign-in.
 */
export async function requireGateOrNull(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user) {
    redirect('/admin/login');
  }
  if (!GATE_ROLES.has(user.role)) {
    return null;
  }
  return user;
}

/**
 * Reception desk gate.
 *
 * Permits STAFF + admin tiers (the reception staff who create offline bookings);
 * explicitly EXCLUDES SECURITY. Unauthenticated → bounce to /admin/login; signed
 * in but not reception-authorised (SECURITY, customers) → return `null` so the
 * page can render a 403 instead of looping through sign-in.
 */
export async function requireReceptionOrNull(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user) {
    redirect('/admin/login');
  }
  if (!canAccessReception(user.role)) {
    return null;
  }
  return user;
}

/**
 * Housekeeping & Maintenance desk gate (`/gate/ops`).
 *
 * Permits every gate-authorised role: HOUSEKEEPING / MAINTENANCE work the
 * tickets, reception & gate staff (incl. SECURITY) report issues, managers and
 * admin tiers run the board. Unauthenticated → bounce to /admin/login; signed
 * in but not gate-authorised (customers) → `null` so the page renders a 403.
 */
export async function requireOpsOrNull(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user) {
    redirect('/admin/login');
  }
  if (!canAccessOps(user.role)) {
    return null;
  }
  return user;
}

/**
 * Restaurant-partner gate (`/menu/manage`).
 *
 * Unauthenticated → bounce to the CUSTOMER sign-in (partners use the normal
 * customer auth paths, not /admin/login). Signed in but not a RESTAURANT
 * account → `null` so the page renders a friendly "partners only" panel.
 */
export async function requireRestaurantOwnerOrNull(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login?next=%2Fmenu%2Fmanage');
  }
  if (!isRestaurantOwner(user.role)) {
    return null;
  }
  return user;
}

/**
 * Strict restaurant-partner gate — for server actions/API routes whose UI was
 * already partner-only. Mirrors `requireAdmin`'s redirect-on-deny shape.
 */
export async function requireRestaurantOwner(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }
  if (!isRestaurantOwner(user.role)) {
    redirect('/menu');
  }
  return user;
}

/**
 * Super Admin gate.
 */
export async function requireSuperAdminOrNull(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user) {
    redirect('/admin/login');
  }
  if (user.role !== 'SUPER_ADMIN' && user.role !== 'DEVELOPER') {
    return null;
  }
  return user;
}

/**
 * Strict admin gate — redirects unauth users to `/admin/login` and
 * THROWS for non-admins. Suitable for server actions where the caller
 * already knows the UI was admin-only.
 */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    redirect('/admin/login');
  }
  if (!ADMIN_ROLES.has(user.role)) {
    redirect('/admin/login?denied=1');
  }
  return user;
}

/**
 * Strict Super Admin gate.
 */
export async function requireSuperAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    redirect('/admin/login');
  }
  if (user.role !== 'SUPER_ADMIN' && user.role !== 'DEVELOPER') {
    redirect('/admin/login?denied=1');
  }
  return user;
}

/**
 * Developer gate.
 */
export async function requireDeveloperOrNull(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user) {
    redirect('/admin/login');
  }
  if (user.role !== 'DEVELOPER') {
    return null;
  }
  return user;
}

/**
 * Strict Developer gate.
 */
export async function requireDeveloper(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    redirect('/admin/login');
  }
  if (user.role !== 'DEVELOPER') {
    redirect('/admin/login?denied=1');
  }
  return user;
}
