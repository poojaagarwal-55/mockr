-- Add submission tracking fields to contest_participants
ALTER TABLE contest_participants 
ADD COLUMN submitted_at TIMESTAMP(3),
ADD COLUMN is_submitted BOOLEAN DEFAULT FALSE,
ADD COLUMN submission_type TEXT DEFAULT 'manual' CHECK (submission_type IN ('manual', 'auto_time', 'auto_tab_switch', 'auto_cheating'));

-- Add index for querying submitted participants
CREATE INDEX contest_participants_contest_id_is_submitted_idx ON contest_participants(contest_id, is_submitted);

-- Add comment
COMMENT ON COLUMN contest_participants.submission_type IS 'Type of submission: manual (user clicked submit), auto_time (time ended), auto_tab_switch (tab switched), auto_cheating (detected cheating)';
