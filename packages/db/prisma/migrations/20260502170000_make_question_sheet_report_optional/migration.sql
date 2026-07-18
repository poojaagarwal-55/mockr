-- AlterTable: Make reportId and sessionId optional in question_sheets
-- This allows practice sheets to be created without being tied to a specific evaluation report

-- Drop the foreign key constraint first
ALTER TABLE "question_sheets" DROP CONSTRAINT IF EXISTS "question_sheets_report_id_fkey";

-- Make the columns nullable
ALTER TABLE "question_sheets" ALTER COLUMN "report_id" DROP NOT NULL;
ALTER TABLE "question_sheets" ALTER COLUMN "session_id" DROP NOT NULL;

-- Re-add the foreign key constraint with nullable support
ALTER TABLE "question_sheets" ADD CONSTRAINT "question_sheets_report_id_fkey" 
  FOREIGN KEY ("report_id") REFERENCES "evaluation_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
