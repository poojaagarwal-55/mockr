-- Expert interview platform: identity flag + 6 new tables.
-- Mirrors the peer_sessions lifecycle so the existing socket / WebRTC plumbing
-- in apps/p2p can be reused. Race-safe slot claim is enforced by a partial
-- UPDATE in application code; the schema only guarantees uniqueness of the
-- resulting_session_id back-pointer.

-- 1. Identity flag (admin grants via toggle).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_expert" BOOLEAN NOT NULL DEFAULT false;

-- 2. Expert profile (lazy-created on first /expert/* read).
CREATE TABLE IF NOT EXISTS "expert_profiles" (
    "id"                 TEXT NOT NULL,
    "user_id"            TEXT NOT NULL,
    "bio"                TEXT,
    "expertise_tags"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "years_experience"   INTEGER,
    "accepting_bookings" BOOLEAN NOT NULL DEFAULT true,
    "rating_avg"         DECIMAL(3,2),
    "sessions_completed" INTEGER NOT NULL DEFAULT 0,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL,
    CONSTRAINT "expert_profiles_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "expert_profiles" ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS "expert_profiles_user_id_key" ON "expert_profiles"("user_id");
CREATE INDEX IF NOT EXISTS "expert_profiles_accepting_bookings_idx" ON "expert_profiles"("accepting_bookings");
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expert_profiles_user_id_fkey') THEN
        ALTER TABLE "expert_profiles" ADD CONSTRAINT "expert_profiles_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 3. Booking requests (candidate submits availability + preferences).
CREATE TABLE IF NOT EXISTS "expert_booking_requests" (
    "id"                 TEXT NOT NULL,
    "candidate_user_id"  TEXT NOT NULL,
    "interview_type"     TEXT NOT NULL DEFAULT 'coding',
    "preferred_language" TEXT NOT NULL DEFAULT 'python',
    "level"              TEXT NOT NULL DEFAULT 'beginner',
    "topics_focus"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "notes"              TEXT,
    "status"             TEXT NOT NULL DEFAULT 'open',
    "expires_at"         TIMESTAMP(3) NOT NULL,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL,
    CONSTRAINT "expert_booking_requests_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "expert_booking_requests" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "expert_booking_requests_status_created_at_idx" ON "expert_booking_requests"("status", "created_at");
CREATE INDEX IF NOT EXISTS "expert_booking_requests_status_expires_at_idx" ON "expert_booking_requests"("status", "expires_at");
CREATE INDEX IF NOT EXISTS "expert_booking_requests_candidate_user_id_status_idx" ON "expert_booking_requests"("candidate_user_id", "status");
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expert_booking_requests_candidate_user_id_fkey') THEN
        ALTER TABLE "expert_booking_requests" ADD CONSTRAINT "expert_booking_requests_candidate_user_id_fkey"
            FOREIGN KEY ("candidate_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 4. Time-window slots per request. claimed_by_expert_id IS NULL UNTIL claimed —
--    application code uses `UPDATE ... WHERE claimed_by_expert_id IS NULL` to win the race.
CREATE TABLE IF NOT EXISTS "expert_booking_slots" (
    "id"                   TEXT NOT NULL,
    "request_id"           TEXT NOT NULL,
    "start_at"             TIMESTAMP(3) NOT NULL,
    "end_at"               TIMESTAMP(3) NOT NULL,
    "candidate_timezone"   TEXT,
    "claimed_by_expert_id" TEXT,
    "claimed_at"           TIMESTAMP(3),
    "resulting_session_id" TEXT,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expert_booking_slots_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "expert_booking_slots" ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS "expert_booking_slots_resulting_session_id_key" ON "expert_booking_slots"("resulting_session_id");
CREATE INDEX IF NOT EXISTS "expert_booking_slots_request_id_idx" ON "expert_booking_slots"("request_id");
CREATE INDEX IF NOT EXISTS "expert_booking_slots_claimed_by_expert_id_idx" ON "expert_booking_slots"("claimed_by_expert_id");
CREATE INDEX IF NOT EXISTS "expert_booking_slots_start_at_claimed_by_expert_id_idx" ON "expert_booking_slots"("start_at", "claimed_by_expert_id");
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expert_booking_slots_request_id_fkey') THEN
        ALTER TABLE "expert_booking_slots" ADD CONSTRAINT "expert_booking_slots_request_id_fkey"
            FOREIGN KEY ("request_id") REFERENCES "expert_booking_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expert_booking_slots_claimed_by_expert_id_fkey') THEN
        ALTER TABLE "expert_booking_slots" ADD CONSTRAINT "expert_booking_slots_claimed_by_expert_id_fkey"
            FOREIGN KEY ("claimed_by_expert_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 5. Materialised session, created when an expert claims a slot.
CREATE TABLE IF NOT EXISTS "expert_sessions" (
    "id"                 TEXT NOT NULL,
    "room_id"            TEXT NOT NULL,
    "request_id"         TEXT,
    "slot_id"            TEXT,
    "candidate_user_id"  TEXT NOT NULL,
    "expert_user_id"     TEXT NOT NULL,
    "interview_type"     TEXT NOT NULL DEFAULT 'coding',
    "preferred_language" TEXT NOT NULL DEFAULT 'python',
    "status"             TEXT NOT NULL DEFAULT 'SCHEDULED',
    "scheduled_for"      TIMESTAMP(3) NOT NULL,
    "ends_at"            TIMESTAMP(3),
    "started_at"         TIMESTAMP(3),
    "ended_at"           TIMESTAMP(3),
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL,
    CONSTRAINT "expert_sessions_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "expert_sessions" ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS "expert_sessions_room_id_key" ON "expert_sessions"("room_id");
CREATE UNIQUE INDEX IF NOT EXISTS "expert_sessions_slot_id_key" ON "expert_sessions"("slot_id");
CREATE INDEX IF NOT EXISTS "expert_sessions_status_scheduled_for_idx" ON "expert_sessions"("status", "scheduled_for");
CREATE INDEX IF NOT EXISTS "expert_sessions_candidate_user_id_scheduled_for_idx" ON "expert_sessions"("candidate_user_id", "scheduled_for");
CREATE INDEX IF NOT EXISTS "expert_sessions_expert_user_id_scheduled_for_idx" ON "expert_sessions"("expert_user_id", "scheduled_for");
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expert_sessions_candidate_user_id_fkey') THEN
        ALTER TABLE "expert_sessions" ADD CONSTRAINT "expert_sessions_candidate_user_id_fkey"
            FOREIGN KEY ("candidate_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expert_sessions_expert_user_id_fkey') THEN
        ALTER TABLE "expert_sessions" ADD CONSTRAINT "expert_sessions_expert_user_id_fkey"
            FOREIGN KEY ("expert_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 6. Ordered questions per session.
CREATE TABLE IF NOT EXISTS "expert_session_questions" (
    "id"                  TEXT NOT NULL,
    "session_id"          TEXT NOT NULL,
    "question_id"         TEXT,
    "question_title"      TEXT NOT NULL,
    "question_difficulty" TEXT NOT NULL,
    "question_topic"      TEXT NOT NULL,
    "is_custom"           BOOLEAN NOT NULL DEFAULT false,
    "custom_prompt"       TEXT,
    "order_index"         INTEGER NOT NULL,
    "added_by_user_id"    TEXT NOT NULL,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expert_session_questions_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "expert_session_questions" ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS "expert_session_questions_session_id_order_index_key"
    ON "expert_session_questions"("session_id", "order_index");
CREATE INDEX IF NOT EXISTS "expert_session_questions_session_id_idx" ON "expert_session_questions"("session_id");
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expert_session_questions_session_id_fkey') THEN
        ALTER TABLE "expert_session_questions" ADD CONSTRAINT "expert_session_questions_session_id_fkey"
            FOREIGN KEY ("session_id") REFERENCES "expert_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expert_session_questions_added_by_user_id_fkey') THEN
        ALTER TABLE "expert_session_questions" ADD CONSTRAINT "expert_session_questions_added_by_user_id_fkey"
            FOREIGN KEY ("added_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
    END IF;
END $$;

-- 7. Structured feedback (one per session). private_notes is expert-only forever;
--    everything else is gated client-side by shared_with_candidate.
CREATE TABLE IF NOT EXISTS "expert_feedback" (
    "id"                    TEXT NOT NULL,
    "session_id"            TEXT NOT NULL,
    "expert_user_id"        TEXT NOT NULL,
    "candidate_user_id"     TEXT NOT NULL,
    "problem_solving"       INTEGER NOT NULL,
    "communication"         INTEGER NOT NULL,
    "code_quality"          INTEGER NOT NULL,
    "technical_depth"       INTEGER NOT NULL,
    "overall_rating"        INTEGER NOT NULL,
    "hire_decision"         TEXT NOT NULL,
    "strengths"             TEXT,
    "improvement_areas"     TEXT,
    "private_notes"         TEXT,
    "shared_with_candidate" BOOLEAN NOT NULL DEFAULT false,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expert_feedback_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "expert_feedback" ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS "expert_feedback_session_id_key" ON "expert_feedback"("session_id");
CREATE INDEX IF NOT EXISTS "expert_feedback_candidate_user_id_created_at_idx" ON "expert_feedback"("candidate_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "expert_feedback_expert_user_id_created_at_idx" ON "expert_feedback"("expert_user_id", "created_at");
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expert_feedback_session_id_fkey') THEN
        ALTER TABLE "expert_feedback" ADD CONSTRAINT "expert_feedback_session_id_fkey"
            FOREIGN KEY ("session_id") REFERENCES "expert_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expert_feedback_expert_user_id_fkey') THEN
        ALTER TABLE "expert_feedback" ADD CONSTRAINT "expert_feedback_expert_user_id_fkey"
            FOREIGN KEY ("expert_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expert_feedback_candidate_user_id_fkey') THEN
        ALTER TABLE "expert_feedback" ADD CONSTRAINT "expert_feedback_candidate_user_id_fkey"
            FOREIGN KEY ("candidate_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
