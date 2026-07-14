-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "visitCodeId" TEXT;

-- CreateTable
CREATE TABLE "VisitCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "visitDate" TIMESTAMP(3) NOT NULL,
    "identityKey" TEXT NOT NULL,
    "userId" TEXT,
    "guestName" TEXT,
    "guestPhone" TEXT,
    "printedAt" TIMESTAMP(3),
    "scanCount" INTEGER NOT NULL DEFAULT 0,
    "lastScannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VisitCode_code_key" ON "VisitCode"("code");

-- CreateIndex
CREATE INDEX "VisitCode_visitDate_idx" ON "VisitCode"("visitDate");

-- CreateIndex
CREATE INDEX "VisitCode_userId_idx" ON "VisitCode"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VisitCode_identityKey_visitDate_key" ON "VisitCode"("identityKey", "visitDate");

-- CreateIndex
CREATE INDEX "Booking_visitCodeId_idx" ON "Booking"("visitCodeId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_visitCodeId_fkey" FOREIGN KEY ("visitCodeId") REFERENCES "VisitCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitCode" ADD CONSTRAINT "VisitCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

