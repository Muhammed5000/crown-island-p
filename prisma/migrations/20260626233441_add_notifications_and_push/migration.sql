-- CreateEnum
CREATE TYPE "NotificationAudience" AS ENUM ('ALL', 'TAG', 'SPECIFIC');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "NotificationCampaign" (
    "id" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "bodyEn" TEXT NOT NULL,
    "bodyAr" TEXT NOT NULL,
    "iconUrl" TEXT,
    "url" TEXT,
    "audience" "NotificationAudience" NOT NULL DEFAULT 'ALL',
    "tagId" TEXT,
    "status" "NotificationStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "pushSentCount" INTEGER NOT NULL DEFAULT 0,
    "pushFailCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationCampaignRecipient" (
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "NotificationCampaignRecipient_pkey" PRIMARY KEY ("campaignId","userId")
);

-- CreateTable
CREATE TABLE "CustomerNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campaignId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'announcement',
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "bodyEn" TEXT,
    "bodyAr" TEXT,
    "url" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationCampaign_status_scheduledAt_idx" ON "NotificationCampaign"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "NotificationCampaign_createdAt_idx" ON "NotificationCampaign"("createdAt");

-- CreateIndex
CREATE INDEX "NotificationCampaignRecipient_userId_idx" ON "NotificationCampaignRecipient"("userId");

-- CreateIndex
CREATE INDEX "CustomerNotification_userId_readAt_idx" ON "CustomerNotification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "CustomerNotification_userId_createdAt_idx" ON "CustomerNotification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- AddForeignKey
ALTER TABLE "NotificationCampaign" ADD CONSTRAINT "NotificationCampaign_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "CustomerTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCampaign" ADD CONSTRAINT "NotificationCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCampaignRecipient" ADD CONSTRAINT "NotificationCampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "NotificationCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCampaignRecipient" ADD CONSTRAINT "NotificationCampaignRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNotification" ADD CONSTRAINT "CustomerNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNotification" ADD CONSTRAINT "CustomerNotification_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "NotificationCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
