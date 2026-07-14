-- PromoCode: per-customer usage toggle (default true = existing one-per-customer behaviour).
ALTER TABLE "PromoCode" ADD COLUMN "oncePerCustomer" BOOLEAN NOT NULL DEFAULT true;

-- PromoRedemption: nullable uniqueness key. A set phone → one-per-customer (unique);
-- NULL → unlimited reuse (Postgres treats NULLs as distinct, so they never collide).
ALTER TABLE "PromoRedemption" ADD COLUMN "uniqueCustomerPhone" TEXT;

-- Backfill: every existing redemption was made under the one-per-customer rule, so
-- its phone becomes the uniqueness key — preserving the historical guarantee. Safe
-- because the old unique [promoCodeId, customerPhone] guarantees no duplicates exist.
UPDATE "PromoRedemption" SET "uniqueCustomerPhone" = "customerPhone";

-- Swap the uniqueness constraint from customerPhone → uniqueCustomerPhone.
DROP INDEX "PromoRedemption_promoCodeId_customerPhone_key";
CREATE UNIQUE INDEX "PromoRedemption_promoCodeId_uniqueCustomerPhone_key" ON "PromoRedemption"("promoCodeId", "uniqueCustomerPhone");

-- Keep a non-unique index for the friendly "already used" pre-check lookup.
CREATE INDEX "PromoRedemption_promoCodeId_customerPhone_idx" ON "PromoRedemption"("promoCodeId", "customerPhone");
