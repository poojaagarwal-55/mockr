-- Add upgrade/downgrade tracking fields to Subscription table
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "scheduled_plan_change" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "scheduled_change_date" TIMESTAMP(3);
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "previous_plan" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "upgrade_payment_id" TEXT;

-- Add upgrade payment tracking fields to Payment table
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "is_upgrade_payment" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "upgrade_from_plan" TEXT;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "upgrade_to_plan" TEXT;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "prorated_days" INTEGER;

-- Add foreign key constraint for upgrade payment
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_upgrade_payment_id_fkey" 
  FOREIGN KEY ("upgrade_payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS "subscriptions_scheduled_plan_change_idx" ON "subscriptions"("scheduled_plan_change");
CREATE INDEX IF NOT EXISTS "subscriptions_scheduled_change_date_idx" ON "subscriptions"("scheduled_change_date");
CREATE INDEX IF NOT EXISTS "payments_is_upgrade_payment_idx" ON "payments"("is_upgrade_payment");
