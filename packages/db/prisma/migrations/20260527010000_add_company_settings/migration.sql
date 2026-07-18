-- Startup-level company workspace settings.

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "website_url" TEXT,
  ADD COLUMN IF NOT EXISTS "logo_url" TEXT,
  ADD COLUMN IF NOT EXISTS "industry" TEXT,
  ADD COLUMN IF NOT EXISTS "company_size" TEXT,
  ADD COLUMN IF NOT EXISTS "headquarters" TEXT,
  ADD COLUMN IF NOT EXISTS "default_timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS "default_work_mode" TEXT NOT NULL DEFAULT 'Hybrid',
  ADD COLUMN IF NOT EXISTS "default_employment_type" TEXT NOT NULL DEFAULT 'Full-time',
  ADD COLUMN IF NOT EXISTS "default_currency" TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS "default_assessment_deadline_days" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS "notify_new_applications" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "notify_assessment_submissions" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "notify_weekly_digest" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "notify_team_changes" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "companies_domain_idx" ON "companies"("domain");
CREATE INDEX IF NOT EXISTS "companies_industry_idx" ON "companies"("industry");
