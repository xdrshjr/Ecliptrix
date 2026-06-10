# TESTER Summary — TODO 05 (local export with preview-parity)

## Meta
- **Agent:** google-tester-01
- **Role:** TESTER (last line of defense; accountable for misses)
- **Task:** todo-05
- **Phase:** 3
- **Verdict:** **PASS WITH FIXES** (independently judged; concurs with reviewer's
  verdict but adds a hard follow-up requirement on the `audio_mix.py` D10 gap)

## Key Decisions

1. **Parity is REAL and load-bearing — mutation-proven.** I did not trust the
   reviewer's "faithful mirror" claim; I MUTATED the parity oracle twice and
   confirmed the parity test fails under each, then restored (clean git diff).
   The export↔preview alignment is genuinely enforced, not decorative.
2. **`audio_mix.py` is a confirmed INCOMPLETE D10 EXTRACTION, not a correctness
   defect.** Spec 05 §2.5 lists `audio_mix.py` as an extraction (MOVE) target;
   the dev instead wrote a tested-but-unused module while the live service kept
   its inline amix (`video_composition_service.py:2058`). Reviewer already
   flagged this [MODERATE], so it is NOT a tester "found issue the reviewer
   missed." I independently verified the LIVE audio path is correct and
   classify this as a **required follow-up** (wire-or-delete), not a Phase-3
   gate blocker — correctness is preserved.
3. **Download-removal + localization are genuinely enforced**, confirmed at both
   the unit-test level and by reading the live code paths (no silent download
   remains; export emits only `/api/storage/files` local refs).
4. **No new issues found beyond the reviewer's** — the reviewer's analysis held
   up under independent probing. No false bugs raised.

## Execution Flow

1. Read upstream (dev summary, global-context, reviewer Meta verdict only).
2. Read specs 05 / 02 (§2.4) / 01 + task-orchestration; read the parity
   source-of-truth `TransitionLayer.ts`.
3. Read all backend code (4 composition modules, `local_media_resolver`,
   `video_models`, and the live service sections: download-removal L988–1049,
   audio_detached guard L1711, inline amix L2046–2067, live audio volume
   L1984) + all frontend code (`useVideoExport`, `CompositionAdapter`,
   `selectPlaybackUrl`) + the 6 test files.
4. Ran all four test commands (counts below).
5. **Parity mutation-proof** (critical probe): perturbed the oracle, confirmed
   FAILs, restored.
6. Adjudicated the `audio_mix` dead-module question via grep (callers = tests
   only) and verified the live audio path handles detach/volume/mute.
7. Completeness scan (stubs/TODO/empty-except/sizes) on the new modules.

## TESTS RUN (exact counts)

| Command | Result |
| --- | --- |
| Backend: `pytest test_filtergraph_builder test_audio_mix test_local_media_resolver test_export_parity -q` | **37 passed** |
| Frontend: `vitest run useVideoExport.localExport + CompositionAdapter.exportPath` | **7 passed** (2 files) |
| `npm run type-check` (`tsc --noEmit`) | **clean** (0 errors) |
| Full `vitest run src/components/video` | **852 passed / 0 failed** (104 files) — baseline confirmed, no regression |

## Parity Mutation-Proof Result (STEP 4 critical probe)

I temporarily perturbed `test_export_parity.py`'s preview oracle and re-ran:

| Mutation | Expectation | Observed |
| --- | --- | --- |
| Dropped the half-clip clamp (`return duration` instead of `min(duration, clip/2)`) | parity test must fail | **FAILED** `test_parity_effective_duration_matches_preview_clamp` (oracle 10.0 vs export 2.0) ✓ |
| Perturbed the fade-in alpha curve (`* 0.5`) | parity test must fail | **FAILED** `test_parity_fade_param_implies_preview_alpha_at_sample_time` (oracle 0.25 vs ffmpeg-implied 0.5) ✓ |
| Restore both | all pass, clean diff | **6 passed**, `git diff` empty ✓ |

**Conclusion: the parity is load-bearing — both the half-clip clamp and the
alpha-curve arithmetic are genuinely cross-checked.** I also independently
compared the Python oracle (`_preview_alpha_for` / `_preview_effective_duration`)
term-by-term against `TransitionLayer.alphaFor` / `effectiveDuration`: out-of-
window→0, fade-in `into/fadeIn`, fade-out `untilEnd/fadeOut`, clamp01,
`EPSILON=0.001` — all MATCH. The only divergence (TS `clamp01` returns 1 for
non-finite; Py passes through) is immaterial for the finite test inputs.

## audio_mix Classification (STEP 4 adjudication)

**Classification: INCOMPLETE D10 EXTRACTION (follow-up required, non-blocking).**

- **Dead-module confirmed:** `grep` shows `build_audio_mix` / `AudioSource` /
  `AudioMixPlan` are imported ONLY by `tests/test_audio_mix.py`. The service
  imports `media_resolution`, `encode`, `filtergraph_builder` — but NOT
  `audio_mix` (`video_composition_service.py:51–59`). `__init__.py` documents it
  but does not re-export it. The live amix is the inline implementation at
  `video_composition_service.py:2058`.
- **Spec intent:** §2.5 lists `audio_mix.py` as an EXTRACTION (MOVE) target →
  writing a parallel unused module is half-done D10, not the goal.
- **LIVE path VERIFIED correct (the safety question):**
  - `audio_detached` → detached video track contributes NO embedded audio: the
    extraction guard at `video_composition_service.py:1711` `continue`s before
    ffprobe/extract. ✓
  - item/track volume respected: live pre-process applies
    `-af volume={audio_item.volume}` (`:1984`), where `volume` =
    `item.volume * track.volume/100` combined upstream in `useVideoExport`. ✓
  - track mute respected: muted audio tracks are filtered out at the frontend
    extraction (`!track.isMuted`) so they never reach the request. ✓
- **What dev MUST do (follow-up, not a Phase-3 blocker):** EITHER route the
  service's amix through `build_audio_mix` (make the tested planner the single
  source of truth, completing D10) OR delete `audio_mix.py` + `test_audio_mix.py`
  (remove the dead/duplicated module). Leaving a tested-but-unused module is a
  standing completeness debt.

## Download-Removal + Localization Findings (STEP 4)

- **No silent download:** `test_resolve_local_media_raises_for_non_local_url`
  pins `NonLocalMediaError` for `https://cdn.example.com/...`. The live service
  (L1004–1028) resolves each unique URL via `resolve_local_media` and on
  `NonLocalMediaError` records a `VideoProcessingError`
  (stage=DOWNLOAD, "localize the material first") — it does NOT push to a
  download queue. The old `urls_to_download` yt-dlp/ffmpeg loop is gone from
  this path. **CONFIRMED.**
- **Cache/local hit uses local path:** `test_resolve_local_media_uses_cache_hit_first`
  (origin='cache') + `_falls_through_to_local_resolver` (origin='local') +
  `_tolerates_cache_lookup_failure` (advisory). **CONFIRMED.**
- **Export localization:** request items carry only `/api/storage/files` local
  URLs. Frontend guard tests assert the serialized request contains no `blob:`,
  no `/api/media/proxy`, no `preview-proxies` — on BOTH `useVideoExport` and
  `CompositionAdapter` emit paths. `selectPlaybackUrl(export)` skips P1/P4 and
  filters via `isLocalMediaReference` / `_isPreviewOnlyReference`. **CONFIRMED.**

## Spec Traceability (spec 05 §6 cases 1–7)

| # | Case | Implemented? | Test Exists? | Test Passes? | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | `useVideoExport` URL local-only, no blob/proxy | YES | YES (`useVideoExport.localExport`) | YES | serialized-request assertion |
| 2 | track_z/opacity/transition/audio_detached values | YES | YES (both FE test files) | YES | by-id field assertions |
| 3 | `CompositionAdapter.exportPath` local-first guard | YES | YES (`CompositionAdapter.exportPath`) | YES | 5 cases incl. nested metadata |
| 4 | `local_media_resolver` same-origin/relative/loopback; whitelist reject; non-local error | YES | YES (`test_local_media_resolver` +6) | YES | incl. thumbnails whitelist (R7) |
| 5 | `filtergraph_builder` overlay/xfade/trim/setpts/concat-fallback | YES | YES (`test_filtergraph_builder` 12) | YES | full multi-track + transition coverage |
| 6 | `audio_mix` amix volume/mute/audio_detached | YES (module) | YES (`test_audio_mix` 7) | YES | ⚠ module is UNWIRED — live path is inline (see classification) |
| 7 | export↔preview parity (param-level) | YES | YES (`test_export_parity` 6) | YES | **mutation-proven load-bearing**; real-ffmpeg pixel / xfade cross-version = **Deferred to desktop walkthrough** |

## Completeness (STEP 5.5)

- New modules: `filtergraph_builder` 334, `encode` 107, `audio_mix` 104,
  `media_resolution` 103 — all ≤ 800. ✓
- Longest methods (body, ex-docstring): `build_filtergraph` ~33, `_build_clip_chain`
  ~29, `_compose_track` ~30 — all ≤ 50. ✓
- No TODO/FIXME/XXX/NotImplementedError/empty-pass in the new modules. ✓
- All `except` clauses are narrow (`LocalMediaResolveError`) or intentional
  logged broad-excepts (`# noqa: BLE001`, documented rationale) — no silent
  swallows. ✓
- Carryover (NOT a TODO-05 regression): `video_composition_service.py` = 2747
  lines, still > 800. D10 shrank it; further extraction is follow-up.

## Issues & Risks

### Required follow-up (non-blocking for Phase-3 gate)
- **[MODERATE — concurs with reviewer] `audio_mix.py` unwired (D10 incomplete).**
  Dev MUST wire `build_audio_mix` into the service OR delete the module + its
  tests. Correctness is preserved by the live inline path; this is completeness
  debt, not a runtime defect.

### Deferred to mandatory desktop walkthrough (cannot verify in vitest/pytest)
- Real-ffmpeg execution: xfade cross-version compatibility, overlay alpha
  blending fidelity, real letterbox pixels, drawtext y-pixel vs canvas vAnchor.
  Parity is verified at the PARAMETER level only (by design, spec §6.7).
- `tpad` track positioning for exotic intra-track-gap layouts.

### No new issues found
- Independent probing surfaced nothing the reviewer missed; no false bugs raised.

## Context for Downstream

- **For TODO-06 (persistence):** persist `track_z/opacity/transition_in/out/
  audio_detached` (item) + `TimelineItem.transitionIn/transitionOut` so a saved
  project re-exports identically. `ClipTransition = {type:'fade'|'dissolve',
  duration:number}`.
- **Parity maintenance:** the Python oracle in `test_export_parity.py`
  (`_preview_alpha_for`) is a HAND-KEPT mirror of
  `src/components/video/playback/TransitionLayer.ts`. Any change to the TS
  alpha math MUST update the oracle — the mutation-proof confirms the test will
  catch a divergence, but only if the oracle itself is kept in sync.
- **audio_mix decision drives a follow-up commit** (wire-or-delete) before this
  area is considered architecturally clean.
- **Acceptance gate:** the real-ffmpeg / pixel / sound parity is the user's
  mandatory Electron desktop walkthrough (per global-context); unit tests pin
  wiring and parameters, not pixels/audio.
