-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "termsUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CategoryTermsAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CategoryTermsAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CategoryTermsAcceptance_categoryId_idx" ON "CategoryTermsAcceptance"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryTermsAcceptance_userId_categoryId_key" ON "CategoryTermsAcceptance"("userId", "categoryId");

-- AddForeignKey
ALTER TABLE "CategoryTermsAcceptance" ADD CONSTRAINT "CategoryTermsAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryTermsAcceptance" ADD CONSTRAINT "CategoryTermsAcceptance_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
