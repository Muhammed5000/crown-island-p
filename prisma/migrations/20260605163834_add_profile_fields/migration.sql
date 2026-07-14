-- AlterTable
ALTER TABLE "CustomerProfile" ADD COLUMN     "age" INTEGER,
ADD COLUMN     "countryCode" TEXT NOT NULL DEFAULT 'EG',
ADD COLUMN     "isHandicapped" BOOLEAN NOT NULL DEFAULT false;
