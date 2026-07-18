-- Add interview type column to interview_sessions table
-- Default to 'full_interview' for backward compatibility with existing sessions

ALTER TABLE "interview_sessions" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'full_interview';

-- Add index for efficient type-based queries
CREATE INDEX IF NOT EXISTS "interview_sessions_type_idx" ON "interview_sessions" ("type");
