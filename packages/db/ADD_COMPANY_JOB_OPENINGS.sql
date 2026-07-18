CREATE TABLE IF NOT EXISTS "public"."company_job_openings" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
    "company_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "company_logo_url" TEXT,
    "title" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "work_mode" TEXT NOT NULL,
    "employment_type" TEXT NOT NULL,
    "role_type" TEXT NOT NULL,
    "profession" TEXT NOT NULL,
    "discipline" TEXT NOT NULL,
    "travel" TEXT NOT NULL,
    "openings" INTEGER NOT NULL DEFAULT 1,
    "experience_level" TEXT NOT NULL,
    "compensation_type" TEXT NOT NULL,
    "compensation" TEXT,
    "duration" TEXT,
    "time_commitment" TEXT,
    "application_deadline" TIMESTAMP(3),
    "skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "company_overview" TEXT,
    "about_role" TEXT NOT NULL,
    "responsibilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "requirements" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "benefits" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "application_note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_job_openings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "company_job_openings_company_id_fkey"
        FOREIGN KEY ("company_id")
        REFERENCES "public"."companies"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "company_job_openings_company_id_status_created_at_idx"
    ON "public"."company_job_openings"("company_id", "status", "created_at");

CREATE INDEX IF NOT EXISTS "company_job_openings_status_employment_type_work_mode_idx"
    ON "public"."company_job_openings"("status", "employment_type", "work_mode");

ALTER TABLE "public"."company_job_openings" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company owners can read their job openings" ON "public"."company_job_openings";
CREATE POLICY "Company owners can read their job openings"
    ON "public"."company_job_openings"
    FOR SELECT
    USING ("company_id" = auth.uid()::TEXT);

DROP POLICY IF EXISTS "Authenticated users can read open job openings" ON "public"."company_job_openings";
CREATE POLICY "Authenticated users can read open job openings"
    ON "public"."company_job_openings"
    FOR SELECT
    USING ("status" = 'open');

DROP POLICY IF EXISTS "Company owners can create job openings" ON "public"."company_job_openings";
CREATE POLICY "Company owners can create job openings"
    ON "public"."company_job_openings"
    FOR INSERT
    WITH CHECK ("company_id" = auth.uid()::TEXT);

DROP POLICY IF EXISTS "Company owners can update their job openings" ON "public"."company_job_openings";
CREATE POLICY "Company owners can update their job openings"
    ON "public"."company_job_openings"
    FOR UPDATE
    USING ("company_id" = auth.uid()::TEXT)
    WITH CHECK ("company_id" = auth.uid()::TEXT);

DROP POLICY IF EXISTS "Company owners can delete their job openings" ON "public"."company_job_openings";
CREATE POLICY "Company owners can delete their job openings"
    ON "public"."company_job_openings"
    FOR DELETE
    USING ("company_id" = auth.uid()::TEXT);
