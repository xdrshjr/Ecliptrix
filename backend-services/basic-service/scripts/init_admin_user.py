#!/usr/bin/env python3
"""
初始化管理员用户脚本

该脚本用于为默认管理员用户生成正确的密码哈希，并更新数据库中的记录。
在执行SQL创建用户表脚本后运行此脚本。
"""

import os
import sys
import bcrypt
from datetime import datetime

# 添加项目根目录到Python路径
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.insert(0, parent_dir)

try:
    from supabase import create_client, Client

    SUPABASE_AVAILABLE = True
except ImportError:
    print("错误: 请安装 supabase 库: pip install supabase")
    sys.exit(1)

from app.config import settings
from app.logger import get_logger

logger = get_logger(__name__)


def generate_password_hash(password: str) -> str:
    """生成密码哈希"""
    try:
        salt = bcrypt.gensalt()
        hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
        return hashed.decode('utf-8')
    except Exception as e:
        logger.error(f"密码哈希生成失败: {str(e)}")
        raise


def init_admin_user():
    """初始化管理员用户"""
    try:
        # 验证环境变量
        if not settings.supabase.url:
            raise ValueError("SUPABASE_URL 环境变量未设置")
        if not settings.supabase.anon_key:
            raise ValueError("SUPABASE_ANON_KEY 环境变量未设置")

        print(f"连接到 Supabase: {settings.supabase.url[:50]}...")

        # 创建 Supabase 客户端
        client: Client = create_client(
            settings.supabase.url,
            settings.supabase.anon_key
        )

        # 默认管理员信息
        admin_username = "admin"
        admin_password = "7#rA3310"  # 默认密码，生产环境应该修改
        admin_email = "admin@ecliptrix.com"

        print(f"为管理员用户 '{admin_username}' 生成密码哈希...")
        password_hash = generate_password_hash(admin_password)

        # 检查用户是否已存在
        existing_user = client.table('users').select('*').eq('username', admin_username).execute()

        if existing_user.data:
            # 更新现有用户的密码哈希
            print(f"更新现有管理员用户 '{admin_username}' 的密码哈希...")

            update_result = client.table('users').update({
                'password_hash': password_hash,
                'updated_at': datetime.now().isoformat()
            }).eq('username', admin_username).execute()

            if update_result.data:
                print("✅ 管理员用户密码哈希更新成功!")
                print(f"用户ID: {update_result.data[0]['id']}")
                print(f"用户名: {update_result.data[0]['username']}")
                print(f"邮箱: {update_result.data[0]['email']}")
                print(f"是否管理员: {update_result.data[0]['is_admin']}")
            else:
                print("❌ 管理员用户密码哈希更新失败")
                return False
        else:
            # 创建新的管理员用户
            print(f"创建新的管理员用户 '{admin_username}'...")

            admin_data = {
                "username": admin_username,
                "email": admin_email,
                "password_hash": password_hash,
                "full_name": "System Administrator",
                "is_active": True,
                "is_admin": True
            }

            insert_result = client.table('users').insert(admin_data).execute()

            if insert_result.data:
                print("✅ 管理员用户创建成功!")
                print(f"用户ID: {insert_result.data[0]['id']}")
                print(f"用户名: {insert_result.data[0]['username']}")
                print(f"邮箱: {insert_result.data[0]['email']}")
                print(f"是否管理员: {insert_result.data[0]['is_admin']}")
            else:
                print("❌ 管理员用户创建失败")
                return False

        print(f"\n默认登录凭据:")
        print(f"用户名: {admin_username}")
        print(f"密码: {admin_password}")
        print(f"\n⚠️  生产环境中请务必修改默认密码!")

        return True

    except Exception as e:
        error_msg = str(e)
        print(f"❌ 初始化管理员用户失败: {error_msg}")
        logger.error("初始化管理员用户失败", {
            "error": error_msg,
            "error_type": type(e).__name__
        })
        return False


if __name__ == "__main__":
    print("=== 管理员用户初始化脚本 ===\n")

    # 检查环境变量
    required_env_vars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY']
    missing_vars = [var for var in required_env_vars if not os.getenv(var)]

    if missing_vars:
        print(f"❌ 缺少必要的环境变量: {', '.join(missing_vars)}")
        print("请确保设置了以下环境变量:")
        for var in required_env_vars:
            print(f"  - {var}")
        sys.exit(1)

    # 初始化管理员用户
    if init_admin_user():
        print("\n=== 初始化完成 ===")

    else:
        print("\n=== 初始化失败 ===")
        sys.exit(1)
