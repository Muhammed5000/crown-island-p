-- CreateEnum
CREATE TYPE "BlockedIdentityKind" AS ENUM ('EMAIL', 'PHONE', 'NATIONAL_ID', 'PASSPORT');

-- AlterTable: account ban tombstone (mirrors deletedAt).
ALTER TABLE "User" ADD COLUMN "blockedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "blockedReason" TEXT;
ALTER TABLE "User" ADD COLUMN "blockedById" TEXT;

-- CreateIndex
CREATE INDEX "User_blockedAt_idx" ON "User"("blockedAt");

-- CreateTable: blocklist of banned identifiers (email / phone / national-id / passport).
CREATE TABLE "BlockedIdentity" (
    "id" TEXT NOT NULL,
    "kind" "BlockedIdentityKind" NOT NULL,
    "value" TEXT NOT NULL,
    "userId" TEXT,
    "reason" TEXT,
    "blockedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlockedIdentity_kind_value_key" ON "BlockedIdentity"("kind", "value");

-- CreateIndex
CREATE INDEX "BlockedIdentity_userId_idx" ON "BlockedIdentity"("userId");
