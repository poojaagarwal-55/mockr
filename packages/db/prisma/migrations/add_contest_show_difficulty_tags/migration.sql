ALTER TABLE "contests"
ADD COLUMN IF NOT EXISTS "show_difficulty_tags" BOOLEAN NOT NULL DEFAULT true;
