-- Peer-to-peer coding interview reports need three extra pieces of data:
--   1. Whether the candidate solved the question (a yes/no the partner answers
--      in the feedback form) — drives the report and the AI summary.
--   2. A cached AI summary of the ratee's performance so we don't regenerate it
--      on every report view.
--   3. The candidate's final code + language so the report's "Your Code" tab can
--      show what they wrote.
--
-- All additive and replay-safe (IF NOT EXISTS), so this is safe to run via
-- `prisma db execute` and later via `prisma migrate deploy`.

ALTER TABLE "peer_feedback" ADD COLUMN IF NOT EXISTS "solved_question" BOOLEAN;
ALTER TABLE "peer_feedback" ADD COLUMN IF NOT EXISTS "ai_summary" TEXT;

ALTER TABLE "peer_session_question_assignments" ADD COLUMN IF NOT EXISTS "final_code" TEXT;
ALTER TABLE "peer_session_question_assignments" ADD COLUMN IF NOT EXISTS "final_language" TEXT;
