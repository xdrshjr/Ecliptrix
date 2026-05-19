# TODO 08：遥测、Feature Flag 与灰度回滚

> Reference: [`specs/08-telemetry-feature-flag-rollout.md`](../specs/08-telemetry-feature-flag-rollout.md)

## Dependencies

- `depends_on`: [01]
- `blocks`: []
- `parallel_group`: B（flag 远端覆写部分）+ E（灰度上线部分）
- 说明：分两阶段。Flag scaffold（4.1 / 4.2）依赖 spec 01 即可启动，与 spec 02-07 并行；灰度推进（4.3 / 4.4）必须在 spec 01–07 全部完成、验收指标达标后启动。

## Tasks

### 阶段 A：埋点与 Flag scaffold（与 spec 02-07 并行）

- [ ] 新增 `src/components/video/playback/telemetry.ts`：`PlaybackTelemetry` 类（spec 08 §六），支持 `record / count / flushNow / dispose`，自动 5s flush + `beforeunload` 强制 flush
- [ ] 在 PlaybackEngine、CanvasCompositor、PlayheadController、AbBufferController 中注入 telemetry 实例（通过构造参数），自动埋点：click_to_first_frame、seek_to_first_frame、sequence_swap_ms、playhead_regression、stalled_event、canvas_dropped_frame_rate、rate_change、error、proxy_url_used
- [ ] 单测 `telemetry.test.ts`：record / count 入队、5s flush、beforeunload 强制 flush
- [ ] 扩展 `src/lib/playbackFlags.ts`：增加 URL query（仅 dev/staging）+ 远端 `/api/config/playback-flag` 解析逻辑；sessionStorage 缓存 10 分钟
- [ ] 单测 `playbackFlags.remoteOverride.test.ts`：sessionStorage 缓存优先级、URL query 仅 dev/staging 生效
- [ ] 后端：新增 `app/routers/config_router.py`（如不存在）的 `GET /api/config/playback-flag`；输出 `{enabled, rolloutPercent, reason}`；按 `sha256(userId + 'playback_v2') % 100 < rolloutPercent` 计算
- [ ] 后端：环境变量 `PLAYBACK_V2_ROLLOUT_PERCENT`（默认 0）、`PLAYBACK_V2_FORCE_ENABLED_USER_IDS`
- [ ] 后端：新增 `app/routers/telemetry_router.py` 的 `POST /api/telemetry/playback`；接收 batch payload；写结构化日志（不阻塞）；不要求 prometheus
- [ ] 单测 `tests/test_playback_telemetry_endpoint.py`：接受 batch、204 / 200 返回、log 写入
- [ ] 单测 `tests/test_playback_flag_endpoint.py`：rolloutPercent + force-enabled list 行为
- [ ] 新增 `app/routers/admin_router.py`（如不存在）的 `GET /api/admin/playback-proxies?status=&limit=`；用 `Depends(require_admin)`（`app/dependencies/auth.py`）鉴权；返回 `cached_materials` 过滤结果
- [ ] 在 `env.template` 添加 `PLAYBACK_V2_ENABLED`、`PLAYBACK_V2_ROLLOUT_PERCENT`、`PLAYBACK_V2_FORCE_ENABLED_USER_IDS`、`NEXT_PUBLIC_PLAYBACK_V2_ENABLED`

### 阶段 B：灰度上线与回滚（在 spec 01-07 完成后）

- [ ] 准备 `rollout-playbook.md`（路径 `docs/plans/video-editor-playback-optimization/rollout-playbook.md`）：启动 checklist / 监控指标位置 / 灰度推进流程 / 回滚 SOP / 已知 issue / 反馈渠道
- [ ] 内部 dogfood 阶段：`PLAYBACK_V2_FORCE_ENABLED_USER_IDS` 设为内部账号；持续 1 周；验收指标达标
- [ ] 5% canary：`PLAYBACK_V2_ROLLOUT_PERCENT=5`，3 天观察
- [ ] 25% rollout：3 天观察
- [ ] 100% rollout：默认开启；legacy 路径保留至下下个 release
- [ ] 回滚演练：在 staging 模拟"playhead_regression 一日 > 1000"告警 → 把 ROLLOUT_PERCENT 设为 0；验证用户 10 分钟内自然回退
- [ ] 回滚清理：legacy 代码删除（保留至少 2 个发布版本后才能动）
