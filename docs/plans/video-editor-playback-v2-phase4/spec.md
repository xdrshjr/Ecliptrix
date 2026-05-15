# Playback v2 — Phase 4 实施方案（spec.md）

> Topic: `video-editor-playback-v2-phase4`
> 文档版本：**v2（评审后修订，2026-05-16）**
> 上游基线：
> - `docs/plans/video-editor-playback-optimization/master-plan.md` v2
> - `docs/plans/video-editor-playback-optimization/specs/08-telemetry-feature-flag-rollout.md`
> - `docs/plans/video-editor-playback-v2-phase2/spec.md` v2（已落地）
> - `docs/plans/video-editor-playback-v2-phase3/spec.md` v2（已落地，§十二「Round 4 接力清单」）
> 任务节点：本节点（Subtask #0）只产出本设计文档，**不修改任何源码**。

---

## 评审记录（Review Notes）

> 评审执行：Subtask #1（设计评审），against commit `efd7d01` 真实代码状态。
> 严重度：**P0** = 必须修，否则方案不可执行；**P1** = 必须修，否则下游必踩坑；**P2** = 建议修，影响可控。
> **本轮 P0 / P1 已全部就地修复**；P2 列在 §十「实施过程发现的方案缺陷」前置占位区，由 Subtask #2 / #3 自行处置。

### P0（无）

经核对真实代码（`PlaybackEngine.ts`、`CanvasCompositor.ts`、`playbackFlags.ts`、`auth.py::require_admin`、alembic `010 / 011`），方案整体可行，无阻塞性缺陷。

### P1（已就地修复）

| # | 严重度 | 维度 | 描述 | 修复位置 |
|---|--------|------|------|----------|
| R-P1-1 | P1 | Feasibility | 旧文表述「Phase 2 已保留 `_pendingSwapStart` ref / `_lastReportTs` 私有字段」**不属实**：在 `PlaybackEngine.ts` / `CanvasCompositor.ts` grep 该名均无命中。下游若按此实施会陷入「找不到 Phase 2 hook」的盲区。 | §3.2.1 表格全行重写，显式注明「本轮新增私有字段」并给出字段名。 |
| R-P1-2 | P1 | Consistency | 旧 §4.1.1 响应 schema 使用 `status` / `profile` / `progress` / `started_at` / `bytes` 字段，但 `cached_materials` 实际列名为 `preview_proxy_status` / `preview_proxy_profile` / `preview_proxy_progress` / `preview_proxy_bytes`（alembic `011_add_preview_proxy_fields.py`）；status 枚举实际为 `absent / queued / running / cached / failed`（旧文写 `pending` 不存在）；表中**没有 `started_at` 列**，最近时间字段是 `preview_proxy_transcoded_at`（完成时间，非起始时间）。 | §4.1.1 query/响应改用实际列名（API 层做 alias 映射），status 枚举改为真实值；新增「时间字段说明」澄清 `transcoded_at` 语义。 |
| R-P1-3 | P1 | Feasibility | 后端 `README.md` 第 209-210 行已写明生产部署使用 `gunicorn -w 4 -k uvicorn.workers.UvicornWorker`。**进程内 aggregator 在 4 worker 下会把同一 user session 的事件散落到 4 个 worker，`/api/admin/playback-metrics` 返回值只反映 1/4 的真实数据，且 worker 命中是随机的。**G2 验收（1000 条 regression → 端点返回 ≥ 1000）在 `-w 4` 下必然失败。R1 把它标为「中概率」太轻描淡写。 | 新增 §3.2.7「部署约束」并新增 ENV `PLAYBACK_V2_AGGREGATOR_REQUIRES_SINGLE_WORKER=true`；rollout-playbook 必须把 `-w 1` 写入 dogfood checklist；多 worker 路径直接返回 `degraded: true` 并明确禁用 §4.4 阈值告警。 |
| R-P1-4 | P1 | Right-sizing | F14（b）提议新增 localStorage 键 `ecliptrix-playback-v2-killswitch-reason`，但 `playbackFlags.ts` 第 126-133 行的现有实现已经把 reason 编码进唯一键值（`${reason}:${Date.now()}`）。新增第二个键会造成 INV13「单向 / 单一真源」语义破裂。 | F14（b）删除：要求**复用现有键**，仅补足 reason 解析工具（read-only helper），不引入第二条持久化路径。 |
| R-P1-5 | P1 | Completeness | F4 把「event-name 白名单」放在 `telemetry.ts::flushNow` 网络层之前，会出现「新增事件忘了改白名单 → 静默丢失」的隐式 bug；这种 fail-silent 与 INV10「永远不抛」原意冲突——INV10 是「错误不冒泡」，不是「未知事件不入库」。 | F4 改写：白名单从「运行时 startsWith 过滤」改为「**TypeScript 类型常量 `PLAYBACK_EVENT_NAMES`**，记录到一个未声明的名字会触发编译错误」；运行时仅保留向后兼容兜底，并在 `dev` 下 `console.warn` 一次。后端 telemetry_router 收到未声明 metric 时**不丢弃**，而是落 `app.log` 并打 `unknown_metric=true` 标签。 |
| R-P1-6 | P1 | Consistency | F9 在 `selectPlaybackUrl` 内 `effectivePreviewUrl` 调 `hitMeter.recordTier`，**违反**该函数在既有代码注释中明确声明的「纯函数」契约（被 50+ 调用点视作 idempotent）。R4 用 JSDoc 提示是不够的：纯函数副作用一旦被 React `useMemo` / SWR `select` 反复触发，命中率统计会偏差数倍。 | F9 改写：`selectPlaybackUrl` 保持纯；hitMeter 改由 **PlaybackEngine.attachActiveMaterial** 时单点调用一次（每次切素材一次），保证「调用频率 = 实际播放次数」。F2 / R4 同步更新。 |

### P2（已记入 §十 占位区，本轮不强制就地修，留给 Subtask #2/#3 实施时确认）

| # | 严重度 | 维度 | 描述 |
|---|--------|------|------|
| R-P2-1 | P2 | Right-sizing | §5.2 提到「numpy 不可用则手写 sorted index」是冗余分支：`requirements.txt:25` 已 pin `numpy==1.26.4`。fallback 增加测试矩阵且不会被覆盖。建议直接依赖 numpy。 |
| R-P2-2 | P2 | Completeness | §4.1.1 `nextCursor` 用 `material_id`（UUID）做分页游标会出现「同 UUID 不同顺序」歧义；建议用 `(preview_proxy_transcoded_at DESC, material_id DESC)` 复合游标。 |
| R-P2-3 | P2 | Right-sizing | §5.2 `_Counter24h` 长度硬编码 24×60，但 §4.3 提供 `PLAYBACK_V2_TELEMETRY_AGG_RETENTION_HOURS` 让用户调；二者只要不同就内存越界或截断。建议从 settings 派生 maxlen。 |
| R-P2-4 | P2 | Right-sizing | R3 「构建后 grep `.next/static` 验证 PlaybackVariantSwitcher 不在 bundle」依赖 Next.js tree-shaking 在 `process.env.NODE_ENV !== 'production'` 字面量下生效；建议把 switcher 改为 `next/dynamic({ ssr: false, loading: null })` + 早返回 null，bundle 注入更可控。 |
| R-P2-5 | P2 | Completeness | §3.2.4 `KillSwitchMonitor.noteStalled` 阈值是「累计 30 次」还是「30 次 stalled 状态进入」？源代码 `PlaybackEngine` 的 stalled 是状态机短暂状态，单次播放可能进入多次。需明确「单 session 不去重计数」or「按 transition 边沿计数」。 |
| R-P2-6 | P2 | Feasibility | INV11 用 `sha256(userId + 'playback_v2').slice(0,12)`（48 bit）：dogfood < 5 人无碰撞风险，全量灰度 (1M user) 期望碰撞 ≈ 0.13%。短期可接受，长期需扩展到 16 hex。 |
| R-P2-7 | P2 | Consistency | B7 「register admin_playback_router 前缀 `/api`」与 §4.1.1 端点声明 `/api/admin/playback-proxies` 一致，要求 router 内声明路径 `/admin/playback-proxies`；建议在 spec 显式注明，避免下游写成 `/api/api/admin/...`。 |

### 评审统计

- 检查项总数：**13**（P0=0 / P1=6 / P2=7）
- 评审耗时：约 25 分钟（含真实代码核对）
- 评审依据 commit：`efd7d01`
- 评审者：Subtask #1 设计评审节点

---

## 一、概述（Overview）

Playback v2 三大支柱（state machine + canvas compositor + ab-buffer/preview-proxy）在 Round 1–3 已全部入库，对应 commit `4f897eb` / `8828370` / `efd7d01`，前端 513 个 vitest 用例全绿，后端 alembic `010` / `011` 迁移完成。**Round 4 是整个 playback v2 项目的最后一公里**：把已经具备运行能力的 v2 栈推到可观察、可回退、可灰度上线的运维就绪状态，并完成 master-plan §九 Phase 1 的退出标准。

本轮的实施目标可以概括为「让线上灰度推进时不需要再打开 IDE」。具体三件事：

1. **观测面板补齐**：补齐 spec 08 §3.1 / §3.2 列出但 Round 1–3 尚未落地的关键指标（`playback.swap_latency_ms`、`playback.preview_proxy_request`、`playback.preview_proxy_cached_hit_rate`、`playback.cache_memory_mb`、`playback.proxy_url_used`、`playback.canvas_dropped_frame_rate`），后端补齐 `media_proxy` / `preview_proxy` 的结构化日志字段，使运维可以仅靠日志收集器（loki / 自建 ELK）拼出 v2 验收指标。
2. **运维端点与回滚自动化**：实现 spec 08 §七 的 `/api/admin/playback-proxies` 只读查询端点；新增最小可用的 `/api/admin/playback-metrics` 滚动窗口聚合端点，给 spec 08 §4.4 回滚条件提供数据源；前端实现 client-side killswitch 自检（已在 Phase 2 留好钩子，本轮接入触发条件）。
3. **灰度落地与文档归档**：交付 spec 08 §八 大纲所指的 `rollout-playbook.md`；新增前端 dev-only force-variant 切换、env.template 与 master-plan §十 状态表的对齐更新；为 Round 4 之后的 legacy 路径清理（master-plan §十一 的「保留 2 个版本后清理」）打底，给 `useVideoPlayback.ts` / 旧 `VideoPlayerPanel` 分支加上 `@deprecated` 注释与 sunset TODO。

**显式非目标**（Phase 4 不做）：

- 不引入 Prometheus / Grafana / Sentry（spec 08 §一 / §十 已声明）；本轮以「结构化日志 + 内存滚动聚合」交付。
- 不动 v2 状态机、Canvas 合成器、A/B Buffer、preview-proxy 转码核心逻辑；本轮只做边沿的观测、鉴权与运维封装。
- 不删除 legacy 路径源码（master-plan §十一 规定「保留 2 个 release」）；本轮只加 `@deprecated`。
- 不引入新的三方依赖（前后端均维持现状）。
- 不做端到端 e2e 自动化（Playwright 脚本）；按 spec 08 §五 / 项目现状以 vitest + httpx 单测覆盖关键回归。

---

## 二、目标与不变量

### 2.1 目标（Goals）

| ID | 目标 | 验收方式 |
|----|------|----------|
| G1 | 全量 v2 验收指标可观测：master-plan §八 八条定量指标在结构化日志里都能找到对应指标。 | grep `app.log` 拿到全部 8 个 metric key，且字段含 P50 / P95 必需的 raw value。 |
| G2 | 灰度回滚条件 **数据源** 可用：`POST /api/telemetry/playback` 入库的事件能被 `/api/admin/playback-metrics?window=15m` 实时聚合，覆盖 §4.4 的三条阈值。 | 单测 + 手测：构造 1000 条 `playback.playhead_regression` 上报，立即查询 `regressionCountLast24h ≥ 1000`。 |
| G3 | 客户端 killswitch 自检在线：playhead regression 单 session 累计 > `KILLSWITCH_REGRESSION_PER_SESSION`（默认 50）或 stalled 率超阈，自动 trip killswitch 并在下次刷新走 legacy。 | 单测：mock telemetry 触发阈，断言 `tripPlaybackV2KillSwitch` 被调用一次且仅一次。 |
| G4 | `/api/admin/playback-proxies?status=running&limit=100` 端点上线，复用 `app/dependencies/auth.py::require_admin`。 | pytest 覆盖：admin 200、普通用户 403、无 token 401、过滤参数正确。 |
| G5 | `rollout-playbook.md` 交付，包含 spec 08 §八 全部 6 段（含可执行命令）。 | 文档 ≥ 800 行字符 + 每段都有 ≥ 1 个具体命令 / SQL / curl 示例。 |
| G6 | env.template 与 master-plan §十 状态表对齐：新增 `PLAYBACK_V2_ROLLOUT_PERCENT`、`PLAYBACK_V2_FORCE_ENABLED_USER_IDS`、`PLAYBACK_V2_TELEMETRY_AGG_WINDOW_MIN` 三项；master-plan §十 表加备注「Round X 落地，commit 短哈希」。 | grep env.template、master-plan diff 命中。 |
| G7 | 现有 frontend vitest 套件（513 用例）+ 本轮新增用例全绿；`tsc --noEmit` 干净；后端 pytest 新增用例全绿。 | CI 输出。 |
| G8 | legacy 路径（`useVideoPlayback.ts`、`VideoPlayerPanel.tsx` 内 flag-off 分支）顶部带 `@deprecated` JSDoc + `// TODO(playback-v2 sunset, owner: <未指定>)`，并出现在 master-plan §十一 的 sunset 表中。 | grep 命中 `@deprecated` 标签。 |

### 2.2 不变量（Invariants）

继承 Phase 2/3 的 INV1–INV9，本轮新增：

| ID | 不变量 | 强制位置 |
|----|--------|----------|
| INV10 | **遥测 SDK 永远不抛**：`PlaybackTelemetry.record/count/flushNow` 在 fetch 失败、JSON 序列化异常、disposed 状态下仍必须 swallow，禁止把异常冒泡到 PlaybackEngine / Compositor 主路径。 | `telemetry.ts` + 新增聚合器。 |
| INV11 | **PII 不出域**：上报体内 `userId` 字段必须是 `sha256(userId + 'playback_v2')` 前 12 位；原始 userId 不允许出现在前端 telemetry payload 与后端 `app.log` 任一字段。 | `telemetry.ts` 构造、telemetry_router pydantic validator。 |
| INV12 | **/admin 端点必须经过 require_admin**：本轮所有以 `/api/admin/*` 为前缀的端点必须显式声明 `Depends(require_admin)`；普通 session token 即使有效，也必须返回 403。 | router 函数签名 + 对应 pytest。 |
| INV13 | **killswitch 状态单向**：客户端只能从未触发 → 已触发；已触发后必须由用户手动清除 localStorage 才能重置；后端任何返回值不允许把已 trip 的客户端 killswitch 反向放开。 | `playbackFlags.ts` 已有 killswitch 早返回逻辑保留 + 本轮聚合器只读。 |

---

## 三、技术设计（Technical Design）

### 3.1 整体数据流（Round 4 增量）

```
┌───────────────────────┐
│ PlaybackEngine        │──record(swap_latency_ms)──┐
│ AbBufferController    │──record(swap_latency_ms)──┤
│ CanvasCompositor      │──record(canvas_dropped)──┐│
│ PlayheadController    │──count(playhead_regress)─┤│
│ MediaProxyClient      │──count(preview_proxy_*)──┘│
│ VideoCacheAdapter     │──record(cache_memory_mb)──┤
│ selectPlaybackUrl     │──count(proxy_url_used:Pn)─┤
└───────────────────────┘                            ▼
            (existing PlaybackTelemetry SDK)   ┌──────────────┐
                                               │ POST /api/   │
                                               │ telemetry/   │
                                               │ playback     │
                                               └──────┬───────┘
                                                      ▼
        ┌───────────────────────────────────────────────────────┐
        │  TelemetryAggregator (in-process, ring buffer)        │
        │  • 累积 last-24h 计数器、滚动 15min P50/P95 直方图    │
        │  • 由 telemetry_router.ingest_playback_telemetry 调用 │
        └─────┬───────────────────────┬─────────────────────────┘
              │                       │
              ▼                       ▼
       app.log 结构化           /api/admin/playback-metrics
       一条 / event             (require_admin, JSON envelope)
              │
              ▼
       (loki / ELK / 自建抓取)
```

`/api/admin/playback-proxies` 仍然直接查 `cached_materials` 表（spec 08 §七 已规定），不经 aggregator。aggregator 只服务 telemetry 维度。

### 3.2 关键代码路径

#### 3.2.1 前端新增指标接入

| 指标 | 触发位置 | 实施提示 |
|------|----------|----------|
| `playback.swap_latency_ms` | `PlaybackEngine._handleBoundary` 中调用 `swapActive` 前后取 `performance.now()`；差值 record。 | **本轮在 `PlaybackEngine` 内新增私有字段 `private _pendingSwapStart: number \| null = null;`**（Phase 2 实际未保留此字段，评审 R-P1-1 已核实）；在调用 `AbBufferController.swapActive` 前赋值 `performance.now()`，回调返回后 record 差值并重置为 null。fallback 分支 record 时打 `tags: { fallback: 'true' }`。 |
| `playback.preview_proxy_request` | `MediaProxyClient.requestPreviewProxy` POST 成功 / 失败两路径各 count 一次，`tags: { result: 'success' \| 'error', material_id }`。 | 失败路径不影响 fallback；保持 fire-and-forget。`material_id` 上报前需先做 INV11 哈希（与 `userId` 同算法），避免素材主键外泄。 |
| `playback.preview_proxy_cached_hit_rate` | `proxyHitMeter` 在 `PlaybackEngine.attachActiveMaterial` 时按当前 tier 单次记录；每 60s 由 PlaybackEngine 取一次比例 record（gauge）。 | **不在 `selectPlaybackUrl` 内部 record**（评审 R-P1-6 已核实：该函数被 50+ 调用点当作纯函数复用，副作用会被 useMemo / SWR 反复触发）。改在「切活动素材」单点调用，频率 = 实际播放次数。 |
| `playback.cache_memory_mb` | `VideoCacheAdapter.getMemoryStats` 已存在（`src/components/video/timeline/infrastructure/VideoCacheAdapter.ts:394`，spec 已核对）；PlaybackEngine 60s 周期 record。 | gauge；不要每 tick record。 |
| `playback.proxy_url_used` | `proxyHitMeter` 在 `attachActiveMaterial` 同处 count 一次，`tags: { tier: 'P1'..'P5' }`。 | 与 `cached_hit_rate` 共享同一 meter 实例与同一调用点（见上）。 |
| `playback.canvas_dropped_frame_rate` | `CanvasCompositor` 已统计 `droppedFrames` / `drawnFrames`（`CanvasCompositor.ts:39-40`）；**本轮在该类新增私有字段 `private _lastEmitMs = 0;`**（Phase 2 实际未保留 `_lastReportTs`，评审 R-P1-1 已核实），在 `draw` / `drawCurrentFrame` 路径末尾按 1s 节流 emit。 | 1s 周期 gauge；emit 完后 reset 计数避免累加偏移。 |

#### 3.2.2 后端聚合器（TelemetryAggregator）

新增 `app/services/playback_metrics_aggregator.py`：单进程内存实现，进程外通过 `app.log` 兜底，不要求高一致性。

```
class PlaybackMetricsAggregator:
    def __init__(self, window_min: int = 15, retention_hours: int = 24): ...

    def record(self, ev: PlaybackTelemetryEvent, *, flag_variant: str) -> None:
        # 1. 维护 24h 计数器（playhead_regression、stalled_event、error）
        # 2. 维护 15min 滚动直方图（click_to_first_frame_ms、seek_to_first_frame_ms、swap_latency_ms）
        # 3. 维护 last-1h 比率（preview_proxy_cached_hit_rate 平均、canvas_dropped_frame_rate 平均）

    def snapshot(self, window_min: int) -> dict:
        # 输出 spec 08 §4.4 三条阈值需要的字段：
        #   - playheadRegressionLast24h (int)
        #   - stalledRatio (float, 与 7d 基线对比的倍数；基线由 caller 注入)
        #   - clickToFirstFramePct95Ms (int, 直方图近似)
        ...
```

线程安全：FastAPI 是单进程异步，aggregator 用 `asyncio.Lock` 保护；考虑到事件量级（dogfood 阶段每分钟 < 100 条），开销可忽略。

#### 3.2.3 `/api/admin/playback-metrics` 端点

```
GET /api/admin/playback-metrics?window=15m
Authorization: Bearer <token>   # require_admin
→ 200 {
  success: true,
  data: {
    window: "15m",
    playheadRegressionLast24h: 0,
    stalledRatio15m: 0.42,
    clickToFirstFramePct95Ms: 280,
    swapLatencyPct95Ms: 14,
    previewProxyHitRate: 0.71,
    cacheMemoryMbAvg: 612.3,
    sampleCount: 1820
  }
}
```

实现位置：`app/routers/admin_playback_router.py`，与同 PR 引入的 `/api/admin/playback-proxies` 同 router 内。

#### 3.2.4 客户端 killswitch 自检

`src/components/video/playback/internal/killswitchMonitor.ts`：

```
class KillSwitchMonitor {
  private regressionCount = 0;
  private stalledCount = 0;
  private startTs = performance.now();

  noteRegression(): void {
    this.regressionCount += 1;
    if (this.regressionCount >= 50) this._trip('regression-overflow');
  }

  noteStalled(): void {
    this.stalledCount += 1;
    if (this.stalledCount >= 30) this._trip('stalled-overflow');
  }

  private _trip(reason: string): void {
    if (this._tripped) return;
    this._tripped = true;
    tripPlaybackV2KillSwitch(reason);   // already in playbackFlags.ts
  }
}
```

接入：`PlaybackEngine` 在 `_emitTelemetry('playback.playhead_regression')` 处同时调 `monitor.noteRegression()`；`stalled` phase 转换处调 `noteStalled()`。

阈值由 Phase 4 v2 评审决定；初值取自 spec 08 §4.4 的服务端阈值（1000 / 50% upgrade）按 session 缩放：单 session 10 倍缩小 → 100 / 5 ≈ 50 / 30。

#### 3.2.5 PII 哈希

`PlaybackTelemetry` 构造接受的 `userId` 字段在写入 queue 之前先做 `sha256(userId + 'playback_v2').slice(0, 12)`；后端 telemetry_router 增加 pydantic validator：若 `userId` 长度不等于 12 或包含非 hex 字符，**直接清空字段**（不报错），避免上游误传原始 userId 时落库。

#### 3.2.6 dev-only 强制 variant 切换

`src/components/video/playback/components/PlaybackVariantSwitcher.tsx`（新增，可选挂在 PlayerControls 顶部）：仅在 `process.env.NODE_ENV !== 'production'` 渲染；按钮三态：`auto` / `force-v2` / `force-legacy`，写 localStorage 并 reload 页面（playbackFlags 锁在挂载时，必须刷新）。

#### 3.2.7 部署约束：聚合器必须单 worker（评审 R-P1-3 新增）

后端 `README.md:209-210` 已记录生产部署方式为 `gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker`。`PlaybackMetricsAggregator` 是**进程内单实例**，在多 worker 下：

1. 同一 user session 的 POST telemetry 会被随机 worker 接收，aggregator 数据被切成 4 份；
2. 同一 admin GET 也会随机命中某 worker，返回值只反映 1/4 的真实样本；
3. `/api/admin/playback-metrics` 在 -w 4 下做阈值告警**必然失真**，会触发误回滚。

本轮约束：

- 新增 ENV `PLAYBACK_V2_AGGREGATOR_REQUIRES_SINGLE_WORKER`，**默认 `true`**。
- `/api/admin/playback-metrics` 在响应中始终携带 `worker_pid: int` 与 `degraded: bool` 字段；`degraded=true` 时 §4.4 阈值不可用于自动回滚决策。
- worker 数量检测策略：app startup 时读取 `os.environ.get('UVICORN_WORKERS', '1')` / `os.environ.get('GUNICORN_WORKERS', '1')`，若 > 1 则启动日志打 WARNING 并把 aggregator 标记为 degraded。
- `rollout-playbook.md` 必须在「dogfood 启动 checklist」段写明：dogfood 与首阶段灰度强制 `-w 1`；如需扩 worker，先把 aggregator 改造为 redis backend（已列入 §十二 Round 5）。

### 3.3 序列图：客户端 killswitch 触发 → 下次刷新走 legacy

```
PlayheadController        KillSwitchMonitor      playbackFlags        Editor reload
   │  detectsRegression()       │                       │                     │
   ├──────────────────────────► │ noteRegression()      │                     │
   │     (×50)                  │                       │                     │
   │                            ├──tripPlaybackV2────► │ writeLocalStorage   │
   │                            │     KillSwitch        │                     │
   │                            │                       │ ← user F5/Reload  ──┤
   │                            │                       │                     │
   │                            │                       ├─isPlaybackV2────►   │
   │                            │                       │   Enabled() 返回   │
   │                            │                       │   false (killswitch)│
   │                            │                       │                     │
   │                            │                       │  → Editor 走 legacy │
```

### 3.4 与上游 specs 的精确差异调和

| 来源 | 上游条款 | 本轮处理 |
|------|----------|----------|
| spec 08 §3.1 | `playback.canvas_dropped_frame_rate` 为 gauge，每 1s 一次 | 本轮按 1s emit（3.2.1） |
| spec 08 §4.2 | `/api/config/playback-flag` 已实现（Round 1） | 本轮 **不动** |
| spec 08 §4.4 | 三条回滚阈值（1000 regression / stalled +50% / first-frame P95 > 800ms 30min） | 本轮提供数据源（aggregator），不实现自动回滚执行（仍需运维一键调 rolloutPercent） |
| spec 08 §六 | `PlaybackTelemetry` SDK 已实现（Round 1） | 本轮新增 SDK-内 PII 哈希（3.2.5），保持向后兼容 |
| spec 08 §七 | `/api/admin/playback-proxies` | 本轮实现（3.2.3 同 router） |
| spec 08 §八 | `rollout-playbook.md` 大纲 | 本轮交付（§4 文件清单） |
| Round 3 §十二 接力清单 | 5 项 | 本轮全覆盖：1（telemetry 扩展）、2（rollout 数据源 + killswitch）、3（金路径 3/4 列入 §七 验收）、4（指标采集模板列入 playbook）、5（master-plan §十 状态表更新） |

---

## 四、接口设计（Interface Design）

### 4.1 后端 REST

#### 4.1.1 `GET /api/admin/playback-proxies`

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `status` | query string | 否 | `absent` \| `queued` \| `running` \| `cached` \| `failed`（与 alembic `011` 表 `preview_proxy_status` 枚举一致）；缺省返回 `queued` + `running` + `failed`（**排除** `absent` 与 `cached`） |
| `limit` | query int | 否 | 1–500，默认 100 |
| `cursor` | query string | 否 | 上一页最后一行的 `(preview_proxy_transcoded_at, material_id)` base64 编码复合游标；评审 R-P2-2 |

> **字段映射说明（评审 R-P1-2）**：`cached_materials` 表的列名实际为 `preview_proxy_status` / `preview_proxy_profile` / `preview_proxy_progress` / `preview_proxy_bytes` / `preview_proxy_transcoded_at` / `preview_proxy_last_error`。API 层做 alias 映射，**响应体使用短名**便于消费；查询条件按真实列名执行。表中**无 `started_at` 列**，spec v1 该字段属误写，本 v2 改用 `transcoded_at`（completion timestamp；对 `running` 行该字段为 `null`，对 `cached` 行为完成时间）。

响应：

```
200 {
  success: true,
  data: {
    items: [
      {
        material_id: "uuid",
        profile: "preview-480p",           // 来自 preview_proxy_profile
        status: "running",                  // 来自 preview_proxy_status
        progress: 0.42,                     // 来自 preview_proxy_progress，0..1
        transcoded_at: null,                // 来自 preview_proxy_transcoded_at（running 时 null）
        bytes: 12345678,                    // 来自 preview_proxy_bytes
        error: null                         // 来自 preview_proxy_last_error
      },
      ...
    ],
    nextCursor: "base64(transcoded_at_iso|material_id)" | null,
    total: 17
  }
}
```

错误：401（无 token）、403（非 admin）、500（DB 异常，envelope `{success:false, error_code, message}`）。

#### 4.1.2 `GET /api/admin/playback-metrics`

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `window` | query string | 否 | `5m` \| `15m`（默认）\| `1h` |

响应：详见 §3.2.3。**新增字段（评审 R-P1-3）**：返回体根部 envelope 增加 `worker_pid: int` 与 `degraded: bool`；当 `degraded=true` 时调用方（rollout-playbook 中的运维脚本）**不得**依据本响应触发 §4.4 自动回滚。

#### 4.1.3 `POST /api/telemetry/playback`（Round 1 已存在，本轮扩展）

请求体新增字段约束（向后兼容）：

| 字段 | 修改 |
|------|------|
| `userId` | 长度 = 12 + hex 校验；不符合一律清空（不报错） |
| `events[].name` | **不丢弃**未知 metric（评审 R-P1-5）：仅当前缀为 `playback.*` 才进入 aggregator；其余 metric 仍入库到 `app.log` 并打 `unknown_metric=true` tag，便于发现「前端新增事件忘了同步常量表」。 |

响应仍为 204；新增内部副作用：调用 aggregator.record。

### 4.2 前端模块

#### 4.2.1 `KillSwitchMonitor`

```
new KillSwitchMonitor({
  regressionThreshold?: number;   // default 50
  stalledThreshold?: number;      // default 30
});

monitor.noteRegression(): void;
monitor.noteStalled(): void;
monitor.dispose(): void;
```

由 `VideoPlayerPanel` v2 分支创建并通过 props 传给 PlaybackEngine（与 telemetry 对齐）。

#### 4.2.2 `proxyHitMeter`

```
hitMeter.recordTier(tier: 'P1'|'P2'|'P3'|'P4'|'P5'): void;
hitMeter.snapshotHitRate(): number;     // P2/P3 命中视为 hit；其余视为 miss
hitMeter.reset(): void;
```

由 `selectPlaybackUrl` 在 `effectivePreviewUrl` 内同侧调用（避免修改纯函数签名）。

### 4.3 配置项与环境变量

| 名称 | 默认值 | 说明 |
|------|--------|------|
| `PLAYBACK_V2_ROLLOUT_PERCENT` | `0` | Round 1 已存在，本轮在 env.template 显式列出 |
| `PLAYBACK_V2_FORCE_ENABLED_USER_IDS` | `""` | 同上 |
| `PLAYBACK_V2_TELEMETRY_AGG_WINDOW_MIN` | `15` | aggregator 滚动窗口分钟数 |
| `PLAYBACK_V2_TELEMETRY_AGG_RETENTION_HOURS` | `24` | aggregator 保留窗口 |
| `NEXT_PUBLIC_PLAYBACK_V2_KILLSWITCH_REGRESSION` | `50` | 客户端 monitor 阈值（覆盖默认） |
| `NEXT_PUBLIC_PLAYBACK_V2_KILLSWITCH_STALLED` | `30` | 同上 |
| `PLAYBACK_V2_AGGREGATOR_REQUIRES_SINGLE_WORKER` | `true` | 评审 R-P1-3 新增；当检测到 worker > 1 且本项 = true 时，aggregator 标记 degraded |

后端 `app/config.py` 增加对应 settings 字段，遵循现有 `Settings` pydantic 风格。

---

## 五、数据模型（Data Model）

### 5.1 数据库

**本轮零迁移**。`cached_materials` 表已经被 alembic 010 / 011 扩展完毕（spec 05 / 06 覆盖），admin 查询直接读。**不允许**在本轮新增 alembic 文件以避免 down_revision 链断裂；如果发现需要新增字段，记入 §十「实施过程发现的方案缺陷」并由 Round 5 处理。

### 5.2 内存数据结构

`PlaybackMetricsAggregator` 内部：

```
@dataclass
class _Counter24h:
    bucket_minute: deque[tuple[int, int]]   # (epoch_min, count) 环形 24*60 长

@dataclass
class _Histogram15m:
    samples: deque[tuple[int, float]]       # (epoch_sec, value) 环形 15*60 长

@dataclass
class _Gauge1h:
    samples: deque[tuple[int, float]]       # 60min × 1 sample
```

P95 用 `numpy.percentile` 近似（项目已有 numpy 依赖）；如果 numpy 不可用则手写 sorted index。

### 5.3 前端 store / 持久化

- `localStorage.ecliptrix-playback-v2-killswitch`：Phase 2 已存在，本轮 monitor 仅写入，不读取（读取仍由 `playbackFlags.ts` 完成）。
- `localStorage.ecliptrix-playback-v2-variant-override`（**新增**）：dev switcher 写入；`auto` 时 key 不存在；其他值优先级最高（接入 `isPlaybackV2Enabled` 解析链最高优先级，仅在 dev/staging 生效）。
- `sessionStorage.ecliptrix-playback-flag-cache`：Round 1 已实现，本轮不动。

---

## 六、文件 / 模块变更计划

> 标记：A = 新增，M = 修改，D = 删除。
> 对照 master-plan §六 与 spec 08，全部位置预先核对存在性。

### 6.1 前端（src/）

| # | 类型 | 文件 | 一句话意图 |
|---|------|------|------------|
| F1 | A | `src/components/video/playback/internal/killswitchMonitor.ts` | KillSwitchMonitor 类，§3.2.4 |
| F2 | A | `src/components/video/playback/internal/proxyHitMeter.ts` | P-tier 命中率与计数共享单例，§3.2.1。**只在 `PlaybackEngine.attachActiveMaterial` 单点调用**（评审 R-P1-6），不被 `selectPlaybackUrl` 触达，保持后者纯函数语义。 |
| F3 | A | `src/components/video/playback/components/PlaybackVariantSwitcher.tsx` | dev-only 三态切换，§3.2.6 |
| F4 | M | `src/components/video/playback/telemetry.ts` | (a) 新增导出常量 **`PLAYBACK_EVENT_NAMES`** 为 `as const` 字面量联合（6 项 + 既有），`record/count` 入参用该类型约束（评审 R-P1-5：编译期阻断而非运行时静默）；(b) 构造时 PII 哈希；(c) `flushNow` **不**做事件名过滤，将所有事件按 SDK 既有逻辑透传；后端做白名单分流。 |
| F5 | M | `src/components/video/playback/PlaybackEngine.ts` | (a) 周期 60s emit `cache_memory_mb` / `preview_proxy_cached_hit_rate`；(b) `_handleBoundary` 接入 `swap_latency_ms`（含**新增**私有字段 `_pendingSwapStart`，评审 R-P1-1）；(c) `playhead_regression` / `stalled` 转 KillSwitchMonitor；(d) 新增 `attachActiveMaterial(material, tier)` 调用点，触发 `proxyHitMeter.recordTier` 一次。 |
| F6 | M | `src/components/video/playback/AbBufferController.ts` | 暴露 `lastSwapResult` 元数据（`{ usedFallback: boolean, latencyMs: number }`），供 Engine record |
| F7 | M | `src/components/video/playback/CanvasCompositor.ts` | 新增私有字段 **`_lastEmitMs`**（评审 R-P1-1，Phase 2 未保留同名字段）；1s 周期 emit `canvas_dropped_frame_rate`。 |
| F8 | M | `src/components/video/playback/PlayheadController.ts` | regression hook 调 monitor.noteRegression（已有 `onRegression` 回调，本轮仅在 v2 panel 注入时绑定） |
| F9 | M | `src/components/video/lib/selectPlaybackUrl.ts` | **不修改函数体**（评审 R-P1-6 保持纯函数）；仅在头部 JSDoc 增补一行：「副作用统计请在调用方（`PlaybackEngine.attachActiveMaterial`）做」。本项实际上从「修改」回退到「文档补丁」，可考虑合入 F5 commit 内单独 hunk。 |
| F10 | M | `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | (a) 创建 KillSwitchMonitor；(b) 渲染 dev switcher；(c) flag-off 分支顶部加 `@deprecated` |
| F11 | M | `src/components/video/hooks/useVideoPlayback.ts` | 顶部 JSDoc `@deprecated`；不动行为 |
| F12 | M | `src/components/video/playback/types.ts` | 新增 `IKillSwitchMonitor`、`IProxyHitMeter`、`PlaybackEngineAttachDeps` 字段扩展 |
| F13 | M | `src/components/video/playback/index.ts` | re-export 新增类型与单例 |
| F14 | M | `src/lib/playbackFlags.ts` | (a) 新增 variant override 解析层（最高优先级，仅 dev/staging）；(b) **`tripPlaybackV2KillSwitch(reason)` 已在 commit `8828370` 落地**，本轮复用现有写入格式 `${reason}:${Date.now()}`（评审 R-P1-4：不再新增独立 `*-killswitch-reason` 键，避免 INV13 双键漂移）；新增 read-only helper `readKillSwitchReason(): { reason: string; trippedAt: number } \| null` 供 dev devtool 解析。 |
| F15 | A | `src/components/video/playback/__tests__/killswitchMonitor.test.ts` | 阈值触发 / 单向 / dispose 关闭计数 |
| F16 | A | `src/components/video/playback/__tests__/proxyHitMeter.test.ts` | tier 计数 / snapshot 比例 / reset |
| F17 | A | `src/components/video/playback/__tests__/telemetry.pii.test.ts` | userId 必须以 12 hex 哈希出现；原值不能落入 payload |
| F18 | A | `src/components/video/playback/__tests__/PlaybackEngine.metrics.test.ts` | 60s 周期 emit / swap_latency 接入 / regression 转 monitor |
| F19 | A | `src/components/video/playback/__tests__/CanvasCompositor.metrics.test.ts` | 1s 周期 emit canvas_dropped_frame_rate |
| F20 | A | `src/lib/__tests__/playbackFlags.variantOverride.test.ts` | 仅 dev / staging 生效；killswitch reason 写 localStorage |
| F21 | A | `src/lib/__tests__/playbackFlags.killswitch.test.ts` | trip 后 isPlaybackV2Enabled 早返回 false（INV13） |

### 6.2 后端（backend-services/basic-service/）

| # | 类型 | 文件 | 一句话意图 |
|---|------|------|------------|
| B1 | A | `app/services/playback_metrics_aggregator.py` | 进程内滚动窗口聚合器，§3.2.2 |
| B2 | A | `app/routers/admin_playback_router.py` | `/api/admin/playback-proxies` + `/api/admin/playback-metrics`，require_admin。**router 内声明路径为 `/admin/playback-proxies` / `/admin/playback-metrics`**，由 `app/main.py` 以前缀 `/api` 挂载，避免 `/api/api/...` 双前缀（评审 R-P2-7）。响应需包含 `worker_pid` 与 `degraded` 字段（评审 R-P1-3 / §3.2.7）。 |
| B3 | M | `app/routers/telemetry_router.py` | (a) pydantic validator 强制 PII 形态；(b) 入库时调 aggregator.record；(c) **不在白名单的 metric 名不丢弃**（评审 R-P1-5）——仍按 SDK 原协议落 `app.log`，仅打 `unknown_metric=true` tag 且跳过 aggregator。 |
| B4 | M | `app/routers/media_proxy_router.py` | 在 stream 完成 / 错误处补结构化字段 `cache_state`、`upstream_latency_ms`、`bytes_total`（不改业务行为） |
| B5 | M | `app/routers/preview_proxy_router.py` | 在 enqueue / status / file 三处分别 log `preview_proxy.tasks_queued` 当前值、`preview_proxy.transcode_duration_ms`、`preview_proxy.failure_total` 字段；从 service 拿数据 |
| B6 | M | `app/services/preview_proxy_service.py` | 暴露 `get_queue_depth()` 与 `last_failure_count()` 只读方法；不改入队 / 转码逻辑 |
| B7 | M | `app/main.py` | 注册 `admin_playback_router`，前缀 `/api`（与 admin 系列其他路由一致） |
| B8 | M | `app/config.py` | 新增 5 个 settings 字段（§4.3，含评审 R-P1-3 新增的 `PLAYBACK_V2_AGGREGATOR_REQUIRES_SINGLE_WORKER`） |
| B9 | M | `env.template` | 新增 7 个环境变量条目（§4.3） |
| B10 | A | `tests/test_admin_playback_proxies.py` | admin 200 / 普通 403 / 无 token 401 / 过滤 / 分页 |
| B11 | A | `tests/test_admin_playback_metrics.py` | aggregator 注入数据后端点返回正确聚合 |
| B12 | A | `tests/test_playback_telemetry_pii.py` | 上传带原始 userId → 落库被清空；上传带 hash → 透传 |
| B13 | A | `tests/test_playback_metrics_aggregator.py` | 单元测试：滚动窗口正确性 / P95 计算 |

### 6.3 文档与配置

| # | 类型 | 文件 | 一句话意图 |
|---|------|------|------------|
| D1 | A | `docs/plans/video-editor-playback-optimization/rollout-playbook.md` | spec 08 §八 6 段大纲实现（启动 checklist / 监控位置 / 灰度推进 / 回滚 SOP / 已知 issue / 反馈渠道） |
| D2 | M | `docs/plans/video-editor-playback-optimization/master-plan.md` | §十 状态表追加「实施 Round 与 commit 短哈希」列；§十一 sunset 表新增 |
| D3 | M | `.env.local.template`（前端） | 新增 `NEXT_PUBLIC_PLAYBACK_V2_KILLSWITCH_REGRESSION` / `_STALLED` 默认值条目 |

### 6.4 不允许触碰的文件（DO-NOT-TOUCH）

为了把 Round 4 风险锁在边沿层，以下文件本轮**禁止修改**：

- `app/services/media_proxy_service.py`、`app/services/preview_proxy_queue.py`：核心业务逻辑稳定，本轮只在 router / service 边界加日志。
- `app/models/db_models.py`（cached_materials 字段相关）：零迁移约束（§5.1）。
- `src/components/video/timeline/store/**`：单一时间源，本轮不改。
- `src/components/video/playback/internal/constants.ts`、`fitContain.ts`：算法文件，无变更需求。

---

## 七、测试与验收（Testing & Acceptance）

### 7.1 自动化测试

新增用例覆盖：

| 模块 | 用例文件 | 用例数 |
|------|----------|-------:|
| KillSwitchMonitor | F15 | 6 |
| ProxyHitMeter | F16 | 5 |
| Telemetry PII | F17 | 4 |
| Engine metrics 接入 | F18 | 7 |
| Compositor metrics | F19 | 3 |
| Flags variant override | F20 | 4 |
| Flags killswitch INV13 | F21 | 3 |
| Backend admin endpoints | B10 | 7 |
| Backend metrics endpoint | B11 | 4 |
| Backend PII validator | B12 | 4 |
| Aggregator | B13 | 8 |
| **小计（新增）** | | **55** |

回归：Round 1–3 共 513 个 frontend vitest 用例 + 后端 pytest 全套必须保持绿。

### 7.2 手测金路径（接管 Round 3 §7.2 路径 3 / 4）

| # | 路径 | 验收 |
|---|------|------|
| M1 | 1080p 短样本（≤10s）首次入轨 → 5s 内 cached（spec 03 §3 路径 3） | 状态轮询 ≤ 5s 后 status=cached |
| M2 | 4K HEVC 长样本（≥60s）首次入轨 → preview-proxy 必走 fallback | 调试器观察 P5 命中 >  0；`preview_proxy_request{result:error}` count 上升 |
| M3 | dev switcher 三态切换 → reload 后 isPlaybackV2Enabled 返回符合预期 | 控制台 `isPlaybackV2Enabled()` 返回 true / false |
| M4 | 模拟 50 次 playhead regression → killswitch trip → reload 走 legacy | localStorage 出现 `ecliptrix-playback-v2-killswitch=true` |
| M5 | 以 admin token 访问 `/api/admin/playback-proxies?status=running` → 200 + items[] | curl + jq |
| M6 | 以普通用户 token 同上 → 403 | curl |
| M7 | 模拟 1000 条 regression 上报 → `/api/admin/playback-metrics?window=15m` 返回 ≥ 1000 | curl |

### 7.3 性能验收（master-plan §八 八条）

本轮负责采集而非达成。在 dogfood 环境用 5 名内部用户连续使用 1 周，导出 `app.log` 中 metric 字段，按下表比对：

| 指标 | 目标 | Phase 4 验收要求 |
|------|------|-------------------|
| P50 click-to-first-frame | < 100ms | 数据可采集且 ≥ 1 周连续样本 |
| P95 click-to-first-frame | < 300ms | 同上 |
| P95 seek-to-frame | < 150ms | 同上 |
| 稳定播放帧率 | ≥ 60fps（rAF 16.67ms ± 1ms） | 同上 |
| Sequence 切换闪屏 | < 16ms | 同上（来自 swap_latency_ms） |
| 光标回跳事件 / 30min | 0 | 同上（playhead_regression 必须可读） |
| 远端素材代理 RTT P95 | < 800ms | 同上（来自 media_proxy.upstream_latency_ms） |
| Subjective 评级 | ≥ 4.5/5 | playbook 提供问卷模板 |

### 7.4 Definition of Done（DoD）

- [ ] §6.1 / §6.2 / §6.3 全部条目 land；不允许跳过任何 A 项；M 项行为可由测试覆盖。
- [ ] §7.1 新增 55 用例 + Round 1–3 全部既有用例全绿。
- [ ] §7.2 M1 / M3 / M4 / M5 / M6 / M7 手测通过；M2 性能验收延后到 §7.3 数据采集阶段。
- [ ] `tsc --noEmit` 干净；`npm run lint` 无新增错误（warning 不阻塞）。
- [ ] 后端 `pytest tests/ -v` 全绿（含 Round 1–3 既有套件）。
- [ ] `docs/plans/video-editor-playback-optimization/rollout-playbook.md` 入库。
- [ ] master-plan §十 / §十一 更新；env.template 更新。
- [ ] commit 以 `feat(video-editor):` 前缀，单一 commit 包含本轮全部产物（仿 Round 1–3 风格）。

---

## 八、风险与缓解（Risks & Mitigations）

| ID | 风险 | 影响 | 概率 | 缓解 |
|----|------|------|------|------|
| R1 | TelemetryAggregator 在多 worker 部署下数据被切分（FastAPI 多进程）。 | **高** | **高** | 评审 R-P1-3 升级：后端 `README.md:209-210` 实际记录的生产部署即 `gunicorn -w 4`，本风险概率为「高」。强制约束：(1) §3.2.7 新增的 `PLAYBACK_V2_AGGREGATOR_REQUIRES_SINGLE_WORKER` 默认 `true`；(2) 端点响应携带 `worker_pid` / `degraded`；(3) rollout-playbook 强制 dogfood 与首阶段灰度 `-w 1`；(4) Round 5 引入 redis backend。 |
| R2 | killswitch 阈值过紧（regression > 50）导致正常用户被错误回退。 | 中 | 中 | 阈值通过 env 可调；playbook 提供「清理 killswitch 步骤」（清除 localStorage + reload）；初始通过 dev switcher 内部验证。 |
| R3 | dev variant switcher 误打包到 prod bundle。 | 中 | 低 | 严格通过 `process.env.NODE_ENV !== 'production'` 早返回；构建后 grep 验证 `PlaybackVariantSwitcher` 未出现在 `.next/static`；测试覆盖 prod build。 |
| R4 | proxy hit-rate meter 被错误嵌入 selectPlaybackUrl，命中率被 useMemo / SWR 反复触发而失真。 | 中 | **已规避** | 评审 R-P1-6：本 v2 把 `recordTier` 的唯一调用点改到 `PlaybackEngine.attachActiveMaterial`；`selectPlaybackUrl` 保持纯。F2 / F9 已同步。 |
| R5 | aggregator 内存增长在长时间运行后超预算。 | 中 | 低 | 环形 deque 容量固定（24*60 + 15*60 + 60）≈ 1.6k 条 × 64B ≈ 100KB；可忽略；测试断言 deque maxlen。 |
| R6 | `/api/admin/playback-metrics` 在前端 dashboard 不存在的情况下被错误暴露。 | 中 | 低 | 严格 require_admin；非 admin 401/403 路径走 `app/dependencies/auth.py` 既有逻辑（已有测试覆盖）；本 spec 的 B10/B11 用例兜底。 |
| R7 | `swap_latency_ms` 在 fallback 分支测得过大，污染 P95。 | 低 | 中 | record 时打 `tags.fallback`；后端聚合分维度 P95；playbook 文档说明区分逻辑。 |
| R8 | env.template 改动覆盖既有 .env，导致开发者环境失配。 | 中 | 低 | env.template 只追加新变量，不修改现有行；commit 显式列出 diff；playbook 提示同步本地 .env。 |
| R9 | PII 哈希实现前后端不一致（一边用 sha256，一边用 md5）。 | 高 | 低 | 后端 validator 仅校验长度+hex，不校验算法；约定写在 spec 与 telemetry.ts JSDoc；前后端同测一条样例（hardcoded fixture）确保一致。 |
| R10 | KillSwitchMonitor 阈值与服务端阈值不联动，灰度回滚条件触发时客户端可能尚未 trip（or 反之）。 | 中 | 中 | 默认值在 spec §3.2.4 明确给出 10× 缩放公式；playbook 中提供「服务端阈值变更需同步前端 env」运维 checklist。 |

---

## 九、回滚策略（Rollback）

本轮变更全部满足以下任一条件即可瞬时回滚：

1. **环境层回滚**：`PLAYBACK_V2_ROLLOUT_PERCENT=0` + `PLAYBACK_V2_FORCE_ENABLED_USER_IDS=""`；不需要发版。
2. **客户端紧急回滚**：用户在浏览器 console 执行 `localStorage.setItem('ecliptrix-playback-v2-killswitch','true'); location.reload()` 立即走 legacy。
3. **代码回滚**：本轮新增文件均为可独立 revert 的边沿模块；M 项中除 `playbackFlags.ts` 与 `telemetry.ts` 外均为「副作用 + 注释」级改动，单 commit `git revert` 即可。
4. **数据回滚**：本轮无 alembic 迁移，无须数据回滚。

---

## 十、实施过程发现的方案缺陷（待 Subtask #2 / #3 回填）

> 本节预留为占位，由 Subtask #2 / #3 在编码与代码 review 阶段以 F1 / F2 / ... 列出实现中发现的方案缺陷，避免缺陷散落各处。Round 5 可基于本节判断是否需要补 spec 修订。

### 10.0 Subtask #2（Round 4 实施）阶段发现

| Ref | 现象 | 处置方案 |
|-----|------|----------|
| F-R4-1 | 评审 R-P1-1 要求新增私有字段名为 `_lastEmitMs`。落地时在 `CanvasCompositor` 增加伴随字段 `_emitSeeded: boolean`，原因：`_now()` 在测试 / jsdom 下从 0 开始计时，单纯用 `_lastEmitMs === 0` 判定「未初始化」会导致 throttle 永远返回 early。`_lastEmitMs` 名字保持与 spec 一致；`_emitSeeded` 为局部辅助标志，未泄漏到对外契约。 |
| F-R4-2 | spec §3.2.1 要求 `CACHE_MEMORY_MB` 60s 周期 emit。落地时由 PlaybackEngine 通过 `globalThis.__ecliptrixCacheMemoryMb` 函数桥读取，避免把 `VideoCacheAdapter`（timeline 包内部模块）拖进 playback/ 子模块依赖图，保护 INV1「playback 不依赖 timeline」。Round 5 接 redis backend 时一并替换为正式依赖。 |
| F-R4-3 | spec §F6 把 `AbBufferController.swapActive` 的最近一次结果暴露为 `getLastSwapResult()`。落地时 PlaybackEngine 仍以「`_pendingSwapStart` + `_now()` 差值」记录 swap_latency_ms（spec §3.2.1 原本要求），`getLastSwapResult` 仅作为额外诊断 API，便于未来 dev devtool / golden path M2 抓 fallback 路径采样；当前没有运行时调用以保持开销最小。 |
| F-R4-4 | spec §F4 提到「`PlaybackTelemetry` 构造时 PII 哈希」。落地时为避免依赖 `crypto.subtle`（async）破坏既有 sync 构造 API，新增 `src/components/video/playback/internal/sha256.ts`（约 80 LOC 纯 JS）。该实现非安全用途，与 spec §R-P2-6 一致。 |
| F-R4-5 | 后端 pytest 在本机仍受 Anaconda cv2 递归 import 影响（与 Round 3 §F5 同一现象），`app.services.__init__` 加载阶段失败 → 4 个新增 backend 测试无法在本地 collect。已 (a) 用 importlib.util 加载 `app/services/playback_metrics_aggregator.py` 手工 smoke 验证滚动窗口与 P95 输出正确；(b) 用纯正则脚本验证 PII validator 行为；(c) 代码本身遵循既有项目惯例（fastapi.testclient + dependency_overrides），CI 环境（无 cv2 冲突）应能跑通。Round 5 / dogfood checklist 由运维侧执行端到端 pytest 验证。 |

### 10.1 评审遗留 P2 占位（待 Subtask #2/#3 实施时确认）

| Ref | 来源 | 处置方案 |
|-----|------|----------|
| R-P2-1 | 评审 | 编码时直接依赖 numpy，删除「fallback 手写 sorted index」逻辑（requirements.txt:25 已 pin numpy==1.26.4）。 |
| R-P2-2 | 评审 | nextCursor 使用复合游标 `(preview_proxy_transcoded_at DESC, material_id DESC)` base64 编码；测试覆盖跨页一致性。 |
| R-P2-3 | 评审 | aggregator deque maxlen 从 settings 派生：`maxlen = settings.playback_v2_telemetry_agg_retention_hours * 60`。 |
| R-P2-4 | 评审 | PlaybackVariantSwitcher 改为 `next/dynamic(() => import(...), { ssr: false, loading: () => null })`，并在 dynamic 工厂内部用 `if (process.env.NODE_ENV === 'production') return null;` 双重护栏。 |
| R-P2-5 | 评审 | `KillSwitchMonitor.noteStalled` 语义定为「按 transition 边沿计数」：仅在状态机从非-stalled → stalled 的瞬间 +1；同一连续 stalled 区间不重复计数。 |
| R-P2-6 | 评审 | 当前 12 hex（48 bit）夯实在 dogfood 阶段；进入全量灰度前由 Round 5 评估是否扩到 16 hex。 |
| R-P2-7 | 评审 | router 内 path 不带 `/api` 前缀；`app/main.py` 注册时统一 `prefix="/api"`。pytest 必须 assert 端点完整路径为 `/api/admin/playback-...`。 |

（其余实施过程发现的缺陷由 Subtask #2 / #3 追加）

---

## 十一、Round 4 与上游 specs 的对应关系（一图速览）

| Round 4 交付项 | 上游 spec 对应条款 |
|---------------|---------------------|
| 6 个新增 telemetry 事件 | spec 08 §3.1（5 项）+ Phase 3 §十二.1（swap_latency / preview_proxy_request / hit_rate / cache_memory） |
| TelemetryAggregator | spec 08 §3.1 / §4.4 数据源 |
| `/api/admin/playback-proxies` | spec 08 §七 |
| `/api/admin/playback-metrics` | spec 08 §4.4 数据源（新增端点；未在原 spec 列出，本轮新增并标注 "v3 候选条目"） |
| KillSwitchMonitor | Phase 2 spec §3.2.8（killswitch 兜底）+ spec 08 §4.4 |
| `rollout-playbook.md` | spec 08 §八 |
| dev variant switcher | spec 08 §4.1 #1（URL query 仅 dev/staging 生效）的 UI 友好版 |
| PII 哈希 | spec 08 §十 Q2 答案 |
| env.template 整理 | master-plan §六 / §十一 持续维护 |
| `@deprecated` legacy 路径 | master-plan §十一 「保留 2 个版本后清理」准备工作 |

---

## 十二、Round 5 接力清单（前瞻，本轮不做）

供 Round 5（如有）参考，**不计入本轮 DoD**：

1. legacy 路径源码删除（前提：`rolloutPercent=100%` 持续 ≥ 1 周无回滚事件）。
2. TelemetryAggregator 从单进程内存升级为 redis backend（前提：FastAPI 部署变多 worker）。
3. Prometheus / Grafana 接入（spec 08 §十 Q1 长期 TODO）。
4. WebAudio mixer / WebCodecs / filmstrip preview（master-plan §九 Phase 3 选项）。
5. Round 4 实施过程中 §十 列出的所有方案缺陷的修订发布。

---

## 十三、参考与基线

- master-plan v2 §一 ~ §十二
- spec 08：`docs/plans/video-editor-playback-optimization/specs/08-telemetry-feature-flag-rollout.md`（草案）
- Phase 2 spec v2：`docs/plans/video-editor-playback-v2-phase2/spec.md`
- Phase 3 spec v2：`docs/plans/video-editor-playback-v2-phase3/spec.md`，§十二「Round 4 接力清单」
- 既有代码基线（commit `efd7d01`）：
  - 前端：`src/components/video/playback/{PlaybackEngine,AbBufferController,CanvasCompositor,PlayheadController,PlaybackClock,telemetry,types,index}.ts`
  - 后端：`app/routers/{telemetry_router,config_router,media_proxy_router,preview_proxy_router}.py`、`app/services/{media_proxy_service,preview_proxy_service,preview_proxy_queue}.py`
  - 鉴权：`app/dependencies/auth.py::require_admin`

---

> **本设计文档版本：v2（评审后修订，2026-05-16）**。下游 Subtask #2（代码开发）按本 v2 的文件清单与评审修订点逐项落地；§十 评审遗留 P2 占位由实施阶段处置。

---

## 评审结论（Review Verdict）

**结论：有条件通过（Approved with Conditions）**

### 评审依据

- 真实代码 commit：`efd7d01`
- 跨文件核对：`PlaybackEngine.ts` / `CanvasCompositor.ts` / `playbackFlags.ts` / `auth.py::require_admin` / alembic `010` & `011` / `requirements.txt` / `README.md` 部署章节
- 评审维度：Feasibility / Completeness / Consistency / Right-sizing
- 评审产出：6 项 P1 已就地修复并升版至 v2；7 项 P2 已记入 §10.1 由实施阶段处置

### 通过的前提条件（Conditions）

下游 Subtask #2 编码阶段必须满足：

1. **C1（关联 R-P1-1）**：实施 §3.2.1 中所有「本轮新增私有字段」时，名字必须与本 spec v2 完全一致（`_pendingSwapStart` / `_lastEmitMs`），方便后续审计。
2. **C2（关联 R-P1-2）**：`/api/admin/playback-proxies` 实现必须用真实列名查询、API alias 映射到短名；测试 B10 必须断言数据库实际列名而非短名。
3. **C3（关联 R-P1-3 / R1）**：rollout-playbook.md 必须把 `gunicorn -w 1` 写入「dogfood 启动 checklist」首项；`/api/admin/playback-metrics` 响应必须包含 `worker_pid` 与 `degraded`；多 worker 检测的 startup WARNING 必须可读。
4. **C4（关联 R-P1-4）**：F14 实施时**不得**新增第二个 killswitch localStorage 键；只允许 read-only 解析。pytest / vitest 断言 `localStorage` 只出现单一 `ecliptrix-playback-v2-killswitch` 键。
5. **C5（关联 R-P1-5）**：F4 实施时**不得**在前端 `flushNow` 加白名单过滤；后端 telemetry_router 未识别 metric 必须可读到 `app.log`（带 `unknown_metric=true` tag），不可静默丢弃。
6. **C6（关联 R-P1-6）**：F9 实施时 `selectPlaybackUrl` 函数体保持不变（仅 JSDoc 补丁）；`proxyHitMeter.recordTier` 的唯一调用点必须是 `PlaybackEngine.attachActiveMaterial`；F16 测试用例必须验证「同一素材多次 useMemo 触发，meter 计数 = 1」。

任一条件未满足 → Subtask #3（代码评审）必须打回。

### 通过后的下一步

Subtask #2 按以下顺序入场：
1. 后端 B1（aggregator）+ B2（admin router）+ B7 / B8 / B9 / B10 / B11 / B13 — 形成数据采集与查询主链路。
2. 前端 F1 / F2 / F4 / F5 / F6 / F7 / F8 / F14 — 形成上报与 killswitch 主链路。
3. 文档 D1 / D2 / D3 — rollout-playbook（含 C3 必含项）+ master-plan 状态表更新。
4. 测试 F15–F21 / B12 — 闭环。

> 评审完成时间：2026-05-16
> 评审人：Subtask #1（设计评审节点）
> 文档版本变更：v1 → **v2**
