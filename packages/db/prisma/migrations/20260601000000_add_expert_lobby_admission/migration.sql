-- Persist expert-room lobby admission so candidates who are accepted once can
-- reconnect to the same call without requiring a second approval.
ALTER TABLE "expert_sessions" ADD COLUMN "candidate_admitted_at" TIMESTAMP(3);

