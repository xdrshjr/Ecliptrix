-- 添加用户角色字段的迁移脚本
-- Add user_role field to users table

-- 创建用户角色枚举类型
DO $$ BEGIN
    CREATE TYPE user_role_enum AS ENUM ('admin', 'regular', 'premium');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 添加用户角色字段（默认值为 'regular'）
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS user_role user_role_enum DEFAULT 'regular';

-- 为现有的管理员用户设置角色为 'admin'
UPDATE users 
SET user_role = 'admin' 
WHERE is_admin = true;

-- 为现有的非管理员用户设置角色为 'regular'（如果尚未设置）
UPDATE users 
SET user_role = 'regular' 
WHERE is_admin = false AND user_role IS NULL;

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_users_user_role ON users(user_role);

-- 添加注释
COMMENT ON COLUMN users.user_role IS '用户角色类型：admin(管理员)、regular(普通用户)、premium(高级用户)';
COMMENT ON TYPE user_role_enum IS '用户角色枚举类型：admin(管理员)、regular(普通用户)、premium(高级用户)';

-- 验证数据
DO $$
DECLARE
    admin_count INTEGER;
    regular_count INTEGER;
    premium_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO admin_count FROM users WHERE user_role = 'admin';
    SELECT COUNT(*) INTO regular_count FROM users WHERE user_role = 'regular';
    SELECT COUNT(*) INTO premium_count FROM users WHERE user_role = 'premium';
    
    RAISE NOTICE '用户角色迁移完成:';
    RAISE NOTICE '  - 管理员用户: %', admin_count;
    RAISE NOTICE '  - 普通用户: %', regular_count;
    RAISE NOTICE '  - 高级用户: %', premium_count;
END $$;

