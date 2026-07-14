-- Append-only downtime history for places (reporting source of truth).
-- PlaceOutage rows are live state and get hard-deleted on cancel/end-early;
-- PlaceOutageLog preserves every span so out-of-service counts/durations
-- remain reportable forever.

-- CreateTable
CREATE TABLE "PlaceOutageLog" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "outageId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'OUTAGE',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdById" TEXT,
    "endedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaceOutageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlaceOutageLog_outageId_key" ON "PlaceOutageLog"("outageId");
CREATE INDEX "PlaceOutageLog_placeId_startsAt_idx" ON "PlaceOutageLog"("placeId", "startsAt");
CREATE INDEX "PlaceOutageLog_startsAt_endsAt_idx" ON "PlaceOutageLog"("startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "PlaceOutageLog" ADD CONSTRAINT "PlaceOutageLog_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "ServicePlace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Report range-scan indexes on Booking
CREATE INDEX "Booking_createdAt_idx" ON "Booking"("createdAt");
CREATE INDEX "Booking_bookingDate_idx" ON "Booking"("bookingDate");

-- Seed: mirror every existing PlaceOutage window into the log. Rows still in
-- PlaceOutage were never deleted, so they are accurate history; windows deleted
-- before this table existed are unrecoverable (history effectively starts at
-- the PlaceOutage feature's deploy). Idempotent-safe via the outageId unique.
INSERT INTO "PlaceOutageLog" ("id", "placeId", "outageId", "kind", "startsAt", "endsAt", "cancelled", "reason", "createdById", "createdAt", "updatedAt")
SELECT 'polog_' || "id", "placeId", "id", 'OUTAGE', "startsAt", "endsAt", false, "reason", "createdById", "createdAt", CURRENT_TIMESTAMP
FROM "PlaceOutage"
ON CONFLICT ("outageId") DO NOTHING;
