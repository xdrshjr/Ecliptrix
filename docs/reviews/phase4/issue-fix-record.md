# Phase 4 Issue Fix Record — 视频剪辑 Agent 同轨重叠修复

## Issue #1 — 不安全的类型强转 (Minor, Type-Safety)

**文件**:
- `src/lib/video-editing-agent/reconcile.ts`
- `src/lib/video-editing-agent/OperationApplier.ts`

**问题描述**:

`reconcileOverlapsAfterAgentOp(state, operation)` 的 `operation` 形参原来是 `TimelineOperation`（定义在 `src/lib/video-editing-agent/types.ts`）。但是 `OperationApplier.applyToTimeline` 内接收到的 operation 是 `AgentTimelineOperation`（定义在 `src/types/index.ts`）。两个 discriminated union 在 add_clip 分支上的 `material` 字段有差异：

| 字段 | `TimelineOperation.material` | `AgentTimelineOperation.material` (AgentMaterialData) |
|------|--------------------------|---------------------------------------------------|
| `id` | ✅ | ✅ |
| `name` | ✅ | ✅ |
| `type` | ✅ | ✅ |
| `url` | **string（必填）** | **缺失** |
| `thumbnailUrl?` | ✅ | ✅ |

原实现靠 `operation as TimelineOperation` 强转绕过类型检查。reconcile 实际上只读 `operation.type`、`operation.clip.trackId` 等字段，完全不访问 `material.url`，所以运行时没有 bug。但强转在类型层面掩盖了"这两个类型结构不同"的事实，未来若有人加一行 `operation.material.url` 的访问代码，静态类型无法拦截。

**严重度**: Minor（不影响运行时，但削弱了静态类型保障）

**修复**:

在 `reconcile.ts` 中定义一个内部类型别名 `ReconcilableOperation = TimelineOperation | AgentTimelineOperation`，把两种 discriminated union 合并。TypeScript 对 union 的 switch/case 收窄仍然有效，因为二者的 `type` 判别字段完全一致；而 reconcile 读取的 `clip.trackId` / `clipId` / `trackId` / `fromTrackId` / `toTrackId` 在两种类型下都存在且类型一致。

**Before** (`reconcile.ts`):

```ts
import type { TimelineState, Track, TimelineItem } from '@/types';
import type { TimelineOperation } from './types';

function affectedTrackIds(
  state: TimelineState,
  operation?: TimelineOperation,
): Set<string> | null { /* ... */ }

export function reconcileOverlapsAfterAgentOp(
  state: TimelineState,
  operation?: TimelineOperation,
  opts?: { epsilon?: number },
): ReconcileResult { /* ... */ }
```

**After**:

```ts
import type { TimelineState, Track, TimelineItem, AgentTimelineOperation } from '@/types';
import type { TimelineOperation } from './types';

/**
 * Accepted operation shape for reconcile. `TimelineOperation` (from the
 * video-editing-agent types) and `AgentTimelineOperation` (from `@/types`)
 * share every field reconcile reads but differ on unrelated ones like
 * `material.url`, so accepting the union lets both the in-browser
 * `OperationApplier` and the server-side `agent.ts` call this helper
 * without an unsafe cast.
 */
type ReconcilableOperation = TimelineOperation | AgentTimelineOperation;

function affectedTrackIds(
  state: TimelineState,
  operation?: ReconcilableOperation,
): Set<string> | null { /* ... */ }

export function reconcileOverlapsAfterAgentOp(
  state: TimelineState,
  operation?: ReconcilableOperation,
  opts?: { epsilon?: number },
): ReconcileResult { /* ... */ }
```

**Before** (`OperationApplier.ts`):

```ts
import type { AgentOperation, MaterialOperation, /* ... */ TimelineOperation } from './types';
// ...
reconcileOverlapsAfterAgentOp(state, operation as TimelineOperation);
```

**After**:

```ts
import type { AgentOperation, MaterialOperation, /* ... */ } from './types';
// `TimelineOperation` import dropped — no longer needed here.
// ...
reconcileOverlapsAfterAgentOp(state, operation);
```

**验证**:

1. `npx tsc --noEmit` 通过（0 错误）。
2. `npx vitest run src/components/video/timeline src/lib/video-editing-agent` → 13 test files / 90 tests 全部通过。
3. 全量 `npx vitest run` → 43 test files / 302 tests 全部通过。

`agent.ts::applyOperationLocally` 本来就用 `operation: TimelineOperation` 直接调用 reconcile，新 union 类型向下兼容，无需调整。

---

## 未修问题（已记录为可接受）

| # | 文件 | 描述 | 不修原因 |
|---|------|------|--------|
| obs-1 | `AgentEventRouter.handleToolResult` | `auto_fix_overlaps` 的 N 条 move_clip 被当作 N 条独立 operation 应用，在 UI 的 undo 列表里显示为 N 条记录。 | 与现有 `compose_storyboard` 路径完全同构。分组 UX 是独立的 feature，超出本期范围（"不能让 Agent 剪辑出重叠 + 能检查 + 能修复"）。 |
| obs-2 | `OperationApplier.applyToTimeline` L546 | reconcile 已经在 `state.totalDuration` 写入一次（有变更时取 `Math.max(computeTotalDuration(state), state.totalDuration ?? 0)`），外层又做 `state.totalDuration = Math.max(maxEnd, state.totalDuration);`。冗余但结果一致。 | 非 bug。移除需要同步调整测试期望，收益微乎其微。 |
| obs-3 | pack-flush 策略本身 | 策略是"按 startTime 排序后从 0 开始打紧整条轨道"。若轨道上已有 a@0 + b@10，新插入 c@5，pack 后会得到 a@0 + c@5 + b@(5+c.dur)，即 b 被右移。 | 这就是 UI 层 `TimelineAggregate.organizeVideoAudioTracks` 既有行为（拖拽完成后也这么打紧），本期目标是"让 Agent 行为与 UI 一致"而不是"改 UI 行为"。 |
| obs-4 | `tools/deleteClip.ts` | 未加 `overlapWarning` post-check。 | `delete_clip` 不可能引入新重叠（只会减少片段）；省掉一次 O(N log N) 扫描，符合防御性编码原则。 |

---

## 修复后最终状态

- **总改动**: 新增 9 文件 + 修改 11 文件（Phase 3 交付）+ 本次 Phase 4 微调 2 文件（reconcile.ts、OperationApplier.ts）。
- **代码行数变化**: Phase 4 净增约 +12 / -3 行（新增类型别名 + 注释，删除冗余 import + cast）。
- **测试**: 全量 302/302 通过。
- **类型检查**: `tsc --noEmit` 0 错误。
