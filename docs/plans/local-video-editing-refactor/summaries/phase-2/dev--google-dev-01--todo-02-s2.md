# DEV Summary — TODO 02 Sub-stage S2 (compositor CORE: multi-track real-time canvas compositor)

## Meta
- **Agent:** google-dev-01
- **Role:** DEV
- **Task:** todo-02-s2 (unified local preview compositor — the engine core)
- **Phase:** 2
- **Verdict:** COMPLETED

S2 scope = the multi-track real-time canvas compositor engine (the highest-risk
part of the refactor). It builds DIRECTLY on the S1 data layers (TrackScheduler,
TransitionLayer, SubtitleLayer, ImageOverlayLayer, AudioSyncPool) and the existing
v2 modules (CanvasCompositor, PlaybackClock). S3 (PreviewCanvas host +
useCompositionPlayback) and S4 (delete v1 / flag) are explicitly NOT in this
sub-stage. The new engine COEXISTS with v1 + the legacy single-sequence engine —
no v1 behaviour changed.

## Key Decisions

1. **The multi-track engine is a NEW module `MultiTrackPlaybackEngine.ts`, not a
   retrofit of the legacy `PlaybackEngine`.** Deliberate, documented deviation
   from the literal "modify PlaybackEngine" wording, justified by two HARD
   constraints that would otherwise be violated: (a) `PlaybackEngine.ts` is
   already 983 lines (pre-existing v2 debt) — adding multi-track in-place breaches
   the 800-line file cap; (b) it is the single-active-sequence state machine with
   195 deeply-coupled tests (handover/killswitch/drift/metrics) — retrofitting
   risks regressing all of them. Instead the NEW engine has NO single-active-
   sequence assumption (exactly what the spec asks for), and `PlaybackEngine.ts`
   got a header note marking it legacy + "extend MultiTrackPlaybackEngine, not
   here", to be deleted with v1 in S4. Both are exported from the barrel so S3 can
   mount the new one. This satisfies the SPIRIT ("remove the single-active-sequence
   assumption", "engine S3 can mount", "coexist with v1") without breaking caps or
   tests. Reviewer should confirm this trade-off is acceptable; the alternative
   (in-place) violates two hard constraints.

2. **RC-B "比对键 == 赋值" is the structural core of `VideoSourcePool`.** The pure
   `computeSourcePlan` resolves each active clip's URL via the INJECTED
   `resolveSource(seq)` (the caller wires
   `resolveSequencePlaybackUrl(seq, liveMaterials, lockedOpts)?.url`), and decides
   `needsSrcSwap` by comparing that SAME resolved URL against the element's CURRENT
   `src` (both origin-normalized) — never against a stale sequence snapshot. The
   applier then assigns EXACTLY the planned `desiredUrl`. Compare key == assigned
   value, root-causing the black-screen symptom. Pinned by tests: same live URL →
   no swap; patched-after-insert URL → swap+seek; relative-vs-absolute same-origin
   → no false swap.

3. **Pure-planner / thin-applier split (mirrors S1 AudioSyncPool).** All decision
   logic — `computeSourcePlan` (VideoSourcePool), `assembleLayers` /
   `buildVideoLayers` / `buildSubtitleLayers` (assembleLayers.ts) — is pure and
   jsdom-testable with `VideoElementLike` fakes; raw `<video>`/canvas live only in
   the thin `VideoSourcePool` applier + `CanvasCompositor`. No DOM in the tested
   decision path.

4. **`assembleLayers` lives in `internal/assembleLayers.ts`, not inside
   CanvasCompositor.** Keeps the compositor under 800 lines (now 545) and makes the
   layer-assembly seam independently testable (z-order, opacity × transition alpha,
   idle/unready drops) without a GPU. `CanvasCompositor.renderFrame(layers)` is the
   draw-only entry: sort by z, draw video (fit-contain + globalAlpha), image, and
   pre-wrapped subtitle lines, reusing the existing letterbox/fitContain + adaptive
   frame-dropping + stats model.

5. **Effective video opacity = item.opacity × transition alpha, folded in the
   PURE layer-assembly** (`buildVideoLayers` calls `TransitionLayer.alphaFor`), not
   in the draw. The compositor just applies `layer.opacity` as `globalAlpha`. This
   keeps the fade/dissolve semantics in the S1-shared TransitionLayer (export 05
   mirrors it) and makes "upper opacity<1 → lower visible" (§6 case 8) a property of
   the assembled list (both layers present), verified with the mock 2d context.

6. **`VIDEO_SEEK_TOLERANCE_SEC = 0.25` as a named constant** (constants.ts),
   between the A/B bind-snap (0.05) and the audible audio drift (0.5). Seek
   de-bounce: re-seek only when `|currentTime - target| > tolerance` OR the src was
   just swapped (fresh src always needs the initial seek). No bare magic number.

7. **PlaybackClock change is minimal and additive: `subscribeTick` is a named
   alias of `subscribe`,** documenting that `compositionTime` is the single time
   truth and that one tick drives BOTH the video render and the audio tick. The
   engine subscribes once via `subscribeTick` and fans out to compositor + audio
   inside that handler, so the two never run on separate clocks.

8. **All clip/time math flows through spec-01 `ClipTimeMapping` via S1
   `activeClipAt`** (TrackScheduler) inside VideoSourcePool, AudioSyncPool, and
   assembleLayers. No cumulative-offset math anywhere in S2.

## Execution Flow

1. Read all 6 planning docs + global-context + the S1 summary (the contracts S2
   consumes).
2. Read every existing v2 module I build on (CanvasCompositor, PlaybackEngine,
   PlaybackClock, AbBufferController, PlayheadController, types, fitContain,
   constants) + all S1 modules (TrackScheduler/Transition/Subtitle/Image/Audio) +
   ClipTimeMapping + resolveSequencePlaybackUrl (the RC-B resolution surface) + the
   CanvasCompositor mock-context test pattern.
3. Baselined the playback suite (21 files / 195) + type-check (clean).
4. Added `VIDEO_SEEK_TOLERANCE_SEC`; built `VideoSourcePool.ts` (pure planner +
   applier) with the RC-B invariant.
5. Built `internal/assembleLayers.ts` (pure layer assembly).
6. Upgraded `CanvasCompositor` with `renderFrame(layers)` + `_drawSubtitleLines`;
   added `renderFrame` to `ICanvasCompositor` (+ fixed the one mock in
   AbBufferController.test).
7. Added `subscribeTick` to PlaybackClock; built `MultiTrackPlaybackEngine.ts`;
   wired the barrel exports + the legacy-marker note on PlaybackEngine.
8. Wrote 4 test files (43 cases); fixed origin-normalization fixture bugs + test
   fixture typings; refactored `attach` to keep all methods ≤50 lines.
9. Ran type-check (clean), targeted vitest (43), full playback suite (238), full
   video suite (867), and lint on changed source (clean).

## Artifacts

### Created (source)
- `src/components/video/playback/VideoSourcePool.ts` (346 lines) — per-track A/B
  decode pool; pure `computeSourcePlan` + thin `VideoSourcePool` applier; RC-B.
- `src/components/video/playback/MultiTrackPlaybackEngine.ts` (338 lines) — the
  generalized engine S3 mounts; per-tick sync→assemble→render→audio→playhead.
- `src/components/video/playback/internal/assembleLayers.ts` (193 lines) — pure
  CompositorLayer[] assembly (video opacity × transition alpha, z-order).

### Modified (source)
- `src/components/video/playback/CanvasCompositor.ts` — `renderFrame(layers)`
  multi-source compositing + `_drawSubtitleLines`; legacy `drawFrame`/_drawOverlays
  untouched (still used by the legacy engine).
- `src/components/video/playback/PlaybackClock.ts` — `subscribeTick` alias + doc
  noting it is the sole composition clock driving render + audio.
- `src/components/video/playback/types.ts` — `renderFrame` added to
  `ICanvasCompositor`.
- `src/components/video/playback/internal/constants.ts` —
  `VIDEO_SEEK_TOLERANCE_SEC = 0.25`.
- `src/components/video/playback/PlaybackEngine.ts` — header note: LEGACY
  single-sequence engine, multi-track lives in MultiTrackPlaybackEngine, removed
  with v1 in S4. (No behavioural change.)
- `src/components/video/playback/index.ts` — barrel exports for the S2 surface
  (MultiTrackPlaybackEngine + types, VideoSourcePool, assembleLayers, and re-export
  of the S1 layers) so S3 mounts via the single import entry.

### Tests (created)
- `…/__tests__/VideoSourcePool.test.ts` (24) — active clip + plan, RC-B same-key
  swap, seek-tolerance de-bounce, prewarm selection, applier vs fake elements.
- `…/__tests__/CanvasCompositor.renderFrame.test.ts` (10) — z-order, per-layer
  globalAlpha, §6 case 8 (upper opacity<1 → lower drawn), §6 case 9 (subtitle
  drawn), unready/zero-opacity skips, drawn/dropped accounting, detach no-op.
- `…/__tests__/assembleLayers.test.ts` (9) — opacity × transition alpha, fade-in/
  out, cross-kind z-order, idle/inactive drops, subtitle wrapping.
- `…/__tests__/MultiTrackPlaybackEngine.test.ts` (9) — paused first-frame paint,
  play tick pipeline (render+audio+playhead), ended-at-total, pause/seek, two-track
  composite, detached-audio-no-double-audio, dispose.

### Tests (modified)
- `…/__tests__/AbBufferController.test.ts` — added `renderFrame: vi.fn()` to the one
  `ICanvasCompositor` mock (interface gained the method).

## Interfaces Touched (Contract Verification)

### CONSUMES — spec-01 `ClipTimeMapping` (shared clip contract)
- Role: CONSUMER. `mapTimelineTimeToSourceTime` + `TIME_EPSILON` via S1
  `activeClipAt`. Contract verified: **YES** — VideoSourcePool/assembleLayers tests
  assert mapped source times to 6 decimals + epsilon boundaries; no hand-rolled
  offset math. Peer: TODO 01 (dev-01).

### CONSUMES — S1 `TrackScheduler.activeClipAt` / `prewarmNextAt`
- Role: CONSUMER. Per-track active clip + prewarm selection. Contract verified:
  **YES** — used unchanged; plan tests assert correct per-track clip + prewarm URL.
  Peer: S1 (self).

### CONSUMES — S1 `TransitionLayer.alphaFor`
- Role: CONSUMER. Folded into `buildVideoLayers` effective opacity. Contract
  verified: **YES** — assembleLayers tests assert fade-in midpoint (0.5×0.5=0.25)
  and fade-out ramp. Peer: S1 (self) / export 05 (shared semantics).

### CONSUMES — S1 `SubtitleLayer` (`activeSubtitlesAt`, `resolveSubtitleStyle`, `wrapText`)
- Role: CONSUMER. `buildSubtitleLayers` produces pre-wrapped `subtitle` layers.
  Contract verified: **YES** — wrap-into-multiple-lines + empty-drop tested; §6 case
  9 draws the lines. Peer: S1 (self).

### CONSUMES — S1 `ImageOverlayLayer.buildImageLayersAt`
- Role: CONSUMER. `assembleLayers` lifts image layers above video. Contract
  verified: **YES** — z-order test asserts image z > all video z. Peer: S1 (self).

### CONSUMES — S1 `AudioSyncPool` (`AudioSyncPool`, `computeAudioSyncActions`, `AudioElementLike`)
- Role: CONSUMER. Engine builds it with a `VideoElementLike→AudioElementLike`
  adapter and ticks it on the composition clock; audioDetached → no double audio.
  Contract verified: **YES** — engine test pins detached embedded audio stays
  paused. Peer: S1 (self).

### CONSUMES — S1 `VideoTrackGroup` / `AudioTrackGroup` (types)
- Role: CONSUMER. `VideoTrackGroup` is the per-tick video input; `AudioSyncGroup`
  the audio input. Contract verified: **YES** — used as the facade return shapes.
  Peer: S1 (self).

### CONSUMES — `resolveSequencePlaybackUrl` (RC-B resolution surface)
- Role: CONSUMER (indirect — injected as `resolveSource`). Not called inside S2;
  the host wires it so the SAME resolution drives compare + assign. Contract
  verified: **YES** by construction — `computeSourcePlan` compares and the applier
  assigns the identical `desiredUrl`. Peer: S1 (resolver unchanged) / S3 (wires it).

### PRODUCES — `MultiTrackPlaybackEngine` engine surface (for S3 to mount)
- Role: PRODUCER. See "Context for Downstream" for the exact API + DOM contract.
  Contract verified: **YES** — exported from the barrel; engine test mounts it with
  the same injected resolvers S3 will supply and drives play/pause/seek/dispose.

### PRODUCES — `CanvasCompositor.renderFrame(layers)` + `CompositorLayer[]`
- Role: PRODUCER. The per-frame multi-source draw entry. Contract verified: **YES**
  — renderFrame tests assert z-order, per-layer globalAlpha, subtitle draw, drawn/
  dropped accounting. Peer: S3 host (drives via engine), export 05 (mirrors z/opacity).

## Issues & Risks (esp. what only the real desktop/canvas verifies, not jsdom)

- **GPU compositing cost of N concurrent `<video>` decodes + per-frame
  `drawImage` blends** is NOT measurable in jsdom (drawImage is a spy). The
  adaptive-fps degrade/recover model is wired and unit-tested for thresholds, but
  the real frame-drop behaviour on mid-tier hardware with several 4K tracks is a
  DESKTOP-WALKTHROUGH item (spec §6 mid-material "no long stall" + §7 risk row 1).
- **Real seek/decode latency + `seeked` timing** is jsdom-invisible (jsdom never
  fires `seeked`; `currentTime` set is instant). The seek-tolerance de-bounce and
  the drift catch are logic-tested, but audio/video sync after a real seek is a
  DESKTOP item (spec §6 case 10 + §7 audio-sync risk).
- **Actual same-origin URL resolution** (`/api/storage/files/...`,
  preview/local-proxy fallback) is exercised only via the injected `resolveSource`
  fake here; S3 wires the real `resolveSequencePlaybackUrl` + live materials. §6
  cases 6/7 (import MP4 → add → play, patch-after-insert) are END-TO-END and need
  S3 + desktop. The RC-B *invariant* (compare==assign) is unit-pinned now.
- **Image overlay rasterisation** depends on `HTMLImageElement.complete`/
  `naturalWidth`, which jsdom does not load; the image draw branch is reused from
  the existing tested `_drawOverlays`, but on-canvas image pixels are a DESKTOP item.
- **Legacy-engine deviation** (decision #1): if the reviewer requires the
  multi-track logic physically inside `PlaybackEngine.ts`, that conflicts with the
  800-line cap + the 195-test coupling; flagged for the one allowed appeal/arbitration.

## Unit-verifiable NOW vs deferred to desktop walkthrough (spec §6)

| §6 case | Status |
| --- | --- |
| 4 (TrackScheduler multi-track + epsilon) | S1 — already green |
| 5 (TransitionLayer alpha curves) | S1 — already green |
| 8 (two tracks, upper opacity<1 → lower visible) | **UNIT-VERIFIED NOW** (renderFrame + assembleLayers mock-context) |
| 9 (subtitle drawn to canvas) | **UNIT-VERIFIED NOW** (renderFrame draws lines) |
| 10 (audio multi-track sync; detach → no double audio) | logic UNIT-VERIFIED (engine detached-audio test + S1 AudioSyncPool); real audible sync after seek = DESKTOP |
| 1 (resolve empty seq.url → local) | S1 — already green |
| 6 (import MP4 → add → play, no black screen) | END-TO-END — needs S3 + DESKTOP; RC-B invariant unit-pinned |
| 7 (patch-after-insert refresh) | END-TO-END — needs S3 (RC-A already in S1) + DESKTOP; RC-B swap unit-pinned |
| 11 (no `isPlaybackV2Enabled` references) | S4 (delete v1/flag) — not in S2 |

## Context for Downstream (S3 MUST mount this)

### The exact `MultiTrackPlaybackEngine` API S3 calls
- Construct: `new MultiTrackPlaybackEngine()` (optionally inject `clock`/
  `compositor`/`playhead`/`now` for tests).
- `attach(deps: MultiTrackAttachDeps)` — wires render targets + timeline facade and
  paints the first paused frame. Throws if disposed.
- `play()` / `pause()` / `seek(t: number)` — drive playback; `seek` keeps the
  prior playing/paused state. `getPhase()` → `'idle'|'playing'|'paused'|'ended'|
  'disposed'`. `subscribe(listener)` → phase changes. `dispose()` — stops clock,
  detaches compositor, blocks re-attach.

### The DOM + facade contract S3's PreviewCanvas must provide (`MultiTrackAttachDeps`)
- `canvas: HTMLCanvasElement` — the preview canvas (sized in device px).
- `resolveTrackElements(trackId) → { active: VideoElementLike; prewarm: VideoElementLike | null } | null`
  — ONE active `<video>` + ONE prewarm `<video>` per VISIBLE video track. These are
  the hidden decode sources PreviewCanvas hosts (a hidden container). Returning a
  null prewarm disables A/B prewarm for that track (still correct, just no warm-up).
- `resolveAudioElement(trackId) → VideoElementLike | null` — one HTMLAudio (or
  hidden `<video>`) per audio track; the engine adapts it to the AudioSyncPool.
- `resolveSource(seq) → string | null` — **MUST be**
  `(seq) => resolveSequencePlaybackUrl(seq, liveMaterials, lockedOpts)?.url ?? null`,
  with `lockedOpts` locked at mount (preferPreviewProxy/preferLocalProxy) so the
  compare key == the assigned value (RC-B). Do NOT pass two different resolvers for
  compare vs assign — that reintroduces the black-screen bug.
- `timeline` (`MultiTrackTimelineFacade`): `getVideoTrackGroups()` →
  `VideoTrackGroup[]` (one per visible video track, z ascending = bottom→top, items
  carrying trackZ/opacity/transition/audioDetached from CompositionAdapter);
  `getAudioSyncGroups()` → `AudioSyncGroup[]` (independent audio tracks `kind:'audio'`
  + detached-video-audio `kind:'embeddedVideoAudio'`); `getSubtitleItems()` →
  `SubtitleSequenceItem[]` (from `compositionPlayback.subtitleSequences`, S1);
  `getImageItems()` → `ImageOverlayInput[]`; `getTotalDuration()`/`getCurrentTime()`/
  `setCurrentTime()`.
- `viewport?` — `{ aspectRatio, letterboxColor }` for fixed-ratio letterboxing.
- `measureSubtitle?` — a real 2d-context text measurer
  (`(text, style) => ctx.measureText(...).width` with the same font string the
  compositor uses). Omitted → a length-based fallback (fine headless, imprecise
  wrapping on desktop, so S3 SHOULD pass a real measurer).

### Wiring notes for S3
- The engine subscribes the clock once (`subscribeTick`) and fans out to compositor
  + audio; S3 must NOT add a second clock or a second render loop.
- The first paused frame is painted in `attach`, so mounting on a paused timeline
  is not black as long as `resolveTrackElements` + `resolveSource` are ready.
- `VideoSourcePool` assigns `element.src` itself (RC-B); PreviewCanvas should NOT
  set `src` on the decode `<video>`s — only create them, size the canvas, and pass
  the handles in.
