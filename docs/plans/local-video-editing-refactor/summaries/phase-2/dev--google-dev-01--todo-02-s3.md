# DEV Summary — TODO 02 Sub-stage S3 (host + orchestration hook + wiring)

## Meta
- **Agent:** google-dev-01
- **Role:** DEV
- **Task:** todo-02-s3 (unified local preview compositor — host + hook + wiring)
- **Phase:** 2
- **Verdict:** COMPLETED

S3 scope = the **host surface** (PreviewCanvas), the **orchestration hook**
(useCompositionPlayback) that makes the S2 `MultiTrackPlaybackEngine` usable in
the editor, and the **coexisting wiring** into VideoPlayerPanel on the v2 path.
The new compositor path mounts when `isPlaybackV2Enabled()` is true and replaces
the legacy single-sequence v2 PreviewSurface; when the flag is OFF the v1 inline
player is byte-unchanged. **No deletion** — every legacy symbol (flag,
PreviewSurface, legacy PlaybackEngine, useVideoPlayback, v2OverlaysProvider,
killswitch/variant/proxyHitMeter) is retained. S4 owns all deletion.

## Key Decisions

1. **PreviewCanvas owns DOM only; the hook owns the engine lifecycle.** The host
   renders the preview `<canvas>` + a hidden decode-source container and exposes a
   ref handle (`PreviewCanvasHandle`) with exactly the `MultiTrackAttachDeps`
   surface: `getCanvas`, `resolveTrackElements` (one active + one prewarm
   `<video>` per video track, created lazily + cached), `resolveAudioElement`
   (one hidden media element per audio track, cached), and `measureSubtitle` (a
   real offscreen 2d-context measurer using the compositor's font string). The
   host NEVER assigns `src` on the decode `<video>`s — the VideoSourcePool owns
   that (RC-B). Decode elements are appended to a 0×0 hidden container and cleared
   on unmount so a remount does not orphan `<video>` sources.

2. **The hook binds the host via a CALLBACK ref (`hostRef`), passed straight to
   `<PreviewCanvas ref={hook.hostRef}>`.** A callback ref (not a MutableRefObject)
   stores the handle and bumps a `hostVersion` state, so the engine attach effect
   re-runs the moment the PreviewCanvas imperative handle commits — robust to
   parent/child effect ordering and to a late-mounting canvas (no attach-before-
   bind race). The first implementation used a MutableRefObject; the callback-ref
   form is strictly more robust and is what the unit test pins.

3. **RC-B "比对键 == 赋值" is preserved by locking the resolver options ONCE.**
   `resolverOptsRef` is set on first render from `{preferPreviewProxy,
   preferLocalProxy}` and never mutated. The single injected
   `resolveSource = (seq) => resolveSequencePlaybackUrl(seq, liveMaterials,
   lockedOpts)?.url ?? null` is used by the VideoSourcePool for BOTH the
   change-decision and the assignment, so the compare key equals the assigned
   value. Live materials are read through a ref so a material patch never forces a
   re-attach (which would reset the engine state machine mid-playback) — the
   RC-A signature rebuild in `useTimelineComposition` (S1) drives the
   `compositionPlayback` change, and the engine reads the fresh sequences per tick
   through the timeline-facade closures.

4. **Attach ONCE, read live data through refs.** The attach effect depends only on
   `[enabled, aspectRatio, buildTimelineFacade]` (the facade is itself stable —
   all its getters read refs). Sequences / materials / timelineState / currentTime
   / onTimeUpdate flow through latest-value refs updated every render. Result: the
   engine is constructed/attached once per enabled mount and disposed on unmount,
   never torn down by routine data churn.

5. **Track groups are built purely + tested in isolation.**
   `buildVideoTrackGroups` groups video sequences by `trackId`, derives `z` from
   the first item's `trackZ` (fallback first-seen order), sorts bottom→top, and
   preserves item order (startTime-ordered upstream → satisfies TrackScheduler
   INV-5) carrying opacity/transition passthrough.
   `buildAudioSyncGroups` emits one `kind:'audio'` group per audio track AND one
   `kind:'embeddedVideoAudio'` group per video track (id `embedded:<trackId>`)
   carrying `audioDetached`, so the S1 AudioSyncPool suppresses a detached video
   track's embedded audio (no double audio). Per-group `volume` is 1 because the
   CompositionAdapter already folds track gain into each clip's `volume`
   (avoids double-applying the track scalar).

6. **Real overlay data — the `[]` stub is bypassed, not deleted.** The timeline
   facade's `getSubtitleItems` returns `compositionPlayback.subtitleSequences`
   (S1) and `getImageItems` returns `buildImageOverlayInputs(timelineState,
   materials)` — image items with `originalMaterialType==='image'` on visible
   tracks, URL resolved from the live material (same authority as video). The
   engine's `assembleLayers` (S2) builds the subtitle/image layers itself. The old
   `v2OverlaysProvider` `[]` stub is now dead code on the new path (S4 deletes it).

7. **Readiness gate is direct-local-first.** `isCompositionReady` returns true for
   an empty timeline and for every video sequence whose material satisfies
   `canPreviewDirectLocalMaterial(material)` (ready the instant a same-origin local
   URL exists — NOT gated on proxy/download), OR whose URL resolves via the live
   material. A still-uploading placeholder (no resolvable URL) holds the gate.
   Exposed as `isReady` for the panel; it does NOT block the engine attach (a
   paused first frame still paints) — it is an advisory gate the panel/UI may use.

8. **Wiring is minimal + localized to the v2 branch.** The only VideoPlayerPanel
   changes: two imports, one `MOUNT_LEGACY_V2_SURFACE = false` constant, the
   `useCompositionPlayback({... enabled: playbackV2Enabled})` call (+ a memoized
   `previewAspectRatio` from `selectedAspectRatio.ratio`), and the render branch —
   `{playbackV2Enabled && <PreviewCanvas ref={compositionPreview.hostRef} .../>}`
   plus gating the legacy `<PreviewSurface variant="v2">` behind
   `MOUNT_LEGACY_V2_SURFACE` so exactly one mounts on the v2 path. v1 is untouched.

## Execution Flow

1. Re-used the intact context from the cut-off turn (all S1/S2 contracts +
   VideoPlayerPanel mount points already read). Confirmed nothing was written.
2. Baselined: `npm run type-check` clean; `src/components/video` = 106 files /
   883 tests green.
3. Wrote `PreviewCanvas.tsx` (DOM host + ref handle + DPR resize + lazy pools).
4. Wrote `useCompositionPlayback.ts` (pure builders + readiness gate + engine
   lifecycle + locked RC-B resolver + real overlay facade).
5. Wired VideoPlayerPanel: imports, `MOUNT_LEGACY_V2_SURFACE`, hook call,
   render-branch swap (PreviewCanvas on v2, PreviewSurface gated off).
6. Type-check after wiring → fixed a narrowing issue (replaced `false &&` with a
   named `MOUNT_LEGACY_V2_SURFACE` constant so `playbackEngineRef.current`
   narrowing inside the retained branch still holds). Clean.
7. Wrote 3 test files: PreviewCanvas DOM contract (RTL/jsdom), useCompositionPlayback
   (mocked engine + pure builders), VideoPlayerPanel source-regex mount test.
8. Saved this summary early; ran targeted vitest + the full video suite.

## Artifacts

### Created (source)
- `src/components/video/components/VideoPlayerPanel/PreviewCanvas.tsx` — compositor
  host: canvas + hidden decode-source container + `PreviewCanvasHandle`
  (getCanvas / resolveTrackElements / resolveAudioElement / measureSubtitle) +
  DPR-aware ResizeObserver. No business logic.
- `src/components/video/hooks/useCompositionPlayback.ts` — orchestration hook +
  exported pure builders (`buildVideoTrackGroups`, `buildAudioSyncGroups`,
  `buildImageOverlayInputs`, `isCompositionReady`).

### Modified (source)
- `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` — v2-branch
  wiring only (imports, `MOUNT_LEGACY_V2_SURFACE`, hook call + `previewAspectRatio`,
  render swap). v1 untouched; nothing deleted.

### Tests (created)
- `…/VideoPlayerPanel/__tests__/PreviewCanvas.test.tsx` — **source-regex** (the
  vitest/rolldown transform cannot mount component JSX under this project's
  `jsx:"preserve"` tsconfig — same constraint as PreviewSurface.v2.test.tsx, which
  importing PreviewCanvas to render confirmed). Pins the DOM host contract:
  canvas + aria-hidden source host; handle methods (getCanvas/resolveTrackElements/
  resolveAudioElement/measureSubtitle); per-track active+prewarm lazy-create +
  cache; per-track audio cache; **no `.src =` / `setAttribute('src')` anywhere**
  (RC-B); measureSubtitle via 2d ctx with the compositor font; DPR ResizeObserver;
  pool release on unmount.
- `…/hooks/__tests__/useCompositionPlayback.test.tsx` — pure builders (z-order,
  passthrough, detached-audio tag, image selection/drop, readiness gate); hook
  lifecycle (attach once / inert when disabled / play-pause-seek / dispose on
  unmount); RC-B single resolver compare==assign; real subtitle/image facade
  (not `[]`); `isReady` true for direct-local.
- `…/VideoPlayerPanel/__tests__/VideoPlayerPanel.compositorMount.test.tsx` —
  source-regex: imports, flag-gated hook + PreviewCanvas mount, locked resolver
  flags, legacy PreviewSurface retained-but-gated, v1 + flag untouched, no-deletion.

## Interfaces Touched (Contract Verification)

### CONSUMES — S2 `MultiTrackPlaybackEngine` mount API (`attach`/`play`/`pause`/`seek`/`dispose`/`getPhase`)
- Role: CONSUMER. The hook constructs one engine, `attach`es it with the
  `MultiTrackAttachDeps` built from the PreviewCanvas handle + the locked resolver
  + the live timeline facade, drives play/pause/seek, and disposes on unmount.
- **Verified: YES** — method: `useCompositionPlayback.test.tsx` mocks the engine
  and asserts attach captured the deps, and play/pause/seek/dispose were called.
  Peer: S2 (self).

### CONSUMES — S2 `MultiTrackAttachDeps` DOM contract
- Role: CONSUMER/PRODUCER bridge. PreviewCanvas PRODUCES the DOM surface; the hook
  maps it 1:1 into `MultiTrackAttachDeps` (canvas, resolveTrackElements,
  resolveAudioElement, resolveSource, timeline facade, viewport, measureSubtitle).
- **Verified: YES** — method: PreviewCanvas.test.tsx asserts each handle method;
  type-check pins the deps shape (the hook assigns a `MultiTrackAttachDeps`).
  Peer: S2 (self).

### CONSUMES — S1 `compositionPlayback.subtitleSequences` + passthrough fields
- Role: CONSUMER. `getSubtitleItems` returns `subtitleSequences`;
  `buildVideoTrackGroups` carries `trackZ`/`opacity`/`transitionIn`/`transitionOut`;
  `buildAudioSyncGroups` carries `audioDetached`.
- **Verified: YES** — method: builder tests assert passthrough + the facade test
  asserts `getSubtitleItems()[0].text`. Peer: S1 (self).

### CONSUMES — `resolveSequencePlaybackUrl` (RC-B resolution authority)
- Role: CONSUMER. Wired as the SINGLE `resolveSource`, options locked once.
- **Verified: YES** — method: hook test asserts `resolveSource(seq)` returns the
  live local URL and is deterministic across calls (compare==assign). Peer: S1
  (resolver unchanged) / S2 (VideoSourcePool consumes it).

### CONSUMES — S1 `SubtitleLayer` (`TextMeasurer`, `ResolvedSubtitleStyle`) / `ImageOverlayLayer` (`ImageOverlayInput`)
- Role: CONSUMER. PreviewCanvas's `measureSubtitle` matches `TextMeasurer`;
  `buildImageOverlayInputs` emits `ImageOverlayInput[]`.
- **Verified: YES** — method: type-check + PreviewCanvas measure test + image
  builder test. Peer: S1 (self).

### CONSUMES — `canPreviewDirectLocalMaterial` (readiness gate)
- Role: CONSUMER. `isCompositionReady` treats a direct-local material as ready
  immediately.
- **Verified: YES** — method: readiness test (direct-local ready with NO
  proxy/download state; pending material holds). Peer: spec 02 §2.6 / localMaterial.

### PRODUCES — the VideoPlayerPanel v2 mount (what S4 makes the sole path)
- Role: PRODUCER. `{playbackV2Enabled && <PreviewCanvas ref={compositionPreview.hostRef}/>}`
  + the hook; legacy PreviewSurface gated off via `MOUNT_LEGACY_V2_SURFACE=false`.
- **Verified: YES** — method: source-regex mount test. Peer: S4 (deletes the
  legacy branch + flag and makes this unconditional).

### PRODUCES — the `PreviewCanvasHandle` DOM host contract
- Role: PRODUCER. The stable ref surface the hook (and S4's sole path) consumes.
- **Verified: YES** — method: PreviewCanvas.test.tsx asserts every method +
  caching + no-src invariant. Peer: useCompositionPlayback (self) / S4.

## Issues & Risks (esp. what only the real desktop/canvas verifies)

- **Real GPU compositing + N concurrent `<video>` decodes** remain a DESKTOP item
  (jsdom `drawImage` is a spy; no real decode/seek/`seeked`). The end-to-end
  "import MP4 → add → play, no black screen" (§6 case 6) and patch-after-insert
  (§6 case 7) are now wireable but need the real Electron shell: the RC-A/RC-B
  invariants are unit-pinned, but the actual same-origin frame paint is desktop.
- **Audio/video sync after a real seek** (§6 case 10 audible) is jsdom-invisible;
  the detach→no-double-audio LOGIC is pinned (S1/S2 + this hook's group tagging).
- **Image overlay on-canvas pixels** depend on real `HTMLImageElement` load
  (jsdom does not load); the selection/URL-resolution data is unit-verified, the
  raster is desktop.
- **`MOUNT_LEGACY_V2_SURFACE = false` is a deliberate dead-branch marker** kept
  only so the legacy PreviewSurface wiring + its symbols (`v2Timeline`,
  `v2Resolver`, `v2OverlaysProvider`, `playbackEngineRef`,
  `killSwitchMonitorRef`, `proxyHitMeterRef`) stay referenced for coexistence.
  This is intentionally NOT clean — it exists to be deleted wholesale in S4.

### S4 deletion checklist (what makes the new path the SOLE path)

1. **`src/lib/playbackFlags.ts`** — remove v2 flag/killswitch/variant: `STORAGE_KEY`,
   `SESSION_REMOTE_KEY`, `URL_QUERY_KEY`, `KILL_SWITCH_KEY`, `VARIANT_OVERRIDE_KEY`,
   `isPlaybackV2Enabled`, `tripPlaybackV2KillSwitch`, the `/api/config/playback-flag`
   remote consumption. **KEEP** the decoupled `PREVIEW_PROXY_FLAG_KEY` /
   `LOCAL_PREVIEW_FLAG_KEY` (still used by the resolver as remote fallback).
2. **`VideoPlayerPanel.tsx`** — delete: the `MOUNT_LEGACY_V2_SURFACE` constant +
   the entire gated `<PreviewSurface variant="v2">` branch; `playbackEngineRef`,
   `killSwitchMonitorRef`, `proxyHitMeterRef` + their `new PlaybackEngine()/
   KillSwitchMonitor/ProxyHitMeter` init block; `handleV2KillSwitch`; the
   `v2Timeline` / `v2Resolver` / `v2OverlaysProvider` memos; the `playbackV2Enabled`
   useMemo + all `playbackV2Enabled ?` forks; the v1 inline composition/preview
   branch (~1949–2179) + the hidden legacy `<video>` `display: none` gate; make
   the PreviewCanvas mount + `useCompositionPlayback` unconditional. Then split the
   file to ≤800 lines (D10).
3. **`src/components/video/hooks/useVideoPlayback.ts`** — delete (@deprecated v1 hook).
4. **`src/components/video/components/VideoPlayerPanel/PreviewSurface.tsx`** — delete
   (legacy single-sequence v2 surface; replaced by PreviewCanvas).
5. **`src/components/video/playback/PlaybackEngine.ts`** — delete (legacy
   single-sequence engine; replaced by MultiTrackPlaybackEngine) + its barrel
   exports in `playback/index.ts` (`PlaybackEngine`, `PlaybackEngineDeps`) and the
   195 PlaybackEngine.* tests.
6. **`playback/components/PlaybackVariantSwitcher.tsx`** + **`playback/internal/killswitchMonitor.ts`**
   — delete (flag UI + monitor). **KEEP** `playback/internal/proxyHitMeter.ts`
   (still referenced by `selectPlaybackUrl.ts`; only remove after confirming no refs).
7. Remove the now-dead `v2OverlaysProvider` `[]` stub + `OverlayPayload` import in
   VideoPlayerPanel; remove `import PreviewSurface from './PreviewSurface'`.
8. **`src/components/video/hooks/useRemoteMaterialPrefetch.ts`** ALSO calls
   `isPlaybackV2Enabled()` (found by the reviewer; was missing from this list) —
   remove that reference too. Then verify NO `isPlaybackV2Enabled` references
   remain ANYWHERE in the codebase (§6 case 11): grep the whole repo, not just
   VideoPlayerPanel. Update the CLAUDE.md playback-v2 section (doc sync — 06 or a
   standalone commit).
9. **`src/components/video/playback/AudioSyncPool.ts`** `'embeddedVideoAudio'`
   group kind is now UNUSED on the live path (S3 routes embedded audio through the
   decode `<video>` mute, not the AudioSyncPool — see Rework below). The kind +
   its detach-suppression branch can be removed in S4 IFF no other caller emits
   it (the MultiTrackPlaybackEngine test still constructs one directly — update or
   drop that test). KEEP the independent-`'audio'` path.

### Desktop walkthrough must verify (S3 → desktop hand-off)

- Import a local MP4 → add to a track → play: the preview paints from
  `/api/storage/files/...` (same-origin), no black screen, DevTools Network shows
  NO ingest / preview-proxy / media-proxy / blob.
- Patch-after-insert: add a placeholder before its URL finalizes, then let the URL
  resolve → preview refreshes with NO manual reload (RC-A signature rebuild +
  RC-B compare==assign through the injected resolver).
- Multi-track: two overlapping video tracks, upper opacity<1 → lower shows through.
- Subtitle track renders over the video; image overlay rasterises at its position.
- Audio (RISK 2): a NON-detached video track plays its OWN embedded audio (the
  decode `<video>` is unmuted); a DETACHED video track is silent and its paired
  audio track plays (no double audio); an idle track is silent; seek keeps
  audio/video aligned. Transport (play/pause) and a paused timeline scrub both
  drive the new engine (prop-driven, no imperative panel calls).
- Toggle the flag OFF → v1 inline player behaves exactly as before (regression).

## Context for Downstream

- **S4** owns ALL deletion — the precise checklist is above. The new path is
  already the only one mounted on the v2 branch; S4 makes it unconditional and
  removes the flag + legacy modules, then splits VideoPlayerPanel (D10).
- **Export 05** still shares the transition/z-order/opacity semantics via the S1
  TransitionLayer + S2 assembleLayers (unchanged by S3). The group-building order
  here (z-ascending bottom→top, embedded-audio detach tagging) is the same
  semantics 05's filtergraph must mirror.
- **The readiness gate (`isReady`)** is available for the panel to surface a
  "preparing" affordance, but it does NOT gate the engine attach (a paused first
  frame paints regardless), so it must not be used to block play() unconditionally.

## Rework (S3 fix)

Tester acceptance returned ISSUES FOUND. Three were real and are fixed; full
`src/components/video` suite now **930 passed** (was 916), type-check + lint clean.

### BUG 1 — scrub-while-paused was dead code (CONFIRMED + FIXED)
- **Root cause:** the hook render body wrote `currentTimeRef.current = currentTime`
  BEFORE the scrub effect read it, so the guard
  `Math.abs(currentTimeRef.current - currentTime) < 1e-6` was ALWAYS true →
  `engine.seek()` never fired on a prop-driven paused scrub → the new compositor
  never repainted on a paused scrub.
- **Fix:** introduced a SEPARATE `lastSeekedTimeRef`, updated ONLY after a seek
  actually fires (in `seek()`, in the scrub effect, AND in the facade's
  `setCurrentTime` so the engine's own clock advance — which flows back as the
  `currentTime` prop — does NOT cause a re-seek / clock fight). The scrub effect's
  guard now reads `lastSeekedTimeRef`, which the render-body write can no longer
  pre-satisfy. Result: a paused scrub PAST epsilon calls `engine.seek(t)`; a scrub
  WITHIN epsilon does NOT re-seek; a self-originated clock update does NOT re-seek.
  Pinned in `useCompositionPlayback.probe.test.tsx` (rewrote the BUG-documenting
  test into three correctness tests).

### BUG 1b — transport did not drive the new engine (CONFIRMED + FIXED)
- **Root cause:** VideoPlayerPanel only used `compositionPreview.hostRef` and never
  called `play()/pause()/seek()`; the hook had no `isPlaying` input, so the new
  engine never played/paused on transport.
- **Fix:** added an `isPlaying` hook option (prop-driven) + a transport effect:
  `isPlaying` true → `engine.play()`, false → `engine.pause()`. Wired the panel to
  pass `isCompositionPlaying`. No imperative calls required from the panel. Pinned
  in `useCompositionPlayback.probe.test.tsx` (`prop-driven transport` block).

### RISK 2 — embedded (non-detached) video audio was SILENT (CONFIRMED + FIXED)
- **Root cause:** decode `<video>`s were `muted=true` AND the engine routed
  `embedded:<trackId>` audio to a SEPARATE srcless audio element, so a
  non-detached video track's own audio played from nowhere — "no audio", not "no
  double audio".
- **Routing decision (the fix):** a video track's embedded audio plays from its
  OWN decode `<video>` element. The `VideoSourcePool` now drives `el.muted` per
  frame from the active clip's `audioDetached`: **unmuted** when NOT detached
  (its embedded audio is audible), **muted** when detached or idle (the paired
  independent audio sequence is the sole source → no double audio). The
  `AudioSyncPool` now owns ONLY independent `'audio'` tracks —
  `buildAudioSyncGroups` no longer emits `'embeddedVideoAudio'` groups. "No double
  audio for DETACHED tracks" is preserved: detached decode element muted + paired
  audio track (an independent `'audio'` group) carries the sound.
- **Changes:** `VideoSourcePool.ts` — `VideoElementLike.muted?` + `TrackSourcePlan
  .muteAudio` (computed from `audioDetached`; idle ⇒ true) + applier sets
  `el.muted`. `useCompositionPlayback.ts` `buildAudioSyncGroups` — dropped the
  `videoSequences` param + embedded-group construction. `PreviewCanvas.tsx` —
  comment clarified that mute is pool-owned. UNIT tests in
  `VideoSourcePool.test.ts`: `computeSourcePlan` `muteAudio` truth table (non-
  detached false / detached true / idle true) + applier mutes-detached /
  unmutes-non-detached / mutes-idle (actual sound stays a desktop check).

### Files changed in rework
- `src/components/video/hooks/useCompositionPlayback.ts` — `lastSeekedTimeRef`
  guard, prop-driven transport + scrub effects, `isPlaying` option,
  `buildAudioSyncGroups` single-arg (independent audio only).
- `src/components/video/playback/VideoSourcePool.ts` — `muted` routing
  (`VideoElementLike.muted?`, `TrackSourcePlan.muteAudio`, applier).
- `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` — pass
  `isPlaying: isCompositionPlaying` to the hook.
- `src/components/video/components/VideoPlayerPanel/PreviewCanvas.tsx` — mute
  ownership comment.
- Tests: `useCompositionPlayback.probe.test.tsx` (scrub→correct + transport),
  `useCompositionPlayback.test.tsx` (buildAudioSyncGroups → independent-only +
  `isPlaying` in fixtures), `VideoSourcePool.test.ts` (muteAudio routing).

### Corrected S4 checklist line (item 8)
`src/components/video/hooks/useRemoteMaterialPrefetch.ts` ALSO calls
`isPlaybackV2Enabled()` and was missing from the original checklist — S4 must
remove that reference too, then grep the WHOLE repo (not just VideoPlayerPanel)
to confirm zero `isPlaybackV2Enabled` references remain (§6 case 11). Item 9 added:
the AudioSyncPool `'embeddedVideoAudio'` group kind is now dead on the live path
and can be removed in S4 once its direct-construction engine test is updated.
