# TODO 04: API 路由重组 + 前端适配

> 对应 Spec: `specs/04-api-routes-refactor.md`

## 后端路由 - 新建

- [ ] 新建 `app/routers/storage_router.py`
- [ ] 定义路由前缀 `/storage`
- [ ] 实现 `POST /upload-audio` 端点
- [ ] 实现 `POST /upload-file` 端点
- [ ] 实现 `POST /upload-video` 端点（含临时文件管理和缩略图逻辑）
- [ ] 实现 `GET /user-materials` 端点（支持 user_id, material_type, page, page_size 参数）
- [ ] 实现 `GET /health` 端点
- [ ] 从 `storage_service` 导入全局单例

## 后端路由 - 修改

- [ ] `auth_router.py`：所有路由方法增加 `db: AsyncSession = Depends(get_db_session)`
  - [ ] `POST /auth/login`：传递 db 给 auth_service.authenticate_user
  - [ ] `POST /auth/register`：传递 db 给 auth_service.register_user
  - [ ] `POST /auth/logout`：传递 db 给 session_service.invalidate_session
  - [ ] `GET /auth/me`：传递 db 给 auth_service.get_user_by_id
  - [ ] `POST /auth/refresh-session`：传递 db 给 session_service.validate_session
- [ ] `user_router.py`：所有路由方法增加 `db: AsyncSession = Depends(get_db_session)`
  - [ ] `GET /user/profile/{user_id}`
  - [ ] `PUT /user/profile/{user_id}`
  - [ ] `GET /user/all`（管理员用）
  - [ ] `POST /user/create`（管理员用）
  - [ ] `DELETE /user/{user_id}`（管理员用）
- [ ] `workflow_router.py`：所有涉及数据库的路由方法增加 db 依赖注入

## 后端路由 - 注册变更

- [ ] `main.py`：移除 `from app.routers import supabase_router` 和 `app.include_router(supabase_router.router, prefix="/api")`
- [ ] `main.py`：新增 `from app.routers import storage_router` 和 `app.include_router(storage_router.router, prefix="/api")`
- [ ] `app/routers/__init__.py`：更新导出（移除 supabase_router，新增 storage_router）

## 后端模型变更

- [ ] 新建 `app/models/storage_models.py`（从 supabase_models.py 迁移并重命名）
  - [ ] `FileUploadResponse`
  - [ ] `VideoUploadResponse`
  - [ ] `MaterialItem`
  - [ ] `UserMaterialsResponse`
- [ ] 更新 `app/models/__init__.py`：移除 supabase_models 导入，新增 storage_models

## 后端清理

- [ ] 删除 `app/routers/supabase_router.py`
- [ ] 删除 `app/models/supabase_models.py`
- [ ] 删除 `app/services/supabase_service.py`

## 前端 - API 客户端

- [ ] 新建 `src/lib/api/storage.ts`（从 supabase.ts 迁移）
- [ ] 重命名函数：`uploadVideoToSupabase` → `uploadVideo`
- [ ] 重命名函数：`uploadFileToSupabase` → `uploadFile`
- [ ] 重命名函数：`downloadFileFromUrl` → `downloadFile`
- [ ] 更新所有 fetch URL：`/api/supabase/` → `/api/storage/`
- [ ] 删除 `src/lib/api/supabase.ts`

## 前端 - Next.js API 代理路由

- [ ] 新建 `src/app/api/storage/upload-video/route.ts`（从 supabase 目录迁移）
  - [ ] 更新后端 URL：`/api/supabase/upload-video` → `/api/storage/upload-video`
- [ ] 新建 `src/app/api/storage/upload-file/route.ts`
  - [ ] 更新后端 URL
- [ ] 新建 `src/app/api/storage/user-materials/route.ts`
  - [ ] 更新后端 URL
- [ ] 删除 `src/app/api/supabase/` 整个目录

## 前端 - Hooks 更新

- [ ] `src/components/video/hooks/useAICreation.ts`
  - [ ] 更新 import：`@/lib/api/supabase` → `@/lib/api/storage`
  - [ ] 更新函数调用：`uploadVideoToSupabase` → `uploadVideo`
  - [ ] 更新函数调用：`uploadFileToSupabase` → `uploadFile`
- [ ] `src/components/video/hooks/useAIVideoGeneration.ts`
  - [ ] 更新 import 和函数调用
- [ ] 全局搜索 `supabase` 关键词，检查是否有其他组件引用

## 前端 - URL 格式适配

- [ ] 确认视频播放器组件能处理相对路径 URL（`/api/storage/files/...`）
- [ ] 确认图片组件能处理相对路径 URL
- [ ] 确认下载功能能处理相对路径 URL
