# TESTER Summary — TODO 02 Sub-stage S1 (jsdom-testable data/wiring layers)

## Meta
- **Agent:** google-tester-01
- **Role:** TESTER
- **Task:** todo-02-s1
- **Phase:** 2
- **Verdict:** ALL PASS

S1 acceptance-tested. Reviewer verdict (Meta only, by design) was PASS; I formed
an independent judgment and concur. No bugs, no incomplete impl, no spec
mismatch. 18 new tests added to harden S1-scope boundaries and earn S2/S3
integration credit. S2/S3-scope acceptance cases (multi-video canvas
compositing, subtitle pixel render, audio runtime) correctly deferred.

## Key Decisions

1. **Verified the trailing-edge convention divergence is intentional and is now
   PINNED.** The three active-at selectors deliberately differ at the exact end
   of an item:
   - `activeClipAt` (TrackScheduler) — **last clip INCLUSIVE** (`<= end+eps`),
     non-last half-open. Audio/video final frame wins at end.
   - `activeImageItemsAt` (ImageOverlayLayer) — **strict half-open** (`< end-eps`),
     no last-item carve-out. An overlay never leaks one frame past its end.
   - `activeSubtitlesAt` (SubtitleLayer) — **closed** (`<= end+eps`). A caption
     stays visible through its exact end.
   I added a regression guard that asserts all three diverge at the same `t=end`
   so a future "unify the selectors" tidy-up that silently changes preview
   behaviour fails loudly. **Consistent with v1 image parity and each layer's
   intent — NOT a defect.**

2. **Confirmed audio at the EXACT end of the last clip stays a one-frame play
   candidate (the reviewer's spot-check item).** `computeAudioSyncActions` on a
   single audio clip at `t=end` → `hold`/`play` (not `pause`), because
   `activeClipAt` is last-clip-inclusive. Just past `end+eps` → `pause`. Pinned
   both. Cosmetically negligible, self-heals at composition end — intentional.

3. **audioDetached no-double-audio is correctly modelled and already tested
   across two tracks on one clock.** Confirmed `AudioSyncPool.test.ts` asserts
   the detached embedded-video-audio track pauses while the paired independent
   audio track plays (both the pure planner and the fake-element wrapper). I
   added complementary `volume=0 → still plays at volume 0` (mute via volume,
   NOT pause — stays clock-aligned) and an over-driven-track clamp test.

4. **Integration boundaries verified pre-S2/S3.** Wrote explicit contract tests:
   - `ImageOverlayLayer.buildImageLayersAt` → `CompositorLayer['image']` whose
     `{src, opacity, bounds.{x,y,w,h}}` are exactly the fields the current
     `CanvasCompositor._drawOverlays` `image` branch reads (the produced layer
     adapts cleanly into `OverlayPayload['image']`; bounds finite + in [0,1]).
   - `AudioSyncPool` plan shape: every action has `trackId` + a valid
     `AudioSyncActionKind`; non-pause actions carry a clamped [0,1] volume;
     muted → pause with no volume.
   - `SubtitleSequenceItem` ports↔view dual declaration: a **typed** round-trip
     assignment (no `as unknown as`) that fails `tsc` if either declaration
     drifts — closing the gap the reviewer flagged where the hook's cast would
     mask divergence. Type-check passes → declarations are genuinely in lockstep.

5. **Completeness audit clean.** No TODO/FIXME/HACK/placeholder in any S1 source
   (new or modified). NaN/±Inf guards present (`clamp01`/`clampVolume` return 0
   for non-finite; pinned that `+Inf → 0` because the guard precedes the `>=1`
   clamp — a deliberate safe choice). `_ensurePlaying` swallows only the benign
   play() promise rejection. `AUDIO_DRIFT_EPSILON_SEC` is the single named drift
   constant — no bare `0.5` in `AudioSyncPool.ts`.

## Execution Flow

1. Read dev summary + global-context + reviewer Meta (verdict only) +
   master-plan + spec-01 + spec-02 (esp. §6) + todo-02 + task-orchestration.
2. Read all S1 source (5 new layers + constants + types + ports +
   CompositionAdapter + videoEditingTypes + useTimelineComposition +
   ClipTimeMapping) and all 8 S1 test files; read `CanvasCompositor._drawOverlays`
   to verify the produced image-layer shape against the real draw consumer.
3. Ran the 8 S1 test files (**91 passed**), `npm run type-check` (**clean**),
   and the full `src/components/video` suite (**99 files / 806 passed** — matches
   dev's reported 806, no regression).
4. Probed S1-scope gaps and wrote 18 new tests (2 new files + 2 augmented).
5. Re-ran new + augmented files (31 passed), type-check (clean), and the full
   video suite again: **101 files / 824 passed** (was 99/806; +2 files / +18
   tests, no regressions).

## Artifacts

### Tests added (NEW files)
- `src/components/video/playback/__tests__/compositorLayerBoundaries.test.ts`
  (11) — trailing-edge convention consistency across the 3 selectors;
  audio-at-last-clip-end convention; ImageOverlayLayer→compositor and
  AudioSyncPool-plan integration boundaries.
- `src/components/video/timeline/infrastructure/__tests__/subtitleSequenceContract.test.ts`
  (2) — typed ports↔view `SubtitleSequenceItem` lockstep guard (compile-time +
  runtime; no `as unknown as`).

### Tests augmented
- `src/components/video/playback/__tests__/AudioSyncPool.test.ts` (+5) —
  volume edges (explicit 0, exactly 1, just-over-1, NaN/±Inf guard) and
  `volume=0 → play at 0 not pause`, over-driven-track clamp.

### Spec traceability matrix
Inline below (## Spec Traceability). No separate file.

## Spec Traceability (spec 02 §6, S1-relevant requirements)

| §6 case | Requirement | Implemented? | Test Exists? | Passes? | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | `resolveSequencePlaybackUrl`: empty seq.url + live direct-local → localStorageUrl, not gated on proxy/download | YES (no code change needed) | YES `resolveSequencePlaybackUrl.test.ts` rc1 cases | YES | direct-local bypasses both proxy tiers |
| 2 | `useTimelineComposition`: patch-after-insert URL refresh, id stable, `currentSequenceIndex` preserved | YES (signature rebuild + materials effect) | YES `useTimelineComposition.localPreview.test.ts` | YES | preservedIndex by seq id |
| 3 | rebuild on pure `materials` change | YES | YES (same file) | YES | signature gate avoids no-op rebuild |
| 4 | `TrackScheduler.activeClipAt`: multi-track + epsilon boundaries | YES | YES `TrackScheduler.test.ts` + `compositorLayerBoundaries.test.ts` | YES | source time via ClipTimeMapping (6-dp) |
| 5 | `TransitionLayer.alphaFor`: fade-in/out/dissolve curves, 1 outside | YES | YES `TransitionLayer.test.ts` | YES | half-clip clamp prevents alpha>1 |
| 6 | multi-video canvas compositing (pixel) | — | — | — | **Deferred to S2** (compositor core) |
| 7 | patch-after-insert end-to-end component preview | partial (hook layer done) | hook-level YES | YES | full component **Deferred to S3** |
| 8 | two-track canvas overlay pixel assertion | — | — | — | **Deferred to S2** |
| 9 | subtitle canvas pixel render | data/layout YES | YES `SubtitleLayer.test.ts` (layout) | YES | pixel draw **Deferred to S2** |
| 10 | audio runtime: two tracks aligned, detach → no double audio | planner YES | YES `AudioSyncPool.test.ts` + boundaries | YES | HTMLAudio runtime **Deferred to S3** |
| 11 | flag-deletion regression (no `isPlaybackV2Enabled`) | — | — | — | **Deferred to S4** (v1/flag deletion) |
| — | subtitle extraction (types→adapter→hook flow) | YES | YES `CompositionAdapter.subtitles.test.ts` + `subtitleSequenceContract.test.ts` + hook | YES | dual decl in lockstep (tsc-verified) |
| spec01 | ClipTimeMapping reuse (no hand-rolled time math) | YES | YES (asserted to 6 dp) | YES | INV-3 path |

## Issues & Risks

- **No bugs found. No incomplete impl. No spec mismatch. No integration
  incompatibility.** Concur with reviewer PASS.
- **(non-blocking, downstream) Adapter forwards only `audioDetached`**;
  `opacity`/`trackZ`/`transitionIn`/`transitionOut` are typed + signature-folded
  but not yet populated by `extractVideoSequences` (no UI producer today; default
  `opacity=1`). Forward-compatible; populating belongs to S2. Not an S1 defect.
- **(watch item) `SubtitleSequenceItem` is declared twice** (ports + view). Now
  guarded by a typed round-trip test + the tsc gate; if either drifts, type-check
  goes red. Keep them in lockstep — the hook's `as unknown as` would otherwise
  mask drift.
- **(style, pre-existing, non-blocking)** Some lines exceed the 80-col cleancode
  guideline (not lint-enforced; consistent with surrounding code). All S1 files
  ≤248 lines, methods ≤~36 lines.

## Issue Analysis (per task Step 6)
No issues found. Nothing the reviewer missed; the reviewer's two observations
(trailing-edge divergence; adapter passthrough not yet populated) are accurate
and I converted the first into an explicit regression guard rather than a defect.

## Context for Downstream (S2 / S3)

- **S2 (compositor core):** `buildImageLayersAt` output is byte-compatible with
  the `image` fields `_drawOverlays` already reads — wire it straight in; it does
  its own time selection (no `startMs`/`endMs` needed) and carries `z` for
  cross-layer ordering. §6 cases 6/8/9-pixel are S2 acceptance; write the
  off-screen-canvas pixel assertions there.
- **S3 (host/hook + audio runtime):** `AudioSyncPool.tick` is ready; supply the
  `AudioElementResolver` (HTMLAudio pool) and build groups (`kind:'audio'` per
  audio track + `kind:'embeddedVideoAudio'` per video track carrying
  `audioDetached`). Pass `track.volume` normalized 0..2 (the product is clamped
  to [0,1]). §6 case 10 audio-runtime + case 7 full-component preview are S3
  acceptance. **Spot-check at composition end:** audio on the last clip is a
  one-frame `play` at exact end by design (pinned in
  `compositorLayerBoundaries.test.ts`).
- **S4 (delete v1 + flag):** §6 case 11 (`isPlaybackV2Enabled` absence) is the
  S4 acceptance gate; not in S1 scope.
- Keep the two `SubtitleSequenceItem` declarations identical — the contract test
  enforces it via tsc.

## Verification
- S1 8 files: **91 passed**. With my 18 added (10 files): **109 passed**.
- `npm run type-check`: **CLEAN** (incl. the new typed contract test).
- Full `src/components/video`: **101 files / 824 passed** (baseline 99/806 + my
  2 files / 18 tests; no regressions).
