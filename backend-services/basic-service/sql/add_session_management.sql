-- 会话管理迁移脚本
-- 为用户表添加单设备登录功能所需的字段

-- 添加会话管理相关字段
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS active_session_token VARCHAR(255) UNIQUE,
ADD COLUMN IF NOT EXISTS session_created_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS session_device_info TEXT,
ADD COLUMN IF NOT EXISTS session_ip_address VARCHAR(45);

-- 创建索引以提高会话查询性能
CREATE INDEX IF NOT EXISTS idx_users_active_session_token ON users(active_session_token) WHERE active_session_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_session_created_at ON users(session_created_at) WHERE session_created_at IS NOT NULL;

-- 注释
COMMENT ON COLUMN users.active_session_token IS '当前活跃的会话令牌，用于单设备登录控制';
COMMENT ON COLUMN users.session_created_at IS '当前会话创建时间';
COMMENT ON COLUMN users.session_device_info IS '当前会话的设备信息（User-Agent）';
COMMENT ON COLUMN users.session_ip_address IS '当前会话的IP地址';

