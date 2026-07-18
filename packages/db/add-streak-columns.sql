-- Add streak tracking columns to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS current_streak INTEGER DEFAULT 0 NOT NULL,
ADD COLUMN IF NOT EXISTS longest_streak INTEGER DEFAULT 0 NOT NULL,
ADD COLUMN IF NOT EXISTS last_activity_date TIMESTAMP;

-- Add comments for documentation
COMMENT ON COLUMN users.current_streak IS 'Current consecutive days of activity (interviews or question submissions)';
COMMENT ON COLUMN users.longest_streak IS 'Longest streak ever achieved by the user';
COMMENT ON COLUMN users.last_activity_date IS 'Last date user completed an activity (interview or question submission)';
