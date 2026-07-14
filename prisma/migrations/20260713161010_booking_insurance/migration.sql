-- CreateEnum
CREATE TYPE "RefundKind" AS ENUM ('SERVICE', 'INSURANCE');

-- CreateEnum
CREATE TYPE "InsuranceChargeType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "InsuranceCollectionStatus" AS ENUM ('PENDING', 'COLLECTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "InsuranceDecision" AS ENUM ('UNDECIDED', 'REFUND', 'NO_REFUND');

-- CreateEnum
CREATE TYPE "InsuranceRefundMethod" AS ENUM ('PROVIDER', 'CASH', 'INSTAPAY');

-- CreateEnum
CREATE TYPE "InsuranceRefundStatus" AS ENUM ('AWAITING_ADMIN', 'PENDING_DESK', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED', 'MANUAL_ATTENTION');

-- AlterTable
ALTER TABLE "RefundLine" ADD COLUMN     "kind" "RefundKind" NOT NULL DEFAULT 'SERVICE';

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "insuranceEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "insuranceFixedCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "insurancePercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "insuranceType" "InsuranceChargeType" NOT NULL DEFAULT 'FIXED';

-- CreateTable
CREATE TABLE "BookingInsurance" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "type" "InsuranceChargeType" NOT NULL,
    "percent" INTEGER,
    "fixedCents" INTEGER,
    "baseCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "collectionStatus" "InsuranceCollectionStatus" NOT NULL DEFAULT 'PENDING',
    "collectedAt" TIMESTAMP(3),
    "paidVia" "PaymentProvider",
    "decision" "InsuranceDecision" NOT NULL DEFAULT 'UNDECIDED',
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "noRefundReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingInsurance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceRefund" (
    "id" TEXT NOT NULL,
    "bookingInsuranceId" TEXT NOT NULL,
    "method" "InsuranceRefundMethod" NOT NULL,
    "status" "InsuranceRefundStatus" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "providerRefundRef" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "proofUrl" TEXT,
    "failureMessage" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsuranceRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingInsurance_bookingId_key" ON "BookingInsurance"("bookingId");

-- CreateIndex
CREATE INDEX "BookingInsurance_collectionStatus_decision_idx" ON "BookingInsurance"("collectionStatus", "decision");

-- CreateIndex
CREATE INDEX "BookingInsurance_updatedAt_idx" ON "BookingInsurance"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceRefund_providerRefundRef_key" ON "InsuranceRefund"("providerRefundRef");

-- CreateIndex
CREATE INDEX "InsuranceRefund_bookingInsuranceId_idx" ON "InsuranceRefund"("bookingInsuranceId");

-- CreateIndex
CREATE INDEX "InsuranceRefund_status_createdAt_idx" ON "InsuranceRefund"("status", "createdAt");

-- CreateIndex
CREATE INDEX "InsuranceRefund_proofUrl_idx" ON "InsuranceRefund"("proofUrl");

-- CreateIndex
CREATE INDEX "InsuranceRefund_updatedAt_idx" ON "InsuranceRefund"("updatedAt");

-- AddForeignKey
ALTER TABLE "BookingInsurance" ADD CONSTRAINT "BookingInsurance_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceRefund" ADD CONSTRAINT "InsuranceRefund_bookingInsuranceId_fkey" FOREIGN KEY ("bookingInsuranceId") REFERENCES "BookingInsurance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma cannot declare partial unique indexes): at most ONE
-- active refund attempt per deposit. The service layer's atomic decision claim
-- is the primary gate; this is the DB-level backstop against double payouts.
CREATE UNIQUE INDEX "InsuranceRefund_active_one_per_insurance"
  ON "InsuranceRefund" ("bookingInsuranceId")
  WHERE "status" IN ('AWAITING_ADMIN', 'PENDING_DESK', 'PROCESSING');

-- Hand-written CHECK constraints (defense in depth; the service layer validates
-- first and these should never fire in normal operation).
ALTER TABLE "BookingInsurance"
  ADD CONSTRAINT "BookingInsurance_amount_nonneg" CHECK ("amountCents" >= 0),
  ADD CONSTRAINT "BookingInsurance_base_nonneg" CHECK ("baseCents" >= 0);

ALTER TABLE "InsuranceRefund"
  ADD CONSTRAINT "InsuranceRefund_amount_positive" CHECK ("amountCents" > 0);
