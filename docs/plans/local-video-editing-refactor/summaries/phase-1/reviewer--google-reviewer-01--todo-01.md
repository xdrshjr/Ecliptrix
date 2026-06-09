# REVIEWER Summary — TODO 01 (剪辑核心 + 多轨道 + clip 语义契约)

## Meta
- **Agent:** google-reviewer-01
- **Role:** REVIEWER
- **Task:** todo-01
- **Phase:** 1
- **Verdict:** PASS

## Scope reviewed
Spec `specs/01-timeline-editing-core.md`, todos `todos/01...`, dev summary,
global-context. Read every created/modified file plus the downstream consumers
of the changed surfaces (dragSlice resize-commit path, historySlice
record/capture wiring, Track entity, useTimelineStore composition, i18n keys).

## Key Decisions (validated)

1. **`ClipTimeRef` structural ref over the entity is the RIGHT contract shape.**
   `TimelineItem` exposes `startTime/duration` as value objects (not numbers),
   while 02/05 consume numeric sequence DTOs. A minimal numeric `{ startTime;
   duration; clipStart?; clipEnd? }` is satisfied by `TimelineItemData`,
   `VideoSequenceItem`, `AudioSequenceItem`, and fixtures alike — one function,
   zero adapters. Importable from the domain barrel (`domain/index.ts` exports
   `TIME_EPSILON`, both map fns, and `ClipTimeRef`). Contract is clean for 02/05.

2. **INV-3 enforcement lives in exactly one place (entity), and applies to BOTH
   resize paths.** I verified the drag-resize commit (`dragSlice.ts:169-184`)
   routes through `state.resizeItem → aggregate.resizeItem → entity.resize`, the
   same path as the programmatic action. There is NO parallel clip arithmetic in
   the drag layer that the entity rewrite could desync — DragCalculationService
   only computes the transient preview; the authoritative clip mutation happens
   once. This is the cleanest possible discharge of spec §2.6 关卡#1.

## Correctness analysis (the load-bearing part)

- **ClipTimeMapping math** — pure, no DOM/React/value-objects. `clipStart`
  defaults to 0; `clampWithEpsilon` snaps within-`TIME_EPSILON` overruns to the
  exact bound in both directions. Worked example (clip=[2,5] start=10 → t=12 ⇒
  source 4) and round-trip identity are both pinned by tests. Correct & pure.
- **SplitService INV-1..INV-3** — `offset = tCut - start`,
  `splitSourceTime = clipStart + offset`; left=[clipStart, splitSourceTime]
  dur=offset, right=[splitSourceTime, clipEnd] start=tCut dur=duration-offset.
  Seamless join proven by construction (`left.clipEnd === right.clipStart ===
  splitSourceTime`; `left.endTime === right.startTime === tCut`). Spec §6 #2
  worked example (start=10 dur=6 clip=[2,8] @t=13 ⇒ [2,5]/[5,8]) reproduces
  exactly. Boundary/epsilon/out-of-range → null no-op, no track mutation.
  Untrimmed clip defaults to [0, duration]. Left keeps original id; right minted.
- **resize INV-3** — I hand-proved INV-1 cannot be violated on either edge:
  the `resize` guards (`newStart < currentEnd` / `newEnd > startTime`) bound
  `timeDelta` strictly below `duration` in magnitude, so the clamped
  `newClipStart < clipEnd` and `newClipEnd > clipStart` strictly ⇒ derived
  duration > 0. `end` edge clamps `clipEnd` to `originalDuration` (no read past
  media); `start` edge clamps `clipStart` to ≥0. The `clipStart`-set-but-
  `clipEnd`-absent fallback synthesises a coherent clipEnd preserving visual
  duration — defensive but correct. No-clip-info branch falls back to edge-
  derived duration. Solid.
- **detachAudio purity / has-audio gate** — domain `TimelineAggregate.detachAudio`
  never reads live material; it re-checks `type==='video' && !audioDetached`
  (no-op→null), reuses `TrackSelectionService` to pick/create the audio track,
  parks the derived item past the last item to dodge overlap (Track.addItem does
  NOT enforce non-overlap — see Note 1), flags the source, then autoOrganize
  repacks. The has-audio decision correctly lives in `detachAudioAction`
  (`hasAudio===false` blocks; `undefined` treated as detachable for video — a
  reasonable, documented choice). Time-alignment preserved because both tracks
  pack identically; pinned by the `keeps the detached audio time-aligned` test.
- **audioDetached passthrough** — `CompositionAdapter` forwards the flag verbatim
  onto `VideoSequenceItem.audioDetached` and into wire `video_sequences[].
  audio_detached`; URL selection is provably unchanged (test asserts identical
  `url` with/without the flag). 02/05 own the actual audio suppression. Correct.

## Integration / contract (for 02 & 05)
- Shared contract importable from `@/components/video/timeline/domain`. ✓
- `audioDetached` flows entity → `TimelineItemData`/`CreateItemProps` →
  `VideoSequenceItem` → wire `audio_detached`, and is in `src/types/index.ts`
  (`TimelineItem`) + `toPlainObject` so 06 persists it. ✓
- `INV-3` now holds on every item; split halves join with no gap/overlap. ✓

## Completeness / TODO compliance
Every TODO-01 checkbox is implemented with no stubs/placeholders (grepped the new
files clean; only "TODO 02/05" doc references remain). All 6 spec acceptance
test groups are present (46 new tests). i18n keys `toolbar.cut` +
`shortcuts.cutShortcut` exist in both locales — no runtime-undefined risk in the
toolbar toggle.

**Detach-UI-not-threaded assessment: ACCEPTABLE SCOPE, NOT A GAP.** The spec §3
file plan and todos/01 list `TimelineItem.tsx` → "detach 入口（右键/菜单）",
which IS delivered (`onDetachAudio` prop + `handleContextMenu`, gated on
video/!detached/!locked). `TrackContainer`/`TimelinePanel` appear NOWHERE in
spec §3 or todos/01. Supplying the prop from the panel (which holds the live
`materials` has-audio signal) is legitimately the next layer's wiring, and the
optional prop renders inert without breaking existing markup. In-scope work is
complete.

## Issues found
- **None blocking.** No Critical / Important / Suggestion-level defects in
  TODO-01's code.

### Non-blocking observations (NOT TODO-01 defects, no action taken)
1. `Track.addItem` does not enforce INV-5 (non-overlap) at the entity level — it
   pushes + sorts. This is the PRE-EXISTING codebase contract; detach's
   "park-past-last" + autoOrganize is the correct mitigation within it. Out of
   scope to change here.
2. `TimelineItem.tsx` is 859 lines (>800 CLAUDE.md threshold). It is a
   pre-existing UI file inflated by concurrent TODO-03 work; TODO-01's edits were
   strictly additive (~30 lines). Splitting it is out of TODO-01 scope. Flag for
   a future refactor, owner TBD.
3. `splitAction` skips `!track.isVisible` for BOTH scopes (incl. `'selected'`),
   so a selected item on a hidden track silently won't split. Defensible
   ("don't edit what you can't see", consistent with composition filters);
   noting in case a future UX wants selected-scope to ignore visibility.

## Fixes applied
- None. The implementation is correct and clean as delivered; no conservative
  edits were warranted (editing would have added risk without benefit).

## Excellence (D10-worthy) notes
- The INV-3 single-source-of-truth design (entity owns the invariant; resize
  action and drag-commit both funnel through it; `resizeItemAction` is doc-only)
  is textbook DDD and directly neutralises symptom ② at the data layer.
- The `ClipTimeRef` structural-typing decision lets ONE pure function serve the
  entity DTO and both downstream sequence DTOs with zero adapters — a genuinely
  elegant contract surface for 02/05.
- Test suite quality is high: worked examples mirror the spec verbatim,
  round-trip identity is asserted, undo/redo round-trips compare full
  `exportToData().tracks` deep-equality, and the time-alignment-after-
  autoOrganize case is explicitly pinned.

## Context for Downstream
- **02 / 05:** `ClipTimeMapping` is the ONLY sanctioned clip↔source conversion —
  import from the domain barrel, use `TIME_EPSILON` for edges, do NOT re-derive
  offsets (that divergence is symptom ② root cause). Honour
  `VideoSequenceItem.audioDetached` / wire `audio_detached`: a detached video
  contributes NO audio; its audio comes from the paired audio sequence (same
  materialId/start/dur/clip). INV-3 (`duration === clipEnd - clipStart`) holds on
  every item; split halves are seamless.
- **06 (persistence):** persist split-produced item ids + `audioDetached`
  (already in `toPlainObject`). On load, regularise legacy items violating INV-3
  by recomputing `duration` from `clipEnd - clipStart` (06 owns this). Also
  consider whether autoOrganize's flush-from-0 repack should preserve absolute
  positions for restored projects.
- **Panel layer (future):** thread `onDetachAudio` from the panel (which owns the
  live `materials` list / `hasAudio`) down through TrackContainer to
  TimelineItem to activate the right-click detach entry; call
  `detachAudioAction(get, itemId, { type, hasAudio })`.
