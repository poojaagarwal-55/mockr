ALTER TABLE public.job_apply_profiles
    ADD COLUMN IF NOT EXISTS leetcode_url TEXT,
    ADD COLUMN IF NOT EXISTS geeksforgeeks_url TEXT,
    ADD COLUMN IF NOT EXISTS codeforces_url TEXT,
    ADD COLUMN IF NOT EXISTS codechef_url TEXT;

CREATE TABLE IF NOT EXISTS public.job_applications (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    job_id TEXT NOT NULL REFERENCES public.company_job_openings(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    selected_projects JSONB NOT NULL DEFAULT '[]'::jsonb,
    github_profile_snapshot JSONB,
    github_analysis JSONB,
    coding_profiles JSONB,
    coding_analysis JSONB,
    evidence_pack JSONB,
    recruiter_analysis JSONB,
    status TEXT NOT NULL DEFAULT 'submitted',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT job_applications_job_user_unique UNIQUE (job_id, user_id)
);

ALTER TABLE public.job_applications
    ADD COLUMN IF NOT EXISTS evidence_pack JSONB,
    ADD COLUMN IF NOT EXISTS recruiter_analysis JSONB;

CREATE INDEX IF NOT EXISTS job_applications_job_submitted_idx
    ON public.job_applications(job_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS job_applications_user_submitted_idx
    ON public.job_applications(user_id, submitted_at DESC);

ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_applications_user_select ON public.job_applications;
CREATE POLICY job_applications_user_select
    ON public.job_applications
    FOR SELECT
    USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS job_applications_company_select ON public.job_applications;
CREATE POLICY job_applications_company_select
    ON public.job_applications
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.company_job_openings jobs
            WHERE jobs.id = job_applications.job_id
              AND jobs.company_id = auth.uid()::text
        )
    );

DROP POLICY IF EXISTS job_applications_user_insert ON public.job_applications;
CREATE POLICY job_applications_user_insert
    ON public.job_applications
    FOR INSERT
    WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS job_applications_user_update ON public.job_applications;
CREATE POLICY job_applications_user_update
    ON public.job_applications
    FOR UPDATE
    USING (auth.uid()::text = user_id)
    WITH CHECK (auth.uid()::text = user_id);

CREATE TABLE IF NOT EXISTS public.github_project_analyses (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL,
    repo_full_name TEXT NOT NULL,
    repo_node_id TEXT,
    default_branch TEXT,
    head_sha TEXT,
    is_fork BOOLEAN NOT NULL DEFAULT false,
    score INTEGER NOT NULL DEFAULT 0,
    analysis JSONB NOT NULL,
    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT github_project_analyses_user_repo_sha_unique UNIQUE (user_id, repo_full_name, head_sha)
);

CREATE INDEX IF NOT EXISTS github_project_analyses_user_repo_idx
    ON public.github_project_analyses(user_id, repo_full_name);

ALTER TABLE public.github_project_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS github_project_analyses_user_select ON public.github_project_analyses;
CREATE POLICY github_project_analyses_user_select
    ON public.github_project_analyses
    FOR SELECT
    USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS github_project_analyses_user_insert ON public.github_project_analyses;
CREATE POLICY github_project_analyses_user_insert
    ON public.github_project_analyses
    FOR INSERT
    WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS github_project_analyses_user_update ON public.github_project_analyses;
CREATE POLICY github_project_analyses_user_update
    ON public.github_project_analyses
    FOR UPDATE
    USING (auth.uid()::text = user_id)
    WITH CHECK (auth.uid()::text = user_id);
