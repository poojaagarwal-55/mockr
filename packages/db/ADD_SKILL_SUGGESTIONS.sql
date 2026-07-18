CREATE TABLE IF NOT EXISTS public.skill_suggestions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL DEFAULT 'seed',
    usage_count INTEGER NOT NULL DEFAULT 0,
    created_by_user_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS skill_suggestions_name_idx
    ON public.skill_suggestions(name);

CREATE INDEX IF NOT EXISTS skill_suggestions_usage_count_idx
    ON public.skill_suggestions(usage_count);

ALTER TABLE public.skill_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY skill_suggestions_authenticated_select
    ON public.skill_suggestions
    FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY skill_suggestions_authenticated_insert
    ON public.skill_suggestions
    FOR INSERT
    WITH CHECK (auth.uid()::text = created_by_user_id OR created_by_user_id IS NULL);

CREATE POLICY skill_suggestions_authenticated_update
    ON public.skill_suggestions
    FOR UPDATE
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);
