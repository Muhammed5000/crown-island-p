-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "termsAr" TEXT,
ADD COLUMN     "termsEn" TEXT,
ADD COLUMN     "termsUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3);
