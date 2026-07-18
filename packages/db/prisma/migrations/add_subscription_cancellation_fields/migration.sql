-- Add cancellation tracking fields to subscriptions table
-- These fields track user cancellations, payment failures, and subscription expiry

-- Add cancellation timestamp
ALTER TABLE "subscriptions" 
ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3);

-- Add cancellation reason (user_request, payment_failure, admin_action)
ALTER TABLE "subscriptions" 
ADD COLUMN IF NOT EXISTS "cancellation_reason" TEXT;

-- Add expiry timestamp (when subscription actually expired)
ALTER TABLE "subscriptions" 
ADD COLUMN IF NOT EXISTS "expired_at" TIMESTAMP(3);

-- Add failed payment tracking
ALTER TABLE "subscriptions" 
ADD COLUMN IF NOT EXISTS "failed_payment_attempts" INTEGER NOT NULL DEFAULT 0;

-- Add last failed payment timestamp
ALTER TABLE "subscriptions" 
ADD COLUMN IF NOT EXISTS "last_failed_payment_at" TIMESTAMP(3);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS "subscriptions_cancelled_at_idx" ON "subscriptions"("cancelled_at");
CREATE INDEX IF NOT EXISTS "subscriptions_expired_at_idx" ON "subscriptions"("expired_at");
CREATE INDEX IF NOT EXISTS "subscriptions_status_current_period_end_idx" ON "subscriptions"("status", "current_period_end");

-- Add comment for documentation
COMMENT ON COLUMN "subscriptions"."cancelled_at" IS 'Timestamp when user cancelled the subscription';
COMMENT ON COLUMN "subscriptions"."cancellation_reason" IS 'Reason for cancellation: user_request, payment_failure, admin_action';
COMMENT ON COLUMN "subscriptions"."expired_at" IS 'Timestamp when subscription actually expired and user was downgraded';
COMMENT ON COLUMN "subscriptions"."failed_payment_attempts" IS 'Number of consecutive failed payment attempts';
COMMENT ON COLUMN "subscriptions"."last_failed_payment_at" IS 'Timestamp of the last failed payment attempt';
