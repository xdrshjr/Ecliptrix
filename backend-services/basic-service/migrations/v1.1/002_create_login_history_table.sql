-- v1.1 - 002: 创建登录历史表
-- Create login_history table for tracking login attempts

CREATE TABLE IF NOT EXISTS login_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    login_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    ip_address VARCHAR(50),
    device_info TEXT,
    login_result VARCHAR(20) NOT NULL,
    failure_reason VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_login_history_user_id ON login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_login_history_login_at ON login_history(login_at);
