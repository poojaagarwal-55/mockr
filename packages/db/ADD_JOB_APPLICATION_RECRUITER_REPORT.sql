ALTER TABLE "public"."job_applications"
ADD COLUMN IF NOT EXISTS "recruiter_report" JSONB;
