-- Speed up scheduled peer batch matching by slot/status and queue residual lookups.
CREATE INDEX IF NOT EXISTS "peer_queue_tickets_matched_session_id_preferred_language_idx"
ON "peer_queue_tickets"("matched_session_id", "preferred_language");

CREATE INDEX IF NOT EXISTS "peer_queue_tickets_matched_session_id_status_idx"
ON "peer_queue_tickets"("matched_session_id", "status");

CREATE INDEX IF NOT EXISTS "peer_sessions_source_status_scheduled_for_idx"
ON "peer_sessions"("source", "status", "scheduled_for");
