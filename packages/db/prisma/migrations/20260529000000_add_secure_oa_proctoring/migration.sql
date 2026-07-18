-- Secure OA browser proctoring foundation.
-- OA identity is the JobRound row where round_type = 'mock_oa'.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS "secure_oa_sessions" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "job_round_id" TEXT NOT NULL,
  "job_round_candidate_id" TEXT NOT NULL,
  "candidate_user_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "started_at" TIMESTAMP(3),
  "submitted_at" TIMESTAMP(3),
  "terminated_at" TIMESTAMP(3),
  "terminated_reason" TEXT,
  "client_fingerprint" TEXT,
  "user_agent" TEXT,
  "ip_address" TEXT,
  "integrity_score" INTEGER,
  "integrity_rules_snapshot" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "secure_oa_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "proctoring_events" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "session_id" TEXT NOT NULL,
  "client_event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "client_timestamp" TIMESTAMP(3) NOT NULL,
  "server_timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  "triggered_termination" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "proctoring_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "proctoring_snapshots" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "session_id" TEXT NOT NULL,
  "s3_key" TEXT NOT NULL,
  "s3_bucket" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "taken_at" TIMESTAMP(3) NOT NULL,
  "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "trigger" TEXT NOT NULL,
  "triggering_event_id" TEXT,
  CONSTRAINT "proctoring_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "proctoring_rules" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "job_round_id" TEXT,
  "version" INTEGER NOT NULL,
  "rules" JSONB NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proctoring_rules_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "secure_oa_sessions"
    ADD CONSTRAINT "secure_oa_sessions_job_round_id_fkey"
    FOREIGN KEY ("job_round_id") REFERENCES "job_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "secure_oa_sessions"
    ADD CONSTRAINT "secure_oa_sessions_job_round_candidate_id_fkey"
    FOREIGN KEY ("job_round_candidate_id") REFERENCES "job_round_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "secure_oa_sessions"
    ADD CONSTRAINT "secure_oa_sessions_candidate_user_id_fkey"
    FOREIGN KEY ("candidate_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "secure_oa_sessions"
    ADD CONSTRAINT "secure_oa_sessions_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "secure_oa_sessions"
    ADD CONSTRAINT "secure_oa_sessions_status_check"
    CHECK ("status" IN ('pending', 'active', 'submitted', 'terminated', 'abandoned'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "secure_oa_sessions"
    ADD CONSTRAINT "secure_oa_sessions_terminated_reason_check"
    CHECK ("terminated_reason" IS NULL OR "terminated_reason" IN ('auto_rule_violation', 'manual_company', 'webcam_revoked', 'multi_session_conflict'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "secure_oa_sessions"
    ADD CONSTRAINT "secure_oa_sessions_integrity_score_check"
    CHECK ("integrity_score" IS NULL OR ("integrity_score" >= 0 AND "integrity_score" <= 100));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "proctoring_events"
    ADD CONSTRAINT "proctoring_events_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "secure_oa_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "proctoring_events"
    ADD CONSTRAINT "proctoring_events_event_type_check"
    CHECK ("event_type" IN (
      'session_start',
      'session_heartbeat',
      'face_absent',
      'face_multiple',
      'face_looking_away',
      'object_detected',
      'tab_hidden',
      'window_blur',
      'fullscreen_exit',
      'devtools_opened',
      'copy',
      'paste',
      'cut',
      'contextmenu',
      'webcam_revoked',
      'webcam_stream_ended',
      'heartbeat_gap',
      'multi_session_attempt',
      'network_disconnect',
      'network_reconnect'
    ));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "proctoring_events"
    ADD CONSTRAINT "proctoring_events_severity_check"
    CHECK ("severity" IN ('info', 'low', 'medium', 'high', 'critical'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "proctoring_snapshots"
    ADD CONSTRAINT "proctoring_snapshots_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "secure_oa_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "proctoring_snapshots"
    ADD CONSTRAINT "proctoring_snapshots_triggering_event_id_fkey"
    FOREIGN KEY ("triggering_event_id") REFERENCES "proctoring_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "proctoring_snapshots"
    ADD CONSTRAINT "proctoring_snapshots_mime_type_check"
    CHECK ("mime_type" = 'image/jpeg');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "proctoring_snapshots"
    ADD CONSTRAINT "proctoring_snapshots_trigger_check"
    CHECK ("trigger" IN ('scheduled', 'event_triggered'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "proctoring_rules"
    ADD CONSTRAINT "proctoring_rules_job_round_id_fkey"
    FOREIGN KEY ("job_round_id") REFERENCES "job_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "secure_oa_sessions_job_round_id_job_round_candidate_id_key" ON "secure_oa_sessions"("job_round_id", "job_round_candidate_id");
CREATE INDEX IF NOT EXISTS "secure_oa_sessions_job_round_id_status_idx" ON "secure_oa_sessions"("job_round_id", "status");
CREATE INDEX IF NOT EXISTS "secure_oa_sessions_candidate_user_id_status_idx" ON "secure_oa_sessions"("candidate_user_id", "status");
CREATE INDEX IF NOT EXISTS "secure_oa_sessions_company_id_status_created_at_idx" ON "secure_oa_sessions"("company_id", "status", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "proctoring_events_session_id_client_event_id_key" ON "proctoring_events"("session_id", "client_event_id");
CREATE INDEX IF NOT EXISTS "proctoring_events_session_id_server_timestamp_idx" ON "proctoring_events"("session_id", "server_timestamp");
CREATE INDEX IF NOT EXISTS "proctoring_events_session_id_event_type_idx" ON "proctoring_events"("session_id", "event_type");
CREATE INDEX IF NOT EXISTS "proctoring_events_session_id_severity_idx" ON "proctoring_events"("session_id", "severity");

CREATE INDEX IF NOT EXISTS "proctoring_snapshots_session_id_taken_at_idx" ON "proctoring_snapshots"("session_id", "taken_at");

CREATE UNIQUE INDEX IF NOT EXISTS "proctoring_rules_job_round_id_version_key" ON "proctoring_rules"("job_round_id", "version");
CREATE INDEX IF NOT EXISTS "proctoring_rules_job_round_id_is_active_idx" ON "proctoring_rules"("job_round_id", "is_active");

ALTER TABLE "secure_oa_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proctoring_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proctoring_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proctoring_rules" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "secure oa sessions company manage" ON "secure_oa_sessions";
CREATE POLICY "secure oa sessions company manage"
  ON "secure_oa_sessions"
  FOR ALL
  USING ((auth.uid())::text = "company_id")
  WITH CHECK ((auth.uid())::text = "company_id");

DROP POLICY IF EXISTS "secure oa sessions candidate read" ON "secure_oa_sessions";
CREATE POLICY "secure oa sessions candidate read"
  ON "secure_oa_sessions"
  FOR SELECT
  USING ((auth.uid())::text = "candidate_user_id");

DROP POLICY IF EXISTS "secure oa sessions candidate update" ON "secure_oa_sessions";
CREATE POLICY "secure oa sessions candidate update"
  ON "secure_oa_sessions"
  FOR UPDATE
  USING ((auth.uid())::text = "candidate_user_id")
  WITH CHECK ((auth.uid())::text = "candidate_user_id");

DROP POLICY IF EXISTS "proctoring events company read" ON "proctoring_events";
CREATE POLICY "proctoring events company read"
  ON "proctoring_events"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM "secure_oa_sessions" "s"
      WHERE "s"."id" = "proctoring_events"."session_id"
        AND "s"."company_id" = (auth.uid())::text
    )
  );

DROP POLICY IF EXISTS "proctoring snapshots company read" ON "proctoring_snapshots";
CREATE POLICY "proctoring snapshots company read"
  ON "proctoring_snapshots"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM "secure_oa_sessions" "s"
      WHERE "s"."id" = "proctoring_snapshots"."session_id"
        AND "s"."company_id" = (auth.uid())::text
    )
  );

DROP POLICY IF EXISTS "proctoring rules company read" ON "proctoring_rules";
CREATE POLICY "proctoring rules company read"
  ON "proctoring_rules"
  FOR SELECT
  USING (
    "job_round_id" IS NULL OR EXISTS (
      SELECT 1
      FROM "job_rounds" "jr"
      WHERE "jr"."id" = "proctoring_rules"."job_round_id"
        AND "jr"."company_id" = (auth.uid())::text
    )
  );

DROP POLICY IF EXISTS "proctoring rules company manage" ON "proctoring_rules";
CREATE POLICY "proctoring rules company manage"
  ON "proctoring_rules"
  FOR ALL
  USING (
    "job_round_id" IS NOT NULL AND EXISTS (
      SELECT 1
      FROM "job_rounds" "jr"
      WHERE "jr"."id" = "proctoring_rules"."job_round_id"
        AND "jr"."company_id" = (auth.uid())::text
    )
  )
  WITH CHECK (
    "job_round_id" IS NOT NULL AND EXISTS (
      SELECT 1
      FROM "job_rounds" "jr"
      WHERE "jr"."id" = "proctoring_rules"."job_round_id"
        AND "jr"."company_id" = (auth.uid())::text
    )
  );

INSERT INTO "proctoring_rules" ("id", "job_round_id", "version", "rules", "is_active")
VALUES (
  'proctoring-rules-default-v1',
  NULL,
  1,
  '{
    "thresholds": {
      "face_absent_terminate_ms": 30000,
      "face_multiple_terminate_count": 2,
      "max_tab_hidden_events": 3,
      "max_fullscreen_exit_events": 2,
      "max_paste_char_count_single": 200,
      "max_paste_total_char_count": 500,
      "heartbeat_interval_ms": 5000,
      "heartbeat_grace_ms": 15000,
      "snapshot_interval_ms": 30000
    },
    "auto_terminate_on": [
      "webcam_revoked",
      "webcam_stream_ended",
      "multi_session_attempt"
    ],
    "auto_terminate_on_severity": "critical",
    "integrity_score_weights": {
      "face_absent": 10,
      "face_multiple": 25,
      "face_looking_away": 3,
      "object_detected": 20,
      "tab_hidden": 8,
      "window_blur": 2,
      "fullscreen_exit": 15,
      "devtools_opened": 30,
      "paste": 5,
      "heartbeat_gap": 5
    },
    "integrity_score_base": 100,
    "integrity_score_floor": 0
  }'::jsonb,
  true
)
ON CONFLICT ("id") DO UPDATE SET
  "rules" = EXCLUDED."rules",
  "is_active" = true,
  "updated_at" = CURRENT_TIMESTAMP;
