import 'server-only';
import { Prisma } from '@prisma/client';
import type { AuditAction } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { redactSensitive } from './sanitize';

/**
 * Audit-log writer.
 *
 * Accepts an active Prisma transaction so the audit row commits together with
 * the mutation it describes. If the mutation fails the audit row never
 * appears, and vice versa — there are no "wrote but didn't log" gaps.
 *
 * Defense-in-depth: `before` and `after` are passed through
 * `redactSensitive()` so that even if a caller forgets to project a Prisma
 * row through its `auditable*()` helper, well-known secret-bearing keys
 * (`passwordHash`, `tokenHash`, OAuth tokens, session tokens, …) are
 * replaced with `[REDACTED]` before the row is written. The right primary
 * fix is still at the call site — see `src/server/audit/sanitize.ts`.
 */

export interface AuditInput {
  actorUserId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function safeJson(value: unknown): Prisma.InputJsonValue {
  if (value === undefined || value === null) return Prisma.JsonNull as unknown as Prisma.InputJsonValue;
  return redactSensitive(value) as Prisma.InputJsonValue;
}

export function audit(tx: Prisma.TransactionClient, params: AuditInput) {
  return tx.auditLog.create({
    data: {
      actorUserId: params.actorUserId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      before: safeJson(params.before),
      after: safeJson(params.after),
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    },
  });
}

/**
 * Audit without an outer transaction — used for read-only events such as login.
 */
export function auditStandalone(params: AuditInput) {
  return prisma.auditLog.create({
    data: {
      actorUserId: params.actorUserId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      before: safeJson(params.before),
      after: safeJson(params.after),
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    },
  });
}
