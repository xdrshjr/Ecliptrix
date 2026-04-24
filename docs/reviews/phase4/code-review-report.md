# Phase 4 Code Review Report — 视频剪辑 Agent 同轨重叠修复

> **Reviewer**: Senior Code Reviewer
> **Scope**: Phase 3 交付物 — `reconcile.ts` + `check_timeline_overlaps` / `auto_fix_overlaps` 工具 + 5 个编辑工具 overlapWarning 改造 + `OperationApplier` / `agent.ts::applyOperationLocally` 双端 reconcile + systemPrompt 反思-修复闭环
> **Date**: 2026-04-25

---

## 执行摘要

Phase 3 交付的"reconcile 双端镜像 + Agent 反思-修复闭环"方案落地质量高：核心算法纯函数化、与 UI 层 `TimelineAggregate.organizeVideoAudioTracks` 同构、前后端 state 单次 `setState` 落地（修复 R11 undo 中间态）、批量编辑事件通过 `details.operations[]` 传递避免 last-wins 丢事件（R12）、systemPrompt 追加硬约束章节并提供死循环防护。

**测试**: 90/90 overlap 相关测试通过，全量 302/302 通过；`tsc --noEmit` 无报错。

**发现问题**: 0 项 critical / 0 项 major / **1 项 minor 已修复** + 少量文档级 observation（不修）。

**结论**: 代码质量达标，可进入 Phase 5（commit & deliver）。

---

## 评审范围清单

### 新增文件 (9)

| 文件 | 作用 |
|------|------|
| `src/lib/video-editing-agent/reconcile.ts` | 纯函数 pack-flush（前后端共享） |
| `src/lib/video-editing-agent/tools/checkOverlaps.ts` | `check_timeline_overlaps` Agent 工具 |
| `src/lib/video-editing-agent/tools/autoFixOverlaps.ts` | `auto_fix_overlaps` Agent 工具 |
| `src/lib/video-editing-agent/__tests__/reconcile.test.ts` | reconcile 单测 |
| `src/lib/video-editing-agent/__tests__/checkOverlaps.test.ts` | check 工具单测 |
| `src/lib/video-editing-agent/__tests__/autoFixOverlaps.test.ts` | autoFix 工具单测 |
| `src/lib/video-editing-agent/__tests__/operationApplier.overlap.test.ts` | OperationApplier 反思-修复单测 |
| `src/lib/video-editing-agent/__tests__/agent.reconcile.test.ts` | 服务端镜像 reconcile 单测 |
| `src/lib/video-editing-agent/__tests__/agent.overlap.integration.test.ts` | Agent 端到端集成测试 |
| `src/components/video/timeline/__tests__/findAllOverlaps.test.ts` | 重叠扫描单测 |
| `docs/video-editing-agent-overlap-fix.md` | 方案设计文档 |

### 修改文件 (11)

| 文件 | 改动摘要 |
|------|--------|
| `src/components/video/timeline/domain/services/ItemPlacementService.ts` | 新增 `findAllOverlaps(tracks, opts?)` 静态方法 |
| `src/lib/video-editing-agent/OperationApplier.ts` | 在单次 `setTimelineState` 内调用 reconcile |
| `src/lib/video-editing-agent/agent.ts` | `applyOperationLocally` 镜像调用 reconcile |
| `src/lib/video-editing-agent/systemPrompt.ts` | 追加"同轨不可重叠"硬约束章节 + 死循环防护 + ALWAYS_AVAILABLE_TOOLS 扩充 |
| `src/lib/video-editing-agent/tools/index.ts` | 注册 2 个新工具 + 导出 `runOverlapPostCheck` / `formatOverlapWarning` helper |
| `src/lib/video-editing-agent/tools/addToTrack.ts` | 成功路径附加 `overlapWarning + overlapCount` |
| `src/lib/video-editing-agent/tools/moveClip.ts` | 同上 |
| `src/lib/video-editing-agent/tools/resizeClip.ts` | 同上 |
| `src/lib/video-editing-agent/tools/trimClip.ts` | 同上 |
| `src/lib/video-editing-agent/tools/composeStoryboard.ts` | 同上 + 批量 `operations[]` 仍完整返回 |
| `src/lib/video-editing-agent/tools/getTimeline.ts` | 返回值新增 `overlapCheck: { valid, overlapCount, overlaps[] }` |

---

## 评审发现（按维度）

### 1. 正确性 Correctness

核心路径多次细读，未发现逻辑错误：

- **半开区间语义** — `trackHasOverlap` / `findAllOverlaps` / pack-flush 统一使用 `[start, start+duration)`，相切边界 (a.end === b.start) 不算重叠。浮点容差 1e-6 秒，`reconcile.ts` 与 `ItemPlacementService.findAllOverlaps` 采用同一常量，不会出现"某工具报重叠、另一工具报无"的抖动。
- **受影响轨道收敛** — `affectedTrackIds()` 只返回 operation 触及的 trackId 集合，避免"修复 Agent 没碰过的历史重叠"（R13 缓解）。对 `move_clip` 同时追加 from/to 两个轨道，符合语义。
- **幂等性** — `reconcileOverlapsAfterAgentOp` 对已打紧的时间线返回空 `operations`，`reconcile.test.ts` 有专门单测覆盖；`packAllReorganisableTracks` 同样幂等。
- **subtitle / locked 跳过** — `isReorganisable()` 统一入口，两处 pack 函数复用，单测显式覆盖（`autoFixOverlaps.test.ts` + `reconcile.test.ts`）。
- **totalDuration 同步** — reconcile 在有变更时更新 `state.totalDuration = Math.max(computeTotalDuration(state), state.totalDuration ?? 0)`；`OperationApplier` 外层也会再取一次 max，结果一致（略冗余，非 bug）。
- **R11 undo 中间态** — `OperationApplier.applyToTimeline` 只调用一次 `setTimelineState(state)`，reconcile 在同一个 state 对象上 mutate 后一次性落地；`operationApplier.overlap.test.ts` 的 `setStateCalls.toHaveLength(1)` 断言明确保护此不变量。
- **R12 批量事件** — `auto_fix_overlaps` 不调用 `context.updateTimeline`（避免 `operations` Map last-wins），而把 move_clip 数组塞到 `details.operations[]`；前端 `AgentEventRouter.handleToolResult` 已识别该字段并逐个 `applier.apply`，与 `compose_storyboard` 同构。
- **R2 双端镜像** — 服务端 `agent.ts::applyOperationLocally` 与浏览器端 `OperationApplier.applyToTimeline` 使用同一 pure function，相同输入必然产出相同 state。`agent.reconcile.test.ts` 单测验证服务端路径结果与前端一致。

### 2. 代码质量 Code Quality

- **模块边界清晰** — `reconcile.ts` 无 React/DOM/Zustand 依赖，可在 Next.js API route 与浏览器两侧复用。
- **命名与风格** — 与现有 `video-editing-agent/tools/*.ts` 风格一致（工厂函数 + `Type.Object` schema + `{ success, ...result }` 返回）。
- **注释** — 所有关键决策都有 **Why** 解释（R11/R12/R13、subtitle/locked 跳过、operations Map 冲突）。
- **一个类型安全 nit（已修）** — `OperationApplier.applyToTimeline` 原来需要 `operation as TimelineOperation` 强转，因为 `AgentTimelineOperation.material` 不带 `url` 字段。详见 Issue #1（下文）。

### 3. 错误处理 Error Handling

- 所有编辑工具在失败路径用 `{ success: false, error: ... }` 统一壳，与已有 `addToTrack` 约定一致。
- `auto_fix_overlaps` 在 subtitle/locked 造成的"未解决重叠"会额外返回 `warning` 字段，避免 LLM 死循环。
- circuit breaker（5 次连续失败中断）已有，本期未新增失败源。
- **无 silent fallback** — 唯一一次 `console.warn` 在 `OperationApplier` 的初始 state fallback，属可追踪降级。

### 4. 安全 Security

- 所有新增工具接受的参数均为本地 trackIds / 无外部查询，不经过 shell / SQL / HTML 插值。
- `formatOverlapWarning` 输出含用户无法控制的内容（片段 ID），但仅用于 LLM 消费，不渲染为 HTML。
- 无新增网络请求 / API 调用。无 secret 暴露。

### 5. 性能 Performance

- `findAllOverlaps` 复杂度 O(N log N) per track（排序）+ O(N+K) 扫描（N=片段数，K=重叠对）。对典型时间线（≤数百片段）运行时间 < 5ms。
- `pack-flush` 同样 O(N log N) per track。
- reconcile 仅在 affected tracks 上运行，不会对大规模项目全表扫描。
- `JSON.parse(JSON.stringify(...))` deep-clone 是本项目既有约定；在每次 agent operation 落地时调用 1 次，可接受。

### 6. 测试质量 Test Quality

| 文件 | 用例数 | 覆盖点 |
|------|------|------|
| `findAllOverlaps.test.ts` | 8 | 空/无重叠/单对/嵌套/相切/浮点容差/轨道过滤/不可变性 |
| `reconcile.test.ts` | 8 | pack-flush 行为、locked/subtitle 跳过、不影响无关轨、幂等、packAll 变体、trackIds filter |
| `checkOverlaps.test.ts` | 2 | valid=true / valid=false 返回结构完整 |
| `autoFixOverlaps.test.ts` | 6 | 修复正确、noop、locked/subtitle 跳过、trackIds filter、批量 operations 数组 |
| `operationApplier.overlap.test.ts` | 4 | 单次 setState（R11）、move_clip 自动修复、subtitle 不动、undoOperation 链路 |
| `agent.reconcile.test.ts` | 2 | 服务端镜像一致性（R2） |
| `agent.overlap.integration.test.ts` | 4 | 三次 add@0 无重叠、check valid=true、autoFix noop、overlapWarning 不冒泡 |

覆盖维度齐全：算法单元、工具壳、UI-state 集成、服务端镜像、端到端 Agent 流。断言粒度合理（既校验 startTime 数组也校验 operations 类型集合）。

### 7. 可维护性 Maintainability

- 所有 post-check 抽到 helper (`runOverlapPostCheck` / `formatOverlapWarning`)，五个编辑工具共用同一套字符串模板；未来调整提示文案只需改一处。
- `reconcile.ts` 导出的 `ReconcileResult` 结构明确，消费方（`auto_fix_overlaps`）通过结构赋值即可使用。
- `docs/video-editing-agent-overlap-fix.md` 完整解释"为何这么做 / 不在本期范围"。

---

## 问题清单 Issue List

| # | 严重度 | 文件 | 问题 | 状态 |
|---|-------|------|-----|------|
| 1 | minor | `reconcile.ts` + `OperationApplier.ts` | `reconcile` 的 `operation` 形参类型是 `TimelineOperation`（`@/types/video-editing-agent`），但 `OperationApplier` 传入的是 `AgentTimelineOperation`（`@/types`），`material.url` 字段差异导致 `as TimelineOperation` 强转。reconcile 实际并未读 `url`，但强转在类型层面掩盖了差异。 | **已修复**（详见 Issue Fix Record #1） |
| obs-1 | doc | `auto_fix_overlaps` → 前端批量应用 | 每条 `move_clip` 被独立 `operationApplier.apply(..., 'tc-batch-i')` 应用，每次产生一条 `OperationRecord`，N 条移动在 UI undo 列表里会显示为 N 次记录。这与 `compose_storyboard` 同构，符合既有模式，不修。 | 已记录，不改 |
| obs-2 | doc | `OperationApplier.applyToTimeline` L546 | reconcile 已在 `state.totalDuration` 写一次，外层又做 `Math.max`。冗余但结果一致。 | 已记录，不改 |
| obs-3 | doc | pack-flush 策略 | 打紧策略会把**整条轨道**的所有后续片段右移以填补新加入片段造成的重叠，可能改变 Agent 未明确请求的片段位置。这是与 UI 拖拽完成后 `organizeVideoAudioTracks` 完全一致的现有约定，不修。 | 已记录，不改 |
| obs-4 | doc | `delete_clip` 工具未加 `overlapWarning` | `delete_clip` 逻辑上不可能引入新重叠；不加 post-check 节省一次 O(N log N) 扫描。 | 设计合理，不改 |

没有任何 critical / major 级别问题。

---

## 最终验证 Final Validation

```
$ npx tsc --noEmit
# 无输出（0 错误）

$ npx vitest run src/components/video/timeline src/lib/video-editing-agent
Test Files  13 passed (13)
     Tests  90 passed (90)

$ npx vitest run
Test Files  43 passed (43)
     Tests  302 passed (302)
```

全量测试通过。无回归。Issue #1 修复后再次全跑仍 302/302 绿色。
