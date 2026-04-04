# 04 - 默认值管理与初始化

## 概述

YAML 配置文件保留在代码库中，作为"出厂设置"的定义来源。首次安装或版本更新时，新设置项自动以默认值初始化到数据库。

## 默认值来源

| 配置类别 | YAML 文件路径 | 顶层 key |
|---------|-------------|---------|
| `tts` | `config/batch_tts_config.yaml` | `batch_tts` (运行参数) + `voice_types` (声音列表) |
| `youtube` | `config/youtube.yaml` | `download`, `upload`, `quality`, `file_management`, `logging` |
| `upload` | `config/upload-config.yaml` | `concurrent_upload`, `file_size_limits`, `retry`, `thumbnail`, `temp_file_management`, `logging` |
| `watermark` | `config/watermark_removal_config.yaml` | `watermark_removal` (含嵌套 `logging`) |
| `video_analysis` | `config/video-analysis-config.yaml` | `queue_management`, `vlm_processing`, `frame_extraction`, `performance`, `temp_files`, `logging` |

## YAML → DB 映射规则

### 解析逻辑

```
def parse_yaml_to_settings(yaml_data, category) -> List[SettingSeed]:
    """
    将 YAML 的每个顶层 section 映射为一条 system_settings 记录。

    batch_tts_config.yaml:
      batch_tts:
        concurrent_threads: 3        → category='tts', key='concurrency'
        retry:                       → category='tts', key='retry'
          max_attempts: 3
        logging:                     → category='tts', key='logging'
        limits:                      → category='tts', key='limits'
      voice_types:
        volcano:
          voices: [...]              → category='tts', key='voices'
    """
```

### 具体映射表

在 `app/services/system_settings_service.py` 中定义映射：

```
YAML_TO_DB_MAPPING = {
    "tts": {
        "file": "config/batch_tts_config.yaml",
        "mappings": [
            {
                "yaml_path": "batch_tts",
                "key": "concurrency",
                "extract_fields": ["concurrent_threads", "max_concurrent_threads", "request_timeout", "batch_timeout"],
                "value_type": "object",
                "description": "TTS 并发线程与超时配置"
            },
            {
                "yaml_path": "batch_tts.retry",
                "key": "retry",
                "value_type": "object",
                "description": "TTS 重试配置"
            },
            {
                "yaml_path": "batch_tts.logging",
                "key": "logging",
                "value_type": "object",
                "description": "TTS 日志配置"
            },
            {
                "yaml_path": "batch_tts.limits",
                "key": "limits",
                "value_type": "object",
                "description": "TTS 资源限制"
            },
            {
                "yaml_path": "voice_types.volcano.voices",
                "key": "voices",
                "value_type": "array",
                "description": "TTS 可用声音列表"
            },
        ]
    },
    # ... youtube, upload, watermark, video_analysis 类似
}
```

## 初始化与同步逻辑

### 启动时初始化

```
async def ensure_defaults_seeded():
    """
    在 app lifespan 启动时调用。
    对每个 YAML 映射：
    1. 检查 DB 中是否已有该 (category, key)
    2. 如果没有 -> INSERT 默认值
    3. 如果已有 -> 不覆盖（保留用户配置）
    4. 新增项 -> INSERT（版本更新场景）
    """
    for category, config in YAML_TO_DB_MAPPING.items():
        yaml_data = load_yaml(config["file"])
        for mapping in config["mappings"]:
            default_value = extract_from_yaml(yaml_data, mapping["yaml_path"])

            # Upsert: 只在不存在时插入
            await upsert_if_not_exists(
                category=category,
                key=mapping["key"],
                value=default_value,          # 首次：value = default_value
                default_value=default_value,   # 总是更新 default_value（反映最新 YAML）
                value_type=mapping["value_type"],
                description=mapping["description"],
            )
```

### 版本更新行为

| 场景 | 行为 |
|------|------|
| 新安装 | 所有设置 value = default_value |
| 更新，设置已存在 | 保留 value 不变，更新 default_value（如 YAML 中默认值改了） |
| 更新，新增了设置项 | INSERT 新行，value = default_value |
| 更新，删除了设置项 | 保留 DB 中的行不删除（向后兼容） |

### Alembic 迁移中的 seed 脚本

```
# alembic/versions/xxxx_seed_default_settings.py
def upgrade():
    # 读取 YAML 文件，解析默认值，批量 INSERT
    # 使用 ON CONFLICT (category, key) DO UPDATE SET default_value = excluded.default_value
    # 这样 default_value 始终跟随代码版本，value 不受影响
```

## 恢复默认值

### 按类别恢复

```
async def reset_to_defaults(category: str, updated_by: str):
    """
    UPDATE system_settings
    SET value = default_value, updated_at = now(), updated_by = ?
    WHERE category = ?
    """
    # 然后刷新缓存 + 同步到 Settings 对象
```

### 全部恢复

```
async def reset_all_to_defaults(updated_by: str):
    """
    UPDATE system_settings
    SET value = default_value, updated_at = now(), updated_by = ?
    """
```

## YAML 文件保留策略

- YAML 文件 **保留在代码库中**，不删除
- 角色从 "运行时配置源" 变为 "默认值定义"
- `config.py` 中的 `get_settings()` 不再直接从 YAML 读取运行时值
- 版本更新时，YAML 文件随代码更新，`ensure_defaults_seeded()` 会把新默认值同步到 DB
