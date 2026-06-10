# TESTER Summary — TODO 02 Sub-stage S3 (host + orchestration hook + wiring)

## Meta
- **Agent:** google-tester-01
- **Role:** TESTER
- **Task:** todo-02-s3 (unified local preview compositor — PreviewCanvas host +
  useCompositionPlayback hook + VideoPlayerPanel v2-branch wiring)
- **Phase:** 2
- **Verdict:** ISSUES FOUND (one real latent bug the reviewer missed; tests &
  type-check otherwise green, no regression). Recommend FIX-BEFORE-S4, not block:
  the broken path is the new (flag-gated, not-yet-default) compositor preview;
  v1 is byte-unchanged, so nothing user-facing regresses today. S4 makes the
  compositor the sole path and MUST NOT inherit this bug.

## Key Decisions

### Testing-approach finding: dev's source-regex claim is TRUE — independently verified at the deepest level
The dev used **source-regex** tests for `PreviewCanvas.tsx` and the
`VideoPlayerPanel` mount, claiming "vitest cannot compile component JSX under
this project's `jsx:'preserve'` tsconfig". I did NOT trust this — I ran three
probes:
1. `render(<div/>)` in a test file → **fails** at `vite:import-analysis`:
   `Failed to parse source for import analysis ... make sure to not set jsx to
   preserve` (the `<div>` token). Confirms the test-file-JSX constraint.
2. `render(React.createElement(Trivial))` (NO JSX syntax) → **passes**. So the
   harness CAN render components — the blocker is JSX *syntax*, not rendering.
3. Importing the REAL `PreviewCanvas` (which has internal JSX) and rendering it
   via `createElement` → **fails inside `PreviewCanvas.tsx:238`** (its own JSX).
   So a JSX-containing `.tsx` component literally cannot be imported into vitest
   AT ALL — not the test file's JSX, not an imported component's JSX.

Conclusion: vitest config ships **no `@vitejs/plugin-react`** and **no esbuild
jsx override**; `tsconfig.json:14` is `"jsx":"preserve"`. The source-regex
substitute for the two component files is **legitimately forced, not a weak
shortcut** — the reviewer's "ACCEPTED" ruling is correct. The `renderHook` hook
test works only because `useCompositionPlayback.ts` is a `.ts` file (no JSX) and
mocks the engine. All probes deleted after use.

Implication for S4: behavioral render tests of PreviewCanvas/VideoPlayerPanel are
impossible until the harness gains a React/JSX transform. The hook (pure TS) is
where the real logic lives and IS behaviorally testable — which is where I found
the bug below.

### Real bug found (reviewer missed): scrub-while-paused effect is dead code
`useCompositionPlayback.ts` render body (line 322) sets
`currentTimeRef.current = currentTime` on EVERY render, BEFORE the scrub effect
(lines 431-440) runs after commit. That effect's guard
`if (Math.abs((currentTimeRef.current ?? 0) - currentTime) < 1e-6) return;`
therefore ALWAYS sees `currentTimeRef.current == currentTime` → returns early →
**never calls `engine.seek()` on a prop-driven paused scrub.** Compounding it,
`VideoPlayerPanel.tsx` never calls `compositionPreview.seek/play/pause/getPhase/
isReady` imperatively (grep = 0 hits; only `hostRef` is used). Net effect on the
v2 compositor path: **paused-scrub does not repaint, and play/pause buttons do
not drive the new engine.** Pinned by a new behavioral test that documents the
current (broken) behavior. Category: correctness / dead-guard (ref clobbered
before read). Confidence: HIGH (behaviorally demonstrated via renderHook).

## Execution Flow
1. Read upstream: dev S3 + S2 summaries, global-context, reviewer **Meta only**.
2. Read planning: spec 02 (§2.6 RC-A/RC-B + readiness gate, §6 acceptance),
   spec 01 (clip contract), todo 02, task-orchestration.
3. Read code: PreviewCanvas.tsx, useCompositionPlayback.ts, the 3 S3 test files,
   the VideoPlayerPanel diff, MultiTrackPlaybackEngine, AudioSyncPool, barrel,
   localMaterial, resolveSequencePlaybackUrl, vitest.config, tsconfig.
4. Ran the 3 S3 test files → 33 passed. type-check → clean. Full
   `src/components/video` → 916 passed / 109 files (matches dev's report).
5. Independently verified the JSX claim via 3 probes (above) — confirmed TRUE.
6. Wrote `useCompositionPlayback.probe.test.tsx` (6 tests) for the lifecycle /
   RC-B / readiness boundaries the original suite under-pins → found the
   scrub-while-paused bug; documented + pinned it. 6/6 pass.
7. Re-ran type-check (clean with probe added) + full video suite → **922 passed
   / 110 files** (916 + 6), no regression.
8. Re-ran the S1/S2 supporting case tests (cases 1-5, 8, 9) → 103 passed.
9. Completeness audit: file sizes, TODO markers, empty bodies.

## Artifacts
### Created (tests)
- `src/components/video/hooks/__tests__/useCompositionPlayback.probe.test.tsx`
  (6 tests): attach-once invariant (no re-attach on sequence/material/time
  churn; engine constructed once); RC-B locked options survive prop flips
  (deterministic resolve after preferPreviewProxy/Local change); graceful
  attach-failure (engine.attach throws → fail-soft dispose, no crash);
  **scrub-while-paused BUG** (documents the dead guard); scrub-while-playing
  (no re-seek, engine owns clock); v1-unchanged (enabled=false → zero engine
  construction / attach / seek even after hostRef binds).

### Probes (created then deleted)
- `_jsxprobe.test.tsx`, `_ce_probe.test.tsx`, `_pc_probe.test.tsx` — the 3 JSX
  capability probes (deleted after capturing evidence).

## Tests Run
| Scope | Result |
| --- | --- |
| 3 S3 test files | 33 passed |
| `npm run type-check` (before + after probe) | clean (exit 0) |
| Full `src/components/video` (before probe) | 916 passed / 109 files |
| Full `src/components/video` (after probe) | **922 passed / 110 files**, 0 fail |
| S1/S2 supporting cases (ClipTimeMapping/TrackScheduler/Transition/renderFrame/assembleLayers/MultiTrackEngine/VideoSourcePool/useTimelineComposition.localPreview/resolveSequencePlaybackUrl) | 103 passed / 9 files |
| New probe file alone | 6 passed |

## Spec 02 §6 Traceability Matrix
| §6 case | Implemented? | Test exists? | Passes? | Notes |
| --- | --- | --- | --- | --- |
| 1 resolve empty seq.url → local URL | YES (S1) | YES | YES | resolveSequencePlaybackUrl.test |
| 2 patch-after-insert refresh (RC-A) | YES (S1) | YES | YES | useTimelineComposition.localPreview |
| 3 materials-only change rebuild | YES (S1) | YES | YES | useTimelineComposition.localPreview |
| 4 TrackScheduler multi-track + epsilon | YES (S1) | YES | YES | TrackScheduler.test |
| 5 TransitionLayer alpha curves | YES (S1) | YES | YES | TransitionLayer.test |
| 6 import MP4 → add → play, no black | YES (wireable) | partial (RC-B invariant unit-pinned; readiness gate) | n/a real paint | **Deferred to desktop** (jsdom = no decode/drawImage) |
| 7 patch-after-insert play, no reload | YES (wireable) | partial (RC-B compare==assign unit-pinned) | n/a real paint | **Deferred to desktop** |
| 8 two tracks, upper opacity<1 → lower visible | YES (S2) | YES | YES | renderFrame + assembleLayers (mock ctx) |
| 9 subtitle drawn to canvas | YES (S2) | YES | YES | renderFrame draws lines |
| 10 audio multi-track sync; detach→no double | logic YES | logic YES (AudioSyncPool suppress + buildAudioSyncGroups tag) | logic YES | **Audible sync after real seek deferred to desktop**; see embedded-audio risk below |
| 11 no `isPlaybackV2Enabled` refs | NO (intentional) | n/a | n/a | **S4** — flag retained for coexistence by design |
| RC-B compare==assign (§2.6) | YES | YES (hook + my probe: locked opts deterministic across calls + prop flips) | YES | single injected resolver, options locked once |
| Readiness gate direct-local (§2.6) | YES | YES | YES | direct-local ready immediately, not blocked on proxy/download |
| v1-unchanged (flag OFF) | YES | YES (compositorMount source + my probe behavioral inertness) | YES | enabled=false → hook fully inert |

## Integration-Boundary Tests (what S4 relies on) — confirmed/extended
- **Engine attach contract** (`MultiTrackAttachDeps` shape): hook builds it 1:1;
  type-check pins the shape; `ICanvasViewport` `{aspectRatio, letterboxColor?}`
  matches the `{aspectRatio, letterboxColor:'#000'}` the hook passes. CONFIRMED.
- **PreviewCanvasHandle DOM host contract** (getCanvas / resolveTrackElements /
  resolveAudioElement / measureSubtitle; per-track active+prewarm lazy cache;
  no `.src=` — RC-B; pool release on unmount): pinned by source-regex (only
  viable method — JSX render impossible). Verified the assertions are meaningful
  (they target real wiring, not trivially-true strings).
- **Attach-once / no re-attach on data churn**: EXTENDED — new probe proves the
  engine is constructed once and never re-attached when sequences/materials/
  currentTime change (Key Decision #4 now behaviorally pinned).
- **Graceful attach failure**: EXTENDED — new probe proves fail-soft dispose.
- **v1-unchanged inertness**: EXTENDED — new probe proves zero engine activity
  when enabled=false.

## Issues & Risks
1. **[BUG, reviewer should have caught: YES] scrub-while-paused dead guard.**
   `currentTimeRef.current` clobbered in render (line 322) before the scrub
   effect reads it (line 437) → effect never seeks; panel never seeks
   imperatively. The new compositor path has no working paused-scrub repaint /
   play-pause control wiring. Category: correctness. The reviewer's PASS WITH
   FIXES cited only a trivial doc fix — this behavioral defect was missed.
   Fix direction: keep a SEPARATE `lastSeekedTimeRef` (not the latest-value ref)
   for the guard, OR have the panel drive `compositionPreview.seek/play/pause`
   imperatively. MUST be fixed before/at S4 (where this becomes the sole path).

2. **[DESKTOP RISK, not confirmable in jsdom] embedded (non-detached) video
   audio may be silent.** PreviewCanvas creates video decode elements with
   `muted = true` (line 113) AND the engine routes every `embedded:<trackId>`
   audio group to a SEPARATE srcless hidden element from `resolveAudioElement`
   (which PreviewCanvas never assigns a src to — only the VideoSourcePool sets
   src, and only on the VIDEO decode elements). So a non-detached video clip's
   own audio appears to have no sounding source. This would be "no audio,"
   distinct from "no double audio." Cannot verify in jsdom (no decode). FLAG for
   the desktop walkthrough: confirm a plain video clip with embedded audio is
   AUDIBLE on the v2 path. Not claimed as a confirmed bug.

3. **[KNOWN DEBT, correctly deferred] VideoPlayerPanel.tsx = 3411 lines (>800).**
   Pre-existing (was 3350); S3 added ~60 lines of localized wiring. D10 split is
   scoped to S4 per spec §2.8 + global-context. Not an S3 defect.

4. **[BY DESIGN] `MOUNT_LEGACY_V2_SURFACE = false` dead-branch marker** + retained
   flag/PreviewSurface/v2OverlaysProvider — intentional coexistence, deleted in
   S4. Correct.

## Completeness Audit
- No TODO/FIXME/HACK/XXX in the S3 source (one "placeholder" hit is a doc
  comment about an uploading material, not a stub).
- No empty function bodies / placeholder returns.
- Error handling present: attach failure (try/catch → dispose), empty
  composition (engine paints empty layer list; readiness gate trivially ready),
  missing material (readiness gate holds; image inputs drop URL-less items).
- Sizes: PreviewCanvas 243, useCompositionPlayback 443 (both ≤800); methods
  ≤50. (VideoPlayerPanel >800 = deferred S4 debt — see Risk 3.)

## Context for Downstream (S4)
- **FIX the scrub-while-paused dead guard** before making the compositor the sole
  path; otherwise paused-scrub repaint silently fails for all users. Either fix
  the guard ref OR wire the panel's transport controls to
  `compositionPreview.{seek,play,pause}`.
- **Wire the transport**: S4 (or the desktop walkthrough prep) must connect the
  play/pause/seek UI to `compositionPreview` — currently only `hostRef` is used.
- **Desktop walkthrough MUST verify embedded (non-detached) video audio is
  audible** (Risk 2), in addition to the detach→no-double-audio logic.
- The RC-A/RC-B invariants, readiness gate, attach-once lifecycle, and
  v1-inertness are all unit/behaviorally pinned and sound. The pure builders
  (buildVideoTrackGroups / buildAudioSyncGroups / buildImageOverlayInputs /
  isCompositionReady) are correct per direct-output assertions.
- The S1/S2 data+core cases stay green (103 tests). The new path coexists
  cleanly; v1 is byte-unchanged.
