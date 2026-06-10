# REVIEWER Summary — TODO 05 (local export with preview-parity)

## Meta
- **Agent:** google-reviewer-01
- **Role:** REVIEWER (Three-Powers Governance; accountable for misses)
- **Task:** todo-05
- **Phase:** 3
- **Verdict:** **PASS WITH FIXES** (one trivial fix applied — wire-interface documentation; touches only a TODO-05 file)

## Key Decisions

1. **Parity oracle is FAITHFUL.** `test_export_parity._preview_alpha_for` /
   `_preview_effective_duration` are an exact arithmetic mirror of
   `TransitionLayer.alphaFor` / `effectiveDuration`. Verified line-by-line
   (see Parity finding). The filtergraph_builder encodes the same curve.
2. **Download-fallback removal is COMPLETE and CORRECT.** The ~line-963
   local-miss→yt-dlp/ffmpeg path is gone; `resolve_local_media` raises
   `NonLocalMediaError` on non-local URLs and the service maps it to a
   user-facing failure response. No silent download remains.
3. **Export URL localization is GUARDED.** Both emit paths use the same
   selection contract; preview-only blob/proxy/preview-proxy refs are excluded;
   tests pin it on both `useVideoExport` and `CompositionAdapter`.
4. **`audio_mix.py` is an unwired (tested-but-not-called) module** — a valid
   D10-completeness issue, but NOT a correctness defect: the `audio_detached`
   routing is enforced by the in-service extraction guard. Flagged, not blocking.
5. **Applied fix:** added the new wire fields (`track_z`, `transition_in/out`,
   `audio_detached`, `clip_start/end`, `clipped_duration`) + `ClipTransitionWire`
   to `src/lib/api/videoComposition.ts`'s `VideoCompositionItem` interface, which
   previously omitted them (the emit relied on `video_items: any[]`). Documents
   the wire contract; type-check stays clean.

## Execution Flow

1. Read dev summary + global-context (Phase-2 compositor semantics).
2. Read specs 05 / 01 / 02 (§2.4 transition + §2.2 multi-track) + task-orchestration.
3. Read preview source of truth: `TransitionLayer.ts` + `assembleLayers.ts`.
4. Read the parity oracle (`test_export_parity.py`) and compared its arithmetic
   to the TS source term-by-term.
5. Read filtergraph_builder / media_resolution / audio_mix / encode +
   local_media_resolver + video_models + the video_composition_service diff
   (download-removal, filtergraph orchestration, audio_detached guard).
6. Read frontend useVideoExport / CompositionAdapter / selectPlaybackUrl /
   ports.ts / types/index.ts + the two guard tests.
7. Verified index alignment (`normalized_videos[i]` ↔ `video_items[i].id`),
   the wire contract (frontend `video_items` snake_case ↔ backend pydantic),
   module sizes (all ≤334 lines / methods ≤50), and the dev-01/dev-02
   shared-file (`src/types/index.ts`) coherence.
8. Ran `npm run type-check` (clean, before + after my fix) and the 4 backend
   test files (exit 0). Did not read tester output per protocol.

## Artifacts

### Reviewed (no change)
- Backend: `composition/{filtergraph_builder,media_resolution,audio_mix,encode}.py`,
  `local_media_resolver.py`, `models/video_models.py`,
  `video_composition_service.py`, tests `test_{filtergraph_builder,audio_mix,
  local_media_resolver,export_parity}.py`.
- Frontend: `useVideoExport.ts`, `CompositionAdapter.ts`, `selectPlaybackUrl.ts`,
  `ports.ts`, `types/index.ts`, tests `useVideoExport.localExport.test.ts`,
  `CompositionAdapter.exportPath.test.ts`.

### Modified (my trivial fix)
- `src/lib/api/videoComposition.ts` — added `ClipTransitionWire` + the new
  optional fields to the `VideoCompositionItem` wire interface (documentation /
  type-safety; behaviour unchanged).

## Issues & Risks

### Valid issues found
- **[MODERATE] `audio_mix.py` is not wired into the export path.** The service
  keeps its own legacy in-service amix (`video_composition_service.py` ~L1813+)
  and never imports `build_audio_mix`/`AudioSource`. Spec 05 §2.5 lists
  `audio_mix.py` as the EXTRACTION target for the amix logic, so the intent was
  to MOVE not DUPLICATE. Correctness is unaffected (the `audio_detached` routing
  is enforced by the extraction guard at L1711, and volume/mute were already
  handled), so this is a D10/architecture-completeness gap, not a runtime defect.
  File:line: `app/services/video_composition_service.py:51-59` (imports omit
  audio_mix) + the standalone `app/services/composition/audio_mix.py`.
  Fix (follow-up, NOT applied — out of trivial scope): route the service's amix
  through `build_audio_mix` so the tested planner is the single source of truth.

- **[LOW, FIXED] Wire interface omitted the new fields.** `videoComposition.ts`'s
  `VideoCompositionItem` lacked `track_z`/`transition_in`/`transition_out`/
  `audio_detached`/`clip_*` (the emit used `any[]`). Applied: added them +
  `ClipTransitionWire`. File: `src/lib/api/videoComposition.ts:17-58`.

- **[LOW, not fixed — pre-existing, out of scope] Audio item URL uses
  `selectAudioPlaybackUrl`, not `selectPlaybackUrl(export)`.** Spec §2.2 says all
  video/audio/image items should use `selectPlaybackUrl(export)`. Audio still uses
  the existing blob-guarded `selectAudioPlaybackUrl` (which returns serverUrl/
  originalUrl and resolves via the same backend whitelist for `/api/audio/...`).
  Functionally local-safe; cosmetic divergence only.

### Carryover (documented, not a TODO-05 regression)
- `video_composition_service.py` = 2747 lines, still > 800 cap. D10 shrank it
  (4 modules extracted) per "shrink toward the cap". Further extraction is
  follow-up.

### Verified clean
- Parity oracle fidelity (CRITICAL): MATCHES (see below).
- Export localization: same-origin local only; no blob/proxy/preview-proxy.
- Download-fallback removal: complete; `NonLocalMediaError` is the only outcome.
- media_resolution reuses local_media_resolver (no whitelist re-impl).
- local_media_resolver change = thumbnails-dir whitelist only (4-line diff).
- audio_detached: detached video contributes no audio (extraction guard).
- Backward compat: all new request fields optional w/ legacy defaults.
- No stubs / TODO / FIXME / empty-except in new modules.
- `src/types/index.ts`: dev-01's `ClipTransition` + `TimelineItem.transitionIn/Out`
  intact + coherent with dev-02's concurrent edits; type-check clean.
- D10: new modules ≤334 lines, methods ≤50.
- Index alignment `normalized_videos[i]` ↔ `request.video_items[i].id` is correct.

## Parity-Oracle-Fidelity (actual arithmetic comparison)

`TransitionLayer.alphaFor` (TS) vs `_preview_alpha_for` (Py):
- `effectiveDuration`: TS `min(d, clipDuration/2)` with `d<=0`/non-finite → 0.
  Py `min(duration, clip_duration/2.0)` with `not duration or duration<=0` → 0.0.
  **MATCH** (the Number.isFinite guard is immaterial for finite test values).
- Out-of-window: TS `t < start - EPS || t > end + EPS → 0`. Py identical. **MATCH.**
- Fade-in: TS `intoClip=t-start; if intoClip < fadeIn-EPS: alpha=min(alpha, intoClip/fadeIn)`.
  Py identical (`into/fade_in_eff`). **MATCH.**
- Fade-out: TS `untilEnd=end-t; if untilEnd < fadeOut-EPS: alpha=min(alpha, untilEnd/fadeOut)`.
  Py identical. **MATCH.**
- Clamp: TS `clamp01`; Py `max(0, min(1, alpha))`. **MATCH.** EPSILON=0.001 both.

Filtergraph encoding matches the oracle:
- z-order = track order: `group_tracks` resolves z = first clip `track_z` else
  first-seen index, sorts ascending; `_overlay_tracks` overlays bottom→top.
  Mirrors `assembleLayers` z-ascending. Asserted (`video_inputs.index(bottom) <
  index(top)`).
- opacity → `format=rgba,colorchannelmixer=aa=<opacity>` = compositor globalAlpha.
  Asserted `aa=0.5` (×2 for the two top clips; opaque base gets none).
- dissolve overlap == transition.duration: `_compose_track` xfade
  `duration=_effective_transition_duration(...)`, `offset=cumulative-duration`.
  Asserted `xfade=transition=fade:duration=1.0` + `offset=4.0`.
- fade window implies the same alpha: ffmpeg `fade=t=in:st=0:d=1.0` ⇒ at t=0.5
  alpha=0.5, equal to the oracle (asserted `< 1e-9`).
- half-clip clamp: export window == preview window == 2.0 for a 10s fade on a
  4s clip (asserted).
**VERDICT: parity is REAL, not faked.**

## Export-Localization finding
`selectPlaybackUrl(material,{purpose:'export'})` skips P1/P4, returns
local-first (`localResolvedUrl→cacheUrl→url→serverUrl` filtered by
`isLocalMediaReference`), else durable `serverUrl||url` filtered by
`_isPreviewOnlyReference` (drops blob / `/api/media/proxy` / preview-proxies).
`useVideoExport` uses it for video + image items; `CompositionAdapter`'s
`selectCanonicalExportReference` mirrors the same priority via the shared
`isLocalMediaReference` predicate (kept relative for the preview-signature
pipeline). Guard tests assert no `blob:` / `preview-proxies` / `/api/media/proxy`
in the serialized request. **CONFIRMED local-only.**

## Download-Removal finding
`video_composition_service` no longer builds `urls_to_download` or runs the
ThreadPoolExecutor download loop. Each unique URL → `resolve_local_media(url,
cache_lookup=...)` → cache hit OR `resolve_media_reference(allow_remote=False)`
OR `NonLocalMediaError` → recorded as a `VideoProcessingError`
(stage=DOWNLOAD/media_resolution) with "localize the material first" recovery
text. **CONFIRMED: no silent download path remains.**

## CONTRACT VERIFICATION
Live export wire: `useVideoExport` emits `video_items[]` (snake_case:
`track_z`, `transition_in`, `transition_out`, `audio_detached`, `opacity`,
`clip_start`, `clip_end`) → `videoCompositionAPI.composeVideo` →
`http.post('/api/video-compose', request)` (BFF passthrough) → backend
`POST /api/video/compose` → pydantic `VideoCompositionRequest.video_items:
List[VideoCompositionItem]`. Backend `VideoCompositionItem`
(`app/models/video_models.py:119-172`) accepts all five new fields as optional
(`track_z: Optional[int]`, `transition_in/out: Optional[ClipTransition]`,
`audio_detached: Optional[bool]`, `opacity` pre-existing). `ClipTransition`
(`{type:Literal['fade','dissolve'], duration:float>0}`) ≡ frontend
`ClipTransition` (`src/types/index.ts:649`) ≡ domain `SequenceTransition`
(`ports.ts:227`) ≡ `ClipTransitionWire` (`videoComposition.ts`, my addition).
`CompositionAdapter.buildCompositionRequest` (`video_sequences` shape) has NO
production caller — tests only — so it is NOT the live wire path. **CONFIRMED
field-name + type alignment across all four declarations on the live path.**

## SUMMARY
TODO-05 delivers genuine local export with real preview-parity. The parity
oracle is a faithful mirror of `TransitionLayer.alphaFor` and the filtergraph
encodes the same z-order / opacity / fade / xfade semantics. The default
cloud-download fallback is fully removed and replaced by a hard
`NonLocalMediaError`. URL localization is enforced and guarded on both emit
paths. The contract (frontend snake_case ↔ backend pydantic) matches.
One moderate D10 gap (`audio_mix.py` tested but unwired — correctness
preserved by the extraction guard) and one low wire-doc gap (fixed). Verdict:
**PASS WITH FIXES.**

## Context for Downstream
- **Tester:** parity oracle (`_preview_alpha_for`) is verified-faithful as of
  this review; if `TransitionLayer.alphaFor` changes, re-check the mirror.
  The live audio routing for `audio_detached` is the in-service extraction
  guard (`video_composition_service.py:1711`), NOT `audio_mix.py`.
- **TODO-06 (persistence):** persist `track_z/opacity/transition_in/out/
  audio_detached` (item) + `TimelineItem.transitionIn/transitionOut` so a saved
  project re-exports identically. `ClipTransition = {type:'fade'|'dissolve',
  duration:number}`.
- **Follow-up:** wire `build_audio_mix` into the service to retire the
  duplicated in-service amix (D10 completion). Further-extract
  `video_composition_service.py` toward the 800-line cap.
