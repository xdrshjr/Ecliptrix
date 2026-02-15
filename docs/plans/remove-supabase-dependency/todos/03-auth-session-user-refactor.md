# TODO 03: 认证、会话、用户服务 SQLAlchemy 迁移

> 对应 Spec: `specs/03-auth-session-user-refactor.md`

## auth_service.py 重写

- [ ] 移除 `from supabase import create_client, Client` 和 `SUPABASE_AVAILABLE` 变量
- [ ] 移除 `_initialize_provider()` 方法
- [ ] 移除 `_create_supabase_provider()` 方法
- [ ] 移除 `_validate_client()` 方法
- [ ] 新增 `from app.models.db_models import User` 导入
- [ ] 新增 `from sqlalchemy.ext.asyncio import AsyncSession` 导入
- [ ] 新增 `from sqlalchemy import select, update` 导入
- [ ] 重写 `__init__`：仅日志记录，无连接初始化
- [ ] 保留 `_hash_password()` 和 `_verify_password()` 不变
- [ ] 重写 `authenticate_user()`：增加 `db` 参数，使用 SQLAlchemy select/update
- [ ] 重写 `register_user()`：增加 `db` 参数，使用 SQLAlchemy insert
- [ ] 重写 `get_user_by_id()`：增加 `db` 参数，使用 SQLAlchemy select
- [ ] 重写 `health_check()`：增加 `db` 参数，使用 SQLAlchemy select count
- [ ] 移除所有 `if settings.auth.mode == "local"` 分支判断
- [ ] 确保 `authenticate_user` 内部调用 `session_service.create_session(db, ...)` 时传递 db

## session_service.py 重写

- [ ] 移除 `from supabase import create_client, Client` 和 `SUPABASE_AVAILABLE`
- [ ] 移除 Supabase Client 初始化逻辑
- [ ] 移除 `_validate_client()` 方法
- [ ] 移除 `self.local_provider` 相关逻辑
- [ ] 新增 SQLAlchemy 导入
- [ ] 重写 `__init__`：仅日志记录
- [ ] 保留 `_generate_session_token()` 不变
- [ ] 重写 `create_session()`：增加 `db` 参数，使用 `update(User)` 更新会话字段
- [ ] 重写 `validate_session()`：增加 `db` 参数，使用 `select(User)` 查询会话字段
- [ ] 重写 `invalidate_session()`：增加 `db` 参数，使用 `update(User)` 清空会话字段
- [ ] 移除所有 `if settings.auth.mode == "local"` 分支判断

## user_service.py 重写

- [ ] 移除 `from supabase import create_client, Client` 和 `SUPABASE_AVAILABLE`
- [ ] 移除 Supabase Client 初始化逻辑
- [ ] 移除 `_validate_client()` 方法
- [ ] 新增 SQLAlchemy 导入
- [ ] 重写 `__init__`：仅日志记录
- [ ] 重写 `get_user_profile()`：增加 `db` 参数，按 id 或 username 查询
- [ ] 重写 `update_user_profile()`：增加 `db` 参数，使用 SQLAlchemy update
- [ ] 重写 `get_all_users()`：增加 `db` 参数，使用 `select(User).order_by()`
- [ ] 重写 `create_user()`：增加 `db` 参数，使用 SQLAlchemy insert
- [ ] 重写 `delete_user()`：增加 `db` 参数，使用 SQLAlchemy delete
- [ ] 保留 `_hash_password()` 不变

## agent_workflow_service.py 重写

- [ ] 移除 `from supabase import create_client, Client` 和 `SUPABASE_AVAILABLE`
- [ ] 移除 Supabase Client 初始化逻辑
- [ ] 新增 SQLAlchemy 导入和 `AgentWorkflow` 模型导入
- [ ] 重写所有 CRUD 方法，增加 `db` 参数
- [ ] 保留现有的 Pydantic 模型引用（workflow_models.py）

## 删除文件

- [ ] 删除 `app/services/auth/__init__.py`
- [ ] 删除 `app/services/auth/local_provider.py`
- [ ] 删除 `app/services/auth/local_session_provider.py`
- [ ] 删除 `app/services/auth/` 目录

## 验证

- [ ] 确保 auth_service 初始化不报错（不依赖任何外部连接）
- [ ] 确保 session_service 初始化不报错
- [ ] 确保所有服务方法的 db 参数正确传递
- [ ] 确保 authenticate_user 内部的事务一致性（查询→创建会话→更新登录时间在同一事务）
