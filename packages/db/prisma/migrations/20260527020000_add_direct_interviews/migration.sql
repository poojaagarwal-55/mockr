-- Direct interview workflow tables.
-- JobRoundCandidate remains the shortlist source of truth; these tables store
-- scheduling, interviewer assignment, question plans, and chat.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS "interview_question_sets" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "title" TEXT NOT NULL,
  "description" TEXT,
  "is_seeded" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "interview_question_sets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "interview_questions" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "question_set_id" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "difficulty" TEXT,
  "expected_topics" JSONB,
  "order_index" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "interview_questions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "direct_interviews" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "job_round_candidate_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "application_id" TEXT NOT NULL,
  "round_id" TEXT NOT NULL,
  "candidate_user_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'shortlisted',
  "selected_from" TEXT NOT NULL DEFAULT 'application_review',
  "score" INTEGER NOT NULL DEFAULT 0,
  "scheduled_at" TIMESTAMP(3),
  "timezone" TEXT,
  "duration_minutes" INTEGER,
  "meeting_url" TEXT,
  "interview_mode" TEXT,
  "location" TEXT,
  "schedule_notes" TEXT,
  "interviewer_member_id" TEXT,
  "assigned_by_id" TEXT,
  "interviewer_notes" TEXT,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "direct_interviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "direct_interview_messages" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "direct_interview_id" TEXT NOT NULL,
  "sender_type" TEXT NOT NULL,
  "sender_company_member_id" TEXT,
  "sender_user_id" TEXT,
  "sender_name" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "direct_interview_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "direct_interview_questions" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "direct_interview_id" TEXT NOT NULL,
  "interview_question_id" TEXT NOT NULL,
  "added_by_member_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "direct_interview_questions_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "interview_questions"
    ADD CONSTRAINT "interview_questions_question_set_id_fkey"
    FOREIGN KEY ("question_set_id") REFERENCES "interview_question_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "direct_interviews"
    ADD CONSTRAINT "direct_interviews_job_round_candidate_id_fkey"
    FOREIGN KEY ("job_round_candidate_id") REFERENCES "job_round_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "direct_interviews"
    ADD CONSTRAINT "direct_interviews_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "direct_interviews"
    ADD CONSTRAINT "direct_interviews_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "company_job_openings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "direct_interviews"
    ADD CONSTRAINT "direct_interviews_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "direct_interviews"
    ADD CONSTRAINT "direct_interviews_round_id_fkey"
    FOREIGN KEY ("round_id") REFERENCES "job_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "direct_interviews"
    ADD CONSTRAINT "direct_interviews_candidate_user_id_fkey"
    FOREIGN KEY ("candidate_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "direct_interviews"
    ADD CONSTRAINT "direct_interviews_interviewer_member_id_fkey"
    FOREIGN KEY ("interviewer_member_id") REFERENCES "company_team_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "direct_interview_messages"
    ADD CONSTRAINT "direct_interview_messages_direct_interview_id_fkey"
    FOREIGN KEY ("direct_interview_id") REFERENCES "direct_interviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "direct_interview_messages"
    ADD CONSTRAINT "direct_interview_messages_sender_company_member_id_fkey"
    FOREIGN KEY ("sender_company_member_id") REFERENCES "company_team_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "direct_interview_messages"
    ADD CONSTRAINT "direct_interview_messages_sender_user_id_fkey"
    FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "direct_interview_questions"
    ADD CONSTRAINT "direct_interview_questions_direct_interview_id_fkey"
    FOREIGN KEY ("direct_interview_id") REFERENCES "direct_interviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "direct_interview_questions"
    ADD CONSTRAINT "direct_interview_questions_interview_question_id_fkey"
    FOREIGN KEY ("interview_question_id") REFERENCES "interview_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "direct_interview_questions"
    ADD CONSTRAINT "direct_interview_questions_added_by_member_id_fkey"
    FOREIGN KEY ("added_by_member_id") REFERENCES "company_team_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "direct_interviews_job_round_candidate_id_key" ON "direct_interviews"("job_round_candidate_id");
CREATE UNIQUE INDEX IF NOT EXISTS "direct_interview_questions_direct_interview_id_interview_question_id_key" ON "direct_interview_questions"("direct_interview_id", "interview_question_id");
CREATE INDEX IF NOT EXISTS "interview_questions_question_set_id_order_index_idx" ON "interview_questions"("question_set_id", "order_index");
CREATE INDEX IF NOT EXISTS "direct_interviews_company_id_status_created_at_idx" ON "direct_interviews"("company_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "direct_interviews_job_id_status_idx" ON "direct_interviews"("job_id", "status");
CREATE INDEX IF NOT EXISTS "direct_interviews_candidate_user_id_created_at_idx" ON "direct_interviews"("candidate_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "direct_interviews_interviewer_member_id_scheduled_at_idx" ON "direct_interviews"("interviewer_member_id", "scheduled_at");
CREATE INDEX IF NOT EXISTS "direct_interview_messages_direct_interview_id_sender_type_read_at_created_at_idx" ON "direct_interview_messages"("direct_interview_id", "sender_type", "read_at", "created_at");
CREATE INDEX IF NOT EXISTS "direct_interview_messages_sender_company_member_id_created_at_idx" ON "direct_interview_messages"("sender_company_member_id", "created_at");
CREATE INDEX IF NOT EXISTS "direct_interview_messages_sender_user_id_created_at_idx" ON "direct_interview_messages"("sender_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "direct_interview_questions_interview_question_id_idx" ON "direct_interview_questions"("interview_question_id");
CREATE INDEX IF NOT EXISTS "direct_interview_questions_added_by_member_id_idx" ON "direct_interview_questions"("added_by_member_id");

INSERT INTO "interview_question_sets" ("id", "title", "description", "is_seeded")
VALUES
  ('frontend-product-engineering', 'Frontend product engineering', 'UI architecture, state, performance, and product judgment.', true),
  ('backend-systems', 'Backend systems', 'APIs, data modeling, authorization, and resilient workflows.', true),
  ('fullstack-collaboration', 'Full-stack collaboration', 'End-to-end ownership, tradeoffs, and candidate experience.', true)
ON CONFLICT ("id") DO UPDATE SET
  "title" = EXCLUDED."title",
  "description" = EXCLUDED."description",
  "is_seeded" = true,
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "interview_questions" ("id", "question_set_id", "prompt", "difficulty", "expected_topics", "order_index")
VALUES
  ('frontend-state-model', 'frontend-product-engineering', 'How would you model shared state for a multi-step hiring workflow without making every component know about every step?', 'medium', '["state modeling","component boundaries","workflow design"]'::jsonb, 1),
  ('frontend-slow-network', 'frontend-product-engineering', 'A candidate list is slow on weak networks. What would you measure first, and what changes would you ship?', 'medium', '["performance","networking","measurement"]'::jsonb, 2),
  ('frontend-accessibility', 'frontend-product-engineering', 'How would you review this scheduling flow for keyboard and screen-reader accessibility?', 'medium', '["accessibility","forms","semantics"]'::jsonb, 3),
  ('frontend-realtime-chat', 'frontend-product-engineering', 'Design a frontend approach for real-time chat that handles reconnects, optimistic messages, and duplicate events.', 'hard', '["websocket","optimistic UI","idempotency"]'::jsonb, 4),
  ('frontend-form-safety', 'frontend-product-engineering', 'What validation belongs on the client versus the server for an interview scheduling form?', 'medium', '["validation","security","UX"]'::jsonb, 5),
  ('frontend-debugging', 'frontend-product-engineering', 'A tab switch causes stale UI after a mutation. How would you debug and prevent that class of bug?', 'medium', '["debugging","cache invalidation","effects"]'::jsonb, 6),
  ('backend-final-round-schema', 'backend-systems', 'Design the tables and API contracts for a direct interview stage after any hiring round.', 'hard', '["schema design","API contracts","round workflow"]'::jsonb, 1),
  ('backend-authz', 'backend-systems', 'How would you enforce that only the right company members can see candidate interview data?', 'hard', '["authorization","RLS","membership roles"]'::jsonb, 2),
  ('backend-websocket', 'backend-systems', 'How would you authenticate and rate-limit a WebSocket chat between a candidate and company?', 'hard', '["websocket auth","rate limiting","validation"]'::jsonb, 3),
  ('backend-idempotency', 'backend-systems', 'A recruiter clicks move-to-interview twice. How do you make the operation idempotent?', 'medium', '["idempotency","unique constraints","transactions"]'::jsonb, 4),
  ('backend-notifications', 'backend-systems', 'How would you send interview notifications without blocking the request path?', 'medium', '["queues","notifications","retries"]'::jsonb, 5),
  ('backend-audit', 'backend-systems', 'What audit trail would you keep for role changes, interview scheduling, and message events?', 'medium', '["audit logs","privacy","compliance"]'::jsonb, 6),
  ('fullstack-empty-states', 'fullstack-collaboration', 'How would you design empty, loading, and error states so recruiters know what to do next?', 'easy', '["UX states","product thinking","copy"]'::jsonb, 1),
  ('fullstack-timezones', 'fullstack-collaboration', 'How would you handle scheduling across company and candidate time zones?', 'medium', '["timezones","date storage","UX"]'::jsonb, 2),
  ('fullstack-privacy', 'fullstack-collaboration', 'Which candidate profile fields should be shown to interviewers, and which should stay private?', 'medium', '["privacy","PII","least privilege"]'::jsonb, 3),
  ('fullstack-migration', 'fullstack-collaboration', 'How would you migrate from JSON metadata to first-class interview tables without downtime?', 'hard', '["migration","backfill","compatibility"]'::jsonb, 4),
  ('fullstack-observability', 'fullstack-collaboration', 'What product and engineering metrics would tell you the direct-interview workflow is working?', 'medium', '["metrics","observability","product analytics"]'::jsonb, 5),
  ('fullstack-edge-cases', 'fullstack-collaboration', 'Name edge cases that could break this interview workflow and how you would guard against them.', 'medium', '["edge cases","resilience","testing"]'::jsonb, 6)
ON CONFLICT ("id") DO UPDATE SET
  "question_set_id" = EXCLUDED."question_set_id",
  "prompt" = EXCLUDED."prompt",
  "difficulty" = EXCLUDED."difficulty",
  "expected_topics" = EXCLUDED."expected_topics",
  "order_index" = EXCLUDED."order_index",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "direct_interviews" (
  "id",
  "job_round_candidate_id",
  "company_id",
  "job_id",
  "application_id",
  "round_id",
  "candidate_user_id",
  "status",
  "selected_from",
  "score",
  "scheduled_at",
  "timezone",
  "duration_minutes",
  "meeting_url",
  "interview_mode",
  "location",
  "schedule_notes",
  "interviewer_member_id",
  "assigned_by_id",
  "interviewer_notes",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid()::text,
  "jrc"."id",
  "jr"."company_id",
  "jr"."job_id",
  "jrc"."application_id",
  "jr"."id",
  "jrc"."user_id",
  CASE
    WHEN NULLIF("jrc"."metadata" #>> '{directInterview,schedule,scheduledAt}', '') IS NOT NULL THEN 'scheduled'
    ELSE 'shortlisted'
  END,
  CASE
    WHEN NULLIF("jrc"."metadata" ->> 'sourceAssignmentId', '') IS NOT NULL THEN 'technical_assignment'
    ELSE COALESCE(NULLIF("jr"."config" ->> 'source', ''), 'application_review')
  END,
  COALESCE("jrc"."score", 0),
  CASE
    WHEN NULLIF("jrc"."metadata" #>> '{directInterview,schedule,scheduledAt}', '') IS NULL THEN NULL
    ELSE ("jrc"."metadata" #>> '{directInterview,schedule,scheduledAt}')::timestamp
  END,
  NULLIF("jrc"."metadata" #>> '{directInterview,schedule,timezone}', ''),
  CASE
    WHEN NULLIF("jrc"."metadata" #>> '{directInterview,schedule,durationMinutes}', '') IS NULL THEN NULL
    ELSE ("jrc"."metadata" #>> '{directInterview,schedule,durationMinutes}')::integer
  END,
  NULLIF("jrc"."metadata" #>> '{directInterview,schedule,meetingLink}', ''),
  NULLIF("jrc"."metadata" #>> '{directInterview,schedule,mode}', ''),
  NULLIF("jrc"."metadata" #>> '{directInterview,schedule,location}', ''),
  NULLIF("jrc"."metadata" #>> '{directInterview,schedule,notes}', ''),
  CASE
    WHEN EXISTS (
      SELECT 1 FROM "company_team_members" "ctm"
      WHERE "ctm"."id" = NULLIF("jrc"."metadata" #>> '{directInterview,interviewer,memberId}', '')
    )
    THEN NULLIF("jrc"."metadata" #>> '{directInterview,interviewer,memberId}', '')
    ELSE NULL
  END,
  NULLIF("jrc"."metadata" #>> '{directInterview,schedule,scheduledBy}', ''),
  NULLIF("jrc"."metadata" #>> '{directInterview,questionSelection,notes}', ''),
  "jrc"."created_at",
  CURRENT_TIMESTAMP
FROM "job_round_candidates" "jrc"
JOIN "job_rounds" "jr" ON "jr"."id" = "jrc"."round_id"
WHERE "jr"."round_type" = 'final_interview'
ON CONFLICT ("job_round_candidate_id") DO NOTHING;

ALTER TABLE "interview_question_sets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interview_questions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "direct_interviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "direct_interview_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "direct_interview_questions" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "interview question sets readable" ON "interview_question_sets";
CREATE POLICY "interview question sets readable"
  ON "interview_question_sets"
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "interview questions readable" ON "interview_questions";
CREATE POLICY "interview questions readable"
  ON "interview_questions"
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "direct interviews company owner manage" ON "direct_interviews";
CREATE POLICY "direct interviews company owner manage"
  ON "direct_interviews"
  FOR ALL
  USING ((auth.uid())::text = "company_id")
  WITH CHECK ((auth.uid())::text = "company_id");

DROP POLICY IF EXISTS "direct interviews team member read" ON "direct_interviews";
CREATE POLICY "direct interviews team member read"
  ON "direct_interviews"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM "company_team_members" "m"
      WHERE "m"."company_id" = "direct_interviews"."company_id"
        AND "m"."company_account_id" = (auth.uid())::text
        AND "m"."status" = 'active'
        AND "m"."role" IN ('admin', 'member')
    )
  );

DROP POLICY IF EXISTS "direct interviews team member update" ON "direct_interviews";
CREATE POLICY "direct interviews team member update"
  ON "direct_interviews"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM "company_team_members" "m"
      WHERE "m"."company_id" = "direct_interviews"."company_id"
        AND "m"."company_account_id" = (auth.uid())::text
        AND "m"."status" = 'active'
        AND ("m"."role" = 'admin' OR "m"."id" = "direct_interviews"."interviewer_member_id")
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "company_team_members" "m"
      WHERE "m"."company_id" = "direct_interviews"."company_id"
        AND "m"."company_account_id" = (auth.uid())::text
        AND "m"."status" = 'active'
        AND ("m"."role" = 'admin' OR "m"."id" = "direct_interviews"."interviewer_member_id")
    )
  );

DROP POLICY IF EXISTS "direct interviews candidate read" ON "direct_interviews";
CREATE POLICY "direct interviews candidate read"
  ON "direct_interviews"
  FOR SELECT
  USING ((auth.uid())::text = "candidate_user_id");

DROP POLICY IF EXISTS "direct interview messages participants read" ON "direct_interview_messages";
CREATE POLICY "direct interview messages participants read"
  ON "direct_interview_messages"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM "direct_interviews" "di"
      WHERE "di"."id" = "direct_interview_messages"."direct_interview_id"
        AND (
          "di"."company_id" = (auth.uid())::text
          OR "di"."candidate_user_id" = (auth.uid())::text
          OR EXISTS (
            SELECT 1
            FROM "company_team_members" "m"
            WHERE "m"."company_id" = "di"."company_id"
              AND "m"."company_account_id" = (auth.uid())::text
              AND "m"."status" = 'active'
              AND "m"."role" IN ('admin', 'member')
          )
        )
    )
  );

DROP POLICY IF EXISTS "direct interview messages participants insert" ON "direct_interview_messages";
CREATE POLICY "direct interview messages participants insert"
  ON "direct_interview_messages"
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "direct_interviews" "di"
      WHERE "di"."id" = "direct_interview_messages"."direct_interview_id"
        AND (
          ("direct_interview_messages"."sender_type" = 'candidate'
            AND "direct_interview_messages"."sender_user_id" = (auth.uid())::text
            AND "di"."candidate_user_id" = (auth.uid())::text)
          OR
          ("direct_interview_messages"."sender_type" = 'company'
            AND "di"."company_id" = (auth.uid())::text)
          OR
          ("direct_interview_messages"."sender_type" = 'company'
            AND EXISTS (
              SELECT 1
              FROM "company_team_members" "m"
              WHERE "m"."id" = "direct_interview_messages"."sender_company_member_id"
                AND "m"."company_id" = "di"."company_id"
                AND "m"."company_account_id" = (auth.uid())::text
                AND "m"."status" = 'active'
                AND ("m"."role" = 'admin' OR "m"."id" = "di"."interviewer_member_id")
            ))
        )
    )
  );

DROP POLICY IF EXISTS "direct interview messages participants update" ON "direct_interview_messages";
CREATE POLICY "direct interview messages participants update"
  ON "direct_interview_messages"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM "direct_interviews" "di"
      WHERE "di"."id" = "direct_interview_messages"."direct_interview_id"
        AND (
          "di"."company_id" = (auth.uid())::text
          OR "di"."candidate_user_id" = (auth.uid())::text
          OR EXISTS (
            SELECT 1
            FROM "company_team_members" "m"
            WHERE "m"."company_id" = "di"."company_id"
              AND "m"."company_account_id" = (auth.uid())::text
              AND "m"."status" = 'active'
              AND "m"."role" IN ('admin', 'member')
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "direct_interviews" "di"
      WHERE "di"."id" = "direct_interview_messages"."direct_interview_id"
        AND (
          "di"."company_id" = (auth.uid())::text
          OR "di"."candidate_user_id" = (auth.uid())::text
          OR EXISTS (
            SELECT 1
            FROM "company_team_members" "m"
            WHERE "m"."company_id" = "di"."company_id"
              AND "m"."company_account_id" = (auth.uid())::text
              AND "m"."status" = 'active'
              AND "m"."role" IN ('admin', 'member')
          )
        )
    )
  );

DROP POLICY IF EXISTS "direct interview questions participants read" ON "direct_interview_questions";
CREATE POLICY "direct interview questions participants read"
  ON "direct_interview_questions"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM "direct_interviews" "di"
      WHERE "di"."id" = "direct_interview_questions"."direct_interview_id"
        AND (
          "di"."company_id" = (auth.uid())::text
          OR "di"."candidate_user_id" = (auth.uid())::text
          OR EXISTS (
            SELECT 1
            FROM "company_team_members" "m"
            WHERE "m"."company_id" = "di"."company_id"
              AND "m"."company_account_id" = (auth.uid())::text
              AND "m"."status" = 'active'
              AND "m"."role" IN ('admin', 'member')
          )
        )
    )
  );

DROP POLICY IF EXISTS "direct interview questions company manage" ON "direct_interview_questions";
CREATE POLICY "direct interview questions company manage"
  ON "direct_interview_questions"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM "direct_interviews" "di"
      WHERE "di"."id" = "direct_interview_questions"."direct_interview_id"
        AND (
          "di"."company_id" = (auth.uid())::text
          OR EXISTS (
            SELECT 1
            FROM "company_team_members" "m"
            WHERE "m"."company_id" = "di"."company_id"
              AND "m"."company_account_id" = (auth.uid())::text
              AND "m"."status" = 'active'
              AND ("m"."role" = 'admin' OR "m"."id" = "di"."interviewer_member_id")
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "direct_interviews" "di"
      WHERE "di"."id" = "direct_interview_questions"."direct_interview_id"
        AND (
          "di"."company_id" = (auth.uid())::text
          OR EXISTS (
            SELECT 1
            FROM "company_team_members" "m"
            WHERE "m"."company_id" = "di"."company_id"
              AND "m"."company_account_id" = (auth.uid())::text
              AND "m"."status" = 'active'
              AND ("m"."role" = 'admin' OR "m"."id" = "di"."interviewer_member_id")
          )
        )
    )
  );
