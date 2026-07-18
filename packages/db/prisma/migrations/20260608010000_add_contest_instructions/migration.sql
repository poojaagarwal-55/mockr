ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "contest_instruction_template" TEXT;

ALTER TABLE "contests"
ADD COLUMN IF NOT EXISTS "instructions" TEXT;

UPDATE "contests"
SET "instructions" = 'Stay in fullscreen until you submit or the timer ends.
Keep this contest tab focused. Switching windows, changing tabs, or leaving the page records an integrity warning.
Write and run code only inside the contest editor.
Copying question text is blocked. Pasting from outside the contest editor is blocked.
Use only the information provided in the problem statements and sample tests.
Submit before the timer reaches zero. After submission, you cannot attempt more questions.'
WHERE "instructions" IS NULL OR btrim("instructions") = '';

ALTER TABLE "contests"
ALTER COLUMN "instructions" SET DEFAULT 'Stay in fullscreen until you submit or the timer ends.
Keep this contest tab focused. Switching windows, changing tabs, or leaving the page records an integrity warning.
Write and run code only inside the contest editor.
Copying question text is blocked. Pasting from outside the contest editor is blocked.
Use only the information provided in the problem statements and sample tests.
Submit before the timer reaches zero. After submission, you cannot attempt more questions.';

ALTER TABLE "contests"
ALTER COLUMN "instructions" SET NOT NULL;
