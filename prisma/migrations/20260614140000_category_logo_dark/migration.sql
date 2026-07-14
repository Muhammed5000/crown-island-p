-- Add a dark-mode variant of the category logo. Nullable + additive, so it is
-- safe to apply to an existing table without touching any rows.
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "logoDarkUrl" TEXT;
