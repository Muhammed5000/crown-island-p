-- AlterTable: the reception operator physically at the desk, recorded alongside
-- the discount authorizer so both staff appear on the booking.
ALTER TABLE "Booking" ADD COLUMN "enteredByStaffId" TEXT;
