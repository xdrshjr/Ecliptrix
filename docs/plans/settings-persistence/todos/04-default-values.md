# TODO 04 - 默认值管理与初始化

**对应规格:** `specs/04-default-values.md`

## Dependencies

- `depends_on: [01, 02]` — 需要表结构和 SystemSettingsService
- `blocks: [05]` — 前端面板需要数据库中有默认值才能正常加载
- `parallel_group: C` — 可与 03 并行

**Why:** 默认值初始化是前端面板能正常展示的前提，也是版本更新兼容的关键。

## Tasks

### YAML 映射定义
- [ ] 在 `SystemSettingsService` 中定义 `YAML_TO_DB_MAPPING` 映射表
- [ ] 映射 `batch_tts_config.yaml` 到 tts category（concurrency, retry, logging, limits, voices 共 5 个 key）
- [ ] 映射 `youtube.yaml` 到 youtube category（download, upload, quality, file_management, logging 共 5 个 key）
- [ ] 映射 `upload-config.yaml` 到 upload category（concurrent_upload, file_size_limits, retry, thumbnail, temp_file_management, logging 共 6 个 key）
- [ ] 映射 `watermark_removal_config.yaml` 到 watermark category（removal, logging 共 2 个 key）
- [ ] 映射 `video-analysis-config.yaml` 到 video_analysis category（queue_management, vlm_processing, frame_extraction, performance, temp_files, logging 共 6 个 key）

### 初始化逻辑
- [ ] 实现 `ensure_defaults_seeded()` — 读取 YAML，解析，INSERT ON CONFLICT DO NOTHING
- [ ] 实现 YAML 解析辅助函数 `extract_from_yaml(yaml_data, yaml_path)` — 支持嵌套路径
- [ ] 在 Alembic seed 迁移或 app lifespan 中调用 `ensure_defaults_seeded()`
- [ ] 验证幂等性：多次运行不覆盖已有值

### Settings 同步
- [ ] 实现 `sync_to_settings()` — 将 DB 值同步到 config.py Settings 对象
- [ ] 更新 `app/config.py` 的 `get_settings()` 或 lifespan 中的初始化顺序
- [ ] 验证现有消费方（batch_tts_service, youtube_service 等）能正确获取 DB 中的值

### 恢复默认值
- [ ] 验证 `reset_to_defaults()` 正确将 value 重置为 default_value
- [ ] 验证恢复后缓存和 Settings 对象同步更新
