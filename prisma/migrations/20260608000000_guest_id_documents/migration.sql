-- CreateEnum
CREATE TYPE "IdVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "GuestIdDocument" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "guestSeq" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "verificationStatus" "IdVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestIdDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuestIdDocument_bookingId_idx" ON "GuestIdDocument"("bookingId");

-- CreateIndex
CREATE INDEX "GuestIdDocument_uploadedById_idx" ON "GuestIdDocument"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "GuestIdDocument_bookingId_guestSeq_key" ON "GuestIdDocument"("bookingId", "guestSeq");

-- AddForeignKey
ALTER TABLE "GuestIdDocument" ADD CONSTRAINT "GuestIdDocument_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
