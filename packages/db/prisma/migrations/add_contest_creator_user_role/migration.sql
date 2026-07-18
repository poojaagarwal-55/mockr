ALTER TABLE public.users
    DROP CONSTRAINT IF EXISTS users_role_allowed_check;

ALTER TABLE public.users
    ADD CONSTRAINT users_role_allowed_check
    CHECK (role IN ('user', 'placement_coordinator', 'contest_creator'));
