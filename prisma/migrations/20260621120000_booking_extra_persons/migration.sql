-- Add the optional paid "extra person" add-on count to bookings.
-- Additive + NOT NULL DEFAULT 0: existing rows backfill to 0 (no add-ons), so
-- there is no behavioural change for bookings made before the feature, and
-- services that never enable `allowExtraPeople` keep charging exactly as before.
ALTER TABLE "Booking" ADD COLUMN "extraPersons" INTEGER NOT NULL DEFAULT 0;
