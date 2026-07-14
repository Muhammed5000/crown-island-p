-- CreateEnum
CREATE TYPE "StaffWorkLocation" AS ENUM ('GATE', 'RECEPTION', 'OPS');

-- CreateTable
CREATE TABLE "WorkSession" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "location" "StaffWorkLocation" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "autoClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkSession_staffId_startedAt_idx" ON "WorkSession"("staffId", "startedAt");

-- CreateIndex
CREATE INDEX "WorkSession_staffId_endedAt_idx" ON "WorkSession"("staffId", "endedAt");

-- AddForeignKey
ALTER TABLE "WorkSession" ADD CONSTRAINT "WorkSession_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
