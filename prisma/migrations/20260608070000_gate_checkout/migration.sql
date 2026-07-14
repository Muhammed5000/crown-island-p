-- AlterEnum: new gate-scan result for exit/checkout scans.
ALTER TYPE "GateScanResult" ADD VALUE 'EXITED';

-- AlterTable: exit/checkout tracking on Booking.
-- Live on-site headcount for a booking = checkedInCount - checkedOutCount.
ALTER TABLE "Booking" ADD COLUMN "checkedOutAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "checkedOutById" TEXT;
ALTER TABLE "Booking" ADD COLUMN "checkedOutCount" INTEGER NOT NULL DEFAULT 0;
