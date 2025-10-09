"""
用户角色更新脚本
用于更新用户的角色类型

使用方法:
python scripts/update_user_role.py --username <username> --role <admin|regular|premium>

示例:
python scripts/update_user_role.py --username admin --role admin
python scripts/update_user_role.py --username user1 --role premium
"""

import os
import sys
import asyncio
import argparse
from pathlib import Path

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from supabase import create_client, Client
from app.config import settings
from app.logger import get_logger

logger = get_logger(__name__)


class UserRoleUpdater:
    """用户角色更新工具"""
    
    def __init__(self):
        """初始化 Supabase 客户端"""
        try:
            if not settings.supabase.url or not settings.supabase.anon_key:
                raise ValueError("SUPABASE_URL 或 SUPABASE_ANON_KEY 环境变量未设置")
            
            self.client: Client = create_client(
                settings.supabase.url,
                settings.supabase.anon_key
            )
            logger.info("Supabase 客户端初始化成功")
            
        except Exception as e:
            logger.error(f"初始化失败: {str(e)}")
            raise
    
    async def get_user_by_username(self, username: str) -> dict:
        """
        根据用户名查询用户
        
        Args:
            username: 用户名
            
        Returns:
            用户数据字典，如果不存在则返回 None
        """
        try:
            response = self.client.table('users').select('*').eq('username', username).execute()
            
            if not response.data:
                return None
            
            return response.data[0]
            
        except Exception as e:
            logger.error(f"查询用户失败: {str(e)}")
            raise
    
    async def update_user_role(self, username: str, role: str) -> bool:
        """
        更新用户角色
        
        Args:
            username: 用户名
            role: 新角色 (admin, regular, premium)
            
        Returns:
            是否更新成功
        """
        try:
            # 验证角色值
            valid_roles = ['admin', 'regular', 'premium']
            if role not in valid_roles:
                logger.error(f"无效的角色类型: {role}，有效值为: {', '.join(valid_roles)}")
                return False
            
            # 查询用户是否存在
            user = await self.get_user_by_username(username)
            if not user:
                logger.error(f"用户不存在: {username}")
                return False
            
            current_role = user.get('user_role', 'unknown')
            logger.info(f"找到用户: {username}")
            logger.info(f"  - 用户ID: {user['id']}")
            logger.info(f"  - 邮箱: {user['email']}")
            logger.info(f"  - 当前角色: {current_role}")
            logger.info(f"  - 目标角色: {role}")
            
            # 如果角色相同，不需要更新
            if current_role == role:
                logger.info(f"用户 {username} 的角色已经是 {role}，无需更新")
                return True
            
            # 更新角色
            update_data = {
                'user_role': role
            }
            
            # 如果设置为管理员，同时更新 is_admin 字段
            if role == 'admin':
                update_data['is_admin'] = True
            elif current_role == 'admin':
                # 如果从管理员降级，取消 is_admin 标记
                update_data['is_admin'] = False
            
            response = self.client.table('users').update(update_data).eq('username', username).execute()
            
            if response.data:
                logger.info(f"✅ 成功更新用户 {username} 的角色: {current_role} -> {role}")
                return True
            else:
                logger.error(f"更新失败: 未知错误")
                return False
                
        except Exception as e:
            logger.error(f"更新用户角色失败: {str(e)}")
            return False
    
    async def list_users_by_role(self, role: str = None):
        """
        列出指定角色的所有用户
        
        Args:
            role: 角色类型，如果为 None 则列出所有用户
        """
        try:
            if role:
                response = self.client.table('users').select('id, username, email, user_role, is_active').eq('user_role', role).execute()
            else:
                response = self.client.table('users').select('id, username, email, user_role, is_active').execute()
            
            if not response.data:
                logger.info("没有找到用户")
                return
            
            logger.info(f"\n找到 {len(response.data)} 个用户:")
            logger.info("-" * 80)
            
            for user in response.data:
                status = "✓ 激活" if user['is_active'] else "✗ 禁用"
                logger.info(f"用户名: {user['username']:<20} 角色: {user['user_role']:<10} 状态: {status}")
                logger.info(f"  邮箱: {user['email']}")
                logger.info(f"  ID: {user['id']}")
                logger.info("-" * 80)
                
        except Exception as e:
            logger.error(f"查询用户列表失败: {str(e)}")


async def main():
    """主函数"""
    parser = argparse.ArgumentParser(
        description='用户角色更新工具',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 设置用户为管理员
  python scripts/update_user_role.py --username admin --role admin
  
  # 设置用户为高级用户
  python scripts/update_user_role.py --username user1 --role premium
  
  # 设置用户为普通用户
  python scripts/update_user_role.py --username user2 --role regular
  
  # 列出所有管理员
  python scripts/update_user_role.py --list admin
  
  # 列出所有用户
  python scripts/update_user_role.py --list
        """
    )
    
    parser.add_argument(
        '--username',
        type=str,
        help='要更新的用户名'
    )
    
    parser.add_argument(
        '--role',
        type=str,
        choices=['admin', 'regular', 'premium'],
        help='新角色类型: admin(管理员), regular(普通用户), premium(高级用户)'
    )
    
    parser.add_argument(
        '--list',
        type=str,
        nargs='?',
        const='all',
        help='列出用户，可选参数: admin, regular, premium'
    )
    
    args = parser.parse_args()
    
    try:
        updater = UserRoleUpdater()
        
        # 列出用户
        if args.list:
            role = args.list if args.list != 'all' else None
            await updater.list_users_by_role(role)
            return
        
        # 更新用户角色
        if not args.username or not args.role:
            parser.error("需要提供 --username 和 --role 参数，或使用 --list 查看用户")
            return
        
        success = await updater.update_user_role(args.username, args.role)
        
        if success:
            sys.exit(0)
        else:
            sys.exit(1)
            
    except Exception as e:
        logger.error(f"脚本执行失败: {str(e)}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())

