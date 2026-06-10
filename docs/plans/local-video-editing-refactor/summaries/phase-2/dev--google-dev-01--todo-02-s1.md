# DEV Summary — TODO 02 Sub-stage S1 (jsdom-testable data/wiring layers)

## Meta
- **Agent:** google-dev-01
- **Role:** DEV
- **Task:** todo-02-s1 (unified local preview compositor — data/wiring layers)
- **Phase:** 2
- **Verdict:** COMPLETED

S1 scope = the jsdom-testable leaf data layers + symptom-① regressions. The
compositor core (S2), host/hook (S3), and delete-v1 (S4) are explicitly NOT in
this sub-stage and were left untouched (read-only awareness only).

## Key Decisions

1. **ImageOverlayLayer is a pure DATA layer producing the existing
   `CompositorLayer` `image` shape.** I inspected the real timeline
   representation first: `VideoPlayerPanel.getCurrentImageOverlays` selects items
   with `originalMaterialType === 'image'` active at `t ∈ [start, start+dur)`,
   each carrying `imagePosition` (`ImagePosition`: x/y/width/height/zIndex,
   normalized [0,1] against the video fit-rect), `opacity`, and a live-material
   URL. The new layer reproduces that selection (half-open + `TIME_EPSILON`) and
   emits `{kind:'image', id, src, bounds:{x,y,w,h}, opacity, z}` — the exact
   variant `CanvasCompositor._drawOverlays` already draws. `imagePosition` is
   ALREADY fit-rect-relative, so bounds are a projection into an optional sub
   fit-rect (identity for the full canvas) + clamp so a dragged overlay can't go
   out of range. NO new shape was invented.

2. **AudioSyncPool splits a PURE planner from a thin DOM applier.**
   `computeAudioSyncActions(groups, t, opts)` returns one
   `{trackId, action:'seek'|'play'|'pause'|'hold', targetSourceTime?, volume?}`
   per track and is fully testable with no audio elements. The `AudioSyncPool`
   class only reads `currentTime`/`paused` off injected `AudioElementLike`
   objects and writes back — minimal DOM surface, out of the tested path.

3. **Audio source time goes through spec 01 `mapTimelineTimeToSourceTime`,
   NOT the v1 ratio math.** v1 computed `clipStart + relativeTime *
   (clipDuration/duration)` (a playbackRate-scaling path). Under spec 01
   playbackRate=1 + INV-3 (`duration === clipEnd-clipStart`) this is identical,
   but the hard constraint says all clip math flows through the contract, so I
   reused `activeClipAt` (TrackScheduler) + `mapTimelineTimeToSourceTime`.

4. **Drift threshold reused from v1 as a named constant.** v1's
   `syncAudioPlayback` hard-seeks only when `drift > 0.5`. I lifted `0.5s` into
   `internal/constants.ts` as `AUDIO_DRIFT_EPSILON_SEC`, documenting that it is a
   DIFFERENT concept from spec 01 `TIME_EPSILON` (perceptible audio drift vs.
   sub-frame clip-edge snapping). No bare magic number.

5. **audioDetached → no double audio modelled via a group `kind` tag.** The
   pure planner accepts groups tagged `'audio'` (independent track, always a
   play candidate) or `'embeddedVideoAudio'` (a video track's own audio). An
   embedded-video-audio group whose active clip has `audioDetached===true` is
   forced to `'pause'`, so when a caller passes both the detached video track and
   its paired audio track on one clock, exactly one source plays.

6. **`subtitleSequences` is now genuinely EXTRACTED, not `[]`.** The prior
   session made `CompositionPlayback.subtitleSequences` REQUIRED but never wired
   it — `npm run type-check` was RED on the missing field in
   `useTimelineComposition`'s initial state. I added
   `CompositionAdapter.extractSubtitleSequences(tracks)` (+ `ICompositionPort` +
   ports `SubtitleSequenceItem`) and wired it through the hook. Filter: visible
   subtitle tracks, subtitle items with non-blank text; sorted by startTime.

7. **Signature strengthened to fold ALL live-resolved + passthrough + subtitle
   fields.** `sequencePlaybackSignature` now folds `url`/`cacheUrl`/`volume` and
   the compositor passthrough fields (`audioDetached`/`opacity`/`trackZ`/
   `transitionIn`/`transitionOut`) on top of the existing
   `materialPlaybackFields` (url/cacheUrl/serverUrl/metadata.localResolvedUrl/
   proxy/localProxy). `computeCompositionSignature` now also folds a subtitle
   part, so a subtitle add / text-change / style-change triggers rebuild.
   `currentSequenceIndex` preservation logic is untouched.

8. **resolveSequencePlaybackUrl needed NO code change.** Verified first: empty
   `seq.url` + a live direct-local material (`/api/storage/files/video/x.mp4`)
   already resolves to that local URL with `source==='localStorageUrl'`, NOT
   gated on proxy/download readiness (the `localStorageReference` chain catches
   `isLocalMediaReference(material.url)`). I added a regression test pinning the
   "no proxy/download state" case (spec 02 §6 case 1) instead of touching code.

## Execution Flow

1. Read all 6 planning docs + global-context + phase-1 dev-01 summary.
2. Inspected the CURRENT state of the leaf layers I own (TrackScheduler /
   TransitionLayer / SubtitleLayer + types) — confirmed 51 baseline tests green;
   did not rebuild them.
3. Inspected real image-overlay data shape (`getCurrentImageOverlays`,
   `ImageOverlay.tsx`, `ImagePosition`) and v1 audio sync (`syncAudioPlayback`,
   `audioElementsRef`, `drift > 0.5`).
4. Baselined `npm run type-check` → found the single pre-existing error (missing
   `subtitleSequences` wiring) — confirming the S1 subtitle task.
5. Built `AUDIO_DRIFT_EPSILON_SEC`, `ImageOverlayLayer.ts`, `AudioSyncPool.ts`.
6. Wired subtitle extraction: ports type + `ICompositionPort` method +
   `CompositionAdapter.extractSubtitleSequences` + hook (`getSubtitleSequences…`,
   initial state, rebuild, signature).
7. Wrote/strengthened tests; ran targeted vitest (95) + full video suite (806) +
   `npm run type-check` (clean) + `next lint` (no new findings).

## Artifacts

### Created (source)
- `src/components/video/playback/ImageOverlayLayer.ts` (195 lines)
- `src/components/video/playback/AudioSyncPool.ts` (248 lines)

### Modified (source)
- `src/components/video/playback/internal/constants.ts` — `AUDIO_DRIFT_EPSILON_SEC = 0.5`.
- `src/components/video/timeline/domain/ports.ts` — `SubtitleSequenceItem` +
  `ICompositionPort.extractSubtitleSequences`.
- `src/components/video/timeline/infrastructure/CompositionAdapter.ts` —
  `extractSubtitleSequences(tracks)` (additive; video/audio extraction unchanged).
- `src/components/video/hooks/useTimelineComposition.ts` — subtitle extractor +
  initial-state `subtitleSequences: []` + rebuild wiring + signature now folds
  url/cacheUrl/volume/passthrough/subtitles.

### Tests (created)
- `src/components/video/playback/__tests__/ImageOverlayLayer.test.ts` (16)
- `src/components/video/playback/__tests__/AudioSyncPool.test.ts` (19)
- `src/components/video/timeline/infrastructure/__tests__/CompositionAdapter.subtitles.test.ts` (5)

### Tests (strengthened)
- `…/hooks/__tests__/useTimelineComposition.localPreview.test.ts` — +2 subtitle
  cases (extraction; blank-skip + text-change rebuild).
- `…/lib/__tests__/resolveSequencePlaybackUrl.test.ts` — +1 (rc1) case:
  direct-local + NO proxy/download state still resolves to localStorageUrl.

## Interfaces Touched

### CONSUMED — spec-01 ClipTimeMapping (THE shared clip contract)
- `mapTimelineTimeToSourceTime(clip, t)` — used by `AudioSyncPool` for audio
  source time; `activeClipAt` (TrackScheduler, already on this contract) used for
  active-clip selection. `TIME_EPSILON` used by `ImageOverlayLayer` selection.
- **Contract verified: YES** (targeted tests assert mapped source times to 6
  decimals; epsilon boundaries asserted).

### PRODUCED for S2/S3 — compositor image-layer data
- `buildImageLayersAt(items, t, fit?) → CompositorLayer['image'][]` with
  `bounds:{x,y,w,h}` + `opacity` + `z`. S2 `CanvasCompositor._drawOverlays`
  consumes the `image` branch; the shape matches the existing `CompositorLayer`
  union exactly.

### PRODUCED for S3 — audio sync action plan
- `computeAudioSyncActions(groups, t, opts) → AudioSyncAction[]` and
  `AudioSyncPool(resolveElement).tick(groups, t, isPlaying)`. S3 supplies the
  `AudioElementResolver` (HTMLAudio pool) and groups built from audio sequences +
  detached-video-audio tracks.

### PRODUCED for S2/S3 — subtitleSequences flow
- `CompositionAdapter.extractSubtitleSequences` → `compositionPlayback
  .subtitleSequences: SubtitleSequenceItem[]`. S3 feeds these to `SubtitleLayer
  .activeAt(t)` + `.layout(...)`; folded into the RC-A rebuild signature.

## Issues & Risks

- **Pre-existing exhaustive-deps warning** at `useTimelineComposition.ts:163`
  (the mount-once init effect `[]`) is unchanged from before my edits — a
  warning, not an error, and not introduced by S1.
- **The clean-code 80-col guideline** is NOT lint-enforced (no `max-len` rule);
  a few signature-helper lines and test assertion strings exceed 80 cols, in
  line with the surrounding codebase. All files are far under the 800-line file
  cap and 50-line method cap.
- **`fit` projection in `computeImageBounds`** defaults to the full canvas
  (identity) because the real timeline `imagePosition` is already fit-rect
  normalized. S2 may pass a letterbox sub-rect; the projection + clamp are
  tested for both.
- **No v1/flag/killswitch/proxyHitMeter code was touched** (that is S4). The v1
  `syncAudioPlayback` and `getCurrentImageOverlays` still exist and are the
  reference behaviour the new pure layers reproduce; S3/S4 replace the call
  sites.

## Context for Downstream (S2 / S3 MUST know)

- **Image data shape (S2 draw):** active selection is half-open
  `[start, start+dur)` with `TIME_EPSILON`; bounds are normalized [0,1] against
  the fit-rect (NOT pixels); `z` defaults to `position.zIndex` then input order;
  empty `src` / zero-area items are dropped. Hand the resolved live-material URL
  in as `src` (same authority as video — do NOT read it inside the layer).
- **Audio plan (S3 apply):** build one `AudioSyncGroup` per audio sequence
  track (`kind:'audio'`) AND, if you want the video track's embedded audio to
  play, a `kind:'embeddedVideoAudio'` group whose item carries `audioDetached`.
  The planner already enforces "detached → pause, paired audio track plays" so
  there is never double audio. Volume = `clip.volume * track.volume` clamped
  [0,1]; pass `track.volume` already normalized (the adapter produces 0..2).
  Hard-seek only fires beyond `AUDIO_DRIFT_EPSILON_SEC` (0.5s).
- **subtitleSequences:** now populated on `compositionPlayback` whenever the
  timeline has visible subtitle items with text. `SubtitleLayer.activeAt(t)` +
  `.layout(text, style, maxWidthPx, measure)` consume them; the style is the
  timeline `SubtitleStyle` (fontFamily/fontColor/backgroundColor/position) which
  `resolveSubtitleStyle` already normalizes.
- **Signature (RC-A):** any change to a sequence's url/cacheUrl/clip/timing/
  volume, the live material's playback fields, the compositor passthrough fields,
  OR the subtitle text/style now triggers a composition rebuild while preserving
  `currentSequenceIndex`. S3 can rely on patch-after-insert refreshing without a
  manual reload.

## Verification
- `npm run type-check` → CLEAN (the prior single error — missing
  `subtitleSequences` wiring — is now resolved).
- Targeted vitest (9 files): **95 passed**.
- Full `src/components/video` suite: **99 files / 806 tests passed**, no
  regressions.
- `next lint` on changed source: no new findings (one pre-existing deps warning).
