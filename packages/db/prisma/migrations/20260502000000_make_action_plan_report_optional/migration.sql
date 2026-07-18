-- AlterTable
-- Make reportId and sessionId nullable in accepted_action_plans
-- This allows action plans to exist without being tied to a specific interview report

ALTER TABLE "accepted_action_plans" ALTER COLUMN "report_id" DROP NOT NULL;
ALTER TABLE "accepted_action_plans" ALTER COLUMN "session_id" DROP NOT NULL;
