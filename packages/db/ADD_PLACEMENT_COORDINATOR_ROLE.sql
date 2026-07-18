-- Adds the placement coordinator role metadata to student users.
-- Run this manually in Supabase SQL editor before deploying the API changes.

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS placement_college_email_domain text;

ALTER TABLE public.users
    DROP CONSTRAINT IF EXISTS users_role_allowed_check;

ALTER TABLE public.users
    ADD CONSTRAINT users_role_allowed_check
    CHECK (role IN ('user', 'placement_coordinator', 'contest_creator'));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_placement_domain_format_check'
          AND conrelid = 'public.users'::regclass
    ) THEN
        ALTER TABLE public.users
            ADD CONSTRAINT users_placement_domain_format_check
            CHECK (
                placement_college_email_domain IS NULL
                OR placement_college_email_domain ~ '^@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$'
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS users_role_idx
    ON public.users(role);

CREATE INDEX IF NOT EXISTS users_placement_college_email_domain_idx
    ON public.users(placement_college_email_domain)
    WHERE placement_college_email_domain IS NOT NULL;

-- Keep direct Supabase reads limited to the signed-in user's own row if RLS is used.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'users'
          AND policyname = 'users_self_select'
    ) THEN
        CREATE POLICY users_self_select
            ON public.users
            FOR SELECT
            USING (auth.uid()::text = id);
    END IF;
END $$;
