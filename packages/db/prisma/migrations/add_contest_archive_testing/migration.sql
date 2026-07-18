ALTER TABLE "contests"
  ADD COLUMN IF NOT EXISTS "is_archived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "is_under_testing" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "created_by_id" TEXT;

CREATE INDEX IF NOT EXISTS "contests_created_by_id_idx" ON "contests"("created_by_id");
CREATE INDEX IF NOT EXISTS "contests_is_archived_is_under_testing_idx" ON "contests"("is_archived", "is_under_testing");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contests_created_by_id_fkey'
  ) THEN
    ALTER TABLE "contests"
      ADD CONSTRAINT "contests_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "contest_testing_testers" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "tester_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contest_testing_testers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contest_testing_testers_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "users"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "contest_testing_testers_tester_user_id_fkey"
    FOREIGN KEY ("tester_user_id") REFERENCES "users"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "contest_testing_testers_owner_id_tester_user_id_key"
  ON "contest_testing_testers"("owner_id", "tester_user_id");

CREATE INDEX IF NOT EXISTS "contest_testing_testers_owner_id_idx"
  ON "contest_testing_testers"("owner_id");

CREATE INDEX IF NOT EXISTS "contest_testing_testers_tester_user_id_idx"
  ON "contest_testing_testers"("tester_user_id");
