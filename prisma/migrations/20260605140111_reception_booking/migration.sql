-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'CASH';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "createdByStaffId" TEXT,
ADD COLUMN     "guestName" TEXT,
ADD COLUMN     "guestPhone" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "proofUrl" TEXT;
