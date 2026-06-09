# Acceptance Test — TODO 04 本地音频波形 (google-tester-01)

> Meta: Role=TESTER · Task=todo-04 · Phase=1 · Verdict=**ALL PASS**
> Branch `feat/local-video-editing-refactor` · Reviewer prior verdict: PASS WITH FIXES
> (ffmpeg `-ar 44100` determinism pin — verified present, see row A4 / D3).

## Verdict: ALL PASS

Every spec-04 §6 acceptance item and every todos/04 task has both an
implementing file and a test (or, for the wiring item, a verified end-to-end
contract match). The three commanded test commands all pass: vitest 23/23,
type-check exit 0, backend pytest 12/12. The BFF passthrough routes that were
flagged as "just added" exist, compile against a real helper, and their
paths/methods match the client EXACTLY — no runtime 404.

> Tooling note: the `Glob` and `Grep` tools returned false-negative "not found"
> for several **untracked** files on this Windows checkout (e.g. the waveform
> lib, the BFF routes, `backend-proxy.ts`). All "missing" conclusions were
> re-verified by direct filesystem `ls`/`cat`/`Read` and the files DO exist.
> Verdict relies only on direct reads, not on the search tools.

## Spec-04 §6 Acceptance — Traceability Matrix

| # | Acceptance requirement | Implementation | Test | Status |
|---|---|---|---|---|
| B1 | Short audio → fixed-length normalized peaks, len ≈ durationSec×peaksPerSecond | `waveform_service.py` `_extract_peaks`/`_downsample_peaks` (L193-261), `_INT16_FULL_SCALE` norm | `test_generate_returns_ready_with_normalized_peaks`, `test_peaks_length_proportional_to_duration` | PASS |
| B2 | JSON persisted to `static/audio/waveforms/{materialId}.json`; GET can fetch | `_write_disk`/`_json_path` (L113-119,435-443), `get_waveform` (L350-372) | `test_persists_camelcase_json_to_waveforms_dir`, `test_get_returns_snake_case_rest_payload` | PASS |
| B3 | Idempotent: existing → ready without re-extract | `generate` short-circuit (L311-318); `_extract_peaks` is the spied seam | `test_generate_is_idempotent` (spy `assert_not_called`), `test_generate_force_reextracts` | PASS |
| B4 | List/delete by materialId (spec 06 hooks) | `list_material_files` (L374-389), `delete_by_material` (L391-414) | `test_list_material_files_returns_relative_path`, `_empty_for_unknown`, `test_delete_by_material_removes_json`, `_noop_when_absent` | PASS |
| F5 | drawWaveform: peaks→column-max map; clip=[2,5] slices; empty→placeholder | `drawWaveform.ts` `mapPeaksToColumns`/`slicePeaksForClip`/`drawWaveform` | `drawWaveform.test.ts` (clip=[2,5]→indices[20,50), max-per-column, empty→baseline, null-ctx no-op, no-AudioContext guard) | PASS |
| F6 | waveformCache.ensure: missing→pending(trigger); ready→slice | `waveformCache.ts` `ensure`/`resolve`/`peaksFor` (single in-flight) | `waveformCache.test.ts` (ready short-circuit, missing→pending, inline-ready, concurrent→1 fetch/1 gen, error→failed, slice [2,5)) | PASS |
| F7 | TimelineItem renders audio waveform; detached audio reuses same materialId; failure degrades | `TimelineItem.tsx` audio branch (L576-608) → `AudioWaveformCanvas.tsx`; detached audio shares parent materialId (spec 01) so reuses `{materialId}.json` | Covered transitively by F5/F6 (canvas = drawWaveform+cache); manual-walkthrough item per spec. Degrade path = drawWaveform empty-peaks baseline (tested F5) | PASS* |

\*F7 has no dedicated component render test; it is composed entirely of F5+F6
units (both tested) plus a manual desktop walkthrough the spec itself prescribes
as the integration check. Not a gap per spec scope — flagged as the one
untested composition seam (low risk: both halves are unit-tested + type-checked).

## todos/04 Task → Artifact Matrix (file-change plan §3)

| Task | File | Exists | Notes |
|---|---|---|---|
| waveform_service (new) | `app/services/waveform_service.py` (490L) | yes | ffmpeg mono s16le → abs-peak downsample → camelCase JSON |
| storage_router (mod) | `app/routers/storage_router.py` L771-880 | yes | `POST /waveform/generate` + `GET /waveform/{material_id}`, queue-bounded |
| storage_models (mod) | `app/models/storage_models.py` L132-168 | yes | 3 snake_case models |
| config (mod) | `app/config.py` L312-322,609,954-959 | yes | `WaveformConfig` peaks_per_second=100, max_concurrent=2, timeout=120; env overrides |
| storage_service (mod) | `app/services/storage_service.py` L480-555,678-683 | yes | trigger ① enqueue on audio upload + has-audio video |
| test_waveform_service (new) | `tests/test_waveform_service.py` (12 tests) | yes | ffmpeg-gated skip |
| waveformClient (new) | `src/components/video/lib/waveform/waveformClient.ts` | yes | snake↔camel normalize |
| waveformCache (new) | `.../waveform/waveformCache.ts` | yes | ensure/peaksFor/status, in-flight collapse |
| drawWaveform (new) | `.../waveform/drawWaveform.ts` | yes | pure canvas, no decode |
| TimelineItem (mod) | `src/components/video/timeline/TimelineItem.tsx` | yes | audio branch + `waveformAudioUrl` memo (selectPlaybackUrl 'export') |
| AudioWaveformCanvas (new, not in plan) | `.../timeline/AudioWaveformCanvas.tsx` | yes | extracted render component (cleaner than inline TimelineItem) |
| WaveformPreview (mod) | `.../VideoProcessingModal/WaveformPreview.tsx` | yes | peaks-first probe, gates wavesurfer, live-decode fallback |
| drawWaveform.test (new) | `.../waveform/__tests__/drawWaveform.test.ts` | yes | 15 cases |
| waveformCache.test (new) | `.../waveform/__tests__/waveformCache.test.ts` | yes | 8 cases |

## CRITICAL — BFF Passthrough End-to-End Wiring (step 3)

Verified resolves end-to-end; no runtime 404:

| Layer | POST generate | GET fetch |
|---|---|---|
| Client (`waveformClient.ts`) | `http.post('/api/storage/waveform/generate', {material_id, audio_url})` | `http.get('/api/storage/waveform/${encodeURIComponent(id)}')` |
| BFF route file | `src/app/api/storage/waveform/generate/route.ts` — `createPassthroughRoute('/api/storage/waveform/generate')` exports `{POST}` | `src/app/api/storage/waveform/[material_id]/route.ts` — `createPassthroughRoute((p)=>'/api/storage/waveform/'+p.material_id)` exports `{GET}` |
| Helper | `src/lib/api/server/backend-proxy.ts` `createPassthroughRoute` (16991B, exists) — awaits `ctx.params`, builds backend URL, forwards raw JSON body + Authorization/x-session-token | same |
| Backend | `storage_router` `POST /waveform/generate` (router prefix `/storage`, app-mounted at `/api`) → `/api/storage/waveform/generate` | `GET /waveform/{material_id}` → `/api/storage/waveform/{material_id}` |

- **Dynamic-segment name match:** folder is `[material_id]`; builder reads
  `p.material_id` — exact match, so the param resolves (not `undefined`).
- **Path match:** client path == BFF route path == backend full path, byte-for-byte.
- **Method match:** client POST/GET == BFF exported POST/GET == backend POST/GET.
- **Same-origin:** `http` client `fetch(path,…)` uses relative paths +
  `assertSameOriginPath` guard, so calls hit the Next.js BFF (not the backend
  directly), satisfying the spec's "Network only same-origin" requirement.

## Spec-conformance spot checks (step 4)

- **Schema separation:** on-disk `_build_disk_payload` → **camelCase**
  `{version:1, materialId, durationSec, peaksPerSecond, peaks[]}`
  (waveform_service.py L263-273); REST `_disk_to_rest` →
  **snake_case** `{status, duration_sec, peaks_per_second, peaks}` (L275-283).
  Pydantic models + router responses are snake_case; client re-normalizes back
  to camelCase. Two shapes, never mixed. CONFORMS.
- **Idempotent generate:** existing JSON returns ready w/o re-extract (spy
  proves no `_extract_peaks` call). CONFORMS.
- **peaks length ≈ durationSec×peaksPerSecond:** `column_count =
  round(duration*pps)` (L255); test asserts `abs(len - round(dur*pps)) <= 1`.
  CONFORMS.
- **drawWaveform pure / no decode:** zero AudioContext/wavesurfer refs in
  `drawWaveform.ts`; explicit no-AudioContext smoke test. AudioWaveformCanvas
  reads only `waveformCache.peaksFor` + draws. CONFORMS.
- **waveformCache slices [clipStart, clipEnd):** `slicePeaksForClip` uses
  `floor(start*pps)`..`ceil(end*pps)`, end-exclusive; test clip=[2,5]@10pps →
  `peaks.slice(20,50)`. CONFORMS to spec 01 interval semantics.
- **Reviewer fix (ffmpeg `-ar 44100` determinism):** `_DECODE_SAMPLE_RATE =
  44100` pinned and passed as `-ar` to ffmpeg (L62, L172); sample-count→duration
  fallback divides by the same constant → exact. PRESENT.
- **Traversal-safe key:** `_SAFE_MATERIAL_ID_RE = ^[A-Za-z0-9._\-]+$`; `../escape`
  rejected with ValueError (→400). Test `test_material_id_with_traversal_is_rejected`. CONFORMS.

## Test Output (actual)

```
# npx vitest run drawWaveform.test.ts waveformCache.test.ts
 Test Files  2 passed (2)
      Tests  23 passed (23)
   Duration  1.98s

# npm run type-check  (tsc --noEmit)
exit 0 — no errors

# python -m pytest tests/test_waveform_service.py -q
12 passed, 24 warnings in 4.13s
  (warnings = pre-existing Pydantic V2 deprecations, unrelated to this TODO)
```

Environment note: no `venv` exists at the documented path on this box; ran
pytest under system Python 3.11.7 (Anaconda) with deps importable. ffmpeg +
ffprobe present on PATH (`/d/dev-tools/ffmpeg-2025-05-15-...`), so the
ffmpeg-gated tests actually executed (not skipped) — extraction path exercised.

## Gaps / Observations

- **No hard blocker.** No spec-04 §6 requirement lacks impl+test.
- **F7 composition seam** (TimelineItem audio render) has no dedicated
  component-level render test — it is the sum of F5 (drawWaveform) + F6
  (waveformCache), both unit-tested, wired via type-checked JSX. Spec assigns
  the integration check to a manual desktop walkthrough. Low risk; noted, not
  blocking.
- **`TimelineItem.tsx` = 859 lines (>800 CLAUDE.md threshold)** — pre-existing
  growth from dev-01/dev-02; dev-04's ~36L addition is surgical. Per master-plan
  D10 the large-file split is a separately scheduled concern. Carried forward as
  a known debt item, not a todo-04 defect.
- **All shared-file edits (config/models/router/service) are additive** and
  non-overlapping with the spec-03 thumbnail additions (verified by reading the
  waveform-only regions) — clean coexistence on the branch.
