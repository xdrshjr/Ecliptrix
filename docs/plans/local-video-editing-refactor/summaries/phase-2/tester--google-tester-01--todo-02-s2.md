# TESTER Summary — TODO 02 Sub-stage S2 (multi-track compositor CORE)

## Meta
- **Agent:** google-tester-01
- **Role:** TESTER
- **Task:** todo-02-s2 (unified local preview compositor — engine core)
- **Phase:** 2
- **Verdict:** ALL PASS

S2 = the new multi-track real-time canvas compositor engine that must COEXIST
with v1 (no v1 deletion, no VideoPlayerPanel wiring — those are S3/S4).
Acceptance-tested against spec 02 §6 (cases 8/9/10-logic verifiable NOW;
6/7/real-canvas/seek/audio-timing deferred to S3 + desktop walkthrough; case 11
to S4). Reviewer google-reviewer-01 returned PASS (verdict only). My independent
verdict: **ALL PASS** — implementation complete, contracts honoured, no issue
the reviewer missed, no incomplete impl, integration boundaries S3 relies on are
now under test.

## Key Decisions

1. **Confirmed the RC-B "比对键==赋值" root fix is BOTH correct AND under a
   regression-proof test.** The dev's tests pin compare==assign on the pure
   planner and the fresh-insert applier path. The HARDER black-screen case — an
   element already holding the OLD live url, whose live material is patched to a
   NEW url, must SWAP `element.src` to that exact new value — was NOT covered at
   the applier level. I added it (`multiTrackCompositorS2Boundaries.test.ts`).
   **Mutation-verified:** reintroducing the stale-snapshot comparison key
   (`normalizeSrc(currentSrc) !== normalizeSrc(hit.clip.url)`) breaks 8 tests
   including my new applier test — so the suite would FAIL loudly if the
   black-screen root cause regressed. This is the spec's stated MUST.

2. **Transition-alpha-at-draw is now pinned end-to-end** through the real
   `assembleLayers → renderFrame` pipeline (not just the assembleLayers seam in
   isolation). **Mutation-verified:** dropping `× alpha` in `buildVideoLayers`
   breaks the test (drawn globalAlpha 0.5 instead of 0.25).

3. **Marked the desktop-only items the dev/reviewer correctly deferred** (real
   GPU N-video blend cost, real `seeked` timing + audio/video sync after a real
   seek, on-canvas image pixels, end-to-end §6 cases 6/7). These are
   jsdom-invisible and genuinely need S3 + a real Electron walkthrough; flagging,
   not faulting.

4. **No false bugs raised.** The one NIT-class observation (engine
   `_buildVideoEntries` recomputes `activeClipAt` that the pool already found;
   exported `activeVideoClipAt` helper currently unused) is pure + deterministic
   → correct, just a small per-tick redundancy + a dangling helper. Recorded as a
   risk/cleanup note, NOT an issue.

## Execution Flow
1. Read upstream: S2 + S1 dev summaries, global-context, reviewer Meta (verdict
   PASS only — per the information boundary).
2. Read planning: specs 02 (esp. §2.2 / §2.6 RC-B / §6) + 01 (ClipTimeMapping),
   todos/02 + task-orchestration.
3. Read all S2 source: NEW (VideoSourcePool, MultiTrackPlaybackEngine,
   internal/assembleLayers) + MODIFIED (CanvasCompositor renderFrame path,
   PlaybackClock subscribeTick, types ICanvasCompositor.renderFrame, constants
   VIDEO_SEEK_TOLERANCE_SEC, index barrel) + the S1 layers S2 consumes
   (TrackScheduler, TransitionLayer, SubtitleLayer, ImageOverlayLayer,
   AudioSyncPool) + videoEditingTypes passthrough fields.
4. Read all 4 dev test files + my prior S1 boundary file (to avoid duplication).
5. RAN: 4 S2 files (43 pass) → type-check (clean) → full `src/components/video`
   (105 files / 867 pass — matches dev's reported 867, no regression).
6. WROTE `multiTrackCompositorS2Boundaries.test.ts` (16 cases) closing the gaps.
7. Mutation-tested the two critical new assertions (RC-B applier swap;
   transition alpha at draw) — both fail under the injected regression, pass on
   revert.
8. Re-ran: 5 S2 files (59 pass) + type-check (clean) + full video suite
   (**106 files / 883 pass**, +16 from the new file, zero regressions).
9. Completeness audit: no TODO/FIXME/HACK/empty-catch/placeholder in S2 source
   (grep-confirmed); seek tolerance + drift epsilon are named constants;
   error-handling present at every IO/DOM boundary.

## Tests Run

| Run | Files | Tests | Result |
| --- | --- | --- | --- |
| 4 S2 dev files (targeted) | 4 | 43 | PASS |
| `npm run type-check` | — | — | CLEAN |
| Full `src/components/video` (baseline) | 105 | 867 | PASS (matches dev) |
| New `multiTrackCompositorS2Boundaries.test.ts` | 1 | 16 | PASS |
| All 5 S2 files | 5 | 59 | PASS |
| Full `src/components/video` (after new file) | 106 | 883 | PASS, no regression |

**New tests written (16, in `multiTrackCompositorS2Boundaries.test.ts`):**
- RC-B applier swap on patch-after-insert (old url → new url, exact value) **[critical, mutation-verified]**
- RC-B no-redundant-swap when already holding the live url (src setter never called)
- RC-B planner compare-key === planned desiredUrl (no stale snapshot)
- Seek de-bounce at EXACT tolerance boundary (≤ → no seek) + one-epsilon-beyond (→ seek)
- Transition alpha at draw: fade-in × item-opacity through renderFrame **[mutation-verified]**; full-opacity body
- z-order: subtitle z > image z > video z (caption never occluded)
- Engine: phase-subscription fires on play→pause + stops after unsubscribe
- Engine: a clock tick AFTER dispose is a no-op (no render/advance — clock unsubscribed, no leak)
- Engine: play() is a no-op after dispose
- Legacy coexistence: CanvasCompositor.drawFrame still draws one source at full alpha (v1 untouched)
- Integration boundary: null prewarm element allowed (A/B disabled, still renders)
- Integration boundary: viewport letterboxColor honoured at fill
- Integration boundary: real measureSubtitle wired through the engine produces wrapped lines
- Integration boundary: renderFrame accepts the full CompositorLayer[] union shape

## Spec Traceability Matrix (spec 02 §6)

| §6 requirement | Implemented? | Test Exists? | Test Passes? | Notes |
| --- | --- | --- | --- | --- |
| 1 (resolve empty seq.url → local) | YES | YES (S1) | YES | S1 — already green |
| 2 (patch live url → seq refresh, keep index) | YES (RC-A, S1) | YES (S1) | YES | S1 useTimelineComposition |
| 3 (materials-only change → rebuild) | YES (RC-A, S1) | YES (S1) | YES | S1 |
| 4 (TrackScheduler multi-track + epsilon) | YES | YES (S1) | YES | S1 green |
| 5 (TransitionLayer alpha curves) | YES | YES (S1) | YES | S1 green |
| **8 (two tracks, upper opacity<1 → lower visible)** | YES | YES (dev renderFrame + assembleLayers; +my e2e alpha) | YES | **UNIT-VERIFIED NOW** — globalAlpha recorded per layer; mutation-proven |
| **9 (subtitle drawn to canvas; above image)** | YES | YES (dev renderFrame; +my subtitle-z-above-image) | YES | **UNIT-VERIFIED NOW** — fillText asserted; z stacking pinned |
| **10 (audio multi-track sync; detach → no double audio) — LOGIC** | YES | YES (engine detached-audio + S1 AudioSyncPool) | YES | **LOGIC VERIFIED NOW**; real audible sync after a real seek = DESKTOP |
| RC-B compare==assign (§2.6, black-screen root) | YES | YES (dev planner/applier; **+my stale-key applier swap**) | YES | **mutation-verified** — fails if stale key reintroduced |
| Seek de-bounce (VIDEO_SEEK_TOLERANCE_SEC) | YES | YES (dev within/exceeds; **+my exact-boundary**) | YES | named constant 0.25 |
| Engine attach/play/pause/seek/dispose + clock-driven tick | YES | YES (dev + my phase-sub/post-dispose) | YES | dispose blocks re-attach + no leak |
| 6 (import MP4 → add → play, no black screen) | n/a (S3) | — | — | **Deferred to S3 + desktop walkthrough** (end-to-end; RC-B invariant unit-pinned) |
| 7 (patch-after-insert refresh, no reload) | n/a (S3) | — | — | **Deferred to S3 + desktop walkthrough** (RC-A in S1, RC-B swap unit-pinned) |
| real-canvas pixels / real seek timing / audio timing | n/a | — | — | **Deferred to S3 + desktop walkthrough** (jsdom-invisible) |
| 11 (no `isPlaybackV2Enabled` references) | n/a (S4) | — | — | **S4** (delete v1 / flag) — not in S2 |

Traceability is COMPLETE for the S2 scope: every §6 item verifiable NOW (8, 9,
10-logic, RC-B, seek, engine API) has a passing test; every deferred item is
explicitly attributed to S3+desktop or S4.

## Issues & Risks

**Issues found: NONE.** No issue the reviewer missed, no incomplete impl, no
false bug. The implementation is complete and correct for the S2 scope.

**Risks / what ONLY a desktop walkthrough can verify (carry into S3):**
- Real GPU cost of N concurrent `<video>` decodes + per-frame `drawImage` blends
  on mid-tier hardware (several 4K tracks) — adaptive-fps thresholds are
  unit-tested but real frame-drop behaviour is desktop-only (spec §7 risk row 1).
- Real `seeked` timing + audio/video sync AFTER a real seek — jsdom never fires
  `seeked` and sets `currentTime` instantly, so the seek-tolerance de-bounce and
  drift catch are logic-tested only; audible sync is a desktop item (§6 case 10).
- On-canvas image pixels — `HTMLImageElement.complete`/`naturalWidth` don't load
  in jsdom; the image draw branch is reused from the tested `_drawOverlays`, but
  actual rasterised pixels are desktop-only.
- End-to-end §6 cases 6/7 (import → add → play; patch-after-insert with no
  reload) need the S3 PreviewCanvas host + the real `resolveSequencePlaybackUrl`
  wiring + a desktop walkthrough. The RC-B *invariant* (compare==assign) is
  unit-pinned NOW, mutation-proven.

**Non-blocking cleanup (NIT, recorded — NOT an issue):**
- `MultiTrackPlaybackEngine._buildVideoEntries` recomputes `activeClipAt` that
  `VideoSourcePool.sync` already found (the plan returns only `trackId`/`z`,
  dropping the clip). Pure + deterministic → correct, just a small per-tick
  redundancy. The exported `assembleLayers.activeVideoClipAt` helper is currently
  unused by the engine. Optional S3 micro-cleanup.

**Information-boundary note:** the reviewer summary file contained detailed
findings below its `## Meta` section; per the task I consumed ONLY the Meta
verdict (PASS) and formed an independent assessment from code + specs.

## Artifacts
- **New test file:** `src/components/video/playback/__tests__/multiTrackCompositorS2Boundaries.test.ts`
  (16 cases — RC-B applier swap, seek-boundary, transition-alpha-at-draw,
  subtitle-z, engine phase/dispose, legacy coexistence, MultiTrackAttachDeps
  integration boundaries). Two critical assertions mutation-verified.
- **Spec traceability matrix:** this file, "Spec Traceability Matrix" section.
- **No source changed** (the two mutations were temporary, reverted, and
  re-verified green).

## Context for Downstream

- **S3 (PreviewCanvas + useCompositionPlayback):** the MultiTrackAttachDeps DOM
  contract is now under test (null prewarm allowed; viewport letterbox honoured;
  real measureSubtitle wired → wrapped lines; renderFrame accepts the full
  CompositorLayer[] union). CRITICAL wiring (unchanged from dev/reviewer): pass
  ONE resolver `(seq) => resolveSequencePlaybackUrl(seq, liveMaterials,
  lockedOpts)?.url` for BOTH compare and assign — two different resolvers
  reintroduce the black-screen bug the mutation test proves. PreviewCanvas must
  create the A/B `<video>` handles but NOT set their `src` (the pool owns
  assignment). Drive §6 cases 6/7 + the real-canvas/seek/audio desktop
  walkthrough — those are NOT unit-coverable.
- **S4:** legacy `PlaybackEngine.ts` + its barrel export + the v1 inline player +
  flag must be deleted together (the two-engine coexistence is time-boxed). My
  legacy-coexistence test confirms `drawFrame` is still the untouched single-
  source path NOW; S4 removes it.
- **S5 export parity:** `CompositorLayer` z-order / opacity / `alphaFor` fade
  semantics are the SHARED contract the ffmpeg filtergraph must reproduce; the
  transition-alpha-at-draw test pins the preview side of that contract.
