# Video Editing Agent — Same-Track Overlap Prevention

## 背景

Agent 自动剪辑时会通过 `add_to_track`、`move_clip`、`resize_clip`、`trim_clip`、`compose_storyboard` 等工具直接写入时间线。这些工具的写入路径与 UI 拖拽路径分离 —— UI 每次操作后都会调用 `TimelineAggregate.organizeVideoAudioTracks()` 自动打紧轨道，而 Agent 路径直接在 `OperationApplier.applyToTimeline` / `agent.ts::applyOperationLocally` 里 `deepClone + push`，跳过了打紧步骤。结果：Agent 经常把多个素材剪在同一轨道的同一时间区间，导致预览和导出时素材互相覆盖。

本次改动通过"reconcile 双端镜像 + 工具反思闭环"消除该问题。

## 方案

### 1. 共享纯函数 `reconcile.ts`

`src/lib/video-editing-agent/reconcile.ts` 暴露两个纯函数：

- `reconcileOverlapsAfterAgentOp(state, operation?)` — 仅在 operation 触及的轨道上检测重叠，发现后按"按 startTime 排序后从 0 开始打紧"（pack-flush）策略修复，**算法与 `TimelineAggregate.organizeVideoAudioTracks` 完全一致**。`subtitle` 与 `locked` 轨道始终跳过。
- `packAllReorganisableTracks(state, opts?)` — 对所有可重组轨道（或 `opts.trackIds` 指定的子集）强制 pack-flush，供 `auto_fix_overlaps` 工具使用。

两个函数都返回 `{ changedTrackIds, operations: TimelineOperation[] }`：移动事件以 `move_clip` 形式给出，便于 SSE 路径同步给前端。

### 2. 双端调用 reconcile（R2 修复）

服务端 (`agent.ts::applyOperationLocally`) 与浏览器端 (`OperationApplier.applyToTimeline`) 在每次 Agent operation 落地后都调用 `reconcileOverlapsAfterAgentOp(state, operation)`。前端调用合并到同一次 `setTimelineState` 中（R11：undo 快照不会出现"重叠中间态"）。

### 3. 新增两个 Agent 工具（始终可用）

- `check_timeline_overlaps`（`tools/checkOverlaps.ts`）：零参数。返回 `{ valid, overlapCount, overlaps[], summary }`。
- `auto_fix_overlaps`（`tools/autoFixOverlaps.ts`）：`{ trackIds?: string[] }`。pack-flush 全部或指定轨道。返回 `{ noop, fixedCount, changedTrackIds, overlapsBefore, overlapsAfter, operations: TimelineOperation[], message, warning? }`。

`auto_fix_overlaps` **不调用 `context.updateTimeline`**：它直接 mutate `context.timelineState`，并把所有 `move_clip` 事件放进 `details.operations[]`。前端 `AgentEventRouter.handleToolResult` 已支持识别该字段并逐个 apply（与 `compose_storyboard` 同构），从而避免 `operations` map last-wins 丢事件（R12 修复）。

### 4. 编辑工具 overlapWarning

`add_to_track` / `move_clip` / `resize_clip` / `trim_clip` / `compose_storyboard` 在每次成功调用后都会调用共享 helper `runOverlapPostCheck` + `formatOverlapWarning`，若仍有重叠则把 `overlapWarning + overlapCount` 字段附加到 result。注意：因为 reconcile 已在落地后立即生效，正常情况下这两个字段不会出现 —— 当出现时，多半是落到了 subtitle/locked 轨道上的疑难重叠，需要 LLM 显式介入。

`get_timeline` 工具同样新增 `overlapCheck: { valid, overlapCount, overlaps[] }` 字段。

### 5. systemPrompt 反思-修复闭环

在 `systemPrompt.ts` 末尾追加新约束章节 "同轨不可重叠"：

- 编辑工具返回 `overlapWarning` → 立即调用 `auto_fix_overlaps`，否则用 `move_clip` 显式调整。
- 复合编辑结束 → `check_timeline_overlaps` → 若 `valid=false` 就 `auto_fix_overlaps` → 再 `check_timeline_overlaps`，循环直至 `valid=true`。
- **死循环防护**：连续 2 次 `auto_fix_overlaps` 返回 `fixedCount=0` 或 `noop=true` 立刻停止；剩余无法自动修复的重叠（subtitle/locked 轨）向用户说明并请求人工介入。

ALWAYS_AVAILABLE_TOOLS 列表也更新加入 `check_timeline_overlaps` / `auto_fix_overlaps`。

## 半开区间约定

`findAllOverlaps` 与 reconcile 一致使用 `[startTime, startTime + duration)` 半开区间，相切边界（`endA === startB`）不算重叠。浮点容差 `epsilon = 1e-6` 秒。

## 测试

| 测试 | 覆盖 |
|------|------|
| `findAllOverlaps.test.ts` | 空、无重叠、单对/多对/嵌套、相切、浮点容差、轨道过滤、无副作用 |
| `reconcile.test.ts` | pack-flush、locked/subtitle 跳过、不污染无关轨道、幂等、`packAllReorganisableTracks` 全量 |
| `checkOverlaps.test.ts` | 干净时间线 valid=true、重叠时 overlaps[] 完整、summary 含 auto_fix 引导 |
| `autoFixOverlaps.test.ts` | 修复正确、noop、locked/subtitle 跳过、trackIds 过滤、批量 operations 数组 |
| `operationApplier.overlap.test.ts` | 单次 setTimelineState（R11）、move_clip 自动修复、subtitle 不动、undo 链路完整 |
| `agent.reconcile.test.ts` | 服务端 `applyOperationLocally` 镜像 reconcile（R2 验证） |
| `agent.overlap.integration.test.ts` | 三次 `add_to_track(startTime=0)` 后 timeline 无重叠、`check` 返回 valid、`autoFix` noop、overlapWarning 不冒泡 |

跑测：`npx vitest run src/components/video/timeline src/lib/video-editing-agent` —— 90 个测试全部通过。

## 不在本期内

- `auto_fix_overlaps` 当前只能解决同轨重叠，不会跨轨道搬移片段。需要跨轨调整时仍需 LLM 调用 `move_clip(newTrackId=...)`。
- 历史项目打开时不主动触发 reconcile（R13 缓解）：reconcile 只在 Agent operation 落地路径上生效。
