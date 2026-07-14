-- Visual layout coordinates for places (admin-arranged floor map; reception/gate
-- render the cinema-style picker from these).
ALTER TABLE "ServicePlace" ADD COLUMN     "gridX" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "gridY" INTEGER NOT NULL DEFAULT 0;

-- Seed sensible initial coordinates from existing ordering so places aren't all
-- stacked at (0,0) before an admin arranges them: 8 per row by sortOrder.
UPDATE "ServicePlace" SET
  "gridX" = ("sortOrder" % 8),
  "gridY" = ("sortOrder" / 8)
WHERE "gridX" = 0 AND "gridY" = 0;
