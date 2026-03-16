-- v1.1 - 001: 添加根用户字段
-- Add is_root column to users table for super admin support

ALTER TABLE users
ADD COLUMN IF NOT EXISTS is_root BOOLEAN NOT NULL DEFAULT false;

-- 将现有的第一个管理员标记为根用户
DO $$
DECLARE
    first_admin_id UUID;
BEGIN
    SELECT id INTO first_admin_id FROM users WHERE is_admin = true ORDER BY created_at ASC LIMIT 1;
    IF first_admin_id IS NOT NULL THEN
        UPDATE users SET is_root = true WHERE id = first_admin_id;
        RAISE NOTICE 'Marked user % as root', first_admin_id;
    END IF;
END $$;
