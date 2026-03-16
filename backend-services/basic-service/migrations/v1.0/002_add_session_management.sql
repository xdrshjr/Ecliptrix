-- v1.0 - 002: Add session management columns
-- Add session management columns for single-device login
-- Schema matches app/models/db_models.py User model session fields

ALTER TABLE users
ADD COLUMN IF NOT EXISTS active_session_token VARCHAR(255),
ADD COLUMN IF NOT EXISTS session_created_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS session_device_info TEXT,
ADD COLUMN IF NOT EXISTS session_ip_address VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_users_active_session_token ON users(active_session_token) WHERE active_session_token IS NOT NULL;
