-- Tiered plans, interview credits, coupon grants, and webhook idempotency.
-- This migration is written defensively because the repo's existing migration
-- history does not include a full baseline and `prisma migrate dev --create-only`
-- fails while replaying the old shadow database migrations.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE "Plan" AS ENUM ('FREE', 'PLUS', 'PRO', 'MAX');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'QUARTERLY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SubscriptionSource" AS ENUM ('PURCHASE', 'COUPON', 'ADMIN_GRANT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CouponType" AS ENUM ('PLAN_GRANT', 'DISCOUNT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentKind" AS ENUM ('SUBSCRIPTION', 'CREDITS');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "plan" "Plan" NOT NULL DEFAULT 'PLUS',
  ADD COLUMN IF NOT EXISTS "cycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN IF NOT EXISTS "source" "SubscriptionSource" NOT NULL DEFAULT 'PURCHASE',
  ADD COLUMN IF NOT EXISTS "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "coupon_id" TEXT;

ALTER TABLE "subscriptions"
  ALTER COLUMN "plan" SET DEFAULT 'FREE',
  ALTER COLUMN "razorpay_subscription_id" DROP NOT NULL,
  ALTER COLUMN "plan_id" DROP NOT NULL;

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "kind" "PaymentKind" NOT NULL DEFAULT 'SUBSCRIPTION',
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

ALTER TABLE "payments"
  ALTER COLUMN "razorpay_payment_id" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "credit_wallets" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "free_credits_remaining" INTEGER NOT NULL DEFAULT 3,
  "free_credits_granted" BOOLEAN NOT NULL DEFAULT true,
  "monthly_balance" INTEGER NOT NULL DEFAULT 0,
  "monthly_granted_at" TIMESTAMP(3),
  "monthly_reset_at" TIMESTAMP(3),
  "purchased_balance" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_wallets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "credit_ledger" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "wallet_id" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "delta" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "ref_type" TEXT,
  "ref_id" TEXT,
  "balance_after" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "feature_usage" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "feature_key" TEXT NOT NULL,
  "period_start" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "tokens" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feature_usage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hourly_submission_counters" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "question_id" TEXT NOT NULL,
  "hour_bucket" TIMESTAMP(3) NOT NULL,
  "success_count" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hourly_submission_counters_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "coupons" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "type" "CouponType" NOT NULL,
  "plan" "Plan",
  "duration_days" INTEGER,
  "discount_percent" INTEGER,
  "max_redemptions" INTEGER,
  "redemptions" INTEGER NOT NULL DEFAULT 0,
  "per_user_limit" INTEGER NOT NULL DEFAULT 1,
  "expires_at" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "coupon_redemptions" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "coupon_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "redeemed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "provider" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "credit_wallets_user_id_key" ON "credit_wallets" ("user_id");
CREATE INDEX IF NOT EXISTS "credit_ledger_user_id_created_at_idx" ON "credit_ledger" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "credit_ledger_ref_type_ref_id_idx" ON "credit_ledger" ("ref_type", "ref_id");
CREATE UNIQUE INDEX IF NOT EXISTS "feature_usage_user_id_feature_key_period_start_key" ON "feature_usage" ("user_id", "feature_key", "period_start");
CREATE INDEX IF NOT EXISTS "feature_usage_user_id_idx" ON "feature_usage" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "hourly_submission_counters_user_id_question_id_hour_bucket_key" ON "hourly_submission_counters" ("user_id", "question_id", "hour_bucket");
CREATE INDEX IF NOT EXISTS "hourly_submission_counters_user_id_hour_bucket_idx" ON "hourly_submission_counters" ("user_id", "hour_bucket");
CREATE UNIQUE INDEX IF NOT EXISTS "coupons_code_key" ON "coupons" ("code");
CREATE INDEX IF NOT EXISTS "coupons_active_idx" ON "coupons" ("active");
CREATE UNIQUE INDEX IF NOT EXISTS "coupon_redemptions_coupon_id_user_id_key" ON "coupon_redemptions" ("coupon_id", "user_id");
CREATE INDEX IF NOT EXISTS "coupon_redemptions_user_id_idx" ON "coupon_redemptions" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_event_id_key" ON "webhook_events" ("event_id");
CREATE INDEX IF NOT EXISTS "webhook_events_provider_event_type_idx" ON "webhook_events" ("provider", "event_type");
CREATE INDEX IF NOT EXISTS "subscriptions_user_id_status_idx" ON "subscriptions" ("user_id", "status");

DO $$ BEGIN
  ALTER TABLE "credit_wallets"
    ADD CONSTRAINT "credit_wallets_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "credit_ledger"
    ADD CONSTRAINT "credit_ledger_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "credit_ledger"
    ADD CONSTRAINT "credit_ledger_wallet_id_fkey"
    FOREIGN KEY ("wallet_id") REFERENCES "credit_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "feature_usage"
    ADD CONSTRAINT "feature_usage_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "hourly_submission_counters"
    ADD CONSTRAINT "hourly_submission_counters_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "coupons"
    ADD CONSTRAINT "coupons_plan_check"
    CHECK ("type" <> 'PLAN_GRANT' OR "plan" IS NOT NULL);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "coupon_redemptions"
    ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey"
    FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "coupon_redemptions"
    ADD CONSTRAINT "coupon_redemptions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "subscriptions"
    ADD CONSTRAINT "subscriptions_coupon_id_fkey"
    FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
