-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "handicapPeople" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BookingHold" ADD COLUMN     "handicapPeople" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BookingSlot" ADD COLUMN     "reservedHandicap" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "dailyCapacityHandicap" INTEGER,
ADD COLUMN     "maxHandicapPerBooking" INTEGER;
