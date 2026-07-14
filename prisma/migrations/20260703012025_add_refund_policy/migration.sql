-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "refundPolicyAr" TEXT,
ADD COLUMN     "refundPolicyEn" TEXT,
ADD COLUMN     "refundPolicyUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "refundPolicyAcceptedAt" TIMESTAMP(3);
