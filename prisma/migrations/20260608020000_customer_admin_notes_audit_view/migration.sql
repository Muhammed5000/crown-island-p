-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'VIEW';

-- AlterTable
ALTER TABLE "CustomerProfile" ADD COLUMN     "adminNotes" TEXT;
