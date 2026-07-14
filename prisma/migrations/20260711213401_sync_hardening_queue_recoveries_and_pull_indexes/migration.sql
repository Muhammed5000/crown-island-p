-- AlterTable
ALTER TABLE "sync_queue" ADD COLUMN     "recoveries" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "BlockedIdentity_createdAt_idx" ON "BlockedIdentity"("createdAt");

-- CreateIndex
CREATE INDEX "CategoryTermsAcceptance_acceptedAt_idx" ON "CategoryTermsAcceptance"("acceptedAt");

-- CreateIndex
CREATE INDEX "Media_createdAt_idx" ON "Media"("createdAt");

-- CreateIndex
CREATE INDEX "RefundLine_createdAt_idx" ON "RefundLine"("createdAt");
