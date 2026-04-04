# 03 - REST API 端点设计

## 概述

新增 `system_settings_router` 用于功能配置的 CRUD，同时重构 `model_settings_router` 适配 UUID 主键。

## 系统设置 API

### Router: `app/routers/system_settings_router.py`

**前缀:** `/api/system-settings`

#### GET /system-settings/categories

获取所有可用的配置类别列表。

```
Response: {
  "success": true,
  "categories": [
    {"name": "tts", "label": "TTS 语音合成", "description": "批量TTS并发、重试、声音列表配置"},
    {"name": "youtube", "label": "YouTube", "description": "下载/上传/质量配置"},
    {"name": "upload", "label": "文件上传", "description": "上传并发、大小限制、缩略图配置"},
    {"name": "watermark", "label": "水印移除", "description": "水印移除并发和日志配置"},
    {"name": "video_analysis", "label": "视频分析", "description": "队列、VLM、帧提取配置"}
  ]
}
```

#### GET /system-settings/{category}

获取某个类别下的全部设置。

```
Response: {
  "success": true,
  "category": "tts",
  "settings": [
    {
      "key": "concurrency",
      "value": {"concurrent_threads": 3, "max_concurrent_threads": 10, ...},
      "default_value": {"concurrent_threads": 3, ...},
      "value_type": "object",
      "description": "TTS 并发线程数配置",
      "updated_at": "2026-03-23T10:00:00Z",
      "updated_by": "admin"
    },
    {
      "key": "voices",
      "value": [{...}, {...}],
      "default_value": [{...}, {...}],
      "value_type": "array",
      "description": "TTS 声音列表",
      "updated_at": "2026-03-23T10:00:00Z",
      "updated_by": "admin"
    }
  ]
}
```

#### PUT /system-settings/{category}/{key}

更新单个设置项。

```
Request: {
  "value": {"concurrent_threads": 5, "max_concurrent_threads": 15, ...}
}

Response: {
  "success": true,
  "message": "Setting updated",
  "setting": { ...完整 setting 对象... }
}
```

**注意:** 需要从请求中获取当前用户的 username，用于 `updated_by` 和审计日志。

#### PUT /system-settings/{category}

批量更新某类别的多个设置。

```
Request: {
  "settings": {
    "concurrency": {"concurrent_threads": 5, ...},
    "retry": {"max_attempts": 5, ...}
  }
}

Response: {
  "success": true,
  "message": "Updated 2 settings in tts",
  "settings": [...]
}
```

#### POST /system-settings/{category}/reset

恢复某类别到默认值。

```
Response: {
  "success": true,
  "message": "Category tts reset to defaults",
  "settings": [...]
}
```

#### POST /system-settings/reset-all

恢复全部设置到默认值。

```
Response: {
  "success": true,
  "message": "All settings reset to defaults"
}
```

#### GET /system-settings/audit-log

查询审计日志（可选参数：category, limit, offset）。

```
Query Params: ?category=tts&limit=50&offset=0

Response: {
  "success": true,
  "logs": [
    {
      "id": "...",
      "setting_type": "system_setting",
      "category": "tts",
      "key": "concurrency",
      "action": "update",
      "changed_by": "admin",
      "changed_at": "2026-03-23T10:00:00Z"
    }
  ],
  "total": 120
}
```

## 模型设置 API 变更

### 现有 `model_settings_router.py` 的变更

**URL 不变**，只有参数类型改变：

| 端点 | 变更 |
|------|------|
| `PUT /providers/{provider_id}` | `provider_id` 类型从 `int` 改为 `str` (UUID) |
| `DELETE /providers/{provider_id}` | 同上 |
| `POST /providers/{provider_id}/fetch-models` | 同上 |
| `ModelProviderResponse.id` | 从 `int` 改为 `str` |
| `ModelAssignmentRequest.provider_id` | 从 `int` 改为 `str` |

**新增端点：**

无。模型设置的 CRUD 和 resolve 逻辑保持原样。

## Pydantic 模型

### 新增到 `app/models/system_settings_models.py`

```
class SettingsCategoryInfo(BaseModel):
    name: str
    label: str
    description: str

class SystemSettingResponse(BaseModel):
    key: str
    value: Any
    default_value: Any
    value_type: str
    description: Optional[str]
    updated_at: Optional[str]
    updated_by: Optional[str]

class CategorySettingsResponse(BaseModel):
    success: bool
    category: str
    settings: List[SystemSettingResponse]

class UpdateSettingRequest(BaseModel):
    value: Any

class BatchUpdateSettingsRequest(BaseModel):
    settings: Dict[str, Any]

class AuditLogEntry(BaseModel):
    id: str
    setting_type: str
    category: Optional[str]
    key: Optional[str]
    action: str
    changed_by: Optional[str]
    changed_at: str

class AuditLogResponse(BaseModel):
    success: bool
    logs: List[AuditLogEntry]
    total: int
```

## 认证与权限

所有系统设置 API 需要管理员权限。使用现有的认证机制：

```
从请求 header 中获取 session token -> 查询 User 表验证 -> 检查 is_admin 或 is_root
```

具体实现：创建一个 FastAPI 依赖 `get_admin_user`，注入到所有 system_settings 端点。
