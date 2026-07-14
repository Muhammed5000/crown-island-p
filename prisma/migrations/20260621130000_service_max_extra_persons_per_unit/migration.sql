-- Add a nullable per-unit cap for the paid "Extra Person" add-on (null = no limit).
-- Additive + nullable: existing rows default to NULL (no cap), so there is no
-- behavioural change for services that have not configured a limit.
ALTER TABLE "Service" ADD COLUMN "maxExtraPersonsPerUnit" INTEGER;
