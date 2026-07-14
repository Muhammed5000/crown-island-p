-- Accessibility (handicap) flag for a physical place. Advisory only — it does
-- not affect availability/pricing; reception & gate colour these cells distinctly.
ALTER TABLE "ServicePlace" ADD COLUMN "isHandicap" BOOLEAN NOT NULL DEFAULT false;
