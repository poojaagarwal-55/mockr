-- Restore coding profile links on job profiles.
ALTER TABLE "job_apply_profiles"
ADD COLUMN IF NOT EXISTS "leetcode_url" TEXT,
ADD COLUMN IF NOT EXISTS "geeksforgeeks_url" TEXT,
ADD COLUMN IF NOT EXISTS "codeforces_url" TEXT,
ADD COLUMN IF NOT EXISTS "codechef_url" TEXT;
