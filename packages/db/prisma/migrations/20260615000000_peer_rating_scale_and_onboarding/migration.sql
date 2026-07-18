-- Peer skill rating moves from a 0-100 scale to a 0-2000 ELO-style scale with
-- bands at 500 / 1000. Widen the numeric columns, add an explicit onboarding
-- flag (so first-time users get the level prompt), and rescale existing scores
-- while preserving each user's band.
--
-- Written to be idempotent: it is safe to run this both manually (via
-- `prisma db execute`, bypassing the _prisma_migrations ledger) and later via
-- `prisma migrate deploy`. The one-shot widen+rescale is guarded on the score
-- column still being numeric(5,2).

-- Onboarding flag (replay-safe). Existing profiles count as already onboarded;
-- that backfill is part of the first-run block below so re-runs don't clobber
-- new, not-yet-onboarded users.
ALTER TABLE "peer_skill_profiles" ADD COLUMN IF NOT EXISTS "onboarded" BOOLEAN NOT NULL DEFAULT false;

-- History columns: widen to hold up to 2000 (ALTER TYPE is idempotent).
ALTER TABLE "peer_skill_history" ALTER COLUMN "previous_score" SET DATA TYPE DECIMAL(7,2);
ALTER TABLE "peer_skill_history" ALTER COLUMN "new_score" SET DATA TYPE DECIMAL(7,2);

DO $$
DECLARE
    score_precision int;
BEGIN
    SELECT numeric_precision INTO score_precision
    FROM information_schema.columns
    WHERE table_name = 'peer_skill_profiles' AND column_name = 'score';

    -- Only the first run (still on the legacy 0-100 numeric(5,2) scale) widens
    -- and rescales. Subsequent runs are no-ops.
    IF score_precision = 5 THEN
        ALTER TABLE "peer_skill_profiles" ALTER COLUMN "score" SET DATA TYPE DECIMAL(7,2);
        ALTER TABLE "peer_skill_profiles" ALTER COLUMN "score" SET DEFAULT 250;

        -- Band-preserving rescale (legacy cutoffs 55/75 -> new cutoffs 500/1000):
        --   beginner     [0,55)   -> [0,500)
        --   intermediate [55,75)  -> [500,1000)
        --   advanced     [75,100] -> [1000,2000]
        UPDATE "peer_skill_profiles"
        SET "score" = LEAST(2000, GREATEST(0, ROUND(
            CASE
                WHEN "score" >= 75 THEN 1000 + ("score" - 75) / 25.0 * 1000
                WHEN "score" >= 55 THEN 500 + ("score" - 55) / 20.0 * 500
                ELSE "score" / 55.0 * 500
            END
        )));

        UPDATE "peer_skill_profiles"
        SET "current_level" = CASE
            WHEN "score" >= 1000 THEN 'advanced'
            WHEN "score" >= 500 THEN 'intermediate'
            ELSE 'beginner'
        END;

        -- Existing users have already picked a level implicitly; mark onboarded.
        UPDATE "peer_skill_profiles" SET "onboarded" = true;
    END IF;
END $$;
