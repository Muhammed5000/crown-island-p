-- Settings: admin-controlled homepage hero video ("ads" slot) + poster fallback.
-- Both nullable (metadata-only ALTERs, non-blocking on Postgres).
ALTER TABLE "Settings" ADD COLUMN "heroVideoUrl" TEXT;
ALTER TABLE "Settings" ADD COLUMN "heroPosterUrl" TEXT;
