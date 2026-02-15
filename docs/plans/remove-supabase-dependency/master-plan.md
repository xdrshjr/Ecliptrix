# Master Plan: 移除 Supabase 依赖，实现完全自部署

## 1. 项目概述与目标

### 背景
Ecliptrix 当前深度依赖 Supabase 提供三项核心服务：
- **对象存储**：视频/音频/图片素材的上传、签名URL、素材列表管理（`supabase_service.py` 1019行）
- **数据库**：用户认证、会话管理、用户资料、工作流存储（通过 Supabase PostgreSQL）
- **认证基础设施**：双模式认证（local / supabase），会话Token管理

### 目标
将所有 Supabase 依赖替换为自部署方案，使 Ecliptrix 能够完全运行在单台 Linux 服务器上，不依赖任何第三方 SaaS 服务。

### 成功标准
1. 项目代码中不存在任何 Supabase SDK 导入或引用
2. 所有功能使用自部署的 PostgreSQL + 本地文件系统正常运行
3. `requirements.txt` 中移除 `supabase`, `storage3`, `postgrest`, `supafunc`
4. 环境变量中不再需要 `SUPABASE_*` 配置项
5. 前端 API 路由中不再存在 `supabase` 命名的端点
6. 所有新服务有对应的测试用例和 API 文档

---

## 2. 范围定义

### 在范围内（In Scope）
- **后端**：替换所有 Supabase 服务调用
  - 数据库交互层：Supabase Client → SQLAlchemy + asyncpg
  - 文件存储服务：Supabase Storage → 本地文件系统
  - 认证服务：移除 supabase 模式分支，仅保留 local 模式
  - 会话服务：迁移到 SQLAlchemy 数据库操作
  - 用户服务：迁移到 SQLAlchemy 数据库操作
  - 工作流存储：迁移到 SQLAlchemy 数据库操作
- **前端**：
  - Next.js API 代理路由重命名和合并
  - 前端 API 客户端更新
  - 上传相关 hooks 更新
- **配置**：
  - 环境变量替换（SUPABASE_* → DATABASE_URL + STORAGE_*）
  - config.py 中移除 SupabaseConfig
  - main.py 中移除 supabase router 注册
- **Schema 管理**：
  - 创建 SQLAlchemy 模型定义
  - 配置 Alembic 迁移框架
  - 应用启动时自动建表（首次部署）
- **清理**：
  - 删除 supabase 相关测试文件，编写新测试
  - 删除 supabase 相关 API 文档，编写新文档
  - 移除 Python 依赖包

### 不在范围内（Out of Scope）
- 旧数据迁移（确认无需迁移）
- Docker/容器化配置
- CI/CD 管道变更
- 前端认证流程的功能性变更（保持现有 local auth 行为）
- 性能优化或新功能开发

---

## 3. 高层架构

### 当前架构（Before）
```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Next.js    │────>│  FastAPI      │────>│  Supabase Cloud │
│  Frontend   │     │  Backend      │     │  - PostgreSQL   │
│             │     │               │     │  - Storage      │
│  /api/supabase/*  │  supabase_    │     │  - Auth (部分)  │
│  /api/auth/*│     │  service.py   │     │                 │
└─────────────┘     └──────────────┘     └─────────────────┘
```

### 目标架构（After）
```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Next.js    │────>│  FastAPI      │────>│  Self-Hosted    │
│  Frontend   │     │  Backend      │     │                 │
│             │     │               │     │  PostgreSQL     │
│  /api/storage/*   │  storage_     │     │  (SQLAlchemy)   │
│  /api/auth/*│     │  service.py   │     │                 │
│             │     │  auth_        │     │  Local FS       │
│             │     │  service.py   │     │  (static/)      │
└─────────────┘     └──────────────┘     └─────────────────┘
```

### 技术栈变更

| 组件 | 当前 | 目标 |
|------|------|------|
| 数据库 | Supabase PostgreSQL (via REST) | 自部署 PostgreSQL (via SQLAlchemy) |
| 数据库驱动 | postgrest (HTTP) | asyncpg (原生异步) |
| ORM | 无（直接 REST 调用） | SQLAlchemy 2.0 (async) |
| Schema 管理 | Supabase 控制台 | Alembic + create_all() |
| 文件存储 | Supabase Storage | 本地文件系统 + FastAPI StaticFiles |
| 文件访问 | 签名URL / 公共URL | FastAPI 静态文件路由 |
| 认证 | 双模式(local/supabase) | 仅 local 模式 |
| Python 依赖 | supabase, storage3, postgrest, supafunc | sqlalchemy[asyncio], asyncpg, alembic |

---

## 4. 关键设计决策

### 4.1 数据库连接管理
- 使用 SQLAlchemy 2.0 异步引擎（`create_async_engine`）
- 连接池管理，适配 FastAPI 生命周期
- `DATABASE_URL` 环境变量为主配置，同时支持 `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD` 分项配置作为备选
- 在 `app/database.py` 中统一管理数据库连接

### 4.2 SQLAlchemy 模型设计
- 在 `app/models/` 下新增 `db_models.py` 存放 SQLAlchemy ORM 模型
- 模型覆盖现有两张表：`users`、`agent_workflows`
- 保持与现有 Pydantic 模型并存（Pydantic 用于 API 校验，SQLAlchemy 用于数据库操作）

### 4.3 文件存储设计
- 存储根目录通过 `STORAGE_ROOT` 环境变量配置，默认 `static/uploads`
- 沿用现有目录结构：`{type}/{YYYY}/{MM}/{DD}/user_{user_id}/{task_id}/{filename}`
- FastAPI StaticFiles 挂载提供文件访问
- 文件URL格式：`/api/storage/files/{relative_path}` 替代 Supabase 签名URL
- 视频缩略图生成逻辑保留在新的存储服务中

### 4.4 认证简化
- 移除所有 `AUTH_MODE` 分支判断
- auth_service 直接使用 SQLAlchemy 操作数据库
- session 管理改为数据库操作（SQLAlchemy）
- 保留 bcrypt 密码哈希、JWT Token 机制

### 4.5 API 路由重组
**后端路由变更：**
- `/api/supabase/upload-audio` → `/api/storage/upload-audio`
- `/api/supabase/upload-file` → `/api/storage/upload-file`
- `/api/supabase/upload-video` → `/api/storage/upload-video`
- `/api/supabase/health` → `/api/storage/health`
- `/api/supabase/user-materials` → `/api/storage/user-materials`

**前端路由变更：**
- `src/app/api/supabase/*` → `src/app/api/storage/*`
- `src/lib/api/supabase.ts` → `src/lib/api/storage.ts`

---

## 5. 依赖变更

### 移除
```
supabase==2.18.0
storage3==0.12.1
postgrest==1.1.1
supafunc==0.1.0
```

### 新增
```
sqlalchemy[asyncio]>=2.0.0
asyncpg>=0.29.0
alembic>=1.13.0
aiofiles>=23.0.0
```

---

## 6. 环境变量变更

### 移除
```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_BUCKET
AUTH_MODE
```

### 新增
```
# 数据库配置（二选一）
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/ecliptrix

# 或分项配置
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ecliptrix
DB_USER=ecliptrix
DB_PASSWORD=your_password

# 存储配置
STORAGE_ROOT=static/uploads          # 文件存储根目录
STORAGE_MAX_FILE_SIZE=524288000      # 最大文件大小(bytes)，默认500MB
```

---

## 7. 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 数据库连接池配置不当 | 并发请求时连接耗尽 | 使用 SQLAlchemy 连接池参数调优，设置合理的 pool_size 和 max_overflow |
| 本地文件存储磁盘空间不足 | 上传失败 | 配置磁盘空间监控，STORAGE_MAX_FILE_SIZE 限制单文件大小 |
| FFmpeg 缩略图生成依赖路径变更 | 视频上传缩略图失败 | 保留现有 FFmpeg 调用逻辑，仅更换文件保存路径 |
| 异步数据库操作与现有同步代码冲突 | 运行时错误 | 统一使用 async session，必要时用 `run_in_executor` 桥接 |
| 前端硬编码的 supabase URL | 功能异常 | 全局搜索并替换所有 supabase 引用 |

---

## 8. 文件变更清单（受影响文件）

### 后端 - 新增文件
- `app/database.py` — 数据库引擎、会话管理、连接池
- `app/models/db_models.py` — SQLAlchemy ORM 模型定义
- `app/services/storage_service.py` — 本地文件存储服务（替代 supabase_service.py）
- `app/routers/storage_router.py` — 存储 API 路由（替代 supabase_router.py）
- `alembic.ini` — Alembic 配置
- `alembic/` — Alembic 迁移目录

### 后端 - 修改文件
- `app/config.py` — 移除 SupabaseConfig，新增 DatabaseConfig、StorageConfig
- `app/main.py` — 替换 router 注册，添加数据库生命周期管理
- `app/services/auth_service.py` — 改用 SQLAlchemy 操作
- `app/services/session_service.py` — 改用 SQLAlchemy 操作
- `app/services/user_service.py` — 改用 SQLAlchemy 操作
- `app/services/agent_workflow_service.py` — 改用 SQLAlchemy 操作
- `app/routers/auth_router.py` — 移除 supabase 分支
- `requirements.txt` — 替换依赖

### 后端 - 删除文件
- `app/services/supabase_service.py`
- `app/routers/supabase_router.py`
- `app/models/supabase_models.py`（内容迁移到通用模型中）
- 所有 supabase 相关测试文件（6个）
- 所有 supabase 相关文档（6个）

### 前端 - 修改文件
- `src/lib/api/supabase.ts` → 重命名为 `src/lib/api/storage.ts`
- `src/app/api/supabase/*` → 重命名为 `src/app/api/storage/*`
- `src/components/video/hooks/useAICreation.ts` — 更新导入
- `src/components/video/hooks/useAIVideoGeneration.ts` — 更新导入
- 其他引用 supabase API 的组件

### 配置文件
- `backend-services/basic-service/.env` — 替换环境变量
- `env.template` — 更新模板
- `env-config/` 目录下的 `.env` 文件

---

## 9. 实施顺序

```mermaid
graph TD
    A[1. 数据库基础设施] --> B[2. SQLAlchemy 模型]
    B --> C[3. 本地存储服务]
    B --> D[4. 认证服务重构]
    C --> E[5. 存储路由重写]
    D --> F[6. 认证/会话/用户路由更新]
    E --> G[7. 前端适配]
    F --> G
    G --> H[8. 配置与依赖清理]
    H --> I[9. 测试编写]
    I --> J[10. 文档更新]
    J --> K[11. 集成验证与清理]
```

1. **数据库基础设施**：创建 database.py，配置 SQLAlchemy 引擎和 Alembic
2. **SQLAlchemy 模型**：定义 User、AgentWorkflow 等 ORM 模型
3. **本地存储服务**：实现 storage_service.py 替代 supabase_service.py
4. **认证服务重构**：auth_service.py 改用 SQLAlchemy，移除 supabase 分支
5. **存储路由重写**：storage_router.py 替代 supabase_router.py
6. **认证/会话/用户路由更新**：更新所有依赖 supabase 的路由
7. **前端适配**：重命名 API 客户端和代理路由
8. **配置与依赖清理**：更新 config.py、requirements.txt、.env 文件
9. **测试编写**：为所有新服务编写测试
10. **文档更新**：编写新的 API 文档
11. **集成验证与清理**：全局搜索确保无残留引用

---

## 10. Spec 文件目录

| 编号 | 文件名 | 内容 |
|------|--------|------|
| 01 | database-infrastructure.md | 数据库连接、SQLAlchemy 配置、Alembic 集成、ORM 模型 |
| 02 | storage-service.md | 本地文件存储服务设计、目录结构、上传/下载/列表/删除 |
| 03 | auth-session-user-refactor.md | 认证、会话、用户服务的 SQLAlchemy 迁移 |
| 04 | api-routes-refactor.md | 后端路由重组 + 前端 API 客户端和代理路由更新 |
| 05 | config-cleanup-testing.md | 配置清理、依赖更新、测试策略、文档更新 |
