ALTER TABLE "public"."job_applications"
ADD COLUMN IF NOT EXISTS "next_round_type" TEXT,
ADD COLUMN IF NOT EXISTS "next_round_moved_at" TIMESTAMP(3);

ALTER TABLE "public"."company_job_openings"
ADD COLUMN IF NOT EXISTS "next_round_type" TEXT,
ADD COLUMN IF NOT EXISTS "next_round_configured_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "public"."user_notifications" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "href" TEXT,
  "read" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "user_notifications_user_id_read_created_at_idx"
ON "public"."user_notifications" ("user_id", "read", "created_at");
