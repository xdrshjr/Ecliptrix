# Spec 02: 本地文件存储服务

## 概述

用本地文件系统替代 Supabase Storage，实现文件上传、下载、列表、删除功能。保留现有的目录结构规范、视频缩略图生成逻辑和重试机制。

---

## 1. StorageService (`app/services/storage_service.py`)

### 1.1 职责

替代现有 `supabase_service.py`（1019行），提供：
- 文件上传（音频/视频/图片/通用文件）
- 文件URL生成（本地静态路径）
- 文件删除
- 用户素材列表（分页、按类型筛选）
- 健康检查

### 1.2 初始化

```
class StorageService:
    def __init__(self):
        self.storage_root = Path(settings.storage.root)  # 默认 "static/uploads"
        self.max_file_size = settings.storage.max_file_size  # 默认 500MB

        # 确保根目录存在
        self.storage_root.mkdir(parents=True, exist_ok=True)

        logger.info("StorageService initialized", {
            "storage_root": str(self.storage_root),
            "max_file_size": self.max_file_size
        })
```

### 1.3 目录结构

沿用现有 Supabase Storage 的目录规范：

```
static/uploads/
├── audio/
│   └── {YYYY}/{MM}/{DD}/
│       └── user_{user_id}/
│           └── {task_id}/
│               ├── audio_file.mp3
│               └── audio_file.wav
├── video/
│   └── {YYYY}/{MM}/{DD}/
│       └── user_{user_id}/
│           └── {task_id}/
│               ├── video_file.mp4
│               └── thumb_video_file.jpg
├── images/
│   └── {YYYY}/{MM}/{DD}/
│       └── user_{user_id}/
│           └── image_file.png
└── files/
    └── {YYYY}/{MM}/{DD}/
        └── user_{user_id}/
            └── document.pdf
```

**路径生成伪代码：**
```
def _generate_storage_path(filename, folder, user_id, task_id=None):
    now = datetime.now()
    date_path = f"{now.year}/{now.month:02d}/{now.day:02d}"

    if task_id:
        return f"{folder}/{date_path}/user_{user_id}/{task_id}/{filename}"
    else:
        return f"{folder}/{date_path}/user_{user_id}/{filename}"
```

---

## 2. 核心方法

### 2.1 文件上传

```
async def upload_file(
    file_data: bytes,
    filename: str,
    content_type: str,
    folder: str = "files",       # audio / video / images / files
    user_id: str = "anonymous",
    task_id: str = None,
    custom_path: str = None      # 可选自定义路径
) -> Dict[str, Any]:
    """
    上传文件到本地存储。

    Returns:
        {
            "success": True,
            "file_url": "/api/storage/files/video/2024/01/15/user_123/task_456/video.mp4",
            "file_path": "video/2024/01/15/user_123/task_456/video.mp4",
            "file_size": 1234567,
            "content_type": "video/mp4",
            "filename": "video.mp4"
        }
    """

    伪代码:
    1. 验证文件大小不超过 max_file_size
    2. 生成存储路径（custom_path 或自动生成）
    3. 确保目标目录存在
    4. 使用 aiofiles 异步写入文件
    5. 生成访问 URL（相对路径）
    6. 返回文件信息
```

### 2.2 音频上传（封装）

```
async def upload_audio_file(
    file_data: bytes,
    filename: str,
    content_type: str,
    user_id: str = "anonymous",
    task_id: str = None
) -> Dict[str, Any]:
    """音频文件上传，自动设置 folder="audio"。"""
    return await self.upload_file(
        file_data, filename, content_type,
        folder="audio", user_id=user_id, task_id=task_id
    )
```

### 2.3 视频上传（含缩略图）

```
async def upload_video_file(
    file_data: bytes,
    filename: str,
    content_type: str,
    user_id: str = "anonymous",
    task_id: str = None,
    generate_thumbnail: bool = True
) -> Dict[str, Any]:
    """
    视频文件上传，支持自动生成缩略图。

    Returns:
        {
            "success": True,
            "file_url": "...",
            "thumbnail_url": "...",   # 缩略图URL
            "duration": 120.5,         # 视频时长(秒)
            "width": 1920,
            "height": 1080,
            ...
        }
    """

    伪代码:
    1. 调用 upload_file() 保存视频
    2. 如果 generate_thumbnail:
       a. 用 ffprobe 获取视频元数据（时长、分辨率）
       b. 用 ffmpeg 在视频中点生成缩略图
       c. 保存缩略图到同目录下（thumb_{filename}.jpg）
    3. 返回视频信息 + 缩略图URL + 元数据
```

**缩略图生成（沿用现有 supabase_router.py 中的逻辑）：**
```
# FFmpeg 命令伪代码
ffprobe -v quiet -print_format json -show_format -show_streams {video_path}
# 获取 duration, width, height

midpoint = duration / 2
ffmpeg -ss {midpoint} -i {video_path} -vframes 1 -q:v 2
       -vf scale={max_width}:-1 {thumb_path}
```

### 2.4 文件删除

```
async def delete_file(file_path: str) -> Dict[str, Any]:
    """
    删除指定路径的文件。

    Args:
        file_path: 相对于 storage_root 的路径

    Returns:
        {"success": True, "message": "文件删除成功"}
    """

    伪代码:
    1. 构造完整路径: storage_root / file_path
    2. 安全检查：确保路径在 storage_root 内（防止路径遍历攻击）
    3. 检查文件是否存在
    4. 删除文件
    5. 清理空目录（可选）
```

### 2.5 用户素材列表

```
async def list_user_materials(
    user_id: str,
    material_type: str = None,  # video / audio / image / all
    page: int = 1,
    page_size: int = 20
) -> Dict[str, Any]:
    """
    列出用户的所有素材文件，支持分页和类型筛选。

    Returns:
        {
            "success": True,
            "total": 42,
            "page": 1,
            "page_size": 20,
            "materials": [
                {
                    "filename": "video.mp4",
                    "file_url": "/api/storage/files/...",
                    "thumbnail_url": "/api/storage/files/...",
                    "file_size": 1234567,
                    "content_type": "video/mp4",
                    "material_type": "video",
                    "created_at": "2024-01-15T10:30:00",
                    "duration": 120.5,
                    "width": 1920,
                    "height": 1080
                },
                ...
            ]
        }
    """

    伪代码:
    1. 确定搜索目录：
       - material_type=video → storage_root/video/
       - material_type=audio → storage_root/audio/
       - material_type=image → storage_root/images/
       - material_type=all/None → 搜索所有类型目录
    2. 递归遍历所有包含 user_{user_id} 的子目录
    3. 收集文件信息（名称、大小、类型、修改时间）
    4. 按修改时间倒序排序
    5. 分页返回
```

### 2.6 健康检查

```
def health_check() -> Dict[str, Any]:
    """检查存储服务健康状态。"""

    伪代码:
    1. 检查 storage_root 目录是否存在且可写
    2. 检查可用磁盘空间
    3. 返回健康状态
```

---

## 3. 文件URL生成

### 3.1 URL 格式

替代 Supabase 签名URL，使用 FastAPI 静态文件路由：

```
# Supabase 签名URL（旧）:
https://hlqvzgwmbejiviaekdns.supabase.co/storage/v1/object/sign/bucket/path?token=xxx

# 本地静态URL（新）:
/api/storage/files/{relative_path}
# 示例: /api/storage/files/video/2024/01/15/user_123/task_456/video.mp4
```

### 3.2 URL 生成方法

```
def _get_file_url(relative_path: str) -> str:
    """生成文件的访问URL。"""
    return f"/api/storage/files/{relative_path}"
```

---

## 4. config.py 新增配置

```
class StorageConfig(BaseModel):
    """Local storage configuration."""
    root: str = Field(default="static/uploads", description="Storage root directory")
    max_file_size: int = Field(
        default=524288000,  # 500MB
        description="Maximum file size in bytes"
    )
    allowed_video_types: List[str] = Field(
        default=["video/mp4", "video/quicktime", "video/x-msvideo", "video/webm"],
        description="Allowed video MIME types"
    )
    allowed_audio_types: List[str] = Field(
        default=["audio/mpeg", "audio/wav", "audio/ogg", "audio/webm", "audio/mp4"],
        description="Allowed audio MIME types"
    )
    allowed_image_types: List[str] = Field(
        default=["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"],
        description="Allowed image MIME types"
    )
```

在 `Settings` 中新增：
```
storage: StorageConfig = Field(default_factory=StorageConfig)
```

在 `get_settings()` 中：
```
storage_config = StorageConfig(
    root=os.getenv("STORAGE_ROOT", "static/uploads"),
    max_file_size=int(os.getenv("STORAGE_MAX_FILE_SIZE", "524288000"))
)
```

---

## 5. 安全考虑

### 5.1 路径遍历防护

所有文件操作前必须验证路径安全：

```
def _validate_path(relative_path: str) -> Path:
    """确保路径在 storage_root 内，防止路径遍历攻击。"""
    full_path = (self.storage_root / relative_path).resolve()

    if not str(full_path).startswith(str(self.storage_root.resolve())):
        raise ValueError("非法路径：路径遍历攻击检测")

    return full_path
```

### 5.2 文件名安全处理

```
def _sanitize_filename(filename: str) -> str:
    """清理文件名，移除危险字符。"""
    # 保留字母、数字、点、下划线、连字符
    # 移除路径分隔符和其他特殊字符
    safe_name = re.sub(r'[^\w\-.]', '_', filename)
    return safe_name
```

### 5.3 文件类型验证

```
def _validate_file_type(content_type: str, folder: str) -> bool:
    """验证文件类型是否允许。"""
    if folder == "video":
        return content_type in settings.storage.allowed_video_types
    elif folder == "audio":
        return content_type in settings.storage.allowed_audio_types
    elif folder == "images":
        return content_type in settings.storage.allowed_image_types
    return True  # files 类型不限制
```

---

## 6. 与现有 static/ 目录的关系

### 6.1 现有静态目录保持不变

项目现有的静态文件挂载（`main.py:357-369`）保持不变：
- `/api/audio/generated` → `static/audio/generated`（TTS 生成的音频）
- `/api/audio/subtitles` → `static/audio/subtitles`（字幕文件）
- `/static/timeline_exports` → `static/timeline_exports`（时间线导出）

### 6.2 新增存储文件挂载

在 `main.py` 中新增：
```
# 用户上传素材的静态文件服务
uploads_dir = settings.storage.root  # "static/uploads"
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/api/storage/files", StaticFiles(directory=uploads_dir), name="storage_files")
```

---

## 7. 从 supabase_service.py 迁移的功能对照

| supabase_service.py 方法 | storage_service.py 方法 | 变化说明 |
|---|---|---|
| `upload_file()` | `upload_file()` | Supabase SDK → aiofiles 本地写入 |
| `upload_audio_file()` | `upload_audio_file()` | 同上 |
| `_generate_bucket_path()` | `_generate_storage_path()` | bucket 路径 → 本地路径 |
| `_get_signed_url()` | `_get_file_url()` | 签名URL → 静态文件URL |
| `_get_public_url()` | `_get_file_url()` | 公共URL → 静态文件URL |
| `delete_file()` | `delete_file()` | Supabase SDK → os 文件删除 |
| `list_user_materials()` | `list_user_materials()` | Supabase Storage 列表 → 本地目录遍历 |
| `_create_file_info()` | `_create_file_info()` | 保留相同的输出格式 |
| `health_check()` | `health_check()` | 检查本地存储可用性 |
| 重试逻辑（3次指数退避） | **移除** | 本地写入无需重试 |

---

## 8. 受影响文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `app/services/storage_service.py` | **新建** | 本地文件存储服务 |
| `app/services/supabase_service.py` | **删除** | 被 storage_service 替代 |
| `app/config.py` | **修改** | 新增 StorageConfig |
| `app/main.py` | **修改** | 新增 storage_files 静态挂载 |
| `.env` | **修改** | 新增 STORAGE_ROOT, STORAGE_MAX_FILE_SIZE |
