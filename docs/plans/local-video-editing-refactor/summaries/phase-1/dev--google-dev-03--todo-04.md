# Dev Summary — TODO 04 本地音频波形 (google-dev-03)

> Phase 1 · parallel_group A · depends_on: [] · blocks: [06]
> Meta Verdict: **COMPLETED**

## Key Decisions

- **Peaks extraction = ffmpeg → mono s16le PCM → abs-peak downsample.** Decode
  with `ffmpeg -ac 1 -f s16le -acodec pcm_s16le -` to stdout, read raw int16
  samples, abs-peak downsample to `round(durationSec * peaksPerSecond)` columns,
  normalize against 16-bit full scale (32768) to `0..1`, round to 4 dp. Chosen
  over `astats`/`showwavespic` for a single deterministic, dependency-free path.
- **Two distinct schemas, never mixed (per spec/TODO).** On-disk JSON is
  **camelCase** `{version, materialId, durationSec, peaksPerSecond, peaks[]}` for
  direct frontend canvas consumption; the REST surface
  (`generate`/`get_waveform` + Pydantic models) is **snake_case**
  (`duration_sec`, `peaks_per_second`) matching project convention + spec 03.
- **Idempotent generate.** Existing `{materialId}.json` short-circuits without
  re-extraction unless `force=True`. `_extract_peaks` is the spied seam proving
  the no-op path in tests.
- **materialId is the on-disk key, frontend-authoritative.** The frontend passes
  its own `MaterialItem.id` to `POST /waveform/generate` and reads it back via
  `GET /waveform/{id}`. Upload-time trigger ① is a best-effort warm-up keyed by
  the stored-file stem; trigger ② (on-demand, idempotent) is authoritative so a
  key mismatch only loses the warm-up, never correctness.
- **Traversal-safe key.** `material_id` is validated against
  `^[A-Za-z0-9._\-]+$` and rejected (`ValueError` → 400) on separators/`..`.
- **Frontend renders from peaks only — zero audio decode.** `drawWaveform` is a
  pure canvas function; `WaveformPreview` hands persisted peaks to wavesurfer's
  `{peaks, duration}` so it skips the decode pass, falling back to live decode
  on a miss (backward compatible — legacy callers pass no `materialId`).
- **Source URL for waveform = `selectPlaybackUrl(item,{purpose:'export'})`** —
  prefers a backend-resolvable same-origin `/api/storage/files/...` reference,
  exactly what the waveform service can decode.

## Execution Flow

1. (TDD) Wrote failing `tests/test_waveform_service.py` (12 cases) →
   `drawWaveform.test.ts` (15) + `waveformCache.test.ts` (8).
2. Backend: `WaveformConfig` (config.py) → `waveform_service.py` → waveform
   models (storage_models.py) → `POST/GET` endpoints (storage_router.py) →
   upload-time enqueue (storage_service.py). Iterated one test assertion
   (ffmpeg `sine` lavfi emits ~0.125 full-scale, not full-scale) → green 12/12.
3. Frontend: `waveformClient.ts` → `waveformCache.ts` → `drawWaveform.ts` →
   `AudioWaveformCanvas.tsx` → wired into TimelineItem audio branch →
   WaveformPreview persisted-peaks-first. Green 23/23.
4. `npm run type-check` exit 0; full video-lib vitest 101/101.

## Artifacts

- **New backend:** `app/services/waveform_service.py` (482L),
  `tests/test_waveform_service.py` (12 tests, ffmpeg-gated skip).
- **New frontend:** `src/components/video/lib/waveform/{waveformClient,waveformCache,drawWaveform}.ts`,
  `.../waveform/__tests__/{drawWaveform,waveformCache}.test.ts`,
  `src/components/video/timeline/AudioWaveformCanvas.tsx`.
- **Modified (waveform-only, additive):** `config.py` (WaveformConfig +
  field + get_settings wiring), `storage_models.py` (3 waveform models),
  `storage_router.py` (2 endpoints + 4 imports), `storage_service.py`
  (`_enqueue_waveform_generation` + audio/has-audio-video hooks),
  `TimelineItem.tsx` (~36L: import + `waveformAudioUrl` memo + audio-branch
  canvas), `WaveformPreview.tsx` (optional `materialId` + peaks-first init).

## Interfaces Touched (contracts)

- `POST /api/storage/waveform/generate` — body `{material_id, audio_url, force?}`
  → `{status: 'ready'|'pending'|'failed', url?}` (idempotent, queue-bounded by
  `WaveformConfig.max_concurrent`).
- `GET /api/storage/waveform/{material_id}` →
  `{status: 'ready'|'pending'|'missing'|'failed', duration_sec?, peaks_per_second?, peaks?, url?}`.
- **On-disk peaks schema** (`STORAGE_ROOT/static/audio/waveforms/{materialId}.json`,
  served via existing `/api/storage/files` mount):
  `{version:1, materialId, durationSec, peaksPerSecond, peaks: number[] 0..1}`.
- **Spec-06 GC hooks** on `WaveformService`:
  - `list_material_files(material_id) -> List[str]` (STORAGE_ROOT-relative paths)
  - `delete_by_material(material_id) -> int` (count removed, 0/1)
- Frontend cache contract: `waveformCache.ensure(materialId, audioUrl) ->
  'idle'|'pending'|'ready'|'failed'`; `peaksFor(materialId, {clipStart, clipEnd})
  -> number[] | null` (clip-interval sliced per spec 01 semantics).

## Issues & Risks

- **TimelineItem.tsx now 859 lines (>800).** It was 650 at HEAD; growth is the
  combined dev-01 (split) + dev-02 (filmstrip) + my ~36L. Per master-plan **D10**
  the large-file split is a separate scheduled concern — flagging for the
  reviewer; my addition alone is minimal/surgical.
- **ffmpeg-gated tests.** `test_waveform_service.py` skips when ffmpeg/ffprobe
  are off PATH. Verified green locally (ffmpeg present); desktop bundles it.
- **Pre-existing unrelated failures** in `tests/test_storage_service.py`
  (`test_upload_file_success`, `test_sanitize_filename` — `_sanitize_filename`
  drift) confirmed present with my `storage_service.py` reverted → NOT caused by
  this TODO.
- **Shared-file merge (with dev-02 / TODO 03):** all my edits to `config.py`,
  `storage_models.py`, `storage_router.py`, `storage_service.py` are additive and
  non-overlapping with the thumbnail/filmstrip additions (waveform vs
  thumbnail-frame; WaveformConfig vs ThumbnailConfig.filmstrip_*). See
  Shared-File Edits below for clean-merge guidance.

## Context for Downstream (spec 06 — 持久化与缓存 GC)

- Reclaim waveforms by materialId via `waveform_service.delete_by_material(id)`;
  audit via `list_material_files(id)`. Orphan sweep can enumerate
  `STORAGE_ROOT/static/audio/waveforms/*.json` and drop those whose stem has no
  live material.
- Peaks are **not** stored in project JSON — re-resolved by materialId. A history
  project's inline `TimelineItemData.waveformData` (still present but no longer
  authoritative) may serve as first-paint fallback before persisted peaks load.
- Detached-audio items (spec 01) share the parent's `materialId`, so they reuse
  the same `{materialId}.json` — no extra file to track.

## Shared-File Edits (for clean merge with google-dev-02 / TODO 03)

All additive; no removals/renames of dev-02's symbols:

- `config.py`: added top-level `class WaveformConfig` (before `StorageConfig`),
  `waveform: WaveformConfig` field on `Settings` (after `storage`), and the
  `waveform_config = WaveformConfig(...)` build + `waveform=waveform_config`
  kwarg in `get_settings()`. Did NOT touch dev-02's `ThumbnailConfig.filmstrip_*`.
- `storage_models.py`: appended `WaveformGenerateRequest`,
  `WaveformGenerateResponse`, `WaveformDataResponse` after dev-02's
  `MaterialThumbnailsResponse`.
- `storage_router.py`: added waveform model imports + `waveform_service`,
  `queue_manager`, `_wait_for_simple_task_completion`, `settings` imports;
  appended `POST /waveform/generate` + `GET /waveform/{material_id}` after
  dev-02's thumbnail endpoints. Did NOT touch the thumbnail-frame endpoint.
- `storage_service.py`: added `_WAVEFORM_QUEUE_NAME`, `_waveform_material_id`,
  `_enqueue_waveform_generation`; audio upload now enqueues on success; video
  upload tracks `has_audio` (loop change preserves dev-02's poster-relocation
  logic) and enqueues when audio is present.
