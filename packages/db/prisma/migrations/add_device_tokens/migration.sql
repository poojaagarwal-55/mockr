-- Simplified device token approach
-- Store device token directly in users table instead of separate table
-- This reduces complexity and database load

ALTER TABLE users ADD COLUMN device_token TEXT;
ALTER TABLE users ADD COLUMN device_token_created_at TIMESTAMP(3);

-- Index for fast device token lookups during login
CREATE INDEX idx_users_device_token ON users(device_token) WHERE device_token IS NOT NULL;
