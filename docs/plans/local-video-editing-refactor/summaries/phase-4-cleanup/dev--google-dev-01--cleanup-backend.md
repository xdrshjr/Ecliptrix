# Phase 4 Cleanup — Backend Composition Service D10 Split

- **Meta** Role: DEV  Task: cleanup-backend  Phase: 4  Verdict: COMPLETED (partial reduction, see Issues & Risks)
- **Author:** google-dev-01
- **Date:** 2026-06-10
- **Branch:** feat/local-video-editing-refactor
- **Target file:** `backend-services/basic-service/app/services/video_composition_service.py`

## Objective

Behavior-preserving D10 split of `video_composition_service.py` (2744 lines) to
move cohesive, self-contained units into focused modules under
`app/services/composition/`, fitting file (<=800) and method (<=50) thresholds.
NO logic/behavior changes.

## Before / After Line Counts

| File | Before | After |
|------|-------:|------:|
| `video_composition_service.py` | 2744 | **2557** |
| `composition/video_scaling.py` (new) | — | 148 |
| `composition/subtitle_prep.py` (new) | — | 77 |
| `composition/media_download.py` (new) | — | 86 |

Net reduction in the orchestrator: **-187 lines**. Residual is **2557 > 800**
(see Issues & Risks for why the rest cannot be safely extracted under the weak
safety net).

## Pre-existing Failure Count (proof of no new failures)

Verification harness in this anaconda env: `cv2` binary is broken (recursion on
import), so a bare `python -c "import ...service"` cannot run; the test suite's
`conftest.py` installs a `cv2` stub, so import is verified via the stub + the
test runs. Full `app.main` cannot boot (broken cv2) — confirmed environmental,
not introduced.

Clean baseline (git-stash of my changes, new files moved aside) vs. after:

| Test scope | Clean baseline | After extraction |
|------------|---------------|------------------|
| 37 green tests (`test_filtergraph_builder` + `test_audio_mix` + `test_local_media_resolver` + `test_export_parity`) | 37 passed | **37 passed** |
| `test_video_composition*.py` (baseline scope) | 17 failed / 31 passed | **17 failed / 31 passed** |
| Full patch-sensitive set (the 6 `test_video_composition*` + `test_pexels_functionality` + `test_subtitle_font_size_fix`) | 20 failed / 32 passed | **20 failed / 32 passed** |

Pre-existing failures are UNCHANGED (stale method calls, Windows `Path.stat`,
missing fixtures/task_id — not mine). The two failing pexels names
(`test_pexels_url_detection`, `test_pexels_retry_all_attempts_fail`) and the 3
`test_subtitle_font_size_fix` failures were confirmed failing on the clean
baseline too.

Additionally, `calculate_video_scaling` was checked for arithmetic equivalence
against a verbatim copy of the original logic across 8 representative cases
(same-ratio, landscape, portrait, square, odd dims) — EQUIVALENT.

## Extraction Seams CHOSEN (safe, self-contained)

1. **`video_scaling.py`** — `get_aspect_ratio_info`, `ensure_even_dimensions`,
   `calculate_video_scaling`, `build_video_filter` (+ two private helpers
   `_direct_scale_params`, `_boxed_scale_params` to keep each <=50 lines). Pure
   math/string builders, no instance state. No test patches them.
2. **`subtitle_prep.py`** — `seconds_to_srt_time` (pure), `create_srt_from_subtitle_items`
   (pure file serialization). The class `_create_srt_from_subtitle_items` (which
   IS patched in `test_subtitle_font_size_fix`) stays as a thin delegating
   method, so `patch.object(service, '_create_srt_from_subtitle_items')` and the
   `self.`-call from `_process_subtitle_tracks` still work.
3. **`media_download.py`** — `is_youtube_url`, `is_pexels_url` (pure predicates),
   `download_image` (+ `_image_extension_from_url` helper). `download_image` is
   not patched anywhere and is fully self-contained.

All original methods are retained as **thin delegating wrappers** so every
`patch.object(service, ...)` and `self.`-call contract the test suite relies on
is preserved exactly.

## Extraction Seams REJECTED (would risk behavior / break test contracts)

- **Video download / retry cluster** (`_download_video`, `_download_youtube_video`,
  `_download_pexels_video_with_retry`, `_download_video_with_ffmpeg`,
  `_download_video_with_retry`, `_normalize_video_with_retry`): heavily coupled
  to module-level `settings` (the pexels tests do
  `@patch('app.services.video_composition_service.settings')`) and cross-patched
  via `patch.object(service, '_download_video_with_ffmpeg' / '_download_youtube_video')`
  with `_download_video` dispatching through `self.`. Moving the bodies to
  another module would either break the module-scoped `settings` patch (different
  namespace) or require keeping every method as a wrapper anyway (no net gain).
  Only the pure URL predicates + image download were safely extractable here.
- **`_compose_video_sync`** (~700 lines): the orchestration core. Interleaves
  shared mutable state (`self.compositions[id]` progress updates, temp-dir
  lifecycle, error-detail construction, fall-back control flow). Splitting it
  means restructuring control flow — exactly the high-risk change the task
  forbids under a weak safety net.
- **`_process_audio_tracks`** (~320 lines): single cohesive method with deep
  local state (temp paths, sequential ffmpeg invocations). The reusable
  `build_audio_mix` filtergraph was already extracted in Phase 3; the remaining
  body is sequential FFmpeg I/O that cannot be split without risking behavior we
  cannot verify (no green test covers the real ffmpeg path here).

## Execution Flow

1. Read the full 2744-line file + existing `composition/*` modules + the
   relevant tests to map every `patch.object` / `self.`-call contract.
2. Recorded clean baseline: line count, 37 green, 17/31 video_composition,
   confirmed cv2-broken environment.
3. Three extractions, each followed by: cv2-stub import check, 37 green tests,
   `test_video_composition*` count comparison, and `py_compile`.
4. For each set of patch-sensitive tests, git-stashed my changes to capture the
   clean-baseline failure count and confirmed it matched post-change.
5. Brought the two >50-line extracted functions under threshold via pure
   structural helper extraction (`_direct_scale_params`, `_boxed_scale_params`,
   `_image_extension_from_url`), proven equivalent.
6. Updated `composition/__init__.py` docstring to list the new modules.

## Artifacts

- New: `app/services/composition/video_scaling.py`, `subtitle_prep.py`, `media_download.py`
- Modified: `app/services/video_composition_service.py` (4 method bodies -> wrappers,
  3 new imports), `app/services/composition/__init__.py` (docstring)

## Issues & Risks

- **Weak safety net (acknowledged):** cv2 is broken in this anaconda env;
  `app.main` cannot boot; ~17 (and 20 in the wider set) pre-existing test
  failures exist independent of this work. Import verified via the conftest cv2
  stub; behavior verified via the 37 green tests + unchanged pre-existing failure
  counts + arithmetic-equivalence check.
- **Residual > 800:** the orchestrator is still **2557 lines**. The remaining
  bulk (`_compose_video_sync`, `_process_audio_tracks`, the settings/patch-coupled
  download cluster) cannot be extracted without restructuring control flow or
  breaking test patch contracts — both disallowed. Per task guidance ("a safe
  partial reduction beats a risky deep restructure"), I stopped at the safe
  seams. Reaching <=800 safely would need: (a) fixing the cv2 env so a real green
  suite exists, then (b) carefully decomposing `_compose_video_sync` into
  stage methods with characterization tests first.
- No new dependencies. No stubs/TODO/FIXME/empty-except introduced. New modules
  all <=148 lines; all new functions <=50 lines.
