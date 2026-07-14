-- AlterTable: per-guest gate entry by photo + name.
-- guestName: a human label so staff pick who is entering by name + photo.
-- checkedInAt/checkedInById: which specific guest has entered (vs still coming).
ALTER TABLE "GuestIdDocument" ADD COLUMN "guestName" TEXT;
ALTER TABLE "GuestIdDocument" ADD COLUMN "checkedInAt" TIMESTAMP(3);
ALTER TABLE "GuestIdDocument" ADD COLUMN "checkedInById" TEXT;
