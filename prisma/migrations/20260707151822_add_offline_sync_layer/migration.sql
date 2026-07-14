-- CreateTable
CREATE TABLE "sync_queue" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "op" TEXT NOT NULL DEFAULT 'upsert',
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "sync_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_state" (
    "key" TEXT NOT NULL,
    "cursor" TEXT,
    "lastPulledAt" TIMESTAMP(3),
    "lastPushedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_state_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "booking_local_state" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3),
    "checkedInById" TEXT,
    "checkedInCount" INTEGER NOT NULL DEFAULT 0,
    "checkedOutAt" TIMESTAMP(3),
    "checkedOutById" TEXT,
    "checkedOutCount" INTEGER NOT NULL DEFAULT 0,
    "placementStatus" "PlacementStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "zkProvisionStatus" "ZkProvisionStatus" NOT NULL DEFAULT 'NONE',
    "zkPin" TEXT,
    "zkCardNo" TEXT,
    "zkLastError" TEXT,
    "zkProvisionedAt" TIMESTAMP(3),
    "zkLevelIds" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_local_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_placement" (
    "id" TEXT NOT NULL,
    "bookingUnitId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "placeId" TEXT,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3),
    "checkedInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_placement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_queue_status_createdAt_idx" ON "sync_queue"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "booking_local_state_bookingId_key" ON "booking_local_state"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "unit_placement_bookingUnitId_key" ON "unit_placement"("bookingUnitId");

-- CreateIndex
CREATE INDEX "unit_placement_bookingId_idx" ON "unit_placement"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "unit_placement_placeId_date_key" ON "unit_placement"("placeId", "date");

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Seed the new local-owned tables from the columns they replace, so existing
-- bookings keep their gate / ZK / placement state after the code cutover.
--
-- The new row's id is DERIVED from the parent id (deterministic), NOT a random
-- uuid. Both the local and online deployments run this same migration against the
-- same booking ids, so they produce IDENTICAL ids for the same logical row. That
-- is what keeps the later idempotent upsert-by-id push conflict-free: a random id
-- per side would create two rows for one bookingId and violate the unique
-- constraint the moment local pushes its row to online. New (post-cutover) rows
-- are created on ONE node only and pushed, so their cuid stays consistent too.
INSERT INTO "booking_local_state" (
  "id", "bookingId", "checkedInAt", "checkedInById", "checkedInCount",
  "checkedOutAt", "checkedOutById", "checkedOutCount", "placementStatus",
  "zkProvisionStatus", "zkPin", "zkCardNo", "zkLastError", "zkProvisionedAt",
  "zkLevelIds", "createdAt", "updatedAt"
)
SELECT
  b."id", b."id", b."checkedInAt", b."checkedInById", b."checkedInCount",
  b."checkedOutAt", b."checkedOutById", b."checkedOutCount", b."placementStatus",
  b."zkProvisionStatus", b."zkPin", b."zkCardNo", b."zkLastError", b."zkProvisionedAt",
  b."zkLevelIds", now(), now()
FROM "Booking" b;

INSERT INTO "unit_placement" (
  "id", "bookingUnitId", "bookingId", "date", "placeId",
  "assignedById", "assignedAt", "checkedInAt", "createdAt", "updatedAt"
)
SELECT
  u."id", u."id", u."bookingId", u."date", u."placeId",
  u."assignedById", u."assignedAt", u."checkedInAt", now(), now()
FROM "BookingUnit" u;
