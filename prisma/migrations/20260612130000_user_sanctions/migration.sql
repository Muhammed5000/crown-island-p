-- User sanctions: admin-issued financial penalties charged on the user's next booking.

-- CreateEnum
CREATE TYPE "SanctionStatus" AS ENUM ('ACTIVE', 'PAID', 'WAIVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Sanction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "status" "SanctionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "pendingBookingId" TEXT,
    "paidByBookingId" TEXT,
    "settledById" TEXT,
    "settledAt" TIMESTAMP(3),
    "settlementNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sanction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sanction_userId_status_idx" ON "Sanction"("userId", "status");

-- CreateIndex
CREATE INDEX "Sanction_status_createdAt_idx" ON "Sanction"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Sanction_pendingBookingId_idx" ON "Sanction"("pendingBookingId");

-- CreateIndex
CREATE INDEX "Sanction_paidByBookingId_idx" ON "Sanction"("paidByBookingId");

-- AddForeignKey
ALTER TABLE "Sanction" ADD CONSTRAINT "Sanction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sanction" ADD CONSTRAINT "Sanction_pendingBookingId_fkey" FOREIGN KEY ("pendingBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sanction" ADD CONSTRAINT "Sanction_paidByBookingId_fkey" FOREIGN KEY ("paidByBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
