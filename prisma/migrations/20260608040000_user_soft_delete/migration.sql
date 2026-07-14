-- Soft-delete tombstone for User. Nullable, so this is a safe additive change
-- (no backfill, no rewrite). Existing rows default to NULL = active.
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Index the tombstone: every active-user listing now filters `deletedAt IS NULL`.
CREATE INDEX IF NOT EXISTS "User_deletedAt_idx" ON "User"("deletedAt");
