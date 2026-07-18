-- AlterTable: Remove dead user preference fields
ALTER TABLE "users" DROP COLUMN IF EXISTS "preferred_role";
ALTER TABLE "users" DROP COLUMN IF EXISTS "preferred_level";
ALTER TABLE "users" DROP COLUMN IF EXISTS "preferred_lang";
