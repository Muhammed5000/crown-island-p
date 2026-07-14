-- CreateEnum
CREATE TYPE "CancellationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "CancellationRequest" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "lockedRefundPercent" INTEGER NOT NULL,
    "lockedRefundCents" INTEGER NOT NULL,
    "hoursBeforeStart" INTEGER NOT NULL,
    "totalCentsAtRequest" INTEGER NOT NULL,
    "status" "CancellationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "processedById" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CancellationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CancellationRequest_bookingId_key" ON "CancellationRequest"("bookingId");

-- CreateIndex
CREATE INDEX "CancellationRequest_status_requestedAt_idx" ON "CancellationRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "CancellationRequest_userId_idx" ON "CancellationRequest"("userId");

-- AddForeignKey
ALTER TABLE "CancellationRequest" ADD CONSTRAINT "CancellationRequest_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationRequest" ADD CONSTRAINT "CancellationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
