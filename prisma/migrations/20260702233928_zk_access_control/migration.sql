-- CreateEnum
CREATE TYPE "ZkProvisionStatus" AS ENUM ('NONE', 'PENDING', 'PROVISIONED', 'FAILED', 'REVOKED');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "zkCardNo" TEXT,
ADD COLUMN     "zkLastError" TEXT,
ADD COLUMN     "zkPin" TEXT,
ADD COLUMN     "zkProvisionStatus" "ZkProvisionStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "zkProvisionedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "requiresAccessControl" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ServicePlace" ADD COLUMN     "zkAccessLevelId" TEXT,
ADD COLUMN     "zkDoorLabel" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "zkEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "zkGuestDeptCode" TEXT DEFAULT 'GUESTS',
ADD COLUMN     "zkServerPort" INTEGER,
ADD COLUMN     "zkServerUrl" TEXT;

-- CreateTable
CREATE TABLE "ZkCard" (
    "id" TEXT NOT NULL,
    "cardNo" TEXT NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedBookingId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZkCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ZkCard_cardNo_key" ON "ZkCard"("cardNo");

-- CreateIndex
CREATE UNIQUE INDEX "ZkCard_assignedBookingId_key" ON "ZkCard"("assignedBookingId");

-- CreateIndex
CREATE INDEX "ZkCard_isActive_assignedBookingId_idx" ON "ZkCard"("isActive", "assignedBookingId");

-- AddForeignKey
ALTER TABLE "ZkCard" ADD CONSTRAINT "ZkCard_assignedBookingId_fkey" FOREIGN KEY ("assignedBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
