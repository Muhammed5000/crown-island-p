-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "sha256" TEXT;

-- CreateIndex
CREATE INDEX "Media_url_idx" ON "Media"("url");
