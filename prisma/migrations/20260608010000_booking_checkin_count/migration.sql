-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "checkedInCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill: bookings already admitted (legacy all-or-nothing) count as fully entered.
UPDATE "Booking" SET "checkedInCount" = "people" WHERE "checkedInAt" IS NOT NULL;
