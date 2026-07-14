-- H2: a claim state placed on the payment row BEFORE the external gateway refund
-- call, so a concurrent/duplicate admin refund can never double-charge the gateway.
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUND_PENDING';

-- Remove PAYMOB from PaymentProvider (Crédit Agricole is now the only card gateway).
-- Remap any legacy PAYMOB payment rows to CREDIT_AGRICOLE FIRST so the enum-swap
-- cast cannot fail. This is a no-op where no PAYMOB rows exist (e.g. production).
UPDATE "Payment" SET "provider" = 'CREDIT_AGRICOLE' WHERE "provider" = 'PAYMOB';

ALTER TABLE "Payment" ALTER COLUMN "provider" DROP DEFAULT;
CREATE TYPE "PaymentProvider_new" AS ENUM ('CREDIT_AGRICOLE', 'INSTAPAY', 'VODAFONE_CASH', 'APPLE_PAY', 'CASH');
ALTER TABLE "Payment" ALTER COLUMN "provider" TYPE "PaymentProvider_new" USING ("provider"::text::"PaymentProvider_new");
ALTER TYPE "PaymentProvider" RENAME TO "PaymentProvider_old";
ALTER TYPE "PaymentProvider_new" RENAME TO "PaymentProvider";
DROP TYPE "PaymentProvider_old";
ALTER TABLE "Payment" ALTER COLUMN "provider" SET DEFAULT 'CREDIT_AGRICOLE';

-- H8: persist the ZK access-level ids last pushed to a booking's person so a
-- re-sync (place reassigned/released) can DIFF and actively revoke old doors.
ALTER TABLE "Booking" ADD COLUMN "zkLevelIds" TEXT;
