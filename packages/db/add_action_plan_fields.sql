-- Add new fields to accepted_action_plans table
ALTER TABLE accepted_action_plans 
ADD COLUMN IF NOT EXISTS artifact_id TEXT,
ADD COLUMN IF NOT EXISTS total_days INTEGER,
ADD COLUMN IF NOT EXISTS current_day INTEGER DEFAULT 1 NOT NULL,
ADD COLUMN IF NOT EXISTS completed_days INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN IF NOT EXISTS completed_questions TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMP(3);

-- Create indexes
CREATE INDEX IF NOT EXISTS accepted_action_plans_user_id_start_date_end_date_idx 
ON accepted_action_plans(user_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS accepted_action_plans_artifact_id_idx 
ON accepted_action_plans(artifact_id);

-- Add foreign key constraint
ALTER TABLE accepted_action_plans 
ADD CONSTRAINT IF NOT EXISTS accepted_action_plans_artifact_id_fkey 
FOREIGN KEY (artifact_id) REFERENCES tutor_artifacts(id) ON DELETE SET NULL ON UPDATE CASCADE;
