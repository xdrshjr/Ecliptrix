# REVIEWER Summary — TODO 02 Sub-stage S3 (host + orchestration hook + wiring)

## Meta
- **Agent:** google-reviewer-01
- **Role:** REVIEWER
- **Task:** todo-02-s3 (unified local preview compositor — PreviewCanvas host +
  useCompositionPlayback hook + VideoPlayerPanel v2-branch wiring)
- **Phase:** 2
- **Verdict:** PASS WITH FIXES (one trivial doc fix to the S4 checklist — see below;
  code is sound and merge-ready)

## Key Decisions

### Testing-approach ruling: ACCEPTED (not a rubber-stamp)
The dev used **source-regex** tests for `PreviewCanvas` and the `VideoPlayerPanel`
mount, claiming "the vitest harness cannot compile component JSX". I did NOT take
this on faith — I **empirically reproduced** it.

Evidence:
- `vitest.config.ts` sets `environment: 'jsdom'` but ships **NO** `@vitejs/plugin-react`
  and **NO** esbuild/jsx override.
- `tsconfig.json` line 14: `"jsx": "preserve"`.
- I wrote a 12-line probe (`render(<div/>)`) and ran it. Result:
  `Error: Failed to parse source for import analysis because the content contains
  invalid JS syntax. If you use tsconfig.json, make sure to not set jsx to preserve.`
  (vite:import-analysis, the JSX `<div>` is the failing token). Probe deleted after.
- This is the SAME constraint documented by ≥4 pre-existing repo tests
  (`PreviewSurface.v2.test.tsx`, `featureFlagBranch.test.tsx`, `playheadResume.test.tsx`,
  `TimelineItem.filmstrip.test.tsx`) — all source-regex. The one repo test that uses
  `render`/`renderHook` (`projectPersistence.integration.test.tsx`) deliberately uses
  **renderHook** and explicitly avoids rendering a component tree.

RULING: the JSX-compile claim is **TRUE**. Source-regex for the two component files
is justified and consistent with the established repo pattern. Crucially, the dev did
NOT take the easy path everywhere: `useCompositionPlayback.test.tsx` is a **real
behavioral test** (`renderHook` + mocked engine + `act`) because a hook contains no
JSX and therefore compiles. This is the correct seam split, not a rubber-stamp. The
behaviorally-meaningful logic (group builders, readiness gate, resolver injection,
attach/play/pause/seek/dispose lifecycle, real-overlay facade) is all under real
execution. The source-regex files only pin DOM-shape/wiring that genuinely cannot run.

### v1-UNCHANGED guarantee: CONFIRMED
- Diff is 4 hunks, 64 insertions / 3 deletions, all localized to imports + the v2
  branch. The only "deletion" is the legacy PreviewSurface mount guard gaining a
  `MOUNT_LEGACY_V2_SURFACE &&` prefix (still inside `playbackV2Enabled`).
- The legacy `<video ref={videoRef}>` `display: playbackV2Enabled ? 'none' : 'block'`
  is **pre-existing** (untouched by this diff). When the flag is OFF it evaluates to
  `'block'` exactly as before → v1 byte-unchanged.
- New hook is `enabled: playbackV2Enabled`; off → fully inert (verified by the
  `enabled=false → never attaches` hook test).

### Contract verification (CONSUMES S2/S1, PRODUCES the S4 host): CONFIRMED
- CONSUMES `MultiTrackAttachDeps` (S2): hook builds the exact shape — `canvas`,
  `resolveTrackElements`, `resolveAudioElement`, `resolveSource`, `timeline`,
  `viewport`, `measureSubtitle`. type-check clean pins it; the hook test captures
  `lastDeps` and asserts the facade returns real groups/subtitles.
- CONSUMES the engine API (S2): attach/play/pause/seek/dispose driven + disposed on
  unmount (hook test asserts each spy).
- RC-B preserved: ONE `resolveSequencePlaybackUrl(seq, materialsRef, lockedOpts)`
  injected as `resolveSource`; options locked once in `resolverOptsRef` and never
  mutated; VideoSourcePool uses it for compare AND assign (verified S2). Hook test
  asserts determinism (`second === first`).
- CONSUMES `AudioSyncGroup` (S1): `buildAudioSyncGroups` emits `kind:'audio'` +
  `kind:'embeddedVideoAudio'` (`embedded:<trackId>`) carrying `audioDetached` → no
  double audio. Shapes match `AudioSyncPool.AudioSyncGroup`/`AudioSyncClip`.
- CONSUMES `ImageOverlayInput` (S1) + `SubtitleSequenceItem` (S1): real overlay data
  fed; the `v2OverlaysProvider` `[]` stub is bypassed (retained, dead on the new path).
- Readiness gate: `canPreviewDirectLocalMaterial` → ready immediately for direct-local,
  NOT blocked on proxy/download; advisory only (does not gate attach). Verified by test.
- PRODUCES `PreviewCanvasHandle` + the v2 mount: coherent for S4 to make sole.

## Execution Flow
1. Read upstream summaries (S3, S2, global-context) + spec 02/01 + todo 02 +
   task-orchestration.
2. Read PreviewCanvas.tsx, useCompositionPlayback.ts, MultiTrackPlaybackEngine.ts,
   playback/index.ts, the 3 new test files, and the VideoPlayerPanel diff (full
   context around the render swap + the legacy `<video>` gate).
3. Adjudicated the testing approach by writing + running a JSX render probe
   (empirically reproduced the `jsx:"preserve"` parse failure), then deleting it.
4. Ran the 3 S3 test files (33 pass), `npm run type-check` (clean), and the
   VideoPlayerPanel + playback + hooks suites (44 files / 426 pass — no regression).
5. Verified the S4 deletion checklist against actual code (files, playbackFlags keys,
   VideoPlayerPanel symbols, proxyHitMeter KEEP justification, isPlaybackV2Enabled
   reference scan).

## Artifacts (reviewed)
- `src/components/video/components/VideoPlayerPanel/PreviewCanvas.tsx` (243 lines)
- `src/components/video/hooks/useCompositionPlayback.ts` (443 lines)
- `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` (diff only)
- Tests: PreviewCanvas.test.tsx, useCompositionPlayback.test.tsx,
  VideoPlayerPanel.compositorMount.test.tsx

## Issues & Risks

### [LOW / S4-checklist gap — flagged, not blocking S3] isPlaybackV2Enabled has an
**unlisted** consumer outside the checklist.
- `src/components/video/hooks/useRemoteMaterialPrefetch.ts:43,435` imports and calls
  `isPlaybackV2Enabled()` to gate `phase3Enabled` (the canvas-engine window prefetch).
- The dev's S4 checklist item 8 asserts "no `isPlaybackV2Enabled` references remain"
  but **does not list `useRemoteMaterialPrefetch.ts`** among the files to edit. When
  S4 removes `isPlaybackV2Enabled`, this active (non-deprecated) hook will fail to
  build. S4 must decide its replacement gate (likely "always on" once v2 is sole) and
  add it to the checklist. This is the same class of footgun global-context warned
  about. Not an S3 defect (S3 deletes nothing) — it is a correction to the S4 plan,
  which drives the riskiest sub-stage, so it is logged here for the tester + S4 dev.
- Fix (doc-only, applied conceptually for S4 — see below): add `useRemoteMaterialPrefetch.ts`
  to S4 checklist item 8.

### [INFO] Desktop-only items (correctly deferred by the dev)
Real GPU compositing, N-concurrent `<video>` decode, audible audio sync after a real
seek, and on-canvas image raster are jsdom-invisible (drawImage/seeked are spies).
These are genuinely desktop-walkthrough items; the RC-A/RC-B/detach/z-order INVARIANTS
are unit-pinned. No reviewer action — flagged for the desktop hand-off.

## Fixes Applied
None to source (no code defect found; PASS WITH FIXES = the one trivial S4-checklist
documentation correction below, which belongs to the S4 plan, not S3 code).

**S4-checklist correction (for the downstream S4 dev):** checklist item 8 must add
`src/components/video/hooks/useRemoteMaterialPrefetch.ts` to the files that reference
`isPlaybackV2Enabled` and decide its post-deletion gate. Everything else in the
checklist is accurate (all named files + symbols + keys verified to exist; the
`proxyHitMeter.ts` KEEP is correct — its surviving consumer after S4 is
`selectPlaybackUrl.ts`).

## S4-Checklist Accuracy Note
Verified against the actual tree — **accurate except for the one gap above**:
- All 6 deletion-target files exist (PreviewSurface, useVideoPlayback, PlaybackEngine,
  PlaybackVariantSwitcher, killswitchMonitor; proxyHitMeter correctly KEPT).
- All playbackFlags keys named for deletion exist (`STORAGE_KEY`, `SESSION_REMOTE_KEY`,
  `URL_QUERY_KEY`, `KILL_SWITCH_KEY`, `VARIANT_OVERRIDE_KEY`) and both KEEP keys exist
  (`PREVIEW_PROXY_FLAG_KEY`, `LOCAL_PREVIEW_FLAG_KEY`).
- All VideoPlayerPanel symbols named for deletion exist exactly
  (`playbackEngineRef`, `killSwitchMonitorRef`, `proxyHitMeterRef`, `handleV2KillSwitch`,
  `v2Timeline`, `v2Resolver`, `v2OverlaysProvider`, `MOUNT_LEGACY_V2_SURFACE`).
- Gap: `useRemoteMaterialPrefetch.ts` `isPlaybackV2Enabled()` call is unlisted (above).

## Scope discipline (S4 boundary): CONFIRMED
Nothing deleted. `git diff --stat` = +64/-3, all additive/v2-branch. All legacy
modules (playbackFlags, useVideoPlayback, PreviewSurface, PlaybackEngine,
killswitchMonitor, PlaybackVariantSwitcher, proxyHitMeter, v2OverlaysProvider) still
present and still referenced. `MOUNT_LEGACY_V2_SURFACE = false` gates (not deletes) the
legacy surface — correct for S3.

## Context for Downstream
- **Tester focus:** (1) the engine-attach soft-failure path (`try/catch` around
  `engine.attach` → `dispose` + `return undefined`) — exercise with a host whose
  `getCanvas()` returns a canvas with no 2d context; (2) the scrub-while-paused effect
  (hook 431-440) — verify it does NOT fight the clock when `phase==='playing'`;
  (3) callback-ref `hostVersion` bump re-runs attach on late host mount (no
  attach-before-bind race). All three are unit-reachable now (engine mockable).
- **S4 dev:** add `useRemoteMaterialPrefetch.ts` to checklist item 8 before deleting
  `isPlaybackV2Enabled`; otherwise the build breaks. The rest of the checklist is
  trustworthy.
- **Export 05:** z-ascending bottom→top grouping + embedded-audio detach tagging here
  mirror the semantics 05's filtergraph must reproduce (unchanged by S3).

## Verdict
**PASS WITH FIXES.** Code is correct, complete (no stubs/TODO/empty-catch; 243 + 443
lines, both ≤800), v1 byte-unchanged, RC-B/readiness/no-double-audio/real-overlay all
verified, contracts coherent for S4. type-check clean; 33 S3 tests + 426 area tests
green. The single fix is a documentation correction to the S4 checklist (add the
`useRemoteMaterialPrefetch.ts` isPlaybackV2Enabled consumer) — no S3 source change
required.
