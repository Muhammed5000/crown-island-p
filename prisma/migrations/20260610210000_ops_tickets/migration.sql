-- CreateEnum
CREATE TYPE "OpsTicketType" AS ENUM ('HOUSEKEEPING', 'MAINTENANCE', 'CLEANING', 'REPAIR', 'INSPECTION', 'OUT_OF_SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "OpsTicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "OpsTicketStatus" AS ENUM ('NEW', 'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'COMPLETED', 'CANCELLED', 'REOPENED');

-- CreateEnum
CREATE TYPE "OpsEventKind" AS ENUM ('CREATED', 'ASSIGNED', 'UNASSIGNED', 'STATUS', 'PRIORITY', 'DUE_DATE', 'NOTE', 'ESCALATED', 'RETURNED_TO_SERVICE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'HOUSEKEEPING';
ALTER TYPE "UserRole" ADD VALUE 'MAINTENANCE';

-- CreateTable
CREATE TABLE "OpsTicket" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "type" "OpsTicketType" NOT NULL,
    "priority" "OpsTicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "OpsTicketStatus" NOT NULL DEFAULT 'NEW',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "placeId" TEXT,
    "bookingId" TEXT,
    "createdById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "dueAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "outageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpsTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsTicketEvent" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "kind" "OpsEventKind" NOT NULL,
    "actorId" TEXT,
    "fromValue" TEXT,
    "toValue" TEXT,
    "note" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsTicketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticketId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpsTicket_reference_key" ON "OpsTicket"("reference");

-- CreateIndex
CREATE INDEX "OpsTicket_status_priority_idx" ON "OpsTicket"("status", "priority");

-- CreateIndex
CREATE INDEX "OpsTicket_assignedToId_status_idx" ON "OpsTicket"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "OpsTicket_createdById_idx" ON "OpsTicket"("createdById");

-- CreateIndex
CREATE INDEX "OpsTicket_placeId_idx" ON "OpsTicket"("placeId");

-- CreateIndex
CREATE INDEX "OpsTicket_type_status_idx" ON "OpsTicket"("type", "status");

-- CreateIndex
CREATE INDEX "OpsTicket_createdAt_idx" ON "OpsTicket"("createdAt");

-- CreateIndex
CREATE INDEX "OpsTicket_dueAt_idx" ON "OpsTicket"("dueAt");

-- CreateIndex
CREATE INDEX "OpsTicketEvent_ticketId_createdAt_idx" ON "OpsTicketEvent"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "StaffNotification_userId_readAt_idx" ON "StaffNotification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "StaffNotification_userId_createdAt_idx" ON "StaffNotification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "OpsTicket" ADD CONSTRAINT "OpsTicket_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "ServicePlace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsTicket" ADD CONSTRAINT "OpsTicket_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsTicket" ADD CONSTRAINT "OpsTicket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsTicket" ADD CONSTRAINT "OpsTicket_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsTicketEvent" ADD CONSTRAINT "OpsTicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "OpsTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsTicketEvent" ADD CONSTRAINT "OpsTicketEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffNotification" ADD CONSTRAINT "StaffNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffNotification" ADD CONSTRAINT "StaffNotification_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "OpsTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

