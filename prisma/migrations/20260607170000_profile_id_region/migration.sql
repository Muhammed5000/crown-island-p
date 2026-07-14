-- Required post-sign-in profile fields: passport (alternative to nationalId) + region.
ALTER TABLE "CustomerProfile" ADD COLUMN     "passportId" TEXT,
ADD COLUMN     "region" TEXT;
