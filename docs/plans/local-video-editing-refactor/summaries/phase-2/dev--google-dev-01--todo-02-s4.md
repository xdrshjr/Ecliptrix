# DEV Summary — TODO 02 Sub-stage S4 (G3: delete v1 + flag, sole compositor path, D10 split)

## Meta
- **Agent:** google-dev-01
- **Role:** DEV
- **Task:** todo-02-s4
- **Phase:** 2
- **Verdict:** COMPLETED

S4 scope = remove the playback-v1 inline `<video>` player + ALL playback-v2
feature-flag machinery + dead code, make the new multi-track compositor
(PreviewCanvas + useCompositionPlayback + MultiTrackPlaybackEngine) the SOLE
preview path, then split VideoPlayerPanel.tsx to ≤800 lines (D10). After S4
there is no v1 fallback.

Executed in two logically-distinct change groups so they review/commit
separately: **Phase A** = deletion + rewire (sole path + flag removal);
**Phase B** = mechanical D10 split (no behaviour change).

## Key Decisions

1. **The v1 inline `<video>` player was NOT actually flag-gated — it always ran;
   the flag only overlaid a canvas.** Reading the panel revealed the `<video>` +
   its ~1800 lines of orchestration (bootstrap, handlePlayPause composition
   branch, handleTimeUpdate, handleVideoEnded, handleCompositionSeek `<video>`
   manipulation, syncAudioPlayback + the inline HTMLAudio pool, assignSequenceSrc,
   captureFrameToCanvas, drag-seek, proxy hot-swap, seek-locks, useVideoCache,
   preloadUpcomingSequences, commitSeekThenPlay) ran on EVERY render and the
   `<video>` was merely hidden (`display:none`) when v2 was on. So "delete v1"
   meant deleting all of that AND re-wiring the imperative `VideoPlayerPanelRef`
   methods + the play button to drive the new compositor instead. The new
   `useCompositionPlayback` is fully PROP-DRIVEN (`isPlaying` → engine play/pause,
   `currentTime` → engine seek, `onTimeUpdate` → push to parent) and
   self-contained (owns its engine, decode `<video>`s, audio sync, rendering),
   so the imperative methods collapse to thin state setters that flip
   `isCompositionPlaying` + `compositionPreview.seek(t)` + notify the parent.
   VideoPlayerPanel.tsx was REWRITTEN (3412 → 985 lines) as a clean sole-path
   component preserving all surviving UI (controls, volume, aspect ratio, export,
   image overlays, cover modal, readiness gate) — then split in Phase B.

2. **`useVideoPlayback.ts` provides the `UseVideoPlaybackReturn` props the panel
   CONTROLS still consume (volume, formatTime, preview-mode play state), not just
   the v2-coupled mock simulator.** Deleting it wholesale would strand the
   parent. Resolution honoring the deletion intent: deleted `useVideoPlayback.ts`
   (the @deprecated v1 hook + its playback-v2-flag-gated mock interval) and
   created a lean replacement `usePreviewTransport.ts` that returns the same
   `UseVideoPlaybackReturn` shape WITHOUT the v2 flag / mock-simulator clock
   (composition time now comes from the engine). VideoEditingInterface swaps
   `useVideoPlayback` → `usePreviewTransport`; the spread `{...videoPlayback}`
   into the panel is unchanged.

3. **`useRemoteMaterialPrefetch`'s `phase3Enabled` only gated the v1
   `videoCache.preloadSequenceWindow` window prefetch** — and the sole production
   caller (`useMaterialManagement`) never passed `videoCache`/`playbackWindow`,
   so it was dead. Removed the `isPlaybackV2Enabled` import, the `phase3Enabled`
   memo, the `preloadSequenceWindow` effect, and the now-dead
   `videoCache`/`playbackWindow` options + the `VideoCacheAdapter` import. The
   preview-proxy TRIGGER (gated by the surviving `isPreviewProxyEnabled`) is
   untouched.

4. **`AudioSyncPool` `'embeddedVideoAudio'` group kind removed (S3-rework item 9).**
   The live path never emits it (`buildAudioSyncGroups` emits only independent
   `'audio'` groups; a video track's embedded audio plays from its own decode
   `<video>`, muted by the VideoSourcePool when detached/idle). Narrowed the union
   to `kind: 'audio'`, dropped the embedded-detach branch + `audioDetached` from
   `AudioSyncClip`, and updated the engine test to assert the detached decode
   element is muted while the paired independent audio track plays.

5. **`types.ts` + `AbBufferController` kept intact.** They are shared compositor
   infrastructure (CanvasCompositor / PlaybackClock / PlayheadController / the new
   MultiTrackPlaybackEngine all import compositor types from `types.ts`), NOT in
   the spec §2.7 deletion list. The now-orphaned legacy-engine-only type
   declarations (`IPlaybackEngine`, `PlaybackEngineAttachDeps`, `IKillSwitchMonitor`,
   `PlaybackTimelineFacade`, `PlaybackSequenceResolver`, `OverlayPayload`, …) are
   pure type-only exports — harmless, still referenced by surviving
   AbBufferController/CanvasCompositor tests — so removing them is out of scope
   and would break those tests. Left as-is.

## Execution Flow

### Phase A — deletion + rewire (sole path + flag removal) — DONE, GREEN GATE A passed
1. Read all 6 planning docs + S1/S2/S3 summaries + global-context + the full
   3412-line VideoPlayerPanel + playbackFlags + the prefetch/playback/audio
   modules; grepped the complete `isPlaybackV2Enabled` reference list.
2. Deleted dead modules + tests via `git rm -f`: PlaybackEngine.ts (+5 tests),
   killswitchMonitor.ts (+test), PlaybackVariantSwitcher.tsx, PreviewSurface.tsx
   (+v2 test), useVideoPlayback.ts, and the playbackFlags v2 tests + the v1/v2
   smoke/flag-branch/compositorMount panel tests.
3. Rewrote `playbackFlags.ts` → only the decoupled preview-proxy + local-preview
   flags remain (all v2 flag/killswitch/variant/remote-flag logic removed).
4. Updated the two surviving flag tests (localPreview, previewProxy) to drop the
   v2 imports/cases, keeping all preview-proxy/local-preview coverage.
5. Rewired `useRemoteMaterialPrefetch.ts` (decision 3) + its previewProxy test mock.
6. Removed the `'embeddedVideoAudio'` kind from `AudioSyncPool.ts` (decision 4)
   + updated AudioSyncPool.test.ts (3 cases) + MultiTrackPlaybackEngine.test.ts.
7. Rewrote `VideoPlayerPanel.tsx` as the sole-path component (decision 1);
   created `usePreviewTransport.ts` (decision 2); swapped the hook in
   VideoEditingInterface + hooks barrel; fixed the playback barrel exports.
8. type-check clean; full `npx vitest run src` (1192 tests) → 1190 pass / 2 fail
   (both pre-existing & unrelated: `backend-proxy.test.ts` query-string handling).
   Added `VideoPlayerPanel.solePath.test.tsx` (7) to pin the S4 invariants.
   lint clean on every changed source file.

### Phase B — D10 split (pure refactor) — DONE, GREEN GATE B passed
With v1 gone the panel was 985 lines (> 800). Extracted along clean seams,
preserving behavior exactly (no logic change):
- `aspectRatios.ts` — pure aspect-ratio config + `buildAspectRatios(labels)` +
  `aspectRatioToNumber(ratio)` (47 lines).
- `imageOverlays.ts` — pure `selectActiveImageOverlays(timeline, materials, t,
  onMissing?)` (the old `getCurrentImageOverlays` selection) (72 lines).
- `useCompositionTransport.ts` — the transport hook: the readiness gate
  (`computeMediaReadiness`, exported pure), all play/pause/seek control flow, and
  the imperative `VideoPlayerPanelRef` (`useImperativeHandle`) the parent drives
  (345 lines). The panel now passes the forwarded `ref` into the hook.
The panel shrank to **697 lines**; every touched file ≤800, every method ≤50.
Added unit tests for the three extracted pure pieces + updated the one
source-regex test (`VideoEditingInterface.timelineStoreMirror`) that pinned the
gate filter to the panel — it now points at `useCompositionTransport.ts`.
GREEN GATE B: type-check clean; full `npx vitest run src` → 1213 pass / 2 fail
(same pre-existing unrelated backend-proxy); `src/components/video` = 838 pass /
0 fail; lint clean on all changed source.

## Artifacts

### Deleted (source)
- `src/components/video/playback/PlaybackEngine.ts` (legacy single-sequence engine)
- `src/components/video/playback/internal/killswitchMonitor.ts`
- `src/components/video/playback/components/PlaybackVariantSwitcher.tsx` (+ the now-empty `components/` dir)
- `src/components/video/components/VideoPlayerPanel/PreviewSurface.tsx`
- `src/components/video/hooks/useVideoPlayback.ts`

### Modified (source)
- `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` — rewritten
  sole-path component (3412 → 697 lines); v1 `<video>` + all its orchestration
  removed; new compositor unconditional; transport delegated to the new hook.
- `src/lib/playbackFlags.ts` — all v2 flag/killswitch/variant/remote-flag logic
  removed; only `isPreviewProxyEnabled` / `isLocalPreviewEnabled` (+ keys) remain.
- `src/components/video/hooks/useRemoteMaterialPrefetch.ts` — removed the
  `isPlaybackV2Enabled` branch + dead `preloadSequenceWindow` effect + its options.
- `src/components/video/playback/AudioSyncPool.ts` — removed the dead
  `'embeddedVideoAudio'` group kind + the detach branch.
- `src/components/video/playback/index.ts` — dropped PlaybackEngine + KillSwitchMonitor exports.
- `src/components/video/hooks/index.ts` — `useVideoPlayback` → `usePreviewTransport`.
- `src/components/video/VideoEditingInterface.tsx` — `useVideoPlayback` → `usePreviewTransport`.

### Created (source)
- `src/components/video/hooks/usePreviewTransport.ts` — lean preview-mode state
  container replacing useVideoPlayback (no v2 flag, no mock simulator).
- `src/components/video/components/VideoPlayerPanel/aspectRatios.ts` (D10).
- `src/components/video/components/VideoPlayerPanel/imageOverlays.ts` (D10).
- `src/components/video/components/VideoPlayerPanel/useCompositionTransport.ts` (D10).

### Tests removed
- `playback/__tests__/PlaybackEngine.{,killswitch,smoke,handover,metrics}.test.ts` (~195 legacy-engine tests)
- `playback/__tests__/killswitchMonitor.test.ts`
- `VideoPlayerPanel/__tests__/PreviewSurface.v2.test.tsx`
- `VideoPlayerPanel/__tests__/VideoPlayerPanel.v2.smoke.test.tsx`
- `VideoPlayerPanel/__tests__/featureFlagBranch.test.tsx`
- `VideoPlayerPanel/__tests__/VideoPlayerPanel.compositorMount.test.tsx` (S3 coexistence)
- `VideoPlayerPanel/__tests__/{VideoPlayerPanel.reentry,playheadResume,VideoPlayerPanel.previewProxy,VideoPlayerPanel.localPreview}.test.tsx` (pinned deleted v1 internals)
- `lib/__tests__/playbackFlags.{killswitch,variantOverride,test}.ts`

### Tests updated / created
- Updated: `playbackFlags.{localPreview,previewProxy}.test.ts` (dropped v2 cases,
  kept all proxy/local-preview coverage); `useRemoteMaterialPrefetch.previewProxy.test.ts`
  (mock drops `isPlaybackV2Enabled`, removed the preloadSequenceWindow case);
  `AudioSyncPool.test.ts` + `MultiTrackPlaybackEngine.test.ts` (embedded-audio →
  decode-element-mute routing); `useCompositionPlayback.test.tsx` (kind assertion);
  `VideoEditingInterface.timelineStoreMirror.test.tsx` (gate moved to transport hook).
- Created: `VideoPlayerPanel.solePath.test.tsx` (S4 sole-path invariants + 800-line cap),
  `aspectRatios.test.ts`, `imageOverlays.test.ts`, `computeMediaReadiness.test.ts`.

## Interfaces Touched (Contract Verification)

- **PRODUCES — the sole-path mount.** `<PreviewCanvas ref={compositionPreview.hostRef}>`
  + `useCompositionPlayback({..., enabled: true})` mount unconditionally; the
  MultiTrackPlaybackEngine is the only preview engine. Verified by
  `VideoPlayerPanel.solePath.test.tsx`. Peer: useCompositionPlayback (S3, intact).
- **PRODUCES — `VideoPlayerPanelRef`.** The imperative handle
  (`handleCompositionSeek`/`seekAndPlayFromTimeline`/`pauseFromTimeline`/`isPlaying`/
  `handlePlayPauseFromTimeline`) is unchanged in shape — the parent
  (VideoEditingInterface spacebar + timeline-click) drives it identically. Now
  owned by `useCompositionTransport`; verified by the solePath test. Peer: VideoEditingInterface.
- **CONSUMES — `usePreviewTransport`** (new) supplies the `UseVideoPlaybackReturn`
  props the panel spreads (volume / formatTime / preview play state). Same shape
  as the deleted useVideoPlayback. Peer: VideoEditingInterface.
- **CONSUMES — preview-proxy / local-preview flags + proxyHitMeter survive.**
  `isPreviewProxyEnabled` / `isLocalPreviewEnabled` (kept in playbackFlags) feed
  the locked resolver options; `proxyHitMeter.ts` is untouched (referenced by
  selectPlaybackUrl). Verified by the surviving flag tests + grep.
- **ZERO `isPlaybackV2Enabled`** real references remain (only a `not.toMatch`
  guard in the solePath test + a docstring mention in types.ts). grep proof in report.

## Issues & Risks (esp. what ONLY the desktop walkthrough can now verify)

- **NO v1 fallback exists.** Every preview path now goes through the compositor;
  there is no flag to roll back. The real GPU compositing / N-concurrent-`<video>`
  decode / real seek+audio-sync / on-canvas image raster were already DESKTOP-only
  items in S2/S3 (jsdom drawImage is a spy, no real `seeked`). After S4 these are
  the ONLY way to validate preview end-to-end — there is no legacy player to diff
  against. The desktop walkthrough below is now load-bearing.
- **Transport semantics changed shape** (prop-driven seek vs the old imperative
  `<video>` seek-lock pipeline). The unit/source tests pin the wiring, but the
  felt behavior of spacebar-play / timeline-scrub / progress-bar-seek driving the
  canvas engine is a desktop check.
- **`types.ts` + `AbBufferController` kept** with now-orphaned legacy-engine type
  declarations (harmless type-only exports, still referenced by surviving
  compositor tests). Out of the spec §2.7 deletion scope; a future tidy-up could
  prune them once those tests migrate, but removing them now would break green.

## Desktop walkthrough the user MUST run (v1 is gone — no fallback)

1. Import a local MP4 → add to a video track → press ▶ (or Space): the preview
   paints from `/api/storage/files/...` (same-origin), NO black screen; DevTools
   Network shows NO ingest / preview-proxy / media-proxy / blob fetch for it.
2. Patch-after-insert: add a placeholder before its URL finalizes, then let the
   URL resolve → preview refreshes with NO manual reload.
3. Multi-track: two overlapping video tracks, upper `opacity<1` → lower shows
   through the composite.
4. Subtitle track renders over the video; an image overlay rasterises at its
   position AND its draggable React handle still drags + persists.
5. Audio: a NON-detached video track plays its OWN embedded audio (decode
   `<video>` unmuted); a DETACHED video track is silent and its paired audio
   track plays (no double audio); an idle track is silent; seek keeps A/V aligned.
6. Transport: play / pause / progress-bar seek / timeline-scrub (paused) / Space
   key (VideoEditingInterface global handler) all drive the canvas engine.
7. Readiness gate: while a remote material is still downloading, ▶ stays clickable
   but surfaces the "素材下载中 (N/M)" toast instead of playing; once ready it plays.
8. Export button still gates on a non-empty timeline; aspect-ratio switch + Cover
   modal still work.

## Context for Downstream

- **Phase 3 / 05 (export)** still shares the transition / z-order / opacity / audio-
  detach semantics via the S1 TransitionLayer + S2 assembleLayers + the
  AudioSyncPool independent-`'audio'`-only routing (a detached video track is
  muted at decode; its paired audio sequence carries sound — the filtergraph must
  mirror exactly this). Unchanged by S4.
- **Phase 3 / 06 (persistence + cache GC)** — the editor now mounts ONLY the
  compositor; there is no v1 audio pool / videoCache window prefetch to persist or
  GC around. The CLAUDE.md playback-v2 paragraph still describes the removed flag
  and must be synced (the orchestrator owns that per the task; I did NOT edit
  CLAUDE.md). The backend `/api/config/playback-flag` route is now unconsumed by
  the frontend; taking the backend endpoint down is a 06 / standalone-commit call.
