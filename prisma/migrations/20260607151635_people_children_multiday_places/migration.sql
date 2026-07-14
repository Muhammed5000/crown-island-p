-- CreateEnum
CREATE TYPE "ExtraPersonMode" AS ENUM ('NEW_UNIT', 'EXTRA_CHARGE');

-- CreateEnum
CREATE TYPE "PlaceType" AS ENUM ('CABIN', 'CABANA', 'UMBRELLA', 'SEAT', 'SPOT');

-- CreateEnum
CREATE TYPE "PlacementStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PARTIAL', 'COMPLETE');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "adults" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "children" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "placementStatus" "PlacementStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "unitsPerDay" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "allowChildren" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "allowExtraPeople" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "allowMultiDay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "childrenCountAsPersons" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "extraChildPriceCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "extraPersonMode" "ExtraPersonMode" NOT NULL DEFAULT 'NEW_UNIT',
ADD COLUMN     "freeChildrenPerUnit" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "includedPersonsPerUnit" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "maxBookingDays" INTEGER,
ADD COLUMN     "maxChildAge" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "maxPersonsPerUnit" INTEGER,
ADD COLUMN     "placeAssignmentRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "placeType" "PlaceType" NOT NULL DEFAULT 'SEAT';

-- CreateTable
CREATE TABLE "ServicePlace" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "PlaceType" NOT NULL,
    "zone" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicePlace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingUnit" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "unitIndex" INTEGER NOT NULL DEFAULT 0,
    "adults" INTEGER NOT NULL DEFAULT 0,
    "children" INTEGER NOT NULL DEFAULT 0,
    "placeId" TEXT,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3),
    "checkedInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServicePlace_serviceId_isActive_idx" ON "ServicePlace"("serviceId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ServicePlace_serviceId_label_key" ON "ServicePlace"("serviceId", "label");

-- CreateIndex
CREATE INDEX "BookingUnit_bookingId_idx" ON "BookingUnit"("bookingId");

-- CreateIndex
CREATE INDEX "BookingUnit_date_idx" ON "BookingUnit"("date");

-- CreateIndex
CREATE UNIQUE INDEX "BookingUnit_placeId_date_key" ON "BookingUnit"("placeId", "date");

-- AddForeignKey
ALTER TABLE "ServicePlace" ADD CONSTRAINT "ServicePlace_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingUnit" ADD CONSTRAINT "BookingUnit_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingUnit" ADD CONSTRAINT "BookingUnit_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "ServicePlace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: keep historical bookings consistent with the new unit model by
-- giving each existing booking exactly one BookingUnit on its booking date,
-- carrying its current head-count as adults. `adults` on Booking also defaults
-- to the existing `people` count so old rows read sensibly. No-op on a fresh
-- database (there are no bookings to backfill).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "Booking" SET "adults" = "people" WHERE "adults" = 1 AND "people" <> 1;

INSERT INTO "BookingUnit" ("id", "bookingId", "date", "unitIndex", "adults", "children", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, b."id", b."bookingDate", 0, b."people", 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Booking" b
WHERE NOT EXISTS (SELECT 1 FROM "BookingUnit" u WHERE u."bookingId" = b."id");
