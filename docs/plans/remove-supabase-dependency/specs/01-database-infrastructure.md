# Spec 01: 数据库基础设施

## 概述

建立 SQLAlchemy 2.0 异步数据库基础设施，替代当前分散在各服务中的 Supabase Client 连接方式。提供统一的数据库引擎、会话管理、ORM 模型定义，以及 Alembic 迁移框架。

---

## 1. 数据库连接管理 (`app/database.py`)

### 1.1 核心组件

新建 `app/database.py`，作为整个后端唯一的数据库连接入口。

**职责：**
- 创建 SQLAlchemy 异步引擎（`AsyncEngine`）
- 管理异步会话工厂（`async_sessionmaker`）
- 提供 FastAPI 依赖注入的 `get_db_session()` 函数
- 应用启动/关闭时的连接池管理

**伪代码：**

```
# app/database.py

import AsyncEngine from sqlalchemy.ext.asyncio
import async_sessionmaker from sqlalchemy.ext.asyncio
import AsyncSession from sqlalchemy.ext.asyncio

# 从配置读取 DATABASE_URL
DATABASE_URL = settings.database.url

# 创建异步引擎
engine = create_async_engine(
    DATABASE_URL,
    pool_size=10,        # 连接池大小
    max_overflow=20,     # 允许超出的最大连接数
    pool_timeout=30,     # 获取连接的超时时间
    pool_recycle=1800,   # 连接回收时间（30分钟）
    echo=settings.debug  # Debug模式打印SQL
)

# 创建异步会话工厂
async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)

# FastAPI 依赖注入
async def get_db_session():
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except:
            await session.rollback()
            raise

# 生命周期管理
async def init_db():
    """应用启动时初始化数据库（首次部署自动建表）"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def close_db():
    """应用关闭时释放连接池"""
    await engine.dispose()
```

### 1.2 配置方式

**环境变量优先级：**
1. `DATABASE_URL`（完整连接字符串）：`postgresql+asyncpg://user:pass@host:5432/dbname`
2. 分项参数备选：`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`

**配置组装伪代码：**
```
if DATABASE_URL 存在:
    url = DATABASE_URL
else:
    url = f"postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
```

---

## 2. SQLAlchemy ORM 模型 (`app/models/db_models.py`)

### 2.1 User 模型

基于现有 Supabase `users` 表的字段分析，定义 SQLAlchemy 模型：

```
class User(Base):
    __tablename__ = "users"

    id            = Column(UUID, primary_key, default=uuid4)
    username      = Column(String(50), unique, not_null, index)
    email         = Column(String(255), unique, not_null)
    password_hash = Column(String(255), not_null)
    full_name     = Column(String(100), nullable)
    avatar_url    = Column(String(500), nullable)
    is_active     = Column(Boolean, default=True)
    is_admin      = Column(Boolean, default=False)
    user_role     = Column(String(20), default="regular")
    created_at    = Column(DateTime(timezone=True), server_default=func.now())
    updated_at    = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    last_login_at = Column(DateTime(timezone=True), nullable)

    # 会话相关字段（单设备登录）
    active_session_token  = Column(String(255), nullable)
    session_created_at    = Column(DateTime(timezone=True), nullable)
    session_device_info   = Column(Text, nullable)
    session_ip_address    = Column(String(50), nullable)
```

**关键设计说明：**
- `id` 使用 UUID 类型，与前端 `ecliptrix-user` 存储中的 ID 格式兼容
- 会话字段内嵌在 User 表中（与现有 Supabase 设计保持一致，单设备登录模型）
- `username` 和 `email` 添加唯一约束和索引

### 2.2 AgentWorkflow 模型

```
class AgentWorkflow(Base):
    __tablename__ = "agent_workflows"

    id              = Column(UUID, primary_key, default=uuid4)
    user_id         = Column(String(36), index)
    workflow_name   = Column(String(200), not_null)
    workflow_data   = Column(JSON, not_null)  # 存储完整工作流定义（节点+连接）
    description     = Column(Text, nullable)
    is_template     = Column(Boolean, default=False)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

### 2.3 Base 声明

```
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass
```

---

## 3. Alembic 迁移框架

### 3.1 目录结构

```
backend-services/basic-service/
├── alembic.ini                    # Alembic 主配置
├── alembic/
│   ├── env.py                     # 迁移环境配置
│   ├── script.py.mako             # 迁移脚本模板
│   └── versions/                  # 迁移版本文件
│       └── 001_initial_schema.py  # 初始 schema
```

### 3.2 alembic.ini 配置要点

```ini
[alembic]
script_location = alembic
sqlalchemy.url = driver://user:pass@localhost/dbname  # 会被 env.py 覆盖

[loggers]
keys = root,sqlalchemy,alembic
```

### 3.3 env.py 配置要点

```
# alembic/env.py 伪代码

# 导入所有 ORM 模型（确保 Alembic 能发现表定义）
from app.models.db_models import Base

# 从应用配置获取数据库URL（而非 alembic.ini 硬编码）
from app.config import settings
config.set_main_option("sqlalchemy.url", settings.database.url)

target_metadata = Base.metadata
```

### 3.4 初始迁移

初始迁移脚本创建 `users` 和 `agent_workflows` 两张表，包含所有列定义、索引和约束。

---

## 4. FastAPI 生命周期集成

### 4.1 main.py 中的变更

在现有 `lifespan()` 函数中集成数据库初始化：

```
# main.py lifespan 变更伪代码

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing database...")
    await init_db()  # 自动创建缺失的表
    logger.info("Database initialized")

    # ... 现有的启动逻辑（视频分析队列等）...

    yield

    # Shutdown
    logger.info("Closing database connections...")
    await close_db()
    logger.info("Database connections closed")
```

### 4.2 移除 Supabase 相关启动逻辑

- 移除 `main.py:281-282` 的 `supabase_router` 导入和注册
- 新增 `storage_router` 的导入和注册

---

## 5. config.py 变更

### 5.1 新增 DatabaseConfig

```
class DatabaseConfig(BaseModel):
    """Database configuration."""
    url: str = Field(
        default="postgresql+asyncpg://ecliptrix:ecliptrix@localhost:5432/ecliptrix",
        description="Database connection URL"
    )
    pool_size: int = Field(default=10, description="Connection pool size")
    max_overflow: int = Field(default=20, description="Max overflow connections")
    pool_timeout: int = Field(default=30, description="Connection timeout in seconds")
    pool_recycle: int = Field(default=1800, description="Connection recycle time in seconds")
```

### 5.2 移除 SupabaseConfig

删除整个 `SupabaseConfig` 类（`config.py:171-177`）。

### 5.3 修改 AuthConfig

```
class AuthConfig(BaseModel):
    """Authentication configuration."""
    # 移除 mode 字段（不再需要 local/supabase 切换）
    admin_username: str = Field(default="admin", description="Initial admin username")
    admin_password: str = Field(default="admin", description="Initial admin password")
```

### 5.4 修改 Settings

```
class Settings(BaseModel):
    # ... 保留所有 LLM 配置 ...

    # 移除: supabase: SupabaseConfig
    # 新增:
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)

    # auth 保留但简化:
    auth: AuthConfig = Field(default_factory=AuthConfig)

    # ... 其余保持不变 ...
```

### 5.5 修改 get_settings()

```
# 移除:
# supabase_config = SupabaseConfig(...)
# auth_config = AuthConfig(mode=os.getenv("AUTH_MODE", "supabase"), ...)

# 新增:
database_url = os.getenv("DATABASE_URL", "")
if database_url:
    database_config = DatabaseConfig(url=database_url)
else:
    db_host = os.getenv("DB_HOST", "localhost")
    db_port = os.getenv("DB_PORT", "5432")
    db_name = os.getenv("DB_NAME", "ecliptrix")
    db_user = os.getenv("DB_USER", "ecliptrix")
    db_password = os.getenv("DB_PASSWORD", "ecliptrix")
    database_config = DatabaseConfig(
        url=f"postgresql+asyncpg://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"
    )

auth_config = AuthConfig(
    admin_username=os.getenv("ADMIN_USERNAME", "admin"),
    admin_password=os.getenv("ADMIN_PASSWORD", "admin")
)
```

---

## 6. 服务层使用模式

### 6.1 依赖注入模式（路由层）

路由中通过 FastAPI 的 `Depends` 注入数据库会话：

```
@router.get("/users/{user_id}")
async def get_user(user_id: str, db: AsyncSession = Depends(get_db_session)):
    result = await user_service.get_user_profile(db, user_id)
    return result
```

### 6.2 服务层接口变更

所有使用数据库的服务方法签名增加 `db: AsyncSession` 参数：

```
# Before (Supabase):
async def get_user_profile(self, user_id: str):
    response = self.client.table('users').select('*').eq('id', user_id).execute()

# After (SQLAlchemy):
async def get_user_profile(self, db: AsyncSession, user_id: str):
    stmt = select(User).where(User.id == user_id, User.is_active == True)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
```

### 6.3 服务初始化变更

服务类不再在 `__init__` 中创建 Supabase Client，改为无状态设计（数据库会话由路由层注入）：

```
# Before:
class UserService:
    def __init__(self):
        self.client = create_client(...)

# After:
class UserService:
    def __init__(self):
        logger.info("UserService initialized")
        # 无需任何连接初始化
```

---

## 7. 初始管理员用户

### 7.1 启动时自动创建

在 `init_db()` 中，建表后检查是否存在管理员用户，若不存在则自动创建：

```
async def init_db():
    # 建表
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 检查并创建初始管理员
    async with async_session_factory() as session:
        stmt = select(User).where(User.is_admin == True)
        result = await session.execute(stmt)
        admin = result.scalar_one_or_none()

        if not admin:
            admin_user = User(
                username=settings.auth.admin_username,
                email=f"{settings.auth.admin_username}@local.dev",
                password_hash=hash_password(settings.auth.admin_password),
                is_admin=True,
                is_active=True,
                user_role="admin",
                full_name="Administrator"
            )
            session.add(admin_user)
            await session.commit()
            logger.info("Initial admin user created")
```

---

## 8. 受影响文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `app/database.py` | **新建** | 数据库引擎、会话管理、init/close |
| `app/models/db_models.py` | **新建** | SQLAlchemy ORM 模型（User, AgentWorkflow） |
| `app/config.py` | **修改** | 移除 SupabaseConfig，新增 DatabaseConfig，简化 AuthConfig |
| `app/main.py` | **修改** | 集成 init_db/close_db 到 lifespan |
| `alembic.ini` | **新建** | Alembic 配置 |
| `alembic/env.py` | **新建** | Alembic 环境配置 |
| `alembic/versions/001_initial_schema.py` | **新建** | 初始 schema 迁移 |
| `requirements.txt` | **修改** | 新增 sqlalchemy[asyncio], asyncpg, alembic |

---

## 9. 设计约束

1. **异步优先**：所有数据库操作使用 `async/await`，与 FastAPI 的异步模型一致
2. **无全局 Client**：不再在模块级别创建数据库客户端实例，改用依赖注入
3. **向后兼容**：ORM 模型的表结构与现有 Supabase 中的表结构字段完全一致
4. **首次部署**：`create_all()` 自动建表，后续变更通过 Alembic 管理
5. **连接池**：通过 `DatabaseConfig` 可调整连接池参数，适应不同部署环境
