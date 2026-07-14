-- AlterEnum: reception ladder roles (rising manual-discount authority).
ALTER TYPE "UserRole" ADD VALUE 'SUPERVISOR' BEFORE 'SECURITY';
ALTER TYPE "UserRole" ADD VALUE 'MANAGER' BEFORE 'SECURITY';
ALTER TYPE "UserRole" ADD VALUE 'DIRECTOR' BEFORE 'SECURITY';

-- AlterTable: staff desk-override PIN (keyed HMAC, unique).
ALTER TABLE "User" ADD COLUMN "pinHash" TEXT;
CREATE UNIQUE INDEX "User_pinHash_key" ON "User"("pinHash");

-- AlterTable: manual reception discount recorded on the booking.
ALTER TABLE "Booking" ADD COLUMN "manualDiscountPercent" INTEGER;
ALTER TABLE "Booking" ADD COLUMN "discountAuthorizedById" TEXT;

-- CreateTable: per-role manual-discount ceilings (admin-configured).
-- NOT seeded here: a fresh enum value cannot be used in the same transaction
-- that adds it. The service falls back to code defaults until rows are written.
CREATE TABLE "RoleDiscountLimit" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "maxPercent" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "RoleDiscountLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoleDiscountLimit_role_key" ON "RoleDiscountLimit"("role");
