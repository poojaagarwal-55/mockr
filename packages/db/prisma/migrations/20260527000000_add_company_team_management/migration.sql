-- Company team management with pre-registration invitations.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS "company_member_accounts" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "full_name" TEXT NOT NULL,
  "avatar_url" TEXT,
  "last_login_at" TIMESTAMP(3),
  "last_login_ip" TEXT,
  "last_login_location" TEXT,
  "email_verified" BOOLEAN NOT NULL DEFAULT false,
  "email_verified_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_member_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "company_member_verification_codes" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "company_account_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_member_verification_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "company_teams" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "company_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "avatar_color" TEXT,
  "created_by_id" TEXT NOT NULL,
  "is_archived" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_teams_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "company_team_invitations" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "company_id" TEXT NOT NULL,
  "team_id" TEXT NOT NULL,
  "invited_by_id" TEXT NOT NULL,
  "accepted_by_company_account_id" TEXT,
  "email" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "accepted_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_team_invitations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "company_team_members" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "company_id" TEXT NOT NULL,
  "team_id" TEXT NOT NULL,
  "company_account_id" TEXT,
  "invitation_id" TEXT,
  "email" TEXT NOT NULL,
  "name_hint" TEXT,
  "role" TEXT NOT NULL DEFAULT 'member',
  "status" TEXT NOT NULL DEFAULT 'active',
  "joined_at" TIMESTAMP(3),
  "added_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_team_members_pkey" PRIMARY KEY ("id")
);

-- If an earlier draft of this migration already created these tables, IF NOT EXISTS
-- above will not add new columns. Add them defensively before constraints/indexes.
ALTER TABLE "company_team_invitations"
  ADD COLUMN IF NOT EXISTS "accepted_by_company_account_id" TEXT;

ALTER TABLE "company_team_members"
  ADD COLUMN IF NOT EXISTS "company_account_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "company_teams"
    ADD CONSTRAINT "company_teams_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "company_teams"
    ADD CONSTRAINT "company_teams_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "company_member_verification_codes"
    ADD CONSTRAINT "company_member_verification_codes_company_account_id_fkey"
    FOREIGN KEY ("company_account_id") REFERENCES "company_member_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "company_team_invitations"
    ADD CONSTRAINT "company_team_invitations_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "company_team_invitations"
    ADD CONSTRAINT "company_team_invitations_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "company_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "company_team_invitations"
    ADD CONSTRAINT "company_team_invitations_invited_by_id_fkey"
    FOREIGN KEY ("invited_by_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "company_team_invitations"
    ADD CONSTRAINT "company_team_invitations_accepted_by_company_account_id_fkey"
    FOREIGN KEY ("accepted_by_company_account_id") REFERENCES "company_member_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "company_team_members"
    ADD CONSTRAINT "company_team_members_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "company_team_members"
    ADD CONSTRAINT "company_team_members_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "company_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "company_team_members"
    ADD CONSTRAINT "company_team_members_company_account_id_fkey"
    FOREIGN KEY ("company_account_id") REFERENCES "company_member_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "company_team_members"
    ADD CONSTRAINT "company_team_members_invitation_id_fkey"
    FOREIGN KEY ("invitation_id") REFERENCES "company_team_invitations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "company_team_members"
    ADD CONSTRAINT "company_team_members_added_by_id_fkey"
    FOREIGN KEY ("added_by_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "company_member_accounts_email_key" ON "company_member_accounts"("email");
CREATE INDEX IF NOT EXISTS "company_member_verification_codes_company_account_id_type_verified_idx" ON "company_member_verification_codes"("company_account_id", "type", "verified");
CREATE INDEX IF NOT EXISTS "company_member_verification_codes_code_expires_at_idx" ON "company_member_verification_codes"("code", "expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "company_team_invitations_token_hash_key" ON "company_team_invitations"("token_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "company_team_members_invitation_id_key" ON "company_team_members"("invitation_id");
CREATE UNIQUE INDEX IF NOT EXISTS "company_team_members_team_id_email_key" ON "company_team_members"("team_id", "email");
CREATE UNIQUE INDEX IF NOT EXISTS "company_team_members_team_id_company_account_id_key" ON "company_team_members"("team_id", "company_account_id");

CREATE INDEX IF NOT EXISTS "company_teams_company_id_is_archived_created_at_idx" ON "company_teams"("company_id", "is_archived", "created_at");
CREATE INDEX IF NOT EXISTS "company_team_invitations_company_id_status_created_at_idx" ON "company_team_invitations"("company_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "company_team_invitations_team_id_status_idx" ON "company_team_invitations"("team_id", "status");
CREATE INDEX IF NOT EXISTS "company_team_invitations_email_status_expires_at_idx" ON "company_team_invitations"("email", "status", "expires_at");
CREATE INDEX IF NOT EXISTS "company_team_members_company_id_status_idx" ON "company_team_members"("company_id", "status");
CREATE INDEX IF NOT EXISTS "company_team_members_company_account_id_status_idx" ON "company_team_members"("company_account_id", "status");

ALTER TABLE "company_member_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_member_verification_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_team_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_team_invitations" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company teams company manage" ON "company_teams";
CREATE POLICY "company teams company manage"
  ON "company_teams"
  FOR ALL
  USING ((auth.uid())::text = "company_id")
  WITH CHECK ((auth.uid())::text = "company_id");

DROP POLICY IF EXISTS "company teams member read" ON "company_teams";
CREATE POLICY "company teams member read"
  ON "company_teams"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM "company_team_members" "m"
      WHERE "m"."team_id" = "company_teams"."id"
        AND "m"."company_account_id" = (auth.uid())::text
        AND "m"."status" = 'active'
    )
  );

DROP POLICY IF EXISTS "company team members company manage" ON "company_team_members";
CREATE POLICY "company team members company manage"
  ON "company_team_members"
  FOR ALL
  USING ((auth.uid())::text = "company_id")
  WITH CHECK ((auth.uid())::text = "company_id");

DROP POLICY IF EXISTS "company team members self read" ON "company_team_members";
CREATE POLICY "company team members self read"
  ON "company_team_members"
  FOR SELECT
  USING ((auth.uid())::text = "company_account_id");

DROP POLICY IF EXISTS "company team invitations company manage" ON "company_team_invitations";
CREATE POLICY "company team invitations company manage"
  ON "company_team_invitations"
  FOR ALL
  USING ((auth.uid())::text = "company_id")
  WITH CHECK ((auth.uid())::text = "company_id");

DROP POLICY IF EXISTS "company member accounts self read" ON "company_member_accounts";
CREATE POLICY "company member accounts self read"
  ON "company_member_accounts"
  FOR SELECT
  USING ((auth.uid())::text = "id");

DROP POLICY IF EXISTS "company member accounts self update" ON "company_member_accounts";
CREATE POLICY "company member accounts self update"
  ON "company_member_accounts"
  FOR UPDATE
  USING ((auth.uid())::text = "id")
  WITH CHECK ((auth.uid())::text = "id");
