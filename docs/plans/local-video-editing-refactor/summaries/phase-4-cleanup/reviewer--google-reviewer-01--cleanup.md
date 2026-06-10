# Phase 4 Cleanup — Review (google-reviewer-01)

Meta Role:REVIEWER Task:cleanup Phase:4 Verdict:PASS

Reviews both google-dev-01 (backend composition split) and google-dev-02
(frontend dead-code removal + module extraction). Both are pure
behaviour-preserving refactors. Verdict: **PASS** — no behaviour drift,
no dead-code-removal errors, no scope violations, all safety nets green.

## Key Decisions

1. **PASS, no fixes applied.** Every extraction verified as a verbatim move;
   the single non-verbatim backend change (dead-pad drop) is provably
   arithmetically equivalent; all 20 removed frontend symbols proven zero-ref;
   KEEP list intact; scope clean.
2. **Backend residual >800 accepted.** `video_composition_service.py` stays
   ~2440–2557 lines (>800). Accepted because the safe seams were taken, the
   residual (`_compose_video_sync`, `_process_audio_tracks`, settings/patch-
   coupled download cluster) cannot be split without restructuring control flow
   or breaking `patch.object` contracts under a weak safety net (cv2-broken env,
   17 pre-existing failures). Partial-but-safe > deep-but-risky, per directive.
3. **Oversized frontend methods accepted as-is.** `processFileUpload` (~155 lines)
   and the ARK `poll` closure (>50 lines) were lifted VERBATIM. Decomposing them
   would mean restructuring the concurrent-upload queue / polling state machine —
   behaviour drift the directive forbids. Verbatim-preservation > the 50-line
   guideline here. Correctly flagged by dev for a future dedicated refactor.

## Execution Flow

1. Read both dev summaries + global-context (KEEP list).
2. Backend: read 3 new modules + full `video_composition_service.py` diff;
   mapped every `patch.object` / `self.`-call contract in `tests/`.
3. Verified the `calculate_video_scaling` dead-pad drop line-by-line (see below).
4. Frontend: grep-verified all 10 constants + 10 types are zero-ref in `src/`;
   confirmed proxyHitMeter runtime copies + KEEP constants untouched.
5. Diffed each frontend extraction against `git show HEAD` (UTF-8 forced to
   defeat console mojibake) — only scaffolding (imports/interfaces/wrapper/deps)
   differs from the original bodies.
6. Ran safety nets: `tsc --noEmit` clean; `vitest run src/components/video`
   873/873; backend green set 37/37.
7. **Behaviour-drift proof (critical):** ran the patch-sensitive
   `test_video_composition*` set (4 files) AFTER the refactor (13 failed /
   28 passed), then stashed the backend changes (reverted service file to HEAD,
   moved new modules aside) and ran the SAME set on clean HEAD — **identical
   13 failed / 28 passed**. Zero new failures. Restored the working tree
   (byte-identical, no BOM drift).

## Artifacts

- This review: `summaries/phase-4-cleanup/reviewer--google-reviewer-01--cleanup.md`
- Verified (backend): `composition/{video_scaling,subtitle_prep,media_download}.py`,
  `video_composition_service.py` (4 method bodies → delegating wrappers + 3 imports),
  `composition/__init__.py` (docstring).
- Verified (frontend): `playback/{internal/constants.ts,types.ts,index.ts}`,
  `hooks/useMaterialManagement.ts` + `hooks/materialManagement/{materialDeleteHelpers,
  useMaterialUpload,useMaterialGeneration}.ts`, `timeline/TimelineItem.tsx` +
  `timeline/{timelineItemStyles.ts,TimelineItemFilmstrip.tsx,TimelineItemDownloadOverlay.tsx}`,
  3 repointed tests + 2 new pure-fn tests.

## Behaviour-preservation findings

**Backend — verbatim moves confirmed.** `get_aspect_ratio_info`,
`ensure_even_dimensions`, `build_video_filter`, `seconds_to_srt_time`,
`create_srt_from_subtitle_items`, `is_youtube_url`, `is_pexels_url`,
`download_image` — same arithmetic, same filter strings (`scale=...,setsar=1:1`,
`pad=...:black`), same control flow, same `_ALLOWED_IMAGE_EXTENSIONS`. Imports
(`AspectRatio`, `SubtitleCompositionItem`) resolve from `app.models`.

**The dead-pad drop (the ONE non-verbatim backend change) — VERIFIED EQUIVALENT.**
Original `_calculate_video_scaling` computed `pad_x`/`pad_y` ONCE from
pre-even-rounding dims, then unconditionally OVERWROTE both in the
"Recalculate padding with even dimensions" block before they were ever read or
returned. The first computation is provably dead (the only statements between
the two blocks are the `_ensure_even_dimensions` calls, which never read
pad_x/pad_y). The new `_boxed_scale_params` keeps only the second (used)
computation — byte-identical arithmetic. Genuinely dead, not a behaviour change.

**Backend patch contracts — preserved.** All 4 extracted clusters retain
`self._method(...)` delegating wrappers with unchanged signatures; every call
site (lines 435/439/654/659/660/1251/2166/2312/2338/2352/2463/2503) still routes
through `self.`. The only test-patched member, `_create_srt_from_subtitle_items`
(`test_subtitle_font_size_fix`), stays a `self.`-method called at 2166/2352 →
patch still intercepts. `_seconds_to_srt_time` is patched nowhere, so the
extracted `create_srt_from_subtitle_items` calling the module-level helper
directly is safe.

**Frontend — verbatim moves confirmed.** `computeItemStyles` == `getItemStyles`
(same padding `max(2, floor(h*0.125))`, `draggedOpacity 0.65/0.8`, per-type
borders/glow, `zIndex isSwapTarget?9:(isSelected?10:1)`). `TimelineItemFilmstrip`
== `renderFilmstrip` (`slot.url ?? poster` preserved via `posterUrl` prop).
`TimelineItemDownloadOverlay` == `renderLocalDownloadOverlay` (same guards, same
`pct` clamp, all 3 branches, locale → `labels` prop passed verbatim).
`LocalProxyMaskState` moved to overlay module + re-exported from TimelineItem →
TrackContainer/Track/TimelinePanel importers unaffected. `materialDeleteHelpers`
(`sourcePathForDelete`/`extraThumbnailKeysForDelete`/`generateUUID`) verbatim.
`useMaterialUpload` / `useMaterialGeneration` bodies verbatim (only scaffolding
differs).

**Hook dep-array expansion — verified non-drift (NOT a regression).** Extracting
closures into param-driven modules required the `useCallback` dep arrays to grow
(e.g. `[taskId,logger]`→`[taskId,logger,user]`; `[logger]`→`[logger,isMountedRef,
setMaterials]`; `[logger,addOrReplaceMaterial]`→`[logger,isMountedRef,setMaterials,
addOrReplaceMaterial]`). The added deps are either React-stable (`setMaterials`
state-setter, `isMountedRef` ref → zero callback-identity churn) or a value that
is set-once in practice (`user`, single-device login). The original arrays were
exhaustive-deps-incomplete-but-lexically-stable; the new ones are correct for the
param closure. Runtime behaviour identical. (Dev's "verbatim" wording is slightly
loose here — dep arrays necessarily changed — but the behaviour is preserved.)

**Mount-lifecycle split — verified equivalent.** Original had ONE `[]` effect
doing `isMountedRef=true/false` AND `pendingAiTasks` cleanup. Refactor splits
into orchestrator (`isMountedRef` `[]` effect) + generation hook (`pendingAiTasks`
cleanup `[]` effect). Both run once on the same mount/unmount cycle; the timer
cleanup never reads `isMountedRef`, and the generation hook captures
`tasks = pendingAiTasks.current` (stable ref) per the React-recommended pattern.
Equivalent.

## Dead-code-removal finding

All 10 removed constants (`VISIBILITY_RESUME_MAX_MS`, `DRIFT_*` ×5,
`PREPARING_TIMEOUT_MS`, `TICK_FPS_REPORT_INTERVAL_MS`, `KILL_SWITCH_LS_KEY`,
`PREWARM_LEAD_SEC`) and 8 uniquely-named removed types (`PlaybackPhase`,
`PlaybackIntent`, `SubtitlePayload`, `IPlaybackEngine`, `SequenceTarget`,
`PlaybackTimelineFacade`, `PlaybackEngineAttachDeps`, `IKillSwitchMonitor`):
grep across `src/` → **ZERO references**. The 2 type-only `ProxyTier`/
`IProxyHitMeter` removed from `types.ts`/`index.ts` are the DEAD duplicates; the
LIVE runtime copies in `internal/proxyHitMeter.ts` remain and are re-exported as
`*Runtime` aliases (index.ts lines 53/55, untouched). KEEP list verified intact:
`AUDIO_DRIFT_EPSILON_SEC`, `VIDEO_SEEK_TOLERANCE_SEC`, `PREVIEW_PROXY_POLL_*`,
`ADAPTIVE_*`, `PLAYHEAD_THROTTLE_MS`, `SHORT_CLIP_THRESHOLD_SEC`, `BIND_*` all
present in constants.ts; proxyHitMeter live copies untouched.

## Repointed-tests ruling

PASS. All 3 repointings change only the `FILE`/anchor path to the new module and
preserve the SAME assertion regexes (`!localPreviewEnabled`, video/audio guard,
status switch; `slot.url ?? poster`). The filmstrip test sensibly splits the
poster-fallback assertion across TimelineItem (`posterUrl={item.thumbnailUrl}`
wiring) and the filmstrip module (`slot.url ??` logic) — same guarded behaviour,
more precise. Intent unchanged.

## Oversized-method ruling

ACCEPT as-is. `processFileUpload` (~155) + ARK `poll` (>50) lifted verbatim;
decomposing them risks upload-queue/polling drift. Verbatim-preservation wins
here; correctly flagged for a future tested refactor.

## Backend-residual ruling

ACCEPT. `video_composition_service.py` >800 (residual documented honestly).
The safe seams were taken; the rest is control-flow-coupled or patch-contract-
coupled and cannot move under the weak safety net. Documented path to <800
(fix cv2 env → characterization tests → decompose `_compose_video_sync`).

## Issues & Risks

- **No blocking issues. No fixes applied.**
- (Non-blocking, observational) The dev summaries say "verbatim" for the hooks;
  technically the `useCallback` dep arrays grew (necessary for the param closure)
  and a one-sentence JSDoc on `LocalProxyMaskState` was dropped. Both verified
  behaviour-neutral. Worth a precise wording note, not a code change.
- (Pre-existing, not this work) `test_pexels_url_detection` fails because both
  old and new `is_pexels_url` match `"pexels.com"` but the test feeds a
  `vimeo.com?...=pexels` URL — a test/impl mismatch present on clean HEAD.

## Context for Downstream

- Both cleanups are safe to integrate. Frontend targets met (all ≤800).
- Backend residual >800 remains as a documented future task; it requires a real
  green suite (cv2 env fix) + characterization tests before `_compose_video_sync`
  can be decomposed.
- The pexels URL-detection test/impl mismatch and the cv2-broken anaconda env are
  pre-existing and independent of this work.

## Safety-net evidence

- `npm run type-check`: exit 0 (clean).
- `vitest run src/components/video`: **873 passed / 0 failed** (106 files).
- backend `test_filtergraph_builder + test_audio_mix + test_local_media_resolver
  + test_export_parity`: **37 passed**.
- backend `test_video_composition*` (4-file scope): 13 failed / 28 passed AFTER
  == 13 failed / 28 passed on clean HEAD baseline → **0 new failures**.
