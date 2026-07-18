CREATE TABLE IF NOT EXISTS "public"."technical_assignments" (
  "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "company_id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "time_limit" TEXT NOT NULL,
  "estimated_hours" TEXT,
  "deadline_policy" TEXT,
  "overview" TEXT NOT NULL,
  "scenario" TEXT NOT NULL,
  "tasks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "starter_context" TEXT,
  "constraints" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "allowed_stack" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "deliverables" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "submission_instructions" TEXT,
  "thinking_questions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "candidate_message" TEXT,
  "rubric" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'live',
  "closes_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "technical_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "technical_assignments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "technical_assignments_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."company_job_openings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "technical_assignments_job_id_key"
ON "public"."technical_assignments" ("job_id");

CREATE INDEX IF NOT EXISTS "technical_assignments_company_id_closes_at_idx"
ON "public"."technical_assignments" ("company_id", "closes_at");

CREATE INDEX IF NOT EXISTS "technical_assignments_status_closes_at_idx"
ON "public"."technical_assignments" ("status", "closes_at");

CREATE TABLE IF NOT EXISTS "public"."technical_assignment_submissions" (
  "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "assignment_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "application_id" TEXT,
  "repo_url" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "score" INTEGER NOT NULL DEFAULT 0,
  "evidence" JSONB,
  "report" JSONB,
  "next_round_type" TEXT,
  "next_round_moved_at" TIMESTAMP(3),
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "technical_assignment_submissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "technical_assignment_submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."technical_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "technical_assignment_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "technical_assignment_submissions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."job_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "technical_assignment_submissions_assignment_id_user_id_key"
ON "public"."technical_assignment_submissions" ("assignment_id", "user_id");

CREATE INDEX IF NOT EXISTS "technical_assignment_submissions_assignment_id_submitted_at_idx"
ON "public"."technical_assignment_submissions" ("assignment_id", "submitted_at");

CREATE INDEX IF NOT EXISTS "technical_assignment_submissions_user_id_submitted_at_idx"
ON "public"."technical_assignment_submissions" ("user_id", "submitted_at");

CREATE INDEX IF NOT EXISTS "technical_assignment_submissions_application_id_idx"
ON "public"."technical_assignment_submissions" ("application_id");

ALTER TABLE "public"."technical_assignment_submissions"
ADD COLUMN IF NOT EXISTS "next_round_type" TEXT;

ALTER TABLE "public"."technical_assignment_submissions"
ADD COLUMN IF NOT EXISTS "next_round_moved_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "technical_assignment_submissions_next_round_moved_at_idx"
ON "public"."technical_assignment_submissions" ("next_round_moved_at");

ALTER TABLE "public"."technical_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."technical_assignment_submissions" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'technical_assignments'
      AND policyname = 'technical_assignments_company_select'
  ) THEN
    CREATE POLICY "technical_assignments_company_select"
    ON "public"."technical_assignments"
    FOR SELECT
    USING ("company_id" = (auth.uid())::text);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'technical_assignments'
      AND policyname = 'technical_assignments_company_write'
  ) THEN
    CREATE POLICY "technical_assignments_company_write"
    ON "public"."technical_assignments"
    FOR ALL
    USING ("company_id" = (auth.uid())::text)
    WITH CHECK ("company_id" = (auth.uid())::text);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'technical_assignment_submissions'
      AND policyname = 'technical_assignment_submissions_user_select'
  ) THEN
    CREATE POLICY "technical_assignment_submissions_user_select"
    ON "public"."technical_assignment_submissions"
    FOR SELECT
    USING ("user_id" = (auth.uid())::text);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'technical_assignment_submissions'
      AND policyname = 'technical_assignment_submissions_company_select'
  ) THEN
    CREATE POLICY "technical_assignment_submissions_company_select"
    ON "public"."technical_assignment_submissions"
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM "public"."technical_assignments" assignment
        WHERE assignment."id" = "technical_assignment_submissions"."assignment_id"
          AND assignment."company_id" = (auth.uid())::text
      )
    );
  END IF;
END $$;
