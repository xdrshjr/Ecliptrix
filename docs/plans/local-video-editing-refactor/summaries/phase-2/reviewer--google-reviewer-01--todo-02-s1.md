# REVIEWER Summary — TODO 02 Sub-stage S1 (jsdom-testable data/wiring layers)

## Meta
- **Agent:** google-reviewer-01
- **Role:** REVIEWER
- **Task:** todo-02-s1
- **Phase:** 2
- **Verdict:** PASS

## Key Decisions

1. **PASS with zero edits.** The five leaf data layers, the audio planner, the
   subtitle extraction wiring, the signature strengthening, and all 8 test files
   are production-ready. I changed nothing.
2. **ClipTimeMapping reuse is genuine, not hand-rolled.** `TrackScheduler`,
   `AudioSyncPool`, and `ImageOverlayLayer` all import
   `mapTimelineTimeToSourceTime` / `TIME_EPSILON` from spec-01
   `ClipTimeMapping.ts`. No cumulative-offset / ratio math (`clipStart +
   relativeTime * (clipDuration/duration)`) was reintroduced. Project invariant
   #1 upheld.
3. **audioDetached double-audio prevention is correctly modelled in the pure
   planner.** `computeAudioSyncActions` forces `'pause'` for an
   `embeddedVideoAudio` group whose active clip has `audioDetached === true`,
   while the paired independent `'audio'` group plays — verified by two tests
   (pure + fake-element). Muted/gap/not-playing all → pause.
4. **症状① signature folding is complete.** `sequencePlaybackSignature` folds
   `url/cacheUrl/volume` + passthrough (`audioDetached/opacity/trackZ/
   transitionIn/transitionOut`) on top of the live `materialPlaybackFields`
   (url/cacheUrl/serverUrl/metadata.localResolvedUrl/proxy/localProxy);
   `computeCompositionSignature` adds a subtitle part. `currentSequenceIndex`
   preservation logic is untouched. `opacity ?? ''` (not `||`) correctly
   preserves an explicit `opacity:0`.
5. **resolveSequencePlaybackUrl needed no change.** Independently traced the
   chain: `canPreviewDirectLocalMaterial` true (via `metadata.isLocalFile` +
   `localResolvedUrl`) bypasses both proxy tiers (`!directLocal` guards) and
   `localStorageReference` picks `metadata.localResolvedUrl`. §6 case 1 holds;
   the added regression test pins it.

## Execution Flow

1. Read dev summary + global-context + master-plan + task-orchestration +
   spec-01 (ClipTimeMapping) + spec-02 (§2.3/2.4/2.5/2.6/§6) + todo-02.
2. Read all S1 source (5 new layers + 4 modified) and all 8 test files.
3. Cross-checked produced shapes against `types.ts` `CompositorLayer['image']`,
   `SequenceTransition`, `VideoTrackGroup`/`AudioTrackGroup`, and
   `videoEditingTypes`/`ports` `SubtitleSequenceItem`.
4. Verified v1 parity for ImageOverlayLayer (default position `{0.1,0.1,0.3,
   0.3,z10}` and half-open `[start,start+dur)` selection both match
   `VideoPlayerPanel.getCurrentImageOverlays`).
5. Confirmed Track entity keeps items sorted by startTime (INV-5) → scheduler's
   sorted-input early-return is safe.
6. Ran `npm run type-check` (clean) and `npx vitest run` on all 8 S1 files
   (91/91 passed) to validate — independent of any tester output.
7. Grepped git status + scope: only `constants.ts` + `types.ts` modified under
   `playback/`; no v1 / flag / killswitch / switcher / proxyHitMeter touched.

## Artifacts (files fixed)

None — PASS with no edits.

## Issues & Risks

- **No bugs found. No integration incompatibilities found.**
- **(observation, non-blocking) Trailing-edge convention differs across the
  three selectors — intentional & documented:** `activeClipAt` (last-clip
  inclusive `<= end+eps`), `activeImageItemsAt` (strict half-open `< end-eps`),
  `activeSubtitlesAt` (closed `<= end+eps`). Each matches its layer's intent
  (clip handoff vs. no overlay frame-leak vs. subtitle visible through end) and
  v1 image parity. Audio at the exact end of the LAST clip stays `play` for one
  frame instead of `pause`; cosmetically negligible and self-heals at
  composition end. Tester may spot-check audio behavior at composition end.
- **(downstream note, in-scope-deferred) Adapter forwards only `audioDetached`;
  `opacity`/`trackZ`/`transitionIn`/`transitionOut` are typed + signature-folded
  but not yet populated by `CompositionAdapter.extractVideoSequences`.** Today a
  no-op: `item.opacity` is always default `1.0` (no UI produces ≠1; transitions
  have no producer yet). The signature is forward-compatible. Populating these
  belongs with S2 (compositor consumption). Not an S1 defect.
- **(style, pre-existing) Some lines exceed the 80-col cleancode guideline** —
  not lint-enforced, consistent with surrounding code; all files ≤248 lines and
  all methods ≤~36 lines.

## Contract Verification (per-interface evidence)

- **CONSUMED — spec-01 ClipTimeMapping:** `TrackScheduler.activeClipAt` line 72
  calls `mapTimelineTimeToSourceTime(clip, t)`; `AudioSyncPool` line 140 calls it
  for `targetSourceTime`; `ImageOverlayLayer`/`SubtitleLayer`/`TransitionLayer`
  use `TIME_EPSILON` for edge math. No hand-rolled time math anywhere.
  **VERIFIED — test `TrackScheduler.test.ts` asserts source times to 6 decimals
  (e.g. t=13 on clip start=10 clipStart=2 → 5).**
- **PRODUCED for S2 — `CompositorLayer['image']`:** `buildImageLayersAt` returns
  `Extract<CompositorLayer,{kind:'image'}>[]` = `{kind:'image', id, src,
  bounds:{x,y,w,h}, opacity, z}`. Byte-matches the `image` variant in
  `playback/types.ts` (lines 149-157). Empty `src` / zero-area dropped; `z` from
  `position.zIndex` else input index. **VERIFIED — `ImageOverlayLayer.test.ts`.**
- **PRODUCED for S3 — audio plan:** `computeAudioSyncActions(groups,t,opts) →
  AudioSyncAction[]` and `AudioSyncPool.tick(...)`. `AudioSyncGroup` (with `kind`
  discriminator + `AudioSyncClip.audioDetached`) is the sync-pool input; it is
  intentionally distinct from `types.ts` `AudioTrackGroup` (timeline-extraction
  shape) — S3 bridges them, as the dev summary documents. Volume =
  `clip.volume * track.volume` clamped [0,1] via `computeEffectiveVolume`.
  **VERIFIED — `AudioSyncPool.test.ts` (19 cases incl. two-track no-double-audio
  on one clock).**
- **PRODUCED for S2/S3 — subtitleSequences flow:**
  `CompositionAdapter.extractSubtitleSequences(tracks)` (visible subtitle
  tracks, non-blank text, sorted) → `ICompositionPort` →
  `useTimelineComposition` initial state + rebuild + folded into signature →
  `compositionPlayback.subtitleSequences: SubtitleSequenceItem[]`. The two
  `SubtitleSequenceItem` declarations (`ports.ts`, `videoEditingTypes.ts`) are
  structurally identical; `SubtitleLayer.activeAt/.layout` consume the
  `videoEditingTypes` shape end-to-end. **VERIFIED —
  `CompositionAdapter.subtitles.test.ts` (5) + `useTimelineComposition.localPreview.test.ts`
  subtitle extraction + blank-skip + text-change-rebuild cases.**
- **Scope contract:** `git status` confirms modified-under-playback = only
  `constants.ts`, `types.ts`; no `useVideoPlayback` / `playbackFlags` /
  `killswitchMonitor` / `PlaybackVariantSwitcher` / `proxyHitMeter` /
  v1 `VideoPlayerPanel` inline player modified or deleted. S4 boundary respected.

## Excellence (D10-qualifying)

- **Pure-planner / DOM-applier split in AudioSyncPool** — `computeAudioSyncActions`
  is fully testable with zero audio elements; the class only reads
  `currentTime`/`paused` and writes back. Exemplary testability.
- **Comprehensive epsilon + degenerate-input handling** — `clamp01`/`clampVolume`
  guard `NaN`/±Inf; `effectiveDuration` clamps fade to half-clip so fade-in+out
  never sum >1 mid-clip; `_ensurePlaying` swallows only the benign play()
  promise rejection (documented why, scoped to the promise, not a structural
  error).
- **`AUDIO_DRIFT_EPSILON_SEC` lifted from v1's `drift > 0.5` into a named,
  documented constant** explicitly contrasted with spec-01 `TIME_EPSILON` — no
  bare magic number, no concept collision.

## Context for Downstream (tester focus)

- Audio behavior at the exact END of the last audio clip (one-frame `play` vs
  `pause`) — spot-check during the multi-track acceptance run (§6 case 10).
- When S3 wires the real HTMLAudio pool: confirm `audioDetached` end-to-end (no
  double audio) and that `track.volume` is passed already normalized to 0..2
  (adapter produces 0..2; `computeEffectiveVolume` clamps the product to [0,1]).
- S2/S3 must populate `opacity`/`trackZ`/transitions through the adapter when a
  real producer exists; the signature already folds them.
- `SubtitleSequenceItem` dual declaration is structural-only; if either drifts,
  the `as unknown as` cast in `useTimelineComposition` will hide it — keep them
  in lockstep.
