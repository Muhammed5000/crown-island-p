-- Widen the check-in headcount constraint to include paid EXTRA PERSONS.
--
-- The gate admits the full admissible party = people + extraPersons (see
-- checkInBooking: `newCount = min(people + extraPersons, …)`, and toPass:
-- `guests = people + extraPersons`). The original constraint
-- (`checkedInCount <= people`, added in 20260608030000) predates paid
-- extra-persons and therefore REJECTS a full check-in for any booking that has
-- extras — the DB raises a check-constraint error which the reception UI shows
-- as the generic "حدث خطأ ما. أعد المحاولة."
--
-- Kept NOT VALID (matching the original) so existing rows are not re-scanned;
-- every new/updated row is still enforced against the corrected upper bound.
ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS "Booking_checkin_count_check";
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_checkin_count_check"
  CHECK ("checkedInCount" <= "people" + "extraPersons") NOT VALID;
