-- v1.0 - 003: 添加用户角色字段
-- Add user_role column (admin/regular/premium)

ALTER TABLE users
ADD COLUMN IF NOT EXISTS user_role VARCHAR(20) DEFAULT 'regular';

-- 同步现有数据
UPDATE users SET user_role = 'admin' WHERE is_admin = true AND (user_role IS NULL OR user_role != 'admin');
UPDATE users SET user_role = 'regular' WHERE is_admin = false AND (user_role IS NULL);

CREATE INDEX IF NOT EXISTS idx_users_user_role ON users(user_role);
