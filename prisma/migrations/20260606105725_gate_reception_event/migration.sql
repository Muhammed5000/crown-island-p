-- AlterEnum
ALTER TYPE "GateScanResult" ADD VALUE 'RECEPTION';

-- AlterTable
ALTER TABLE "GateScanEvent" ADD COLUMN     "amountCents" INTEGER;
