-- Restaurant module: RESTAURANT user role + partner restaurant profiles.

-- New customer-like role for restaurant partners. Safe inside a transaction on
-- PG 12+ because no row in this migration uses the new value.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'RESTAURANT';

-- CreateEnum
CREATE TYPE "RestaurantStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DISABLED');

-- CreateTable
CREATE TABLE "Restaurant" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "coverUrl" TEXT,
    "menuPdfUrl" TEXT,
    "menuPdfName" TEXT,
    "menuPdfSize" INTEGER,
    "phone" TEXT NOT NULL,
    "facebookUrl" TEXT,
    "instagramUrl" TEXT,
    "tiktokUrl" TEXT,
    "websiteUrl" TEXT,
    "address" TEXT,
    "openingHours" TEXT,
    "status" "RestaurantStatus" NOT NULL DEFAULT 'PENDING',
    "statusNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Restaurant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Restaurant_ownerId_key" ON "Restaurant"("ownerId");

-- CreateIndex
CREATE INDEX "Restaurant_status_idx" ON "Restaurant"("status");

-- AddForeignKey
ALTER TABLE "Restaurant" ADD CONSTRAINT "Restaurant_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
