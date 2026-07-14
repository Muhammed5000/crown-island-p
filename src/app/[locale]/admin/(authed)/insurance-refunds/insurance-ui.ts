import type { InsuranceRefundStatus } from '@prisma/client';
import type { BadgeTone } from '@/components/ui/Badge';

/** Shared badge tones for the insurance-refund queue + detail pages. */
export const STATUS_TONE: Record<InsuranceRefundStatus, BadgeTone> = {
  AWAITING_ADMIN: 'warning',
  PENDING_DESK: 'info',
  PROCESSING: 'gold',
  COMPLETED: 'success',
  FAILED: 'danger',
  REJECTED: 'muted',
  MANUAL_ATTENTION: 'danger',
};

/** Compact age label ("35m" / "6h" / "3d") for queue rows and age warnings. */
export function ageLabel(from: Date, now = new Date()): string {
  const mins = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / (24 * 60))}d`;
}

/** Whole days since `from` — drives the stale desk-payout warning (> 7 days). */
export function ageDays(from: Date, now = new Date()): number {
  return Math.floor((now.getTime() - from.getTime()) / 86_400_000);
}
