# TESTER Summary — TODO 01 (剪辑核心 + 多轨道 + clip 语义契约)

## Meta
- **Agent:** google-tester-01
- **Role:** TESTER
- **Task:** todo-01
- **Phase:** 1
- **Verdict:** ALL PASS (with one minor regression-coverage gap — see Gaps)

## Verdict rationale

Every spec-01 §6 acceptance item and every file in the §3 change plan has a
corresponding implementation AND a green test, except acceptance item §6 #6's
*cross-track move type-compatibility* line, which is implemented (guard exists,
exercised indirectly) but lacks a dedicated `moveItem`-level test. That item is
explicitly marked "既有/回归" (pre-existing capability, regression-only) in the
spec, so it does not block, but it is a traceability gap a reviewer should have
flagged. INV-1..INV-3, the split worked-example, and the symptom-② resize
boundary are all directly asserted by tests. Focused suites: 37/37 green;
+resize 5/5; `type-check` clean.

## Spec-traceability matrix

### §6 acceptance items

| # | Acceptance item | Implementation | Test | Status |
|---|---|---|---|---|
| 1 | `ClipTimeMapping`: clip=[2,5] start=10 → t=12→源4; round-trip; clamp; epsilon | `domain/services/ClipTimeMapping.ts` | `ClipTimeMapping.test.ts` (13 tests: t=12→4, start/end maps, clamp both dirs, default clipStart, epsilon-overrun, two round-trip suites) | PASS |
| 2 | `SplitService`: start=10 dur=6 clip=[2,8] cut t=13 → 左 dur=3 [2,5] / 右 start=13 dur=3 [5,8]; seamless;端点/界外 no-op; INV | `domain/services/SplitService.ts` | `SplitService.test.ts` (11 tests; the exact worked example is asserted value-by-value, seamless adjacency, start/end/epsilon/out-of-range no-op, INV-1..INV-3, default-clip fallback) | PASS |
| 3 | `TimelineItem.resize`: trim → duration==clipEnd-clipStart (INV-3); 不越 originalDuration | `domain/entities/TimelineItem.ts` (`resize`→`resizeStartEdge`/`resizeEndEdge`) | `domain/entities/__tests__/TimelineItem.resize.test.ts` (5 tests: end/start lock-step, clamp to originalDuration, clipStart≥0, no-clip fallback; INV-3 asserted in each) | PASS |
| 4 | `splitAction('playhead')`: 多可见轨一拆二, 单条历史, undo/redo 往返 | `store/actions/splitItem.ts` | `store/actions/__tests__/splitItem.test.ts` (6 tests: playhead fan-out, locked skip, exactly-1 SPLIT_ITEM history, undo==before / redo==after via `exportToData().tracks` deep-equal, no-op no-history, selected scope) | PASS |
| 5 | `detachAudioAction`: 视频→audio 轨 item (同 start/dur/clip), 原 item audioDetached=true; undo | `store/actions/detachAudio.ts` + `TimelineAggregate.detachAudio` | `store/actions/__tests__/detachAudio.test.ts` (7 tests: mirror start/dur/clip+materialId, flag set, 1 DETACH_AUDIO history + undo, redo, no-audio no-op, already-detached no-op, unknown-hasAudio detachable, time-align after autoOrganize) | PASS |
| 6a | 多轨道: 跨轨移动类型兼容校验 | `TimelineAggregate.moveItem` → `Track.addItem` → `canAcceptMaterial` (pre-existing) | **No dedicated moveItem type-compat test.** Cross-track/subtitle/locked rejection is covered only for `swapItems` (`__tests__/swapItems.test.ts`) | GAP (minor — guard implemented, regression-only item) |
| 6b | autoOrganize 紧排 video/audio、跳过 subtitle/locked (回归) | `TimelineAggregate.autoOrganize` (pre-existing) | `__tests__/organizeVideoAudioTracks.test.ts` (packs v/a, leaves subtitle, skips locked, mixed) + `__tests__/autoOrganize.integration.test.ts` | PASS |

### §3 file/module change plan

| File | Action | Implemented | Test | Status |
|---|---|---|---|---|
| `domain/services/ClipTimeMapping.ts` | new | yes | ClipTimeMapping.test.ts | PASS |
| `domain/services/SplitService.ts` | new | yes | SplitService.test.ts | PASS |
| `domain/services/__tests__/SplitService.test.ts` | new | — | self | PASS |
| `domain/services/__tests__/ClipTimeMapping.test.ts` | new | — | self | PASS |
| `domain/entities/TimelineItem.ts` | modify (INV-3 resize + audioDetached) | yes | TimelineItem.resize.test.ts | PASS |
| `domain/aggregates/TimelineAggregate.ts` | modify (splitItemAtTime, detachAudio) | yes | covered via splitItem/detachAudio action tests | PASS |
| `domain/services/HistoryService.ts` | modify (SPLIT_ITEM, DETACH_AUDIO union) | yes | asserted by splitItem/detachAudio history-type tests | PASS |
| `store/actions/splitItem.ts` | new | yes | splitItem.test.ts | PASS |
| `store/actions/detachAudio.ts` | new | yes | detachAudio.test.ts | PASS |
| `store/actions/__tests__/splitItem.test.ts` | new | — | self | PASS |
| `store/actions/__tests__/detachAudio.test.ts` | new | — | self | PASS |
| `store/slices/selectionSlice.ts` | modify (setActiveTool / cut wiring) | yes (`setActiveTool`) | indirectly via toolbar; no direct unit test | PASS (thin) |
| `store/actions/resizeItem.ts` | modify (route INV-3) | yes (doc-only; invariant in entity) | resize covered at entity layer | PASS |
| `TimelineToolbar.tsx` | modify (cut/split button usable) | yes (`cutButton`, `handleToggleCut`, `isCutActive`) | `__tests__/TimelineToolbar.comingSoon.test.ts` no longer marks cut comingSoon (only effects/transitions) | PASS |
| `TimelineItem.tsx` | modify (cut-click split + detach entry) | yes (additive; coexists with TODO-03) | no direct interaction test (UI) | PASS (thin) |
| `infrastructure/CompositionAdapter.ts` | modify (audioDetached passthrough) | yes (`audioDetached`, `audio_detached`) | `infrastructure/__tests__/CompositionAdapter.audioDetached.test.ts` (4 tests) | PASS |
| `domain/ports.ts` / `domain/types.ts` / `src/types/index.ts` | modify (audioDetached field) | yes | type-check clean + audioDetached tests | PASS |

## Invariant & worked-example verification

- **INV-1 (duration>0):** asserted — `SplitService.test.ts` "both halves satisfy INV-1..INV-3" (`expect(duration).toBeGreaterThan(0)`).
- **INV-2 (0≤clipStart<clipEnd≤originalDuration):** asserted in the same test (cs≥0, cs<ce, ce≤od).
- **INV-3 (duration==clipEnd-clipStart):** asserted in *both* `SplitService.test.ts` (`toBeCloseTo(ce-cs, 9)` on each half) and `TimelineItem.resize.test.ts` (every resize case asserts `duration==clipEnd-clipStart`). This is the symptom-② root cause and is the most heavily pinned invariant. PASS.
- **Split worked-example (§6 #2):** EXACTLY asserted — `SplitService.test.ts` "splits start=10 dur=6 clip=[2,8] at t=13 into [2,5] and [5,8]" checks left {start10,dur3,clip[2,5]} and right {start13,dur3,clip[5,8]} value-by-value. PASS.
- **Round-trip (§2.2):** asserted — two suites iterate sample points source→timeline→source and timeline→source→timeline to 9-digit identity. PASS.

## Symptom-② boundary checks

1. **Resize keeps duration==clipEnd-clipStart:** YES — `TimelineItem.resize.test.ts` asserts it on end-trim, start-trim, originalDuration clamp, and clipStart≥0 clamp. Implementation derives `duration` from the clip interval in both `resizeStartEdge`/`resizeEndEdge`, so the invariant is structurally guaranteed, not coincidental.
2. **ClipTimeMapping is the single shared contract / no duplicate clip math:** PARTIALLY VERIFIED.
   - The mapping pair lives in exactly one file (`ClipTimeMapping.ts`), exported via the domain barrel; `SplitService` and the entity reuse `TIME_EPSILON` from it.
   - `resizeItemAction` correctly delegates to slice→aggregate→entity with NO clip math in the action (verified by reading the file — doc comment + pass-through only).
   - **Caveat (not a todo-01 defect):** `mapTimelineTimeToSourceTime`/`mapSourceTimeToTimelineTime` are not yet *consumed* by any preview/export code (grep across `src` finds only the domain barrel, SplitService, and tests). The spec assigns that consumption obligation to TODO 02/05, so todo-01's job (deliver the contract + tests) is complete; but the "no duplicate clip math downstream" guarantee cannot be confirmed until 02/05 land and are checked against this contract.

## Gaps found

1. **[Minor] §6 #6 cross-track move type-compatibility has no dedicated test.**
   `TimelineAggregate.moveItem` enforces compatibility through `Track.addItem`→`canAcceptMaterial`, but the only rejection tests target `swapItems`, not `moveItem`. Should the reviewer have caught it? **Yes** — it is a named §6 acceptance line. Severity is low because the guard is pre-existing and the spec scopes this item as regression-only, but the acceptance line is technically un-pinned. Recommend adding one test: dropping a `video` item onto a `subtitle`/`audio` track via `moveItem` throws.
2. **[Informational] Downstream contract consumption unverifiable now.** Per §2.2, 02/05 MUST call `ClipTimeMapping`; no consumer exists yet (by design). Carry to TODO 02/05 acceptance: confirm preview/export import these functions rather than re-deriving clip math.
3. **[Informational] UI interaction paths (TimelineItem cut-click split, right-click detach) have no behavioral test** — only the toolbar source-level comingSoon test changed. Dev summary already notes detach is inert until a parent panel supplies the live has-audio signal (out of todo-01 file scope). Acceptable for this todo; flag for an integration pass.

## Test output (actual)

Command 1 — the four mandated suites:
```
npx vitest run .../ClipTimeMapping.test.ts .../SplitService.test.ts \
  .../splitItem.test.ts .../detachAudio.test.ts
 Test Files  4 passed (4)
      Tests  37 passed (37)
      Duration ~2.7s
```
Per-file: ClipTimeMapping 13 ✓ · SplitService 11 ✓ · splitItem 6 ✓ · detachAudio 7 ✓.

Re-run adding the INV-3 resize entity suite (§6 #3):
```
 Test Files  5 passed (5)
      Tests  42 passed (42)   (+TimelineItem.resize 5 ✓)
```

Command 2 — type-check:
```
npm run type-check  →  tsc --noEmit
(no output, exit 0 — clean)
```

All assertions verified against actual run output; no failures, no skips.
