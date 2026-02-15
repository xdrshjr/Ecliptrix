# Spec 05: 配置清理、依赖更新、测试策略、文档更新

## 概述

完成所有代码变更后的收尾工作：清理环境配置、更新 Python 依赖、编写测试用例、更新 API 文档、全局验证无残留引用。

---

## 1. Python 依赖更新 (`requirements.txt`)

### 1.1 移除的包

```
supabase==2.18.0
storage3==0.12.1
postgrest==1.1.1
supafunc==0.1.0
```

### 1.2 新增的包

```
sqlalchemy[asyncio]>=2.0.0
asyncpg>=0.29.0
alembic>=1.13.0
aiofiles>=23.0.0
```

### 1.3 保留的包（确认无影响）

```
bcrypt==4.0.1       # 密码哈希，继续使用
requests==2.31.0    # HTTP 请求（其他服务使用）
python-dotenv==1.0.0  # 环境变量加载
```

---

## 2. 环境变量配置

### 2.1 后端 `.env` 文件变更

**移除的变量：**
```
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_BUCKET=...
AUTH_MODE=...
```

**新增的变量：**
```
# 数据库配置
DATABASE_URL=postgresql+asyncpg://ecliptrix:ecliptrix@localhost:5432/ecliptrix

# 或者使用分项配置（二选一）
# DB_HOST=localhost
# DB_PORT=5432
# DB_NAME=ecliptrix
# DB_USER=ecliptrix
# DB_PASSWORD=ecliptrix

# 存储配置
STORAGE_ROOT=static/uploads
STORAGE_MAX_FILE_SIZE=524288000

# 管理员配置（重命名）
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
```

**保留不变的变量（重命名）：**
```
LOCAL_ADMIN_USERNAME → ADMIN_USERNAME
LOCAL_ADMIN_PASSWORD → ADMIN_PASSWORD
ENVIRONMENT → 保留用于其他用途，不再关联 Supabase
```

### 2.2 `env.template` 更新

更新模板文件，反映新的变量列表：

```
# ============================================
# Ecliptrix Backend Configuration
# ============================================

# Database Configuration
DATABASE_URL=postgresql+asyncpg://ecliptrix:ecliptrix@localhost:5432/ecliptrix

# Storage Configuration
STORAGE_ROOT=static/uploads
STORAGE_MAX_FILE_SIZE=524288000

# Admin Configuration
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin

# LLM Configuration
LLM_API_KEY=your_llm_api_key
LLM_API_URL=your_llm_api_url
LLM_MODEL=deepseek-v3

# ... 其余 LLM / TTS / PEXELS 等配置保持不变 ...
```

### 2.3 `env-config/` 目录下的 .env 文件

检查并更新 `env-config/haowang-cloud/.env` 和 `env-config/local-kt/.env`，移除 Supabase 变量，添加数据库变量。

### 2.4 前端 `.env.local` 无需变更

前端的 `NEXT_PUBLIC_BACKEND_URL` 保持不变，前端不直接连接数据库。

---

## 3. 测试策略

### 3.1 删除的测试文件

移除所有 supabase 相关测试：
- `tests/test_supabase_service.py`
- `tests/test_supabase_router.py`
- `tests/test_supabase_video_upload.py`
- `tests/test_supabase_retry.py`
- `tests/test_supabase_url_fix.py`
- `tests/test_signed_url_fix.py`
- `tests/test_session_service.py`（需要重写）

### 3.2 新建的测试文件

#### `tests/test_database.py` — 数据库基础设施测试

```
测试用例:
- test_database_connection: 验证数据库连接正常
- test_create_tables: 验证 create_all() 建表成功
- test_session_factory: 验证会话工厂创建和关闭
- test_get_db_session: 验证依赖注入的会话可用
- test_session_commit_rollback: 验证事务提交和回滚
```

#### `tests/test_storage_service.py` — 存储服务测试

```
测试用例:
- test_upload_file: 上传文件并验证存储路径
- test_upload_audio_file: 音频上传功能
- test_upload_video_file: 视频上传（不含缩略图）
- test_upload_video_with_thumbnail: 视频上传含缩略图生成
- test_delete_file: 文件删除功能
- test_list_user_materials: 用户素材列表
- test_list_materials_pagination: 分页功能
- test_list_materials_type_filter: 类型筛选
- test_path_traversal_prevention: 路径遍历攻击防护
- test_file_size_limit: 文件大小限制
- test_sanitize_filename: 文件名安全处理
- test_storage_health_check: 健康检查
```

#### `tests/test_storage_router.py` — 存储路由测试

```
测试用例:
- test_upload_audio_endpoint: POST /api/storage/upload-audio
- test_upload_file_endpoint: POST /api/storage/upload-file
- test_upload_video_endpoint: POST /api/storage/upload-video
- test_user_materials_endpoint: GET /api/storage/user-materials
- test_health_endpoint: GET /api/storage/health
- test_upload_invalid_file_type: 无效文件类型拒绝
- test_upload_oversized_file: 超大文件拒绝
```

#### `tests/test_auth_service.py` — 认证服务测试

```
测试用例:
- test_authenticate_user_success: 正确凭据认证成功
- test_authenticate_user_wrong_password: 密码错误
- test_authenticate_user_nonexistent: 用户不存在
- test_authenticate_user_disabled: 禁用用户
- test_register_user_success: 注册新用户
- test_register_user_duplicate_username: 重复用户名
- test_register_user_duplicate_email: 重复邮箱
- test_get_user_by_id: 按ID获取用户
- test_password_hash_and_verify: 密码哈希与验证
```

#### `tests/test_session_service.py` — 会话服务测试

```
测试用例:
- test_create_session: 创建会话
- test_validate_session_success: 会话验证成功
- test_validate_session_invalid_token: 无效Token
- test_validate_session_expired: 会话过期
- test_invalidate_session: 注销会话
- test_single_device_login: 单设备登录（新登录替代旧会话）
```

#### `tests/test_user_service.py` — 用户服务测试

```
测试用例:
- test_get_user_profile: 获取用户资料
- test_update_user_profile: 更新用户资料
- test_get_all_users: 获取所有用户
- test_create_user: 管理员创建用户
- test_delete_user: 管理员删除用户
```

### 3.3 测试基础设施

使用 SQLite 内存数据库作为测试数据库，避免测试依赖外部 PostgreSQL：

```python
# tests/conftest.py

import pytest
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.models.db_models import Base

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

@pytest.fixture
async def db_session():
    """提供测试用的数据库会话。"""
    engine = create_async_engine(TEST_DATABASE_URL)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, class_=AsyncSession)

    async with session_factory() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()
```

**注意**：需要额外安装 `aiosqlite` 用于测试：
```
# requirements-dev.txt 或 requirements.txt 的 test extras
aiosqlite>=0.19.0
```

---

## 4. 文档更新

### 4.1 删除的文档

- `docs/apis/supabase_upload_file_api.md`
- `docs/apis/supabase_video_upload_api.md`
- `docs/apis/supabase_audio_upload_api.md`
- `docs/apis/supabase_upload_retry_mechanism.md`
- `docs/apis/supabase_url_access_fix.md`
- `docs/apis/supabase_bucket_permissions_guide.md`

### 4.2 新建的文档

#### `docs/apis/storage-api.md`

```markdown
# Storage API 文档

## 概述
本地文件存储服务API，提供文件上传、下载、列表管理功能。

## 端点

### POST /api/storage/upload-video
上传视频文件，自动生成缩略图和提取元数据。

**请求**: multipart/form-data
- file: 视频文件
- user_id: 用户ID
- task_id: 任务ID（可选）

**响应**:
{
    "success": true,
    "file_url": "/api/storage/files/...",
    "thumbnail_url": "/api/storage/files/...",
    "duration": 120.5,
    "width": 1920,
    "height": 1080
}

### POST /api/storage/upload-audio
### POST /api/storage/upload-file
### GET /api/storage/user-materials
### GET /api/storage/health
```

#### `docs/apis/database-setup.md`

```markdown
# 数据库配置指南

## PostgreSQL 安装与配置

### 1. 安装 PostgreSQL
### 2. 创建数据库和用户
### 3. 配置 .env
### 4. 初始化（首次启动自动建表）
### 5. Alembic 迁移管理
```

### 4.3 更新 `README_AUTH.md`

移除所有 Supabase 认证模式的描述，只保留本地认证说明。

### 4.4 更新 `CLAUDE.md`

更新以下内容：
- 移除 `AUTH_MODE` 相关描述
- 更新环境变量列表（移除 SUPABASE_*，新增 DATABASE_URL 等）
- 更新 Architecture 章节中的 Supabase 引用
- 更新 `supabase_service.py` 引用为 `storage_service.py`
- 更新路由列表

---

## 5. 全局清理验证

### 5.1 代码中的 supabase 残留检查

在整个项目中搜索以下关键词，确保无遗漏：

```bash
# 后端搜索
grep -ri "supabase" backend-services/ --include="*.py"
grep -ri "SUPABASE" backend-services/ --include="*.py"
grep -ri "SUPABASE" backend-services/ --include="*.env"

# 前端搜索
grep -ri "supabase" src/ --include="*.ts" --include="*.tsx"
grep -ri "supabase" src/ --include="*.ts" --include="*.tsx"

# 配置搜索
grep -ri "supabase" *.md
grep -ri "supabase" env*
```

### 5.2 预期的搜索结果

搜索后应该只剩下：
- `docs/plans/remove-supabase-dependency/` 中的规划文档（本次生成的）
- Git 历史中的引用（无需处理）
- `__pycache__/` 中的旧编译文件（可清理）

### 5.3 `__pycache__` 清理

删除所有 supabase 相关的 `.pyc` 文件：
```
find . -name "*supabase*" -path "*__pycache__*" -delete
```

---

## 6. `.gitignore` 检查

确认以下内容在 `.gitignore` 中：
```
# 已有的（确认存在）
__pycache__/
*.pyc
.env
static/uploads/     # 新增：用户上传的文件不应提交到 git
```

---

## 7. 部署检查清单

### 7.1 服务器准备

```
1. [ ] 安装 PostgreSQL（版本 >= 13）
2. [ ] 创建数据库: CREATE DATABASE ecliptrix;
3. [ ] 创建用户: CREATE USER ecliptrix WITH PASSWORD 'your_password';
4. [ ] 授权: GRANT ALL PRIVILEGES ON DATABASE ecliptrix TO ecliptrix;
5. [ ] 配置 .env 中的 DATABASE_URL
6. [ ] 确保 static/uploads/ 目录有写入权限
7. [ ] 确保磁盘有足够空间用于文件存储
```

### 7.2 首次启动验证

```
1. [ ] 启动应用: uvicorn app.main:app --host 0.0.0.0 --port 8000
2. [ ] 检查日志：数据库连接成功
3. [ ] 检查日志：表自动创建成功
4. [ ] 检查日志：初始管理员用户创建成功
5. [ ] 访问 /api/storage/health 验证存储服务
6. [ ] 使用管理员凭据登录验证认证服务
7. [ ] 上传测试文件验证存储功能
```

---

## 8. 受影响文件清单（本 Spec）

| 文件 | 操作 | 说明 |
|------|------|------|
| `requirements.txt` | **修改** | 移除4个包，新增4个包 |
| `backend-services/basic-service/.env` | **修改** | 替换环境变量 |
| `env.template` | **修改** | 更新模板 |
| `env-config/**/.env` | **修改** | 更新各环境配置 |
| `tests/test_supabase_*.py` | **删除** | 6个测试文件 |
| `tests/test_session_service.py` | **删除** | 需要重写 |
| `tests/conftest.py` | **新建/修改** | 测试基础设施 |
| `tests/test_database.py` | **新建** | 数据库基础测试 |
| `tests/test_storage_service.py` | **新建** | 存储服务测试 |
| `tests/test_storage_router.py` | **新建** | 存储路由测试 |
| `tests/test_auth_service.py` | **新建** | 认证服务测试 |
| `tests/test_session_service.py` | **新建** | 会话服务测试 |
| `tests/test_user_service.py` | **新建** | 用户服务测试 |
| `docs/apis/supabase_*.md` | **删除** | 6个文档 |
| `docs/apis/storage-api.md` | **新建** | 存储API文档 |
| `docs/apis/database-setup.md` | **新建** | 数据库配置指南 |
| `README_AUTH.md` | **修改** | 移除 Supabase 认证说明 |
| `CLAUDE.md` | **修改** | 更新架构和配置描述 |
