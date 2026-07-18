-- AlterTable: Add new fields to accepted_action_plans for day-wise tracking
ALTER TABLE "accepted_action_plans" 
ADD COLUMN "artifact_id" TEXT,
ADD COLUMN "total_days" INTEGER,
ADD COLUMN "current_day" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "completed_days" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN "completed_questions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "last_accessed_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "accepted_action_plans_user_id_start_date_end_date_idx" ON "accepted_action_plans"("user_id", "start_date", "end_date");

-- CreateIndex
CREATE INDEX "accepted_action_plans_artifact_id_idx" ON "accepted_action_plans"("artifact_id");

-- AddForeignKey
ALTER TABLE "accepted_action_plans" ADD CONSTRAINT "accepted_action_plans_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "tutor_artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
