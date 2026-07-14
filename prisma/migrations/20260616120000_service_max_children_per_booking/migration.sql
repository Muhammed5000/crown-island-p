-- Add a nullable per-booking children cap (null = no limit).
-- Additive + nullable: existing rows default to NULL (no cap), so no backfill and
-- no behavioural change for services that have not configured a limit.
ALTER TABLE "Service" ADD COLUMN "maxChildrenPerBooking" INTEGER;
