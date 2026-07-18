-- Add session_happened flag to peer_feedback
-- When false, the rater indicated the session did not actually take place.
-- These records are excluded from reports and ELO updates.
ALTER TABLE "peer_feedback" ADD COLUMN "session_happened" BOOLEAN NOT NULL DEFAULT true;
