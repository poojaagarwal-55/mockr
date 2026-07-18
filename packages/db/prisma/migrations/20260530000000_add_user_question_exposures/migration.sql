CREATE TABLE "user_question_exposures" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "question_source" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seen_count" INTEGER NOT NULL DEFAULT 1,
    "session_id" TEXT,

    CONSTRAINT "user_question_exposures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_question_exposures_user_id_question_source_question_id_key"
    ON "user_question_exposures"("user_id", "question_source", "question_id");

CREATE INDEX "user_question_exposures_user_id_question_source_idx"
    ON "user_question_exposures"("user_id", "question_source");

CREATE INDEX "user_question_exposures_user_source_last_seen_idx"
    ON "user_question_exposures"("user_id", "question_source", "last_seen_at");

CREATE INDEX "user_question_exposures_question_source_question_id_idx"
    ON "user_question_exposures"("question_source", "question_id");

ALTER TABLE "user_question_exposures"
    ADD CONSTRAINT "user_question_exposures_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
