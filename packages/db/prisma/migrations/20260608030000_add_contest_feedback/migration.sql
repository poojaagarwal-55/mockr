CREATE TABLE IF NOT EXISTS "contest_feedback" (
    "id" TEXT NOT NULL,
    "contest_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_feedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contest_feedback_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'contest_feedback_contest_id_fkey'
    ) THEN
        ALTER TABLE "contest_feedback"
        ADD CONSTRAINT "contest_feedback_contest_id_fkey"
        FOREIGN KEY ("contest_id") REFERENCES "contests"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "contest_feedback_contest_id_user_id_key"
ON "contest_feedback"("contest_id", "user_id");

CREATE INDEX IF NOT EXISTS "contest_feedback_contest_id_rating_idx"
ON "contest_feedback"("contest_id", "rating");

CREATE INDEX IF NOT EXISTS "contest_feedback_user_id_idx"
ON "contest_feedback"("user_id");
