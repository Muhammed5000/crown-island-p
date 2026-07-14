-- Performance indexes on frequently-queried foreign-key scalars and filter
-- columns that previously had no index. `IF NOT EXISTS` keeps this safe to
-- re-run and harmless if an index was added out-of-band.
CREATE INDEX IF NOT EXISTS "Service_categoryId_idx" ON "Service"("categoryId");
CREATE INDEX IF NOT EXISTS "Booking_checkedInById_idx" ON "Booking"("checkedInById");
CREATE INDEX IF NOT EXISTS "Booking_createdByStaffId_idx" ON "Booking"("createdByStaffId");
CREATE INDEX IF NOT EXISTS "GuestIdDocument_verificationStatus_idx" ON "GuestIdDocument"("verificationStatus");
CREATE INDEX IF NOT EXISTS "Payment_provider_idx" ON "Payment"("provider");
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog"("action");

-- Integrity guards on derived counters. Added NOT VALID so pre-existing rows
-- are not retroactively rejected (a single bad legacy row would otherwise abort
-- the whole migration); every INSERT/UPDATE from here on is enforced. To also
-- enforce historical rows once they're known clean, run later:
--   ALTER TABLE "Booking" VALIDATE CONSTRAINT "Booking_people_breakdown_check";
--   ALTER TABLE "Booking" VALIDATE CONSTRAINT "Booking_checkin_count_check";
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_people_breakdown_check"
  CHECK ("people" = "adults" + "children") NOT VALID;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_checkin_count_check"
  CHECK ("checkedInCount" <= "people") NOT VALID;
