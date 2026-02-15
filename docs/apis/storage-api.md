# 本地存储服务 API

本地文件存储服务替代了原 Supabase Storage，提供视频、音频、图片等文件的上传、管理和访问功能。

## 端点列表

### POST /api/storage/upload-audio
上传音频文件到本地存储。

**请求参数（multipart/form-data）：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | File | 是 | 音频文件 |
| user_id | string | 否 | 用户 ID，默认 `anonymous` |
| task_id | string | 否 | 关联任务 ID |

**返回：** `FileUploadResponse` - 包含 `file_url`、`file_path`、`file_size`。

---

### POST /api/storage/upload-video
上传视频文件到本地存储，支持自动生成缩略图和提取元数据（需 ffmpeg/ffprobe）。

**请求参数（multipart/form-data）：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | File | 是 | 视频文件 |
| task_id | string | 否 | 关联任务 ID |
| custom_filename | string | 否 | 自定义文件名 |
| generate_thumbnail | bool | 否 | 是否生成缩略图，默认 true |
| user_id | string | 否 | 用户 ID |

**返回：** `VideoUploadResponse` - 包含 `video_url`、`thumbnail_url`、`duration`、`width`、`height`。

---

### POST /api/storage/upload-file
上传任意类型文件到本地存储。

**请求参数（multipart/form-data）：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | File | 是 | 待上传文件 |
| bucket_path | string | 否 | 自定义存储路径 |
| task_id | string | 否 | 关联任务 ID |
| segment_id | string | 否 | 关联片段 ID |
| user_id | string | 否 | 用户 ID |

**返回：** `StorageUploadResponse` - 包含 `file_url`、`file_path`、`file_size`。

---

### GET /api/storage/user-materials
查询用户已上传的素材列表，支持分页和类型过滤。

**请求参数（query）：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| user_id | string | 是 | 用户 ID |
| page | int | 否 | 页码，默认 1 |
| page_size | int | 否 | 每页数量，默认 20 |
| material_type | string | 否 | 素材类型过滤：video / audio / image |

**返回：** 包含 `materials` 数组、`total`、`page`、`total_pages`。

---

### GET /api/storage/health
存储服务健康检查，返回磁盘空间信息。

**返回示例：**
```json
{
  "service": "LocalStorage",
  "status": "healthy",
  "root": "/path/to/static/uploads",
  "disk_total_gb": 100.0,
  "disk_used_gb": 45.3,
  "disk_free_gb": 54.7,
  "message": "Storage service is healthy"
}
```

## 存储路径结构

文件按以下结构存储：
```
static/uploads/
  {folder}/{YYYY}/{MM}/{DD}/user_{user_id}/{task_id}/{filename}
```

其中 `folder` 为 `video`、`audio`、`images` 或 `files`。

## 静态文件访问

已上传的文件通过 `/api/storage/files/{relative_path}` 路径访问（由 FastAPI StaticFiles 挂载提供服务）。
