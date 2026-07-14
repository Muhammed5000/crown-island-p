-- Customer notification preferences.
-- Additive only: new columns are NOT NULL with safe defaults, so existing rows
-- backfill automatically (booking updates + reminders ON, matching the schema).
ALTER TABLE "CustomerProfile" ADD COLUMN "notifyBookingUpdates" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CustomerProfile" ADD COLUMN "notifyReminders" BOOLEAN NOT NULL DEFAULT true;
