# Phase 4 Cleanup — Frontend (google-dev-02)

Meta Role:DEV Task:cleanup-frontend Phase:4 Verdict:COMPLETED

## Scope

Three behavior-preserving frontend cleanups (NO logic changes):
- A) Dead v1/v2 playback constants + type-only orphans removed.
- B) `useMaterialManagement.ts` split 1295 → 548 (≤800).
- C) `TimelineItem.tsx` split 859 → 652 (≤800).

Safety net used after every step: `tsc --noEmit` (clean) + `vitest run src/components/video`.
Baseline 852/852 → final 873/873 (852 originals all preserved + 23 new pure-fn assertions; 0 failures).

## Key Decisions

### A) Dead-code removal — grep-proof

Each candidate was grepped across `src/`; removed only when the SOLE hit was its own
definition line (`grep -rn "\bNAME\b" src/` → count 1, located in its own file).

**Constants removed from `playback/internal/constants.ts` (10, all zero-ref):**
`VISIBILITY_RESUME_MAX_MS`, `DRIFT_SOFT_MS`, `DRIFT_HARD_MS`, `DRIFT_SOFT_RATE_DELTA`,
`DRIFT_HARD_TRIP_COUNT`, `DRIFT_SAMPLE_INTERVAL_MS`, `PREPARING_TIMEOUT_MS`,
`TICK_FPS_REPORT_INTERVAL_MS`, `KILL_SWITCH_LS_KEY`, `PREWARM_LEAD_SEC`.
Their consumers (deleted PlaybackEngine / killswitchMonitor / prewarm path) are gone.

**KEPT (still referenced, count > 1):** `ADAPTIVE_DEGRADE_DRAW_MS` (6), `ADAPTIVE_RECOVER_DRAW_MS` (5),
`ADAPTIVE_WINDOW_FRAMES` (8), `ADAPTIVE_RECOVER_HOLD_FRAMES` (5) — CanvasCompositor;
`PLAYHEAD_THROTTLE_MS` (3) — PlayheadController; `SHORT_CLIP_THRESHOLD_SEC` /
`BIND_LOADEDMETA_TIMEOUT_MS` / `BIND_SEEK_TIMEOUT_MS` (3 each) — AbBufferController;
`PREVIEW_PROXY_POLL_INTERVAL_MS` / `PREVIEW_PROXY_POLL_BUDGET_MS` (3 each) — MediaProxyClient;
`AUDIO_DRIFT_EPSILON_SEC` (9) + `VIDEO_SEEK_TOLERANCE_SEC` (12) — audio/video sync pools.

**Type-only orphans removed from `playback/types.ts` (10, zero consumers outside types.ts/index.ts barrel):**
`PlaybackPhase`, `PlaybackIntent`, `SubtitlePayload`, `IPlaybackEngine`, `SequenceTarget`,
`PlaybackTimelineFacade`, `PlaybackEngineAttachDeps`, `IKillSwitchMonitor`, plus the
types.ts copies of `ProxyTier` and `IProxyHitMeter` (the live runtime copies live in
`internal/proxyHitMeter.ts`, re-exported as `*Runtime` aliases — untouched). These formed
the deleted single-sequence-engine + killswitch cluster (proof: `grep` excluding
`types.ts`/`index.ts` returned no consumers; the only hits for `ProxyTier`/`IProxyHitMeter`
were the runtime module + the dead barrel lines 64–69).
`index.ts` barrel type-export block pruned to match.

**KEPT in types.ts** (live, consumed by runtime modules): `PreviewFrame`, `ICanvasViewport`,
`OverlayPayload`, `SubtitleStyle`, `CompositorLayer`, `SequenceTransition`, `VideoTrackGroup`,
`AudioTrackGroup`, `CompositorStats`, `IPlaybackClock`, `IAbBufferController`,
`ICanvasCompositor`, `IPlayheadController`, `PlaybackSequenceResolver`.
(`AudioTrackGroup` currently has 0 importers but is a sibling of the LIVE Stage-2
compositor contract family, not v1/v2 engine debt — left in scope-faithfully.)

### B) useMaterialManagement extraction seams

Sibling dir `hooks/materialManagement/`:
- `materialDeleteHelpers.ts` — pure `sourcePathForDelete`, `extraThumbnailKeysForDelete`,
  `generateUUID` (was file-local, now exported + unit-tested).
- `useMaterialUpload.ts` — owns `isUploading`/`uploadProgress` state + the concurrent upload
  queue (`uploadSingleFile`, `triggerAutoAnalysis`, `processFileUpload`, `handleMaterialUpload`,
  `handleDragUpload`). Receives `{ taskId, logger, user, isMountedRef, setMaterials }`; returns
  the handlers + state + `triggerAutoAnalysis` (reused by the search-add path in the orchestrator).
- `useMaterialGeneration.ts` — owns the ARK video/image + storyboard flows and the
  `pendingAiTasks` polling-timer registry + its own unmount cleanup. Receives
  `{ logger, isMountedRef, setMaterials, addOrReplaceMaterial }`.

The orchestrator keeps selection/filter state, the **delete-cascade + cache-eviction wiring
from Phase 3 (unchanged: `evictMaterialCaches` → filmstrip/waveform/videoCache/local eviction,
`cascadeDeleteMaterial` → `deleteMaterialDerived`, `executeDelete`), `addMaterials`,
`addOrReplaceMaterial`, `handleClearAllMaterials`, and the remote/local prefetch wiring.
The single mount-lifecycle effect was split: orchestrator owns `isMountedRef` true/false;
generation hook owns its own `pendingAiTasks` cleanup (same mount/unmount cycle → equivalent).

### C) TimelineItem extraction seams

Sibling modules in `timeline/`:
- `timelineItemStyles.ts` — pure `computeItemStyles(inputs)` (lifted `getItemStyles`; config
  object, no positional param sprawl). Unit-tested.
- `TimelineItemFilmstrip.tsx` — presentational filmstrip tiling layer (lifted `renderFilmstrip`;
  `slot.url ?? posterUrl` fallback preserved). The shared `filmstripCache` singleton usage and
  the throttled `ensure()` effect stay in TimelineItem (Phase-3 cache intact).
- `TimelineItemDownloadOverlay.tsx` — the round-3 local-download overlay (lifted
  `renderLocalDownloadOverlay`; verbatim branches, locale strings passed as a `labels` prop).
  `LocalProxyMaskState` canonical definition moved here and **re-exported from TimelineItem**
  so existing importers (TimelinePanel / Track / TrackContainer) need no edit.

## Execution Flow

1. Baseline: 852/852 pass, type-check clean, line counts confirmed (1295 / 859 / 107).
2. A) grep-proved each constant/type → removed dead ones → type-check + playback subset (213) green.
3. B) extracted 3 modules, rewired orchestrator → fixed `handleAiImageGenerate` return type
   (`ArkImagePack`, not `StoryboardPack`) → type-check green → hooks subset (98) green.
   Repointed existing `useMaterialManagement.localUpload.test.ts` to the upload module.
4. C) extracted 3 modules, rewired render → repointed the two source-level tests
   (`TimelineItem.localDownload`, `TimelineItem.filmstrip`) to the new modules → timeline (217) green.
5. Full `src/components/video`: 873/873, type-check clean.

## Artifacts

New: `hooks/materialManagement/{materialDeleteHelpers,useMaterialUpload,useMaterialGeneration}.ts`,
`timeline/{timelineItemStyles.ts,TimelineItemFilmstrip.tsx,TimelineItemDownloadOverlay.tsx}`,
tests `hooks/__tests__/materialDeleteHelpers.test.ts`, `timeline/__tests__/timelineItemStyles.test.ts`.
Modified: `playback/{internal/constants.ts,types.ts,index.ts}`, `hooks/useMaterialManagement.ts`,
`timeline/TimelineItem.tsx`, and 3 existing tests repointed (no assertion intent changed).

## Issues & Risks

- The two TimelineItem source-level tests and the upload normalization test assert on FILE TEXT
  (jsx:"preserve" blocks rendering). Because the asserted code MOVED, those tests were repointed
  to the new modules; the guarded behavior is unchanged (verbatim relocation).
- `processFileUpload` (~155 lines) and the ARK `poll` closure exceed the 50-line method guideline.
  Both were lifted VERBATIM with closure-coupled internals (queue cursor, progress-interval map,
  retry counters). Decomposing them further risks behavior drift in the upload queue / polling
  loop, which the directive forbids. Left intact as pre-existing structure; flagged for a future
  dedicated refactor with its own behavioral tests.

## Before / After Line Counts

| File | Before | After |
|------|-------:|------:|
| hooks/useMaterialManagement.ts | 1295 | 548 |
| timeline/TimelineItem.tsx | 859 | 652 |
| playback/internal/constants.ts | 107 | 77 |
| playback/types.ts | 372 | 247 |
| playback/index.ts | 78 | 68 |

New modules (all ≤800): materialDeleteHelpers 42 · useMaterialUpload 468 · useMaterialGeneration 349 ·
timelineItemStyles 97 · TimelineItemFilmstrip 54 · TimelineItemDownloadOverlay 167.

Final: type-check clean; `vitest run src/components/video` = 873 passed / 0 failed (106 files).
