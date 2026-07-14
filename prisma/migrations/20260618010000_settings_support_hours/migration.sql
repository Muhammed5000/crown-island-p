-- Settings: admin-configurable /support working days + hours.
ALTER TABLE "Settings" ADD COLUMN "supportOpenDay" INTEGER NOT NULL DEFAULT 6;
ALTER TABLE "Settings" ADD COLUMN "supportCloseDay" INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "Settings" ADD COLUMN "supportOpenTime" TEXT NOT NULL DEFAULT '09:00';
ALTER TABLE "Settings" ADD COLUMN "supportCloseTime" TEXT NOT NULL DEFAULT '23:00';
