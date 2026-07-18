ALTER TABLE "public"."company_job_openings"
ADD COLUMN IF NOT EXISTS "current_round_type" TEXT,
ADD COLUMN IF NOT EXISTS "current_round_resource_id" TEXT,
ADD COLUMN IF NOT EXISTS "current_round_configured_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "company_job_openings_current_round_type_idx"
ON "public"."company_job_openings" ("current_round_type");
