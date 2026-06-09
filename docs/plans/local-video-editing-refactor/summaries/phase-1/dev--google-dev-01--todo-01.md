# DEV Summary — TODO 01 (剪辑核心 + 多轨道 + clip 语义契约)

## Meta
- **Agent:** google-dev-01
- **Role:** DEV
- **Task:** todo-01 (剪辑核心 + 多轨道 + clip 语义契约)
- **Phase:** 1
- **Verdict:** COMPLETED

## Key Decisions

1. **`ClipTimeMapping` operates on a minimal structural `ClipTimeRef`**
   (`{ startTime; duration; clipStart?; clipEnd? }`) — NOT the `TimelineItem`
   entity. Rationale: 02 (preview) and 05 (export) consume plain sequence DTOs
   (`VideoSequenceItem`/`AudioSequenceItem`), and `TimelineItem` exposes
   `startTime`/`duration` as value objects (not numbers). A numeric structural
   ref is satisfied by the entity DTO, both sequence DTOs, and test fixtures —
   so the SAME function serves both downstream consumers with no adapters.
2. **`TIME_EPSILON = 0.001`** snaps within-epsilon overruns to the exact clip
   bound in both mapping directions (no off-by-epsilon jitter at clip edges).
3. **Resize = exact TRIM (INV-3 strong constraint), enforced in the entity.**
   `TimelineItem.resize` now slides the dragged edge's source offset in
   lock-step with the track edge and derives `duration` from the clip interval,
   so `duration === clipEnd - clipStart` ALWAYS holds. The orchestrated
   `resizeItemAction` was intentionally left routing through slice→aggregate→
   entity (no clip math in the action) — the invariant lives in one place.
4. **`split` left half keeps the original id; right half gets a new id.** Both
   halves are exact source sub-intervals (seamless: `left.clipEnd ===
   right.clipStart`). Cut at/near a boundary (epsilon) or outside the item is a
   no-op (returns null, no history).
5. **has-audio gate lives in the store action, NOT the domain.** The domain
   (`TimelineAggregate.detachAudio`) stays pure and never reads live materials;
   `detachAudioAction(get, itemId, material)` takes a minimal
   `DetachAudioMaterialInfo` `{ type; hasAudio? }` supplied by the caller (which
   holds the live `materials` list). `hasAudio === false` blocks the detach;
   `undefined` (unknown) on a video material is treated as detachable.
6. **Detached audio reuses `TrackSelectionService`** to pick/create the target
   audio track, and is placed past existing items to avoid overlap;
   `autoOrganize` then repacks. Video + audio stay time-aligned because both
   tracks are packed identically.
7. **`audioDetached` is a pure passthrough on sequences — URL selection is
   unchanged.** CompositionAdapter forwards it onto `VideoSequenceItem` and into
   the `video_sequences[].audio_detached` wire field; 02/05 are responsible for
   actually suppressing the video's audio.
8. **Multi-target split records ONE `'SPLIT_ITEM'` history entry** (batch),
   matching `removeItemsAction`/`swapItemsAction` undo granularity.

## Execution Flow (TDD)

For each unit: failing vitest first, then implementation, then green.
1. `HistoryService` action-type union extended FIRST (`'SPLIT_ITEM'`,
   `'DETACH_AUDIO'`) so downstream `recordAction(...)` type-checks.
2. `ClipTimeMapping.test.ts` → `ClipTimeMapping.ts` (13 tests).
3. `SplitService.test.ts` → `SplitService.ts` (11 tests).
4. `TimelineItem.resize.test.ts` → entity resize INV-3 rewrite (5 tests).
5. Entity `audioDetached` field + domain/`@/types` type sync.
6. `TimelineAggregate.splitItemAtTime` + `detachAudio` + private helpers.
7. Slice methods `splitItemAtTime`/`detachAudio` + `setActiveTool`.
8. `splitItem.test.ts` → `splitAction` (7 tests).
9. `detachAudio.test.ts` → `detachAudioAction` (7 tests).
10. UI wiring: TimelineToolbar cut toggle; TimelineItem cut-click split +
    right-click detach entry.
11. CompositionAdapter `audioDetached` passthrough + `CompositionAdapter.audioDetached.test.ts` (4 tests).
12. `npm run type-check` (clean) + full `src/components/video` suite (733 green).

## Artifacts

### Created
- `src/components/video/timeline/domain/services/ClipTimeMapping.ts`
- `src/components/video/timeline/domain/services/SplitService.ts`
- `src/components/video/timeline/store/actions/splitItem.ts`
- `src/components/video/timeline/store/actions/detachAudio.ts`

### Modified
- `src/components/video/timeline/domain/services/HistoryService.ts` — action union.
- `src/components/video/timeline/domain/entities/TimelineItem.ts` — `audioDetached` field +
  resize INV-3 strong constraint (split into `resizeStartEdge`/`resizeEndEdge`).
- `src/components/video/timeline/domain/aggregates/TimelineAggregate.ts` — `splitItemAtTime`,
  `detachAudio`, `DetachAudioResult`, private `resolveAudioTrack`/`buildDetachedAudioData`.
- `src/components/video/timeline/domain/types.ts` — `audioDetached?` on `TimelineItemData` + `CreateItemProps`.
- `src/components/video/timeline/domain/index.ts` — barrel exports (ClipTimeMapping, SplitService, DetachAudioResult, types).
- `src/components/video/timeline/domain/ports.ts` — `VideoSequenceItem.audioDetached?`, request `audio_detached?`.
- `src/components/video/timeline/infrastructure/CompositionAdapter.ts` — `audioDetached` passthrough (URL unchanged).
- `src/components/video/timeline/store/slices/timelineSlice.ts` — `splitItemAtTime`/`detachAudio` slice methods.
- `src/components/video/timeline/store/slices/selectionSlice.ts` — `setActiveTool`.
- `src/components/video/timeline/store/actions/resizeItem.ts` — doc only (INV-3 lives in entity).
- `src/components/video/timeline/store/index.ts` — export `splitAction`/`detachAudioAction` + `SplitScope`/`DetachAudioMaterialInfo`.
- `src/components/video/timeline/TimelineToolbar.tsx` — cut/split tool toggle button (active state).
- `src/components/video/timeline/TimelineItem.tsx` — cut-click split, right-click detach entry, `onDetachAudio?` prop.
- `src/types/index.ts` — `audioDetached?` on `TimelineItem`.

### Tests added (46, all green)
- `domain/services/__tests__/ClipTimeMapping.test.ts` (13)
- `domain/services/__tests__/SplitService.test.ts` (11)
- `domain/entities/__tests__/TimelineItem.resize.test.ts` (5)
- `store/actions/__tests__/splitItem.test.ts` (7)
- `store/actions/__tests__/detachAudio.test.ts` (7)
- `infrastructure/__tests__/CompositionAdapter.audioDetached.test.ts` (4)

## Interfaces Touched (consumed by Phase 2 / Phase 3)

### ClipTimeMapping — THE shared clip contract (02 preview + 05 export MUST use it)
```ts
export const TIME_EPSILON = 0.001;
export interface ClipTimeRef { startTime: number; duration: number; clipStart?: number; clipEnd?: number; }
export function mapTimelineTimeToSourceTime(ref: ClipTimeRef, tTimeline: number): number;
export function mapSourceTimeToTimelineTime(ref: ClipTimeRef, tSource: number): number;
```
- Pure, no DOM/React. `clipStart` defaults to 0; clamps out-of-range inputs to
  the nearest clip edge; within-epsilon overruns snap to the exact bound.
- Importable from `@/components/video/timeline/domain` (barrel).

### audioDetached field (new, optional, backward-compatible)
- `TimelineItem` / `TimelineItemData` / `CreateItemProps`: `audioDetached?: boolean`.
- `VideoSequenceItem.audioDetached?: boolean`; wire request `video_sequences[].audio_detached?: boolean`.
- Semantics: when true, the video item's embedded audio is OWNED by a derived
  audio item — preview/export MUST suppress the video's audio.

### Store actions / slice
```ts
splitAction(get, tCut: number, scope: 'selected' | 'playhead'): void
detachAudioAction(get, itemId: string, material: DetachAudioMaterialInfo): void
// slice: setActiveTool(tool), splitItemAtTime(itemId, tCut), detachAudio(itemId)
// aggregate: splitItemAtTime(itemId, tCut): SplitResult|null; detachAudio(itemId): DetachAudioResult|null
```

## Issues & Risks

- **Shared-file race (TimelineItem.tsx):** TODO 03 (filmstrip/waveform) edited
  this file concurrently. I made strictly additive edits (cut-click split,
  right-click detach, `onDetachAudio?` prop, `activeTool` read) after confirming
  mtime stability. No TODO-03 code was removed. Both feature sets coexist;
  full suite green.
- **Detach UI not yet wired through TrackContainer/TimelinePanel.** Those files
  are outside TODO-01's file scope. `onDetachAudio` is an optional prop, so the
  detach entry is inert until a parent (panel) supplies it with the live
  material's has-audio signal. The action + entry handler are complete.
- **autoOrganize repacks leading gaps.** A detached audio item lands flush-from-0
  along with its video track; alignment is preserved because both tracks pack
  identically (test `keeps the detached audio time-aligned…`). If 06 wants to
  preserve absolute positions it should revisit the autoOrganize policy, not the
  detach logic.

## Context for Downstream

### TODO 02 (preview) MUST know
- Compute source-read time via `mapTimelineTimeToSourceTime(seq, tTimeline)` and
  cursor position via `mapSourceTimeToTimelineTime`. DO NOT re-derive clip math
  — that divergence is symptom ② root cause. Use `TIME_EPSILON` for edges.
- Honour `VideoSequenceItem.audioDetached`: a detached video sequence
  contributes NO audio; its audio comes from the paired audio sequence
  (same materialId, same start/dur/clip).
- INV-3 now holds on every item (`duration === clipEnd - clipStart`); after
  split, halves join seamlessly with no gap/overlap.

### TODO 05 (export) MUST know
- The filtergraph clip trim MUST use the same `clipStart/clipEnd` interval the
  contract maps; reuse `ClipTimeMapping` rather than recomputing offsets.
- Read `video_sequences[].audio_detached` from the request and drop that
  video's audio from the mix (the matching `audio_sequences[]` entry supplies it).
- `clip_start`/`clip_end`/`original_duration` are already serialised by
  `CompositionAdapter.buildCompositionRequest`; `audio_detached` is now too.

### TODO 06 (persistence) MUST know
- Persist split-produced item ids and the `audioDetached` flag (already in
  `toPlainObject`). On load, legacy items violating INV-3 should be regularised
  by recomputing `duration` from `clipEnd - clipStart` (06 owns this).
```
Verification: `npm run type-check` clean; `vitest run src/components/video` →
92 files / 733 tests passed (46 new). No regressions.
```
