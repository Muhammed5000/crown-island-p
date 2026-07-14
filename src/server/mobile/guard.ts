import 'server-only';
import type { UserRole } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { isPrivilegedRole } from '@/server/auth/roles';
import { verifyMobileToken } from './token';

/**
 * Request guard for `/api/mobile/**` routes.
 *
 * Reads `Authorization: Bearer <token>`, verifies the signature/expiry, then
 * re-reads the user from the database (the token is only an identity claim —
 * blocks, deletions and role changes must take effect immediately, mirroring
 * the web JWT re-hydration in `src/server/auth/index.ts`).
 *
 * Staff/gate/admin roles are rejected: the mobile app is the CUSTOMER app
 * (CUSTOMER / TESTER / RESTAURANT). Staff tooling stays on the website where
 * the role-confinement proxy applies.
 */

export interface MobileUser {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  phone: string | null;
  role: UserRole;
  termsAcceptedAt: Date | null;
}

export async function getMobileUser(request: Request): Promise<MobileUser | null> {
  const header = request.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();

  const payload = verifyMobileToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.uid },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      phone: true,
      role: true,
      termsAcceptedAt: true,
      deletedAt: true,
      blockedAt: true,
      tokenVersion: true,
    },
  });
  if (!user || user.deletedAt || user.blockedAt) return null;
  if (isPrivilegedRole(user.role)) return null;
  // AUTH-005: reject a token minted before the current session epoch — a password
  // change / reset / "sign out everywhere" bumps tokenVersion, which must revoke
  // older mobile tokens immediately (mirrors the web JWT re-hydration guard).
  if (payload.tv !== user.tokenVersion) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    phone: user.phone,
    role: user.role,
    termsAcceptedAt: user.termsAcceptedAt,
  };
}

/** Standard JSON 401 body shared by every mobile route. */
export const UNAUTHORIZED = { ok: false as const, code: 'unauthorized' as const };
