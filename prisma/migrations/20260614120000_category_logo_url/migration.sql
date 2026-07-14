-- Add an optional per-category logo (brand mark) shown on the category entry
-- page and printed on the downloadable ticket. Nullable + additive, so it is
-- safe to apply to an existing table without touching any rows.
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
