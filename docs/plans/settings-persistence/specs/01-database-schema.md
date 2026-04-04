# 01 - 数据库 Schema 设计

## 概述

将模型设置从 SQLite 迁移到 PostgreSQL，新增系统设置表和审计日志表，全部通过 Alembic 管理。

## ORM 模型定义

### 新增到 `app/models/db_models.py`

#### ModelProvider 表

```
ModelProvider(Base)
  __tablename__ = "model_providers"

  id: UUID (PK, default uuid4)
  name: String(100), unique, not null, indexed
  provider_type: String(50), not null     # 'deepseek', 'openai', 'anthropic' 等
  api_url: String(500), not null
  api_key: Text, not null                 # 加密存储（或明文，与当前 SQLite 一致）
  created_at: DateTime(timezone=True), server_default=func.now()
  updated_at: DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
```

**注意：** PK 从 SQLite 的 INTEGER AUTOINCREMENT 改为 UUID，与项目中其他表一致。现有前端 `provider_id` 类型需要从 `int` 改为 `string`。

#### ModelAssignment 表

```
ModelAssignment(Base)
  __tablename__ = "model_assignments"

  id: UUID (PK, default uuid4)
  function_type: String(30), unique, not null, indexed   # 'chat', 'fast', 'video_cut', 'vision', 'coding'
  provider_id: UUID, ForeignKey("model_providers.id", ondelete="CASCADE"), not null
  model_name: String(200), not null
  temperature: Float, default=0.7
  max_tokens: Integer, default=128000
  updated_at: DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
```

#### SystemSetting 表

```
SystemSetting(Base)
  __tablename__ = "system_settings"

  id: UUID (PK, default uuid4)
  category: String(50), not null, indexed    # 'tts', 'youtube', 'upload', 'watermark', 'video_analysis'
  key: String(100), not null                 # 'concurrency', 'voices', 'retry', etc.
  value: JSONB, not null                     # 实际配置值
  default_value: JSONB, not null             # 出厂默认值（来自 YAML）
  value_type: String(30), default='object'   # schema hint: 'number', 'boolean', 'string', 'object', 'array'
  description: String(500), nullable         # 中英文描述
  updated_at: DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
  updated_by: String(50), nullable           # 修改人 username

  __table_args__ = (
    UniqueConstraint('category', 'key', name='uq_system_settings_category_key'),
  )
```

#### SettingsAuditLog 表

```
SettingsAuditLog(Base)
  __tablename__ = "settings_audit_log"

  id: UUID (PK, default uuid4)
  setting_type: String(30), not null         # 'model_provider', 'model_assignment', 'system_setting'
  category: String(50), nullable             # 对应 system_setting 的 category，或 model_provider/assignment
  key: String(100), nullable                 # 对应具体的 key 或 provider_name
  action: String(20), not null               # 'create', 'update', 'delete', 'reset'
  changed_by: String(50), nullable           # username
  changed_at: DateTime(timezone=True), server_default=func.now()
```

## 存储粒度设计

`system_settings` 的 `category + key` 映射关系：

| category | key | value 示例 | 说明 |
|----------|-----|-----------|------|
| `tts` | `concurrency` | `{"concurrent_threads": 3, "max_concurrent_threads": 10, ...}` | TTS 并发与超时参数 |
| `tts` | `retry` | `{"max_attempts": 3, "delay_seconds": 1, "backoff_factor": 2}` | TTS 重试配置 |
| `tts` | `logging` | `{"enable_detailed_logs": true, ...}` | TTS 日志配置 |
| `tts` | `limits` | `{"max_segments_per_batch": 50, ...}` | TTS 资源限制 |
| `tts` | `voices` | `[{"value": "zh_male_...", "label": "...", "category": "...", ...}, ...]` | 完整声音列表数组 |
| `youtube` | `download` | `{"max_concurrent_downloads": 20, ...}` | YouTube 下载配置 |
| `youtube` | `upload` | `{"upload_timeout": 600, ...}` | YouTube 上传配置 |
| `youtube` | `quality` | `{"default_video_quality": "720p", ...}` | YouTube 质量配置 |
| `youtube` | `file_management` | `{"auto_cleanup": true, ...}` | YouTube 文件管理 |
| `youtube` | `logging` | `{...}` | YouTube 日志配置 |
| `upload` | `concurrent_upload` | `{"max_concurrent_uploads": 3, ...}` | 上传并发配置 |
| `upload` | `file_size_limits` | `{"max_video_size_mb": 500, ...}` | 文件大小限制 |
| `upload` | `retry` | `{...}` | 上传重试配置 |
| `upload` | `thumbnail` | `{...}` | 缩略图配置 |
| `upload` | `temp_file_management` | `{...}` | 临时文件管理 |
| `upload` | `logging` | `{...}` | 上传日志配置 |
| `watermark` | `removal` | `{"concurrent_threads": 5, ...}` | 水印移除主配置 |
| `watermark` | `logging` | `{...}` | 水印日志配置 |
| `video_analysis` | `queue_management` | `{...}` | 视频分析队列配置 |
| `video_analysis` | `vlm_processing` | `{...}` | VLM 处理配置 |
| `video_analysis` | `frame_extraction` | `{...}` | 帧提取配置（含 duration_based_strategy） |
| `video_analysis` | `performance` | `{...}` | 性能配置 |
| `video_analysis` | `temp_files` | `{...}` | 临时文件配置 |
| `video_analysis` | `logging` | `{...}` | 视频分析日志配置 |

## Alembic 迁移

### 迁移文件 1: `add_settings_tables`

```
操作:
1. CREATE TABLE model_providers (UUID PK)
2. CREATE TABLE model_assignments (UUID PK, FK to model_providers)
3. CREATE TABLE system_settings (UUID PK, unique(category, key))
4. CREATE TABLE settings_audit_log (UUID PK)
5. CREATE INDEX on system_settings(category)
6. CREATE INDEX on settings_audit_log(changed_at)
```

### 迁移文件 2: `seed_default_settings`

```
操作:
1. 读取所有 YAML 配置文件
2. 解析每个 section 为 category + key
3. INSERT INTO system_settings (category, key, value, default_value, value_type, description)
   对每个配置项，value = default_value（首次安装时）
4. 使用 op.bulk_insert() 批量插入
```

**幂等性保证：** 使用 `INSERT ... ON CONFLICT (category, key) DO NOTHING`，确保多次运行不会覆盖已有配置。

## 约束与索引

- `model_providers.name` — UNIQUE INDEX
- `model_assignments.function_type` — UNIQUE INDEX
- `system_settings(category, key)` — UNIQUE 复合约束
- `system_settings(category)` — INDEX（按类别查询）
- `settings_audit_log(changed_at)` — INDEX（按时间查询）
- `model_assignments.provider_id` → `model_providers.id` ON DELETE CASCADE
