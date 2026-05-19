# TODO 06：后端低清预览代理转码

> Reference: [`specs/06-backend-preview-proxy-transcode.md`](../specs/06-backend-preview-proxy-transcode.md)

## Dependencies

- `depends_on`: [05]
- `blocks`: [07]
- `parallel_group`: C
- 说明：Phase 2 推荐项。依赖 spec 05 的 `cached_materials` 入库与字段命名约定；被 spec 07 的预览策略消费。可以与 spec 04 在后端开发上并行（无代码冲突），但端到端验证需要 05 上线。

## Tasks

- [ ] 写 `backend-services/basic-service/config/preview-proxy-config.yaml`（spec 06 §五）；启用 ffmpeg 路径校验
- [ ] 在 `app/config.py` 中加载新 YAML，提供 typed config 对象
- [ ] 新增 `app/routers/preview_proxy_router.py`，注册到 `app/main.py`，挂载到 `/api/media/preview-proxy`
- [ ] 新增 `app/services/preview_proxy_service.py`：transcode 任务封装；接口 `ensure_or_enqueue(material_id, profile)` / `get_status(material_id)`
- [ ] 实现 ffmpeg 子进程 wrapper：参数严格按 spec 06 §4.2（baseline、CRF 28、maxrate 1200k、movflags +empty_moov+frag_keyframe+default_base_moof、frag_duration 1000000、-g 60 -sc_threshold 0、AAC 96k）
- [ ] 集成 `-progress pipe:1`：每秒解析 `out_time_ms` / `progress`，更新 `cached_materials.preview_proxy_progress`
- [ ] 使用现有 `QueueManager` 创建专用 transcode 队列，并发上限 `max_concurrent_transcode=2`，单任务超时 600s
- [ ] 实现失败重试一次；二次失败标记 `preview_proxy_status=failed` 并记录 `preview_proxy_last_error`
- [ ] 输出本地：`static/uploads/preview-proxies/<material_id>/480p.mp4`；OSS 上传到 `preview-proxies/<material_id>/480p.mp4`（仅 `OSS_ENABLED=true` 时）
- [ ] 实现幂等：`(material_id, profile)` 已 `cached` → 直接返回，无需再转
- [ ] 扩展 `app/routers/material_router.py` 的 lookup/ingest 响应序列化：把 `preview_proxy_status/local_url/oss_url/progress` 与 spec 05 的 `proxy_status` 一并返回（spec 06 §6.1）；前端 store 与 `selectPlaybackUrl` 依赖此字段映射
- [ ] Alembic 迁移：为 `cached_materials` 加全部 `preview_proxy_*` 字段（spec 06 §六）
- [ ] 实现 `POST /api/media/preview-proxy`：返回 202 + task_id + status
- [ ] 实现 `GET /api/media/preview-proxy/status?material_id=...&profile=...`
- [ ] 实现 `GET /api/media/preview-proxy/file?material_id=...`：301/302 → `preview_proxy_local_url`，未生成 → 404 `preview_proxy.not_ready`
- [ ] 单测 `tests/test_preview_proxy_service.py`：mock ffmpeg subprocess，验证成功路径、进度解析、失败重试、幂等
- [ ] 单测 `tests/test_preview_proxy_router.py`：202 提交 → status → file 三态
- [ ] 端到端手测（CI 可选）：真实 ffmpeg 转 1080p 小样本 → 输出 480p 可在 Chrome `<video>` 播放、Range 200/206 工作正常
- [ ] 在 `env.template` 添加 `PREVIEW_PROXY_MAX_CONCURRENT` / `PREVIEW_PROXY_TIMEOUT_SECONDS` / `PREVIEW_PROXY_ENABLED`
