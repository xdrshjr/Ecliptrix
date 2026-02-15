# TODO 01: 数据库基础设施

> 对应 Spec: `specs/01-database-infrastructure.md`

## 依赖更新

- [ ] 在 `requirements.txt` 中新增 `sqlalchemy[asyncio]>=2.0.0`
- [ ] 在 `requirements.txt` 中新增 `asyncpg>=0.29.0`
- [ ] 在 `requirements.txt` 中新增 `alembic>=1.13.0`
- [ ] 在 `requirements.txt` 中新增 `aiofiles>=23.0.0`

## config.py 变更

- [ ] 新建 `DatabaseConfig` 类（url, pool_size, max_overflow, pool_timeout, pool_recycle）
- [ ] 修改 `AuthConfig`：移除 `mode` 字段，将 `local_admin_username/password` 重命名为 `admin_username/admin_password`
- [ ] 在 `Settings` 中新增 `database: DatabaseConfig` 字段
- [ ] 在 `get_settings()` 中新增 DATABASE_URL / DB_* 环境变量读取逻辑
- [ ] 在 `get_settings()` 中移除 `supabase_config` 创建代码
- [ ] 在 `get_settings()` 中更新 `auth_config`（移除 mode，使用 ADMIN_USERNAME/ADMIN_PASSWORD）
- [ ] 从 Settings 返回值中移除 `supabase=supabase_config`
- [ ] **暂不删除 SupabaseConfig 类**（等其他模块迁移完再删）

## database.py 创建

- [ ] 新建 `app/database.py`
- [ ] 实现 `create_async_engine`（从 settings.database 读取配置）
- [ ] 实现 `async_sessionmaker` 会话工厂
- [ ] 实现 `get_db_session()` 异步生成器（FastAPI Depends 注入用）
- [ ] 实现 `init_db()` 函数（create_all + 创建初始管理员用户）
- [ ] 实现 `close_db()` 函数（engine.dispose）

## ORM 模型

- [ ] 新建 `app/models/db_models.py`
- [ ] 定义 `Base` 声明基类
- [ ] 定义 `User` 模型（含所有字段：id, username, email, password_hash, full_name, avatar_url, is_active, is_admin, user_role, created_at, updated_at, last_login_at, active_session_token, session_created_at, session_device_info, session_ip_address）
- [ ] 定义 `AgentWorkflow` 模型（id, user_id, workflow_name, workflow_data, description, is_template, created_at, updated_at）
- [ ] 验证 User 模型的唯一约束（username, email）
- [ ] 验证索引创建（username, email, user_id in workflows）

## Alembic 配置

- [ ] 在 `backend-services/basic-service/` 下初始化 Alembic（创建 alembic.ini 和 alembic/ 目录）
- [ ] 修改 `alembic/env.py`：从 app.config 读取 DATABASE_URL
- [ ] 修改 `alembic/env.py`：导入 Base.metadata 作为 target_metadata
- [ ] 生成初始迁移脚本 `001_initial_schema.py`

## main.py 集成

- [ ] 在 `lifespan()` startup 中调用 `await init_db()`
- [ ] 在 `lifespan()` shutdown 中调用 `await close_db()`
- [ ] 在 startup 日志中添加数据库初始化成功信息
