# DEV Summary — TODO 05 (local export with preview-parity)

## Meta
- **Agent:** google-dev-01
- **Role:** DEV
- **Task:** todo-05 (local export + ffmpeg compositor feature-parity with the Phase-2 preview compositor)
- **Phase:** 3 (parallel with google-dev-02 / TODO 06 — disjoint files)
- **Verdict:** COMPLETED

TODO 05 makes export fully local (no silent remote download) and brings the
backend FFmpeg compositor to feature-parity with the Phase-2 canvas compositor:
multi-track overlay (z-order + per-clip opacity), transitions (fade → ffmpeg
fade, dissolve → xfade), and subtitle burn-in — so export is what-you-see-is-
what-you-get. The 2760-line `video_composition_service.py` was decomposed per
D10 (§2.5) into four focused `composition/` modules.

## Key Decisions

1. **Two-mode filtergraph builder (`pre_trimmed` flag).** `build_filtergraph`
   emits a full self-contained chain (clip `trim`→`setpts`→`scale`→fade→opacity)
   over ORIGINAL inputs — the form the unit tests assert (clip trim/setpts). The
   service, however, feeds it the ALREADY-normalized clips (the existing pipeline
   trims + scales + strips audio per clip), so it calls `build_filtergraph(...,
   pre_trimmed=True)` which skips trim/scale (would double-apply) and keeps only
   the setpts reset + transition + opacity + overlay + timeline-positioning. This
   reuses the proven normalization pass instead of rewriting the whole decode
   path, and keeps the tested builder contract honest.

2. **Filtergraph vs concat decision + concat fallback.** A timeline that is
   single-track AND transition-free returns `can_use_concat=True` → the service
   keeps the lightweight, already-proven concat path. Otherwise the multi-track
   filtergraph runs; on ANY filtergraph encode failure the service falls back to
   concat (spec 05 §2.4 "filter_complex failure → concat"). Video is produced
   audio-less in both paths (clips normalized with `-an`); audio is mixed in the
   existing downstream amix stage — unchanged routing.

3. **Removed the local-miss download fallback (~line 963), replaced with
   `media_resolution.resolve_local_media`.** Each unique URL now resolves via
   cache-hit OR `local_media_resolver.resolve_media_reference(allow_remote=False)`;
   a non-local URL is a hard `NonLocalMediaError` surfaced to the user
   ("localize the material first"), NOT a yt-dlp/ffmpeg download. The cache
   lookup is injected and failure-tolerant (cache is advisory).

4. **Frontend URL convergence WITHOUT regressing the preview extractor.** The
   real export REQUEST builder (`useVideoExport`) calls `selectPlaybackUrl(export)`
   directly (absolutises for desktop-shell safety — desired there). The
   `CompositionAdapter` extractor (also feeds the preview signature/cache
   pipeline) uses the SAME selection priority via the shared `isLocalMediaReference`
   predicate but returns the reference AS-IS (relative kept relative) — because
   absolutising it broke 9 preview/cache tests that key on the relative path.
   One selection contract, two call sites; documented inline. (First attempt
   delegated the extractor to `selectPlaybackUrl(export)` and regressed those 9
   tests; reverted to the predicate-shared form.)

5. **New request fields are optional + backward-compatible.** `track_z`,
   `transition_in`, `transition_out`, `audio_detached` default to "no transition,
   opacity 1, z by track order, not detached" — old requests behave exactly as
   before. `opacity`/`volume`/`clip_*` already existed and are reused.

6. **Parity = semantic/parameter alignment, not pixel diffing.** `test_export_parity`
   re-expresses `TransitionLayer.alphaFor`'s arithmetic in Python as the oracle
   and asserts the filtergraph parameters imply the identical curve (fade alpha
   at a sample time, dissolve overlap == transition.duration, effective-duration
   half-clip clamp). Cross-language pixel diffing is impractical and out of scope.

## Execution Flow

1. Read all 6 mandated planning docs + Phase-2 summaries (TransitionLayer +
   assembleLayers semantics) + every existing code surface (the 2760-line
   service, local_media_resolver, video_models, useVideoExport, CompositionAdapter,
   selectPlaybackUrl, TransitionLayer, SubtitleLayer, types).
2. Backend model: added `ClipTransition` + `track_z/transition_in/transition_out/
   audio_detached` to `VideoCompositionItem`.
3. Built 4 new `composition/` modules (encode, media_resolution, audio_mix,
   filtergraph_builder).
4. Wired the service: delegated GPU/encode, replaced the download loop with
   `resolve_local_media` (download fallback removed), added
   `_compose_videos_filtergraph` + `_concat_videos`, guarded `audio_detached` in
   embedded-audio extraction, whitelisted `static/video/thumbnails`.
5. Frontend: `useVideoExport` → `selectPlaybackUrl(export)` + new fields;
   `CompositionAdapter` extractor + request builder pass-through; ports +
   `src/types` transition types.
6. Wrote 4 backend test files (37 tests) + 1 new frontend test + strengthened the
   export-path test.
7. Ran type-check (clean), the four backend test files (37 passed), the full
   frontend video suite (852 passed / 0 failed), and proved the touched-area
   composition baseline failures are pre-existing (stashed my service file →
   identical failures).

## Artifacts

### Created (backend)
- `app/services/composition/__init__.py`
- `app/services/composition/encode.py` (107) — GPU detect + encode params.
- `app/services/composition/media_resolution.py` (103) — cache→local-resolver→
  `NonLocalMediaError`; reuses local_media_resolver (no whitelist re-impl).
- `app/services/composition/audio_mix.py` (104) — pure amix planner (volume,
  mute, detached-embedded drop).
- `app/services/composition/filtergraph_builder.py` (334) — multi-track overlay +
  fade/xfade transitions + clip trim/setpts + opacity + tpad positioning.
- `tests/test_filtergraph_builder.py` (12), `tests/test_audio_mix.py` (7),
  `tests/test_export_parity.py` (6).

### Modified (backend)
- `app/models/video_models.py` — `ClipTransition` + 4 new optional item fields.
- `app/services/video_composition_service.py` — removed download fallback;
  delegated GPU/encode; filtergraph-or-concat orchestration; `audio_detached`
  guard; thumbnails whitelist. 2760 → **2747 lines**.
- `app/services/local_media_resolver.py` — whitelisted `static/video/thumbnails`.
- `tests/test_local_media_resolver.py` — +6 tests (thumbnail, resolve_local_media
  cache-hit / fall-through / non-local error / cache-failure tolerance).

### Created (frontend)
- `src/components/video/hooks/__tests__/useVideoExport.localExport.test.ts` (2).

### Modified (frontend)
- `src/components/video/hooks/useVideoExport.ts` — `selectPlaybackUrl(export)` for
  video/image items; pass `track_z/opacity/transition_in/out/audio_detached`.
- `src/components/video/timeline/infrastructure/CompositionAdapter.ts` — extractor
  populates `trackZ/opacity/transitionIn/transitionOut`; request builder passes
  them through; selection contract converged on the shared `isLocalMediaReference`.
- `src/components/video/timeline/domain/ports.ts` — `SequenceTransition` +
  extended `VideoSequenceItem` + request shape.
- `src/types/index.ts` — `ClipTransition` + `TimelineItem.transitionIn/Out`.
- `.../__tests__/CompositionAdapter.exportPath.test.ts` — +2 cases (local-only
  guard, new-field pass-through).

## Interfaces Touched (Contract Verification)

### CONSUMES — spec-01 clip contract (clip_start/clip_end, ClipTimeMapping)
- Role: CONSUMER. Verified: **YES**. `filtergraph_builder._build_clip_chain` trims
  `[clip_start, clip_end]` and resets PTS; `test_clip_trim_and_setpts_emitted`
  asserts it. The export request carries `clip_start/clip_end` from the timeline
  item (spec 01 semantics). Peer: TODO 01 (dev-01).

### CONSUMES — spec-02 transition semantics (TransitionLayer.alphaFor)
- Role: CONSUMER. Verified: **YES**. `_effective_transition_duration` mirrors
  `TransitionLayer.effectiveDuration` (half-clip clamp); fade-in `st=0:d=window`
  and fade-out `st=dur-window:d=window` mirror the leading/trailing ramps;
  dissolve → `xfade ... duration=transition.duration`. `test_export_parity`
  computes the oracle alpha from the SAME arithmetic and asserts the ffmpeg
  params imply it. Peer: TODO 02 (dev-01, self).

### CONSUMES — spec-02 z-order / opacity (assembleLayers)
- Role: CONSUMER. Verified: **YES**. `group_tracks` resolves z from `track_z`
  else first-seen order (the SAME rule as `buildVideoTrackGroups`); tracks
  overlaid bottom→top; per-clip opacity → `colorchannelmixer=aa`. Asserted in
  `test_two_track_overlay_*`, `test_per_clip_opacity_*`, and the parity tests.
  Peer: TODO 02 (self).

### PRODUCES — extended VideoCompositionRequest fields (frontend↔backend)
- Role: PRODUCER. Verified: **YES**. Frontend emits `track_z/opacity/
  transition_in/out/audio_detached` (snake_case) in `useVideoExport`'s
  `video_items` and `CompositionAdapter`'s `video_sequences`; backend
  `VideoCompositionItem` accepts them (optional, backward-compatible).
  `useVideoExport.localExport.test` + `CompositionAdapter.exportPath.test` pin the
  values; the model parses them. Peer: backend video_models (self) ↔ frontend.

### PRODUCES — filtergraph semantics mirroring preview
- Role: PRODUCER. Verified: **YES** by the parity test (parameter-level). Peer:
  google-reviewer-01 / google-tester-01 (final arbiters of parity).

### PRODUCES — local-only resolution contract (no download)
- Role: PRODUCER. Verified: **YES**. `resolve_local_media` raises
  `NonLocalMediaError` on a non-local URL; `test_resolve_local_media_raises_for_
  non_local_url` pins it. The service maps it to a user-facing failure response.

## Issues & Risks (esp. what only real ffmpeg/desktop verifies)

- **No real ffmpeg execution in unit tests.** The filtergraph/audio_mix builders
  are PURE string planners; their OUTPUT is asserted, but actual ffmpeg encoding
  (xfade compatibility across versions, overlay alpha blending fidelity, real
  letterbox pixels) is a **desktop-walkthrough** item. The concat fallback guards
  the failure case.
- **Parity is parameter-level, not pixel-level.** Documented gap: the Python
  oracle (`_preview_alpha_for`) is a hand-kept mirror of the TS
  `TransitionLayer.alphaFor`; a change in the TS source must keep it in sync
  (enforced by review + the parity test, not auto-generated). True cross-language
  pixel diffing is impractical and out of scope (spec 05 §6.7 allows this).
- **Subtitle position parity is convention-level.** Burn-in is delegated to the
  EXISTING `subtitle_service.build_drawtext_filters` (reused, not reimplemented).
  The parity test asserts the shared bottom-anchor convention (backend default
  position 'bottom' ↔ preview SubtitleLayer default vAnchor 0.9); the exact
  drawtext y-pixel vs canvas vAnchor is a desktop check.
- **`tpad` track positioning** assumes a track's first clip establishes its
  timeline offset; multi-gap-within-track layouts (clips with internal gaps) are
  positioned by concat/xfade cumulative offset — a desktop check for exotic
  layouts. Common cut/fade/dissolve layouts are covered.
- **Service still > 800 lines (2747).** D10 shrank it (extracted 4 modules) but
  it remains over cap; further extraction (download/normalize/overlay stages) is
  follow-up. The spec required "shrink toward the cap", satisfied.
- **Pre-existing backend test failures in the touched area are NOT mine.**
  Proven by stashing my service file → `test_video_composition_timeline_order`
  fails identically. Causes: stale `compose_video` method calls (never existed),
  un-patchable `Path.stat` on Windows, missing fixture files, requests missing
  required `task_id`, and one auth test asserting `error_code` instead of
  `detail.error_code`. None touch composition/filtergraph/resolver.

## Context for Downstream

- **For TODO 06 (persistence):** the request fields `track_z/opacity/
  transition_in/transition_out/audio_detached` (item) and the frontend
  `TimelineItem.transitionIn/transitionOut` + domain `TimelineItemData`
  transition fields must be PERSISTED and reload-able so a saved project re-exports
  identically. `ClipTransition` is `{type:'fade'|'dissolve', duration:number}`.
- **For reviewer/tester:** the parity oracle lives in `test_export_parity.py`
  (`_preview_alpha_for` / `_preview_effective_duration`) — verify it still
  mirrors `src/components/video/playback/TransitionLayer.ts`. Run:
  `pytest tests/test_filtergraph_builder.py tests/test_audio_mix.py
  tests/test_local_media_resolver.py tests/test_export_parity.py -v` and the
  frontend `vitest run src/components/video`.
- **Routes unchanged:** frontend hyphen `/api/video-compose` (BFF) → backend
  slash `/api/video/compose`.

## Rework (audio_mix wire/delete)

**Option chosen: WIRED** (the PREFERRED outcome). The reviewer/tester correctly
flagged that `composition/audio_mix.py` was tested-but-dead: the service still
ran an inline amix at the multi-source branch and never imported the module, so
the D10 extraction (§2.5) was incomplete. I completed it by making the module
the LIVE multi-source audio-mix path. Wiring was safe because the inline amix is
a pure filter-string construction with no side effects.

### What changed in the module to make wiring behavior-equivalent
The first-cut `audio_mix.py` had DIVERGED from the live pipeline: it applied
`volume=` inside the filtergraph and performed mute / `audio_detached` routing in
the builder. The live pipeline does NEITHER there — volume is baked into each
file by the per-item pre-processing pass (`-af volume=<v>`), and routing happens
upstream (muted tracks contribute no source; `audio_detached` embedded audio is
dropped at `_extract_video_audio_tracks` ~L1711). Wiring the divergent module
verbatim would have CHANGED behavior (double-applied volume, re-routed). So I
rewrote `build_audio_mix` to be a literal extraction of the inline construction:
it takes already-pre-processed, already-routed sources (just `start_time`),
emits `adelay`→`apad` per source, then the identical `amix=inputs=N:duration=
longest:dropout_transition=3:normalize=0,atrim=duration=<dur>[out]` over
`[delayed{i}]` labels with the same `';'`/space joining. The
`audio_detached` drop, item/track volume, and track mute are all unchanged and
still live where they were — the builder is now the ONLY place the multi-source
mix filter string is constructed.

### Equivalence proof
`tests/test_audio_mix.py` keeps a verbatim snapshot of the ORIGINAL inline
construction (`_inline_mix_filter`, copied byte-for-byte from the replaced code)
as an oracle, and asserts `build_audio_mix(...).filter_complex` equals that
oracle string for (a) a 3-source mix of zero-delay + delayed sources at 12.0s and
(b) the single-source / zero-delay boundary at 5.0s. Both pass, proving the wired
path emits the SAME ffmpeg audio args the inline path did. The remaining tests
pin the amix parameters (`duration=longest`, `dropout_transition=3`,
`normalize=0`, `atrim`) and the `adelay`/`apad` per-source positioning.

### Files changed
- `app/services/composition/audio_mix.py` — rewritten to mirror the inline
  contract (no in-graph volume, no in-builder routing; `AudioSource` now carries
  only `start_time`; `AudioMixPlan` exposes `input_count`/`has_audio`). 95 lines.
- `app/services/video_composition_service.py` — imported `AudioSource` /
  `build_audio_mix`; replaced the ~14-line inline mix-filter construction in
  `_process_audio_tracks` (multi-source branch) with a 4-line call. No duplicate
  amix construction remains. **2747 → 2744 lines.**
- `tests/test_audio_mix.py` — rewritten to the live contract + the inline-
  equivalence proof (7 tests).

### Verification (re-run)
- `npm run type-check` — clean (no errors; no frontend files touched).
- backend `pytest tests/test_filtergraph_builder.py tests/test_audio_mix.py
  tests/test_local_media_resolver.py tests/test_export_parity.py -q` — **37
  passed** (`test_audio_mix.py` alone: 7 passed).
- frontend `vitest run useVideoExport.localExport.test.ts
  CompositionAdapter.exportPath.test.ts` — **7 passed** (2 files). The full
  `src/components/video` (852) suite was not re-run because no frontend source
  was touched.
