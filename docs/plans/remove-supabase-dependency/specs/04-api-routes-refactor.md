# Spec 04: API 路由重组 + 前端适配

## 概述

重组后端路由（将 supabase_router 替换为 storage_router），更新前端 Next.js API 代理路由和 API 客户端，确保所有 "supabase" 命名被消除。

---

## 1. 后端路由变更

### 1.1 新建 `app/routers/storage_router.py`

替代 `supabase_router.py`（665行），保留所有上传/列表/健康检查功能。

**路由映射：**

| 旧路由 | 新路由 | 方法 | 说明 |
|--------|--------|------|------|
| `POST /api/supabase/upload-audio` | `POST /api/storage/upload-audio` | POST | 音频上传 |
| `POST /api/supabase/upload-file` | `POST /api/storage/upload-file` | POST | 通用文件上传 |
| `POST /api/supabase/upload-video` | `POST /api/storage/upload-video` | POST | 视频上传（含缩略图） |
| `GET /api/supabase/health` | `GET /api/storage/health` | GET | 存储健康检查 |
| `GET /api/supabase/user-materials` | `GET /api/storage/user-materials` | GET | 用户素材列表 |

**路由前缀：**
```python
router = APIRouter(prefix="/storage", tags=["Storage"])
```

### 1.2 storage_router.py 结构

```
# app/routers/storage_router.py

from app.services.storage_service import storage_service

router = APIRouter(prefix="/storage", tags=["Storage"])

@router.post("/upload-audio")
async def upload_audio(file: UploadFile, user_id: str = Form(...), task_id: str = Form(None)):
    """上传音频文件。"""
    伪代码:
    1. 读取文件内容
    2. 调用 storage_service.upload_audio_file(...)
    3. 返回上传结果

@router.post("/upload-file")
async def upload_file(file: UploadFile, user_id: str = Form(None), bucket_path: str = Form(None)):
    """上传通用文件。"""
    伪代码:
    1. 确定文件类别（根据 MIME 类型）
    2. 调用 storage_service.upload_file(...)
    3. 返回上传结果

@router.post("/upload-video")
async def upload_video(
    file: UploadFile,
    user_id: str = Form(...),
    task_id: str = Form(None)
):
    """上传视频文件（含缩略图生成和元数据提取）。"""
    伪代码:
    1. 验证文件类型为 video/*
    2. 保存到临时文件
    3. 调用 storage_service.upload_video_file(...)
    4. 清理临时文件
    5. 返回结果（含 thumbnail_url, duration, width, height）

@router.get("/user-materials")
async def get_user_materials(
    user_id: str,
    material_type: str = None,
    page: int = 1,
    page_size: int = 20
):
    """获取用户素材列表。"""
    伪代码:
    1. 调用 storage_service.list_user_materials(...)
    2. 返回分页结果

@router.get("/health")
async def health_check():
    """存储服务健康检查。"""
    return storage_service.health_check()
```

### 1.3 auth_router.py 变更

当前 `auth_router.py` 可能不需要大改，因为它已经通过 `auth_service` 间接使用 Supabase。但路由方法需要注入数据库会话：

```
# Before:
@router.post("/auth/login")
async def login(login_data: UserLogin, request: Request):
    result = await auth_service.authenticate_user(login_data, device_info, ip_address)

# After:
@router.post("/auth/login")
async def login(
    login_data: UserLogin,
    request: Request,
    db: AsyncSession = Depends(get_db_session)
):
    result = await auth_service.authenticate_user(db, login_data, device_info, ip_address)
```

**同样的变更适用于：**
- `POST /api/auth/register`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/refresh-session`

### 1.4 user_router.py 变更

所有路由方法增加 `db: AsyncSession = Depends(get_db_session)`：

```
@router.get("/user/profile/{user_id}")
async def get_profile(user_id: str, db: AsyncSession = Depends(get_db_session)):
    return await user_service.get_user_profile(db, user_id)

@router.put("/user/profile/{user_id}")
async def update_profile(
    user_id: str,
    profile_data: UserProfileUpdate,
    db: AsyncSession = Depends(get_db_session)
):
    return await user_service.update_user_profile(db, user_id, profile_data)

# get_all_users, create_user, delete_user 同理
```

### 1.5 workflow_router.py 变更

工作流路由同样增加数据库会话注入。

### 1.6 main.py 路由注册变更

```python
# 移除:
from app.routers import supabase_router
app.include_router(supabase_router.router, prefix="/api")

# 新增:
from app.routers import storage_router
app.include_router(storage_router.router, prefix="/api")
```

---

## 2. 前端变更

### 2.1 API 客户端重命名

**`src/lib/api/supabase.ts` → `src/lib/api/storage.ts`**

```typescript
// Before (supabase.ts):
export async function uploadVideoToSupabase(request: VideoUploadRequest) {
    const response = await fetch('/api/supabase/upload-video', { ... });
}

export async function uploadFileToSupabase(file, taskId?, bucketPath?) {
    const response = await fetch('/api/supabase/upload-file', { ... });
}

// After (storage.ts):
export async function uploadVideo(request: VideoUploadRequest) {
    const response = await fetch('/api/storage/upload-video', { ... });
}

export async function uploadFile(file, taskId?, bucketPath?) {
    const response = await fetch('/api/storage/upload-file', { ... });
}
```

**函数重命名对照：**

| 旧函数名 | 新函数名 |
|-----------|----------|
| `uploadVideoToSupabase` | `uploadVideo` |
| `uploadFileToSupabase` | `uploadFile` |
| `downloadFileFromUrl` | `downloadFile` |

### 2.2 Next.js API 代理路由重命名

**目录变更：**
```
src/app/api/supabase/           → src/app/api/storage/
├── upload-video/route.ts       → upload-video/route.ts
├── upload-file/route.ts        → upload-file/route.ts
└── user-materials/route.ts     → user-materials/route.ts
```

**route.ts 内部的后端 URL 更新：**

```typescript
// Before:
const backendUrl = `${BACKEND_URL}/api/supabase/upload-video`;

// After:
const backendUrl = `${BACKEND_URL}/api/storage/upload-video`;
```

### 2.3 Hooks 更新

**`src/components/video/hooks/useAICreation.ts`**

```typescript
// Before:
import { uploadVideoToSupabase, uploadFileToSupabase } from '@/lib/api/supabase';

// After:
import { uploadVideo, uploadFile } from '@/lib/api/storage';
```

所有调用处更新函数名：
```typescript
// Before:
const result = await uploadVideoToSupabase({ ... });
const fileResult = await uploadFileToSupabase(file, taskId);

// After:
const result = await uploadVideo({ ... });
const fileResult = await uploadFile(file, taskId);
```

**`src/components/video/hooks/useAIVideoGeneration.ts`**

同样的 import 和调用更新。

### 2.4 全局搜索替换

在整个前端代码中搜索以下关键词，确保无遗漏：

```
搜索词                          → 替换为
"supabase"                     → 检查每个出现处
"/api/supabase/"               → "/api/storage/"
"uploadVideoToSupabase"        → "uploadVideo"
"uploadFileToSupabase"         → "uploadFile"
"@/lib/api/supabase"           → "@/lib/api/storage"
```

---

## 3. Pydantic 模型变更

### 3.1 新建 `app/models/storage_models.py`

从 `supabase_models.py` 迁移通用模型并重命名：

```
# app/models/storage_models.py

class FileUploadResponse(BaseModel):
    """文件上传响应模型。"""
    success: bool
    file_url: str
    file_path: str
    file_size: int
    content_type: str
    filename: str

class VideoUploadResponse(FileUploadResponse):
    """视频上传响应模型。"""
    thumbnail_url: Optional[str] = None
    duration: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None

class MaterialItem(BaseModel):
    """素材项模型。"""
    filename: str
    file_url: str
    thumbnail_url: Optional[str] = None
    file_size: int
    content_type: str
    material_type: str  # video / audio / image
    created_at: str
    duration: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None

class UserMaterialsResponse(BaseModel):
    """用户素材列表响应模型。"""
    success: bool
    total: int
    page: int
    page_size: int
    materials: List[MaterialItem]
```

### 3.2 更新 `app/models/__init__.py`

移除 supabase_models 的导入，新增 storage_models 的导出。

---

## 4. 其他引用 supabase 的文件检查

### 4.1 可能引用 supabase API 的前端组件

需要检查并更新的组件（搜索 `supabase` 关键词）：

- `src/components/video/hooks/useMaterialManagement.ts`
- `src/components/video/MaterialsPanel.tsx`（或类似素材面板组件）
- `src/components/video/hooks/useVideoUpload.ts`（如果存在）
- 其他可能直接引用 `/api/supabase/` 路径的组件

### 4.2 后端其他引用

检查所有 router 和 service 文件中是否有对 `supabase_service` 的直接引用：

```
# 可能的引用位置
from app.services.supabase_service import supabase_service
# → 替换为
from app.services.storage_service import storage_service
```

---

## 5. 响应格式兼容性

### 5.1 文件URL格式变更

前端接收到的文件URL格式将变化：

```
# Before (Supabase):
{
    "file_url": "https://xxx.supabase.co/storage/v1/object/sign/bucket/path?token=xxx",
    "public_url": "https://xxx.supabase.co/storage/v1/object/public/bucket/path"
}

# After (Local):
{
    "file_url": "/api/storage/files/video/2024/01/15/user_123/task_456/video.mp4"
}
```

**前端需确保：**
1. 视频播放器能处理相对路径URL
2. 图片显示能处理相对路径URL
3. 下载功能能处理相对路径URL

### 5.2 缩略图URL格式

```
# Before:
"thumbnail_url": "https://xxx.supabase.co/storage/v1/.../thumb_video.jpg?token=xxx"

# After:
"thumbnail_url": "/api/storage/files/video/2024/01/15/user_123/task_456/thumb_video.jpg"
```

---

## 6. 受影响文件清单

### 后端

| 文件 | 操作 | 说明 |
|------|------|------|
| `app/routers/storage_router.py` | **新建** | 替代 supabase_router.py |
| `app/routers/supabase_router.py` | **删除** | 被 storage_router 替代 |
| `app/models/storage_models.py` | **新建** | 替代 supabase_models.py |
| `app/models/supabase_models.py` | **删除** | 内容迁移到 storage_models |
| `app/models/__init__.py` | **修改** | 更新导出 |
| `app/routers/__init__.py` | **修改** | 更新导出 |
| `app/routers/auth_router.py` | **修改** | 增加 db 依赖注入 |
| `app/routers/user_router.py` | **修改** | 增加 db 依赖注入 |
| `app/routers/workflow_router.py` | **修改** | 增加 db 依赖注入 |
| `app/main.py` | **修改** | 替换 supabase_router → storage_router |

### 前端

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/lib/api/storage.ts` | **新建** | 替代 supabase.ts |
| `src/lib/api/supabase.ts` | **删除** | 被 storage.ts 替代 |
| `src/app/api/storage/upload-video/route.ts` | **新建** | 替代 supabase 代理 |
| `src/app/api/storage/upload-file/route.ts` | **新建** | 替代 supabase 代理 |
| `src/app/api/storage/user-materials/route.ts` | **新建** | 替代 supabase 代理 |
| `src/app/api/supabase/` | **删除** | 整个目录 |
| `src/components/video/hooks/useAICreation.ts` | **修改** | 更新 import 和函数调用 |
| `src/components/video/hooks/useAIVideoGeneration.ts` | **修改** | 更新 import 和函数调用 |
| 其他引用 supabase API 的组件 | **修改** | 更新路径和函数名 |
