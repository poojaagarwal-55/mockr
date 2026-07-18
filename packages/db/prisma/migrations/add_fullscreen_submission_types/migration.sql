-- Add new submission types for fullscreen enforcement
-- This migration updates the CHECK constraint to include auto_fullscreen_exit and auto_window_blur

-- Drop the old constraint
ALTER TABLE contest_participants
DROP CONSTRAINT IF EXISTS contest_participants_submission_type_check;

-- Add the new constraint with additional submission types
ALTER TABLE contest_participants
ADD CONSTRAINT contest_participants_submission_type_check
CHECK (submission_type IN ('manual', 'auto_time', 'auto_tab_switch', 'auto_window_blur', 'auto_fullscreen_exit', 'auto_cheating'));
