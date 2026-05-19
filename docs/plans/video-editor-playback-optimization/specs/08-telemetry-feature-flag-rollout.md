# Spec 08：遥测、Feature Flag 与灰度回滚

> 关联：[`master-plan.md`](../master-plan.md)、所有 spec 01–07
> 阶段：Phase 1（必做）
> 状态：草案

## 一、目的（Purpose）

为整套 v2 播放栈提供：

1. **关键指标遥测**：首帧时间、sequence 切换耗时、playhead 单调写入、stalled 事件、转码耗时、代理缓存命中率等，让"验收指标可被验证、问题可追溯"。
2. **Feature flag 灰度**：用户/环境级开关 `PLAYBACK_V2_ENABLED`，秒级切换。
3. **回滚预案**：明确回滚触发条件、操作步骤、数据兼容性。
4. **运维仪表盘**：把后端转码与代理任务以表格 / JSON 形式暴露给运维查询。

## 二、范围

### 范围内

- 前端遥测埋点 SDK：`src/components/video/playback/telemetry.ts`，挂接到现有日志栈（`VideoEditingLogger`）。
- 后端遥测落地：`/api/telemetry/playback`（接收前端上报）+ 内部计数器写 Prometheus（如已有）/ 本地结构化日志。
- Feature flag 工具：`src/lib/playbackFlags.ts`（spec 01 引入，本 spec 扩展为支持远端配置覆写）。
- 后端 Feature flag：`PLAYBACK_V2_ENABLED` 环境变量，转码 / 代理端点本身始终可用（不依赖 flag），但前端不上报时后端可关闭统计任务。
- 仪表盘只读端点：
  - `GET /api/admin/playback-proxies?status=running&limit=...`（运维查询，需 admin token）。
- 文档：`docs/plans/video-editor-playback-optimization/rollout-playbook.md`（本 spec 落地时同步交付，但非本规划包含项；本 spec 给出大纲）。

### 范围外

- 真实 APM / Sentry 接入（项目暂未明示，按既有日志栈兜底）。
- 业务级 A/B 实验框架（按用户分桶）—— 首期用 `localStorage` + env 即可。

## 三、遥测指标

### 3.1 前端指标

| 名称 | 类型 | 触发点 | 描述 |
|------|------|--------|------|
| `playback.click_to_first_frame_ms` | histogram | `intent.play` → 首次 `drawFrame` 完成 | P50/P95，验收指标 |
| `playback.seek_to_first_frame_ms` | histogram | `intent.seek` → `seeked` + 首次 `drawFrame` | 验收指标 |
| `playback.sequence_swap_ms` | histogram | boundary 进入 → `setActiveSource` | 目标 < 16ms |
| `playback.playhead_regression` | counter | `PlayheadController` 检测到 `t < last_reported - epsilon` 时（**虽然被丢弃**，但计数） | 期望长期 0 |
| `playback.stalled_event` | counter | `phase → stalled` | 关注上升趋势 |
| `playback.canvas_dropped_frame_rate` | gauge | 每 1s `droppedFrames/drawnFrames` | < 1% 视为正常 |
| `playback.rate_change` | counter | 速率切换次数 | 行为分析 |
| `playback.error` | counter | engine error 事件 | 与 stalled 区分；带 `code` 标签 |
| `playback.proxy_url_used` | counter | bindActive 时 URL 来源（`P1/P2/P3/P4/P5`，定义见 spec 07 §3） | 衡量预览代理覆盖率 |

每条事件附带：`taskId`、`userId`（如可得，否则匿名）、`flagVariant`（`v2|legacy`）、`appVersion`、`ua`。

### 3.2 后端指标

| 名称 | 类型 | 描述 |
|------|------|------|
| `media_proxy.request_total` | counter | by `cache_state` (hit/miss/partial), by `source` (pexels/ark/...) |
| `media_proxy.upstream_latency_ms` | histogram | 首字节延迟 |
| `media_proxy.bytes_total` | counter | 流出字节 |
| `preview_proxy.tasks_queued` | gauge | 当前队列长度 |
| `preview_proxy.transcode_duration_ms` | histogram | ffmpeg 完成时长 |
| `preview_proxy.failure_total` | counter | by `error_code` |

后端通过现有日志记录（CLAUDE.md 中 `logs/app.log`），并提供 prometheus exporter（如未来需要）；本 spec 不强制 prometheus，但要求所有指标以结构化字段（key/value）落日志。

## 四、Feature flag 策略

### 4.1 前端

`isPlaybackV2Enabled()` 解析顺序（spec 01 已奠基，本 spec 收紧）：

1. URL query `?playback=v2` / `?playback=legacy`（仅在 dev / staging 域名生效）。
2. localStorage `ecliptrix-playback-v2 = 'true' | 'false'`。
3. **远端配置覆写**：`/api/config/playback-flag`（GET，返回 `{enabled: boolean, rolloutPercent: number}`）。前端在剪辑器首屏加载一次，结果写 sessionStorage（10 分钟内复用）。
4. `process.env.NEXT_PUBLIC_PLAYBACK_V2_ENABLED`。
5. 默认 `false`。

**优先级**：高 → 低；本地覆写 > 远端 > env。

### 4.2 远端配置（后端）

- `GET /api/config/playback-flag`
  - 输入：用户标识（cookie / Authorization 中提取）。
  - 输出：`{ enabled: boolean, rolloutPercent: number, reason: string }`。
  - 实现：`rolloutPercent`（0–100）+ 用户 ID hash → 决定该用户是否命中。
- 配置来源：环境变量 `PLAYBACK_V2_ROLLOUT_PERCENT`（默认 0）+ `PLAYBACK_V2_FORCE_ENABLED_USER_IDS`（逗号分隔）。

### 4.3 灰度阶段

| 阶段 | rolloutPercent | 适用环境 | 持续时间 | 退出条件 |
|------|---------------:|----------|----------|----------|
| 内部 dogfood | 0%（仅内部账号 force-enabled） | prod | 1 周 | 0 critical bug + 验收指标 P50/P95 达标 |
| 5% canary | 5 | prod | 3 天 | 关键指标无显著恶化（regress count = 0、stalled rate 不高于基线 1.2×） |
| 25% | 25 | prod | 3 天 | 同上 |
| 100% | 100 | prod | — | 默认开启；legacy 路径保留至下下个 release |

### 4.4 回滚

- **回滚触发**（自动告警 + 人工确认）：
  - `playback.playhead_regression` 单日总数 > 1000。
  - `playback.stalled_event` 同比上涨 > 50%（相对前一周基线）。
  - 首帧 P95 > 800ms 持续 > 30 min。
- **回滚操作**：
  1. 把 `PLAYBACK_V2_ROLLOUT_PERCENT` 降到 0（运维 dashboard 一键）。
  2. 不需要前端发版；前端在下次刷新（最长 10 分钟）拿到 enabled=false。
  3. 通过 `?playback=legacy` 可让被影响用户立即生效。
- **数据兼容性**：v2 不修改 timeline `workflow_data` schema；切换不损失编辑内容。

## 五、上报通道

### 5.1 前端 → 后端

- 端点：`POST /api/telemetry/playback`（新增）。
- 频率：批量；每 5 秒 flush 一次 + 页面 `beforeunload` 时强制 flush。
- 体：`{ events: TelemetryEvent[], sessionId, taskId }`。
- 后端：写结构化日志（不阻塞），可选 forward 到 metrics 收集器。

### 5.2 高优先告警

直接调用既有错误通道（`logger.error` + `app.log`）。本 spec 不引入新告警机制。

## 六、`PlaybackTelemetry` SDK

```
// src/components/video/playback/telemetry.ts
class PlaybackTelemetry {
  constructor(deps: {
    flushIntervalMs?: number      // 默认 5000
    endpoint?: string             // 默认 '/api/telemetry/playback'
    sessionId: string             // 由调用方分配
    taskId: string
    flagVariant: 'v2' | 'legacy'
  })

  record(name: string, value: number | undefined, tags?: Record<string, string>): void
  count(name: string, tags?: Record<string, string>): void   // +1
  flushNow(): Promise<void>
  dispose(): void
}
```

PlaybackEngine、Compositor、PlayheadController、AbBufferController 持有同一实例（通过 `PlayerControls` 创建并 props 传入），自动埋点 §3.1 所列指标。

## 七、`/api/admin/playback-proxies` 端点

简单只读运维查询：

```
GET /api/admin/playback-proxies?status=running&limit=100
Authorization: Bearer <session-token>   # 通过 app/dependencies/auth.py::require_admin 校验 is_admin=True
→ 200 {
  success: true,
  data: {
    items: [
      { material_id, profile, status, progress, started_at, bytes, error? },
      ...
    ],
    total: number
  }
}
```

实现：直接读 `cached_materials` 表过滤。

## 八、文档：`rollout-playbook.md`（交付时）

落地时同步交付，不包含在本规划文档中。大纲：

1. 启动 checklist
2. 监控关键指标位置
3. 灰度推进流程
4. 回滚 SOP（含命令）
5. 已知 issue 列表与 workaround
6. 用户反馈渠道

## 九、测试

- `src/components/video/playback/__tests__/telemetry.test.ts`
  - `record / count` 入队
  - flush 间隔触发请求
  - `beforeunload` 强制 flush
- `src/lib/__tests__/playbackFlags.remoteOverride.test.ts`
  - sessionStorage 缓存优先级
  - URL query 仅 dev/staging 生效
- `tests/test_playback_telemetry_endpoint.py`
  - 接受 batch payload，记录日志，返回 204
- `tests/test_playback_flag_endpoint.py`
  - rolloutPercent + force enabled list 行为

## 十、Open Questions

1. **Prometheus / Grafana 接入**：是否纳入本 spec？倾向：作为后续 ops 任务；本 spec 只确保结构化日志可被任何收集器抓。
2. **遥测隐私**：要否对 userId 做哈希后上报？倾向：是；用户密钥 + userId hash，避免日志直接泄露。
3. **/api/admin/playback-proxies 的鉴权**：已确认复用 `app/dependencies/auth.py::require_admin`（`is_admin=True` 通行）。Open Question 已闭环；保留条目作为变更记录。
4. **灰度计算 hash**：用 `sha256(userId + 'playback_v2') mod 100`，固定盐保证用户一直在同一桶。

## 十一、参考

- [`master-plan.md`](../master-plan.md) §2.1（验收指标）、§5（D9）、§7（R5/R6 风险）、§九（阶段划分）
- 既有：`src/components/video/utils/logger.ts`（`VideoEditingLogger`）
- 既有：`backend-services/basic-service/logs/app.log`（结构化日志输出）
