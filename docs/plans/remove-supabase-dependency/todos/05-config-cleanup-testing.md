# TODO 05: 配置清理、依赖更新、测试、文档

> 对应 Spec: `specs/05-config-cleanup-testing.md`

## 依赖最终清理

- [ ] 从 `requirements.txt` 移除 `supabase==2.18.0`
- [ ] 从 `requirements.txt` 移除 `storage3==0.12.1`
- [ ] 从 `requirements.txt` 移除 `postgrest==1.1.1`
- [ ] 从 `requirements.txt` 移除 `supafunc==0.1.0`
- [ ] 确认 `requirements.txt` 中新增的4个包版本无冲突

## config.py 最终清理

- [ ] 删除 `SupabaseConfig` 类定义
- [ ] 从 `Settings` 中移除 `supabase` 字段
- [ ] 从 `get_settings()` 返回值中移除 `supabase=supabase_config`
- [ ] 移除 `AUTH_MODE` 环境变量读取

## 环境配置文件更新

- [ ] 更新 `backend-services/basic-service/.env`：移除 SUPABASE_* 变量，新增 DATABASE_URL 等
- [ ] 更新 `env.template`：移除 SUPABASE_* 模板，新增数据库和存储配置模板
- [ ] 更新 `env-config/haowang-cloud/.env`：移除 SUPABASE_* 变量
- [ ] 更新 `env-config/local-kt/.env`：移除 SUPABASE_* 变量

## 测试 - 删除旧测试

- [ ] 删除 `tests/test_supabase_service.py`
- [ ] 删除 `tests/test_supabase_router.py`
- [ ] 删除 `tests/test_supabase_video_upload.py`
- [ ] 删除 `tests/test_supabase_retry.py`
- [ ] 删除 `tests/test_supabase_url_fix.py`
- [ ] 删除 `tests/test_signed_url_fix.py`
- [ ] 删除旧的 `tests/test_session_service.py`

## 测试 - 基础设施

- [ ] 在 `requirements.txt` 或 dev 依赖中新增 `aiosqlite>=0.19.0`
- [ ] 创建/更新 `tests/conftest.py`：SQLite 内存数据库 fixture

## 测试 - 编写新测试

- [ ] 编写 `tests/test_database.py`（连接、建表、会话管理）
- [ ] 编写 `tests/test_storage_service.py`（上传、删除、列表、安全检查）
- [ ] 编写 `tests/test_storage_router.py`（各端点集成测试）
- [ ] 编写 `tests/test_auth_service.py`（认证、注册、密码验证）
- [ ] 编写 `tests/test_session_service.py`（创建、验证、注销、单设备登录）
- [ ] 编写 `tests/test_user_service.py`（CRUD 操作）

## 文档 - 删除旧文档

- [ ] 删除 `docs/apis/supabase_upload_file_api.md`
- [ ] 删除 `docs/apis/supabase_video_upload_api.md`
- [ ] 删除 `docs/apis/supabase_audio_upload_api.md`
- [ ] 删除 `docs/apis/supabase_upload_retry_mechanism.md`
- [ ] 删除 `docs/apis/supabase_url_access_fix.md`
- [ ] 删除 `docs/apis/supabase_bucket_permissions_guide.md`

## 文档 - 编写新文档

- [ ] 编写 `docs/apis/storage-api.md`（存储API端点文档）
- [ ] 编写 `docs/apis/database-setup.md`（PostgreSQL 安装配置指南）
- [ ] 更新 `README_AUTH.md`：移除 Supabase 认证模式描述
- [ ] 更新 `CLAUDE.md`：更新架构描述、环境变量、文件引用

## 全局清理验证

- [ ] 搜索后端代码中所有 `supabase` 引用（`grep -ri "supabase" backend-services/ --include="*.py"`）
- [ ] 搜索前端代码中所有 `supabase` 引用（`grep -ri "supabase" src/ --include="*.ts" --include="*.tsx"`）
- [ ] 搜索配置文件中的 `SUPABASE` 引用
- [ ] 搜索 Markdown 文档中的 `supabase` 引用（排除 plans/ 目录）
- [ ] 清理 `__pycache__/` 中的 supabase 相关 .pyc 文件
- [ ] 确认 `static/uploads/` 已加入 `.gitignore`

## 部署验证

- [ ] PostgreSQL 数据库已安装并可连接
- [ ] `.env` 中 `DATABASE_URL` 配置正确
- [ ] 启动应用，确认数据库连接成功日志
- [ ] 确认表自动创建成功日志
- [ ] 确认初始管理员用户创建成功日志
- [ ] 访问 `GET /api/storage/health` 返回健康状态
- [ ] 使用管理员凭据 `POST /api/auth/login` 登录成功
- [ ] 上传测试文件 `POST /api/storage/upload-file` 成功
- [ ] 上传测试视频 `POST /api/storage/upload-video` 成功（含缩略图）
- [ ] 查询素材列表 `GET /api/storage/user-materials` 返回正确数据
