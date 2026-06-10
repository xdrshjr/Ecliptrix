# REVIEWER Summary — TODO 02 Sub-stage S2 (multi-track compositor CORE)

## Meta
- **Agent:** google-reviewer-01
- **Role:** REVIEWER
- **Task:** todo-02-s2 (unified local preview compositor — engine core)
- **Phase:** 2
- **Verdict:** PASS

S2 builds the new multi-track real-time canvas compositor engine that must
COEXIST with v1 (no v1 deletion, no VideoPlayerPanel wiring — S3/S4). Reviewed
for correctness, the two hard invariants (RC-B + ClipTimeMapping reuse), layer
assembly, scope discipline, completeness, and the S3-facing contract.

## Key Decisions (incl. the deviation ruling)

### ARCHITECTURAL DEVIATION RULING — ACCEPTED
Spec §3 says "PlaybackEngine.ts — modify". The dev instead created a NEW
`MultiTrackPlaybackEngine.ts` (337 lines) and left the legacy `PlaybackEngine.ts`
(983 lines) intact with only a header-comment marking it legacy.

**Ruling: this SATISFIES SPEC INTENT and is the correct engineering call.** The
spec intent is "remove the single-active-sequence assumption", "engine S3 can
mount", "coexist with v1 then delete with v1 in S4". The new engine has NO
single-active-sequence assumption (it composites N visible tracks per frame),
is exported from the barrel so S3 can mount it, and leaves v1 + the legacy engine
runtime behaviour byte-for-byte unchanged. Forcing the multi-track logic INTO the
already-983-line legacy engine would (a) breach the 800-line file cap and (b) put
the new engine at risk of regressing the 195 coupled single-sequence tests — both
HARD constraints. A separate engine is the clean coexistence path.

**S4 OBLIGATION (recorded):** S4 MUST delete the legacy `PlaybackEngine.ts`, its
barrel export (`index.ts` line 8-9), and the now-duplicated single-sequence path
together with the v1 inline player + flag. The two engines coexisting is a
deliberate, time-boxed state — it must NOT survive past S4. Verified this is a
clean coexistence (legacy engine untouched), not a half-migration leaving both
half-used: the legacy engine still imports its own constants and is wired only to
the v1 path; the new engine is fully self-contained and barrel-exported.

### RC-B invariant ("比对键 == 赋值") — VERIFIED CORRECT (critical fix)
`computeSourcePlan` (VideoSourcePool.ts:141) resolves `desiredUrl =
resolveSource(hit.clip)` ONCE; compares `normalizeSrc(currentSrc) !==
normalizeSrc(desiredUrl)` for `needsSrcSwap` (line 147); returns that SAME
`desiredUrl` in the plan (line 159). The applier `_apply` assigns
`el.src = plan.desiredUrl` (line 285) — byte-equal to the compare key. There is
NO second/stale resolution. Pinned by three tests: same live URL → no swap;
empty→patched URL → swap+seek with `desiredUrl === assigned`; relative-vs-absolute
same-origin → no false swap. This is the documented black-screen root fix and it
is structurally correct.

### Other verified decisions
- **ClipTimeMapping reuse:** VideoSourcePool/assembleLayers/engine route ALL
  clip/time math through S1 `activeClipAt` → spec-01 `mapTimelineTimeToSourceTime`
  + `TIME_EPSILON`. No hand-rolled cumulative offsets anywhere (grep-confirmed).
- **Layer assembly:** `assembleLayers` is pure; z-order bottom→top
  (video by track z < image at `baseZ+z+i` < subtitle at `baseZ*2+i`); effective
  video opacity = `clamp01(itemOpacity × alphaFor)`; matches the `CompositorLayer`
  union exactly.
- **renderFrame:** sorts by z, per-layer `globalAlpha`, reuses `fitContain` +
  adaptive-fps + stats; legacy `drawFrame`/`_drawOverlays` untouched.
- **Purity/testability:** `computeSourcePlan` + `assembleLayers` pure; raw
  `<video>`/canvas behind thin adapters; tests use the mock-2d-context pattern;
  §6 case 8 (upper opacity<1 → lower drawn, asserted via recorded globalAlpha) and
  case 9 (subtitle fillText asserted) are genuine, not faked.
- **Seek tolerance** is the named constant `VIDEO_SEEK_TOLERANCE_SEC = 0.25`
  (constants.ts:107), not a magic number.

## Execution Flow
1. Read S2/S1 dev summaries + global-context + specs 02/01 + todo-02 +
   task-orchestration.
2. Read all NEW source (VideoSourcePool, MultiTrackPlaybackEngine, assembleLayers)
   + MODIFIED (CanvasCompositor, PlaybackClock, types, constants, index,
   PlaybackEngine header) + the S1 layers they consume (TrackScheduler,
   TransitionLayer, SubtitleLayer, ImageOverlayLayer, AudioSyncPool) + the
   VideoSequenceItem/SubtitleSequenceItem contract types.
3. Read all 4 new test files + the AbBufferController.test mock change.
4. Verified RC-B compare==assign by source trace.
5. Scope discipline: `git diff --name-only` — NO playbackFlags / useVideoPlayback /
   VideoPlayerPanel / killswitchMonitor / PlaybackVariantSwitcher / proxyHitMeter
   modified. PlaybackEngine.ts diff = header-comment ONLY (no code change).
6. Confirmed `ICanvasCompositor.renderFrame` (now required) has exactly ONE
   concrete impl (CanvasCompositor, has it) + ONE test mock (updated) — no missed
   implementer (integration-compat clean).
7. Ran `npm run type-check` (CLEAN), targeted vitest (60 passed across 5 files),
   full playback suite (238 passed / 25 files, no regressions).

## Artifacts (reviewed)
- NEW: `VideoSourcePool.ts` (346), `MultiTrackPlaybackEngine.ts` (337),
  `internal/assembleLayers.ts` (193) + their 4 `__tests__`.
- MODIFIED: `CanvasCompositor.ts` (545), `PlaybackClock.ts` (166), `types.ts`,
  `internal/constants.ts`, `index.ts`, `PlaybackEngine.ts` (header only),
  `__tests__/AbBufferController.test.ts` (+renderFrame mock).
- All files ≤800 lines; all new/changed methods ≤50 lines.

## Issues & Risks
- **No blocking issues.** No stubs/TODO/FIXME/empty-catch in S2 code (every catch
  is a documented IO/DOM-boundary fallback).
- **NIT (non-blocking):** `MultiTrackPlaybackEngine._buildVideoEntries` recomputes
  `activeClipAt` (the pool already found the active clip inside `sync` but returns
  only `trackId`/`z`, dropping the clip). Pure + deterministic so it is correct,
  just a small per-tick redundancy. The exported `assembleLayers.activeVideoClipAt`
  helper is currently unused by the engine. Optional S3 cleanup — flagged, not
  required.
- **Desktop-only (correctly deferred by dev, not S2's job):** real GPU N-video
  blend cost, real `seeked` timing/audio-video sync after seek, on-canvas image
  pixels, and the end-to-end §6 cases 6/7 (import→add→play, patch-after-insert)
  need S3 + a real Electron walkthrough. The RC-B *invariant* is unit-pinned now.

## Contract Verification (evidence)
- **PRODUCES — `MultiTrackPlaybackEngine` engine surface (S3 mounts):** CONFIRMED.
  `attach(deps: MultiTrackAttachDeps)` (line 117), `play()` (165), `pause()` (178),
  `seek(t)` (186), `getPhase()` (154), `subscribe()` (158), `dispose()` (202) all
  real + coherent; `dispose` blocks re-attach (test asserts throw). DOM contract
  `MultiTrackAttachDeps` (lines 67-83: canvas, resolveTrackElements,
  resolveAudioElement, resolveSource, timeline facade, viewport?, measureSubtitle?)
  matches the documented S3-facing API exactly. Barrel-exported (index.ts:13-19).
- **CONSUMES — every S1 contract:** CONFIRMED.
  - spec-01 ClipTimeMapping via `activeClipAt` → `mapTimelineTimeToSourceTime` +
    `TIME_EPSILON` (VideoSourcePool, assembleLayers, AudioSyncPool, TrackScheduler).
  - `TrackScheduler.activeClipAt` / `prewarmNextAt` (VideoSourcePool.ts:36,193).
  - `TransitionLayer.alphaFor` folded into `buildVideoLayers` (assembleLayers.ts:102).
  - `SubtitleLayer.activeSubtitlesAt`/`resolveSubtitleStyle`/`wrapText`
    (assembleLayers.ts:120-152).
  - `ImageOverlayLayer.buildImageLayersAt` lifted above video (assembleLayers.ts:164).
  - `AudioSyncPool` + `AudioElementLike` via `toAudioElement` adapter
    (MultiTrackPlaybackEngine.ts:148,316); detached embedded audio stays paused
    (engine test asserts).
  - `resolveSequencePlaybackUrl` consumed INDIRECTLY as injected `resolveSource`
    (RC-B compare==assign by construction).
  - `VideoSequenceItem`/`SubtitleSequenceItem` passthrough fields (trackZ/opacity/
    transitionIn/transitionOut/audioDetached) verified present in
    `videoEditingTypes.ts:12-66` and consumed coherently.
- **PRODUCES — `CanvasCompositor.renderFrame(layers)` + `CompositorLayer[]`:**
  CONFIRMED. Required on `ICanvasCompositor` (types.ts:265); one impl + one test
  mock, both have it; z-order/per-layer-globalAlpha/subtitle-draw/drawn-dropped
  accounting asserted.

## Context for Downstream
- **S3:** mount `MultiTrackPlaybackEngine` from the barrel; supply
  `MultiTrackAttachDeps`. CRITICAL: wire `resolveSource =
  (seq) => resolveSequencePlaybackUrl(seq, liveMaterials, lockedOpts)?.url ?? null`
  with `lockedOpts` locked at mount — do NOT pass two different resolvers for
  compare vs assign (reintroduces the black-screen bug). Pass a real
  `measureSubtitle` (2d-context measureText) for correct wrapping on desktop.
  PreviewCanvas creates the A/B `<video>` handles but must NOT set their `src`
  (the pool owns `src` assignment). Drive the end-to-end §6 cases 6/7 + desktop
  walkthrough — those are not unit-coverable.
- **S4 (OBLIGATION):** delete legacy `PlaybackEngine.ts` + its barrel export + the
  duplicated single-sequence path, together with the v1 inline player + flag. The
  two-engine coexistence must NOT survive S4. Also delete `useVideoPlayback.ts`,
  `PlaybackVariantSwitcher.tsx`, `killswitchMonitor` per spec §2.7 (KEEP
  `proxyHitMeter.ts` + decoupled preview-proxy/local-preview flags).
- **S5 export parity:** `CompositorLayer` z-order / opacity / `alphaFor` fade
  semantics are the SHARED contract the ffmpeg filtergraph must reproduce.

## Tokens
Claimed: contract verification (engine surface + all S1 consumes, confirmed),
cross-agent impact (S4 legacy-engine delete obligation, S3 resolver wiring,
ICanvasCompositor interface-add impact analysis), excellence (clean coexistence +
RC-B structural fix), efficient review. One non-blocking NIT raised.
