ALTER TABLE "company_job_openings"
ADD COLUMN IF NOT EXISTS "scoring_config" JSONB;

ALTER TABLE "job_applications"
ADD COLUMN IF NOT EXISTS "evidence_pack" JSONB;

ALTER TABLE "job_applications"
ADD COLUMN IF NOT EXISTS "recruiter_analysis" JSONB;
