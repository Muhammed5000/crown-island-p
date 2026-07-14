-- CreateTable: timed out-of-service windows for a place (maintenance, damage, etc.)
CREATE TABLE "PlaceOutage" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaceOutage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaceOutage_placeId_idx" ON "PlaceOutage"("placeId");

-- CreateIndex
CREATE INDEX "PlaceOutage_startsAt_endsAt_idx" ON "PlaceOutage"("startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "PlaceOutage" ADD CONSTRAINT "PlaceOutage_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "ServicePlace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
