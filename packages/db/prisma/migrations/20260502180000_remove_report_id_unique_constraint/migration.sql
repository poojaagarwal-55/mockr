-- DropIndex: Remove unique constraint on report_id to allow multiple sheets per report
DROP INDEX IF EXISTS "question_sheets_report_id_key";
