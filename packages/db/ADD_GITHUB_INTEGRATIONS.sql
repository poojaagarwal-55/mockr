CREATE TABLE IF NOT EXISTS public.github_integrations (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
    github_user_id TEXT,
    github_username TEXT,
    encrypted_access_token TEXT NOT NULL,
    encrypted_refresh_token TEXT,
    scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_synced_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS github_integrations_github_username_idx
    ON public.github_integrations(github_username);

CREATE INDEX IF NOT EXISTS github_integrations_revoked_at_idx
    ON public.github_integrations(revoked_at);

ALTER TABLE public.github_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY github_integrations_owner_select
    ON public.github_integrations
    FOR SELECT
    USING (auth.uid()::text = user_id);

CREATE POLICY github_integrations_owner_insert
    ON public.github_integrations
    FOR INSERT
    WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY github_integrations_owner_update
    ON public.github_integrations
    FOR UPDATE
    USING (auth.uid()::text = user_id)
    WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY github_integrations_owner_delete
    ON public.github_integrations
    FOR DELETE
    USING (auth.uid()::text = user_id);
