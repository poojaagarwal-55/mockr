ALTER TABLE "direct_interviews"
  ADD COLUMN IF NOT EXISTS "question_plan" JSONB;
