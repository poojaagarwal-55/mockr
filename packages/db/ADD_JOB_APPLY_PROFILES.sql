CREATE TABLE IF NOT EXISTS public.job_apply_profiles (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
    profile_language TEXT NOT NULL DEFAULT 'English',
    pronouns TEXT,
    headline TEXT,
    industry TEXT,
    city TEXT,
    country TEXT,
    postal_code TEXT,
    about TEXT,
    open_to TEXT,
    cover_image_url TEXT,
    selected_resume_id TEXT,
    experiences JSONB DEFAULT '[]'::jsonb,
    education JSONB DEFAULT '[]'::jsonb,
    skills JSONB DEFAULT '[]'::jsonb,
    featured JSONB DEFAULT '[]'::jsonb,
    projects JSONB DEFAULT '[]'::jsonb,
    is_published BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_apply_profiles_is_published_idx
    ON public.job_apply_profiles(is_published);

ALTER TABLE public.job_apply_profiles
    ADD COLUMN IF NOT EXISTS projects JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.job_apply_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_apply_profiles_owner_select
    ON public.job_apply_profiles
    FOR SELECT
    USING (auth.uid()::text = user_id OR is_published = true);

CREATE POLICY job_apply_profiles_owner_insert
    ON public.job_apply_profiles
    FOR INSERT
    WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY job_apply_profiles_owner_update
    ON public.job_apply_profiles
    FOR UPDATE
    USING (auth.uid()::text = user_id)
    WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY job_apply_profiles_owner_delete
    ON public.job_apply_profiles
    FOR DELETE
    USING (auth.uid()::text = user_id);
