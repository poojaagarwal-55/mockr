-- AI Tutor knowledge base.
-- Adds the persistent layer behind the agentic tutor: per-user goals,
-- extracted weak areas + mistakes from completed interviews, cross-conversation
-- memory, generated artifacts (action plans / sheets / quizzes), and a
-- tool-call audit log. Written defensively (idempotent) to match this repo's
-- migration convention.

-- ===== Enums =====

DO $$ BEGIN
  CREATE TYPE "WeakAreaSeverity" AS ENUM ('CRITICAL', 'MODERATE', 'MINOR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "WeakAreaStatus" AS ENUM ('OPEN', 'IMPROVING', 'RESOLVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MistakeType" AS ENUM (
    'WRONG_APPROACH',
    'EDGE_CASE_MISSED',
    'COMPLEXITY_ERROR',
    'SYNTAX_ERROR',
    'CONCEPTUAL_GAP',
    'COMMUNICATION',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TutorMemoryKind" AS ENUM ('PREFERENCE', 'GOAL', 'FACT', 'FEEDBACK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TutorArtifactType" AS ENUM ('QUESTION_SHEET', 'ACTION_PLAN', 'QUIZ', 'STUDY_NOTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TutorArtifactStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'SUPERSEDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ToolCallStatus" AS ENUM ('OK', 'ERROR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===== user_tutor_profiles =====

CREATE TABLE IF NOT EXISTS "user_tutor_profiles" (
  "user_id"            TEXT PRIMARY KEY,
  "target_company"     TEXT,
  "target_role"        TEXT,
  "target_level"       TEXT,
  "target_date"        TIMESTAMP(3),
  "hours_per_week"     INTEGER,
  "preferred_language" TEXT,
  "preferred_topics"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes"              TEXT,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_tutor_profiles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- ===== user_weak_areas =====

CREATE TABLE IF NOT EXISTS "user_weak_areas" (
  "id"             TEXT PRIMARY KEY,
  "user_id"        TEXT NOT NULL,
  "report_id"      TEXT,
  "category"       TEXT NOT NULL,
  "subcategory"    TEXT,
  "topic"          TEXT NOT NULL,
  "severity"       "WeakAreaSeverity" NOT NULL,
  "evidence"       TEXT NOT NULL,
  "status"         "WeakAreaStatus" NOT NULL DEFAULT 'OPEN',
  "occurrences"    INTEGER NOT NULL DEFAULT 1,
  "first_seen_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at"    TIMESTAMP(3),
  CONSTRAINT "user_weak_areas_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_weak_areas_report_id_fkey"
    FOREIGN KEY ("report_id") REFERENCES "evaluation_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_weak_areas_user_id_topic_key"
  ON "user_weak_areas"("user_id", "topic");
CREATE INDEX IF NOT EXISTS "user_weak_areas_user_id_status_idx"
  ON "user_weak_areas"("user_id", "status");
CREATE INDEX IF NOT EXISTS "user_weak_areas_user_id_category_idx"
  ON "user_weak_areas"("user_id", "category");
CREATE INDEX IF NOT EXISTS "user_weak_areas_user_id_last_seen_at_idx"
  ON "user_weak_areas"("user_id", "last_seen_at");

-- ===== user_mistakes =====

CREATE TABLE IF NOT EXISTS "user_mistakes" (
  "id"               TEXT PRIMARY KEY,
  "user_id"          TEXT NOT NULL,
  "report_id"        TEXT,
  "question_ref"     TEXT,
  "question_title"   TEXT,
  "mistake_type"     "MistakeType" NOT NULL,
  "description"      TEXT NOT NULL,
  "user_snippet"     TEXT,
  "correct_approach" TEXT,
  "topic_tags"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_mistakes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_mistakes_report_id_fkey"
    FOREIGN KEY ("report_id") REFERENCES "evaluation_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "user_mistakes_user_id_mistake_type_idx"
  ON "user_mistakes"("user_id", "mistake_type");
CREATE INDEX IF NOT EXISTS "user_mistakes_user_id_created_at_idx"
  ON "user_mistakes"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "user_mistakes_report_id_idx"
  ON "user_mistakes"("report_id");

-- ===== tutor_memories =====

CREATE TABLE IF NOT EXISTS "tutor_memories" (
  "id"         TEXT PRIMARY KEY,
  "user_id"    TEXT NOT NULL,
  "kind"       "TutorMemoryKind" NOT NULL,
  "key"        TEXT NOT NULL,
  "value"      TEXT NOT NULL,
  "source"     TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3),
  CONSTRAINT "tutor_memories_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "tutor_memories_user_id_kind_key_key"
  ON "tutor_memories"("user_id", "kind", "key");
CREATE INDEX IF NOT EXISTS "tutor_memories_user_id_kind_idx"
  ON "tutor_memories"("user_id", "kind");

-- ===== tutor_artifacts =====

CREATE TABLE IF NOT EXISTS "tutor_artifacts" (
  "id"              TEXT PRIMARY KEY,
  "user_id"         TEXT NOT NULL,
  "conversation_id" TEXT,
  "parent_id"       TEXT,
  "artifact_type"   "TutorArtifactType" NOT NULL,
  "title"           TEXT NOT NULL,
  "content"         JSONB NOT NULL,
  "meta"            JSONB,
  "status"          "TutorArtifactStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tutor_artifacts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tutor_artifacts_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "tutor_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "tutor_artifacts_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "tutor_artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "tutor_artifacts_user_id_artifact_type_status_idx"
  ON "tutor_artifacts"("user_id", "artifact_type", "status");
CREATE INDEX IF NOT EXISTS "tutor_artifacts_user_id_created_at_idx"
  ON "tutor_artifacts"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "tutor_artifacts_conversation_id_idx"
  ON "tutor_artifacts"("conversation_id");

-- ===== tutor_tool_call_logs =====

CREATE TABLE IF NOT EXISTS "tutor_tool_call_logs" (
  "id"              TEXT PRIMARY KEY,
  "user_id"         TEXT NOT NULL,
  "conversation_id" TEXT,
  "tool_name"       TEXT NOT NULL,
  "status"          "ToolCallStatus" NOT NULL,
  "latency_ms"      INTEGER NOT NULL,
  "error_code"      TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tutor_tool_call_logs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "tutor_tool_call_logs_user_id_created_at_idx"
  ON "tutor_tool_call_logs"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "tutor_tool_call_logs_tool_name_created_at_idx"
  ON "tutor_tool_call_logs"("tool_name", "created_at");
