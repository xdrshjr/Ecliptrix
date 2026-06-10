# Phase 4 Cleanup — Acceptance Test (google-tester-01)

Meta Role:TESTER Task:cleanup Phase:4 Verdict:ALL PASS

Independently acceptance-tested the CLEANUP PHASE: google-dev-01's backend
`video_composition_service.py` D10 split (3 new modules) + google-dev-02's
frontend dead-code removal + 2 file splits. Both are pure behaviour-preserving
refactors. Reviewer google-reviewer-01 returned PASS; I judged independently and
**concur: ALL PASS — no behaviour drift, no regression, no test-count drop.**

## Verdict: ALL PASS

## Key Decisions

1. **Drift proof is decisive and clean.** The `test_video_composition*.py`
   patch-sensitive set failed IDENTICALLY before and after the refactor
   (17 failed / 31 passed both ways). Zero NEW failures → no behaviour drift.
2. **Test counts hit every target.** Frontend 873/873 (0 failed), backend green
   set 37/37, type-check exit 0. No drop anywhere.
3. **Dead-code removal independently grep-confirmed zero-ref** for all 10
   constants + all 8 uniquely-named types; the `ProxyTier`/`IProxyHitMeter` live
   runtime copies + the full KEEP list are untouched.
4. **All extractions verbatim** (spot-checked body-by-body against `git show
   HEAD`); the single non-verbatim backend change (dead-pad drop) independently
   confirmed dead (overwritten before read).
5. **Phase-3 delete-cascade wiring intact** after the hook split: 4-cache
   eviction + backend cascade both still fire in `executeDelete`.

## Execution Flow

1. Read both dev summaries + ONLY the reviewer `## Meta` verdict (PASS).
2. `git --no-pager diff --stat HEAD` — confirmed the 3 new backend modules +
   6 new frontend modules + 2 new test files; targets present.
3. Read all 3 new backend modules + the service-file diff + all 6 new frontend
   modules + the `useMaterialManagement` / `TimelineItem` / `constants` / `types`
   / `index` diffs.
4. Ran the test matrix (counts below).
5. **Drift proof:** ran `test_video_composition*` AFTER (17F/31P) → stashed the
   backend changes (`git stash push <service> <composition/>`, which reverted the
   service to HEAD and moved the 3 new modules aside) → cleared stale pycache →
   ran SAME command on clean HEAD (17F/31P) → `git stash pop` → verified
   byte-identical restore via pre-recorded `git hash-object` SHAs.
6. Independent dead-code grep across `src/` for every removed symbol.
7. Verbatim spot-checks (backend + frontend) against `git show HEAD`.
8. Line-count + stub/TODO completeness check.

## Tests Run (exact counts)

| Suite | Command | Result | Expected | Pass? |
|-------|---------|--------|----------|-------|
| Frontend type-check | `npm run type-check` | exit 0 (clean) | clean | YES |
| Frontend vitest | `npx vitest run src/components/video` | **873 passed / 0 failed** (106 files) | 873/0 | YES |
| Backend green set | `pytest test_filtergraph_builder + test_audio_mix + test_local_media_resolver + test_export_parity -q` | **37 passed** | 37 | YES |
| Backend composition | `pytest tests/test_video_composition*.py -q` (AFTER) | **17 failed / 31 passed** | — | (drift proof below) |

## Drift Proof (decisive — before == after)

`pytest tests/test_video_composition*.py -q`:

| State | Result |
|-------|--------|
| AFTER refactor (working tree) | **17 failed / 31 passed** |
| Clean HEAD (changes stashed) | **17 failed / 31 passed** |

**Zero NEW failures.** The pre-existing 17 failures (stale method calls, Windows
`Path.stat`, pexels vimeo-URL test/impl mismatch, missing fixtures/task_id) are
identical on clean HEAD → independent of this work. Working tree restored
byte-identical:
- `video_composition_service.py` hash `82431292…` (== pre-stash)
- `composition/video_scaling.py` hash `de17d3e1…` (== pre-stash)
- DRIFT-PROOF stash popped + dropped; only pre-existing TMP stashes remain.

(Note: reviewer ran a 4-file subset and saw 13F/28P; I ran the full
`test_video_composition*` glob and saw 17F/31P. Different scope, same conclusion
— before == after in BOTH scopes. No contradiction.)

## Dead-code-removal — Independent Grep Result

- 10 removed constants (`VISIBILITY_RESUME_MAX_MS`, `DRIFT_*`×5,
  `PREPARING_TIMEOUT_MS`, `TICK_FPS_REPORT_INTERVAL_MS`, `KILL_SWITCH_LS_KEY`,
  `PREWARM_LEAD_SEC`): grep across `src/` → **ZERO references**.
- 8 uniquely-named removed types (`PlaybackPhase`, `PlaybackIntent`,
  `SubtitlePayload`, `IPlaybackEngine`, `SequenceTarget`,
  `PlaybackTimelineFacade`, `PlaybackEngineAttachDeps`, `IKillSwitchMonitor`):
  grep → **ZERO references**.
- `ProxyTier` / `IProxyHitMeter`: only the dead `types.ts`/`index.ts` duplicates
  were removed; the LIVE runtime copies in `internal/proxyHitMeter.ts` are intact
  and re-exported as `*Runtime` aliases (index.ts lines 53/55).
- **KEEP list verified intact** in `constants.ts` (77 lines): `ADAPTIVE_*`×4,
  `PLAYHEAD_THROTTLE_MS`, `SHORT_CLIP_THRESHOLD_SEC`, `BIND_*`×2,
  `PREVIEW_PROXY_POLL_*`×2, `AUDIO_DRIFT_EPSILON_SEC`, `VIDEO_SEEK_TOLERANCE_SEC`.
  All 14 live `types.ts` types (`PreviewFrame` … `PlaybackSequenceResolver`)
  present.

## Behaviour-preservation findings

**Backend — verbatim extraction confirmed** (diffed against `git show HEAD`):
`get_aspect_ratio_info`, `ensure_even_dimensions`, `calculate_video_scaling`,
`build_video_filter`, `seconds_to_srt_time`, `create_srt_from_subtitle_items`,
`is_youtube_url`, `is_pexels_url`, `download_image` — same arithmetic, same
filter strings (`scale=…,setsar=1:1`, `pad=…:black`), same `_ALLOWED_IMAGE_
EXTENSIONS`. All 4 service methods retained as thin `self.`-delegating wrappers
→ every `patch.object` / `self.`-call contract preserved (notably
`_create_srt_from_subtitle_items` stays a `self.`-method for
`test_subtitle_font_size_fix`).

**The dead-pad drop — independently confirmed genuinely dead.** In the original
`_calculate_video_scaling` (HEAD lines 2167-2174) `pad_x`/`pad_y` are computed
from pre-even dims, then UNCONDITIONALLY overwritten (lines 2180-2186) from even
dims before any read/return. The only statements between are the two
`_ensure_even_dimensions` calls, which never read pad_x/pad_y. The new
`_boxed_scale_params` keeps ONLY the second (used) computation → byte-identical
arithmetic. The first `scale_width`/`scale_height` computation IS used (feeds
`_ensure_even_dimensions`) and is correctly retained. Dev's 8-case
arithmetic-equivalence check corroborates.

**Frontend — verbatim extraction confirmed** (diffed against `git show HEAD`):
- `computeItemStyles` == `getItemStyles` (same padding, draggedOpacity 0.65/0.8,
  zIndex, per-type borders/glow, swap-target outline; closure → typed config obj).
- `TimelineItemFilmstrip` == `renderFilmstrip` (`slot.url ?? poster` preserved via
  `posterUrl={item.thumbnailUrl}` wiring).
- `TimelineItemDownloadOverlay` == `renderLocalDownloadOverlay` (all guards, pct
  clamp, all 3 status branches identical; locale → `labels` prop verbatim).
  `LocalProxyMaskState` moved + re-exported from TimelineItem → TimelinePanel /
  Track / TrackContainer importers unaffected.
- `materialDeleteHelpers` (`sourcePathForDelete` / `extraThumbnailKeysForDelete` /
  `generateUUID`) byte-identical (`function`→`export function` only).
- `handleAiImageGenerate` body byte-identical; return type correctly tightened to
  `Promise<ArkImagePack | null>` (was untyped) — matches actual `return pack`.
- `triggerAutoAnalysis` defined in `useMaterialUpload`, returned, and reused by
  the orchestrator's `addMaterials` search-add path.

**Phase-3 delete-cascade wiring — INTACT after the split.** Orchestrator's
`executeDelete` still loops IDs calling BOTH `evictMaterialCaches(id)` (evicts all
4 caches: filmstrip + waveform + videoCache + LocalMediaCache via
`evictLocalMaterialRef`) AND `cascadeDeleteMaterial(id)` (→ backend
`deleteMaterialDerived`) BEFORE state removal. The `evictLocalMaterialRef` bridge
is preserved.

## Completeness / Targets

- Frontend ≤800: useMaterialManagement **548**, TimelineItem **652**, constants
  **77** — all met; all 6 new modules ≤468.
- Backend `video_composition_service.py` = **2557** (>800) — documented residual,
  partial-but-safe reduction (-187), NOT a failure per directive.
- **No stubs/TODO/FIXME introduced.** The single "TODO" grep hit is inside a
  pre-existing comment referencing a spec doc (`see spec 06 / TODO 03`), relocated
  verbatim — not a code marker.
- Oversized `processFileUpload` (~155-203 lines) + ARK `poll` closure: lifted
  VERBATIM from the monolith, dev-acknowledged + reviewer-accepted, flagged for a
  future dedicated tested refactor. Pre-existing structure, not new debt.

## Issues & Risks

- **No blocking issues. No regressions. No false bugs.**
- Pre-existing (independent of this work, present on clean HEAD): cv2 broken in
  the anaconda env (`app.main` cannot boot), 17 pre-existing
  `test_video_composition*` failures, the pexels URL-detection test/impl
  mismatch. None introduced or worsened by the cleanup.
- (Observational, non-blocking) Dev summaries say "verbatim" for the hooks; the
  `useCallback` dep arrays necessarily grew for the param-driven closures and one
  JSDoc on `LocalProxyMaskState` moved with its type. Both behaviour-neutral
  (React-stable / set-once deps). Reviewer already flagged the wording; agreed —
  a precision note, not a defect.

## Context for Downstream

- Both cleanups are SAFE TO INTEGRATE. Frontend targets fully met (all ≤800).
- Backend residual >800 remains a documented future task — requires a real green
  suite (cv2 env fix) + characterization tests before `_compose_video_sync` /
  `_process_audio_tracks` / the settings-coupled download cluster can be split.
- The cv2-broken anaconda env and the pexels URL-detection mismatch are
  pre-existing and orthogonal to this work.
