-- 用户表创建脚本
-- 用于在Supabase中创建用户信息表

-- 创建用户表
CREATE TABLE IF NOT EXISTS users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    avatar_url TEXT,
    is_active BOOLEAN DEFAULT true,
    is_admin BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE,
    
    -- 约束
    CONSTRAINT username_length CHECK (char_length(username) >= 3),
    CONSTRAINT email_format CHECK (email ~* '^[A-Za-z0-9._+%-]+@[A-Za-z0-9.-]+[.][A-Za-z]+$')
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- 创建更新时间的触发器函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 创建触发器
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 插入默认管理员用户（密码需要在应用中哈希后更新）
INSERT INTO users (username, email, password_hash, full_name, is_admin)
VALUES (
    'admin',
    'admin@ecliptrix.com',
    '$2b$12$placeholder_hash_replace_in_app', -- 这个需要在应用中替换为真实的bcrypt哈希
    'System Administrator',
    true
) ON CONFLICT (username) DO NOTHING;

-- 行级安全策略（RLS）
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 临时禁用RLS以允许初始数据插入
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

-- 注意：在生产环境中，您可能需要根据实际的认证系统调整这些策略
-- 目前我们暂时禁用RLS以避免递归问题
-- 如果需要启用RLS，请根据您的认证系统（如Supabase Auth）创建适当的策略

-- 示例策略（已注释，如需要请根据实际情况修改）:
/*
-- 启用RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 允许所有用户读取（根据需要调整）
CREATE POLICY users_select_policy ON users
    FOR SELECT USING (true);

-- 只允许用户更新自己的信息
CREATE POLICY users_update_policy ON users
    FOR UPDATE USING (auth.uid() = id);

-- 只允许管理员插入新用户
CREATE POLICY users_insert_policy ON users
    FOR INSERT WITH CHECK (
        -- 这里需要根据实际的管理员验证逻辑调整
        true
    );

-- 只允许管理员删除用户
CREATE POLICY users_delete_policy ON users
    FOR DELETE USING (
        -- 这里需要根据实际的管理员验证逻辑调整
        true
    );
*/

-- 注释
COMMENT ON TABLE users IS '用户信息表，存储系统用户的基本信息和认证数据';
COMMENT ON COLUMN users.id IS '用户唯一标识符';
COMMENT ON COLUMN users.username IS '用户名，用于登录';
COMMENT ON COLUMN users.email IS '用户邮箱地址';
COMMENT ON COLUMN users.password_hash IS '密码哈希值，使用bcrypt算法';
COMMENT ON COLUMN users.full_name IS '用户全名';
COMMENT ON COLUMN users.avatar_url IS '用户头像URL';
COMMENT ON COLUMN users.is_active IS '用户是否激活';
COMMENT ON COLUMN users.is_admin IS '是否为管理员用户';
COMMENT ON COLUMN users.created_at IS '创建时间';
COMMENT ON COLUMN users.updated_at IS '最后更新时间';
COMMENT ON COLUMN users.last_login_at IS '最后登录时间'; 