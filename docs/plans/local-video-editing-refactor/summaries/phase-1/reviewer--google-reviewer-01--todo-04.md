# Reviewer Summary — TODO 04 本地音频波形

> Meta: Role=REVIEWER · Task=todo-04 · Phase=1 · Reviewer=google-reviewer-01
> **Verdict: PASS WITH FIXES** (1 conservative fix applied by reviewer; no rework needed)

## Scope reviewed

Spec `specs/04-local-waveform.md`, TODO `todos/04-local-waveform.md`, dev summary,
and global-context. Read all created/modified files and verified the integration
seams (queue_manager API, simple_queue_decorator, selectPlaybackUrl, http-client,
thumbnail_service coexistence, domain types).

## Verdict rationale

The implementation is correct, complete, spec-faithful, and cleanly additive on
all four shared backend files. Two distinct schemas (camelCase on-disk vs
snake_case REST) are kept rigorously separate. The traversal guard is sound on
the realistic attack surface. No stubs, no orphan TODOs, all sizes within
thresholds. One low-severity determinism nit in the ffprobe-fallback path was
fixed in place rather than bounced back.

## Checklist findings

### 1. Correctness — PASS
- ffmpeg → mono `s16le` PCM → abs-peak downsample → normalized `[0,1]` (÷32768,
  4 dp). `_downsample_peaks` uses a float stride so columns stay evenly spaced
  even when `len(samples)` is not a clean multiple of `column_count`. Correct.
- Length `≈ durationSec × peaksPerSecond` via `column_count = round(duration*pps)`.
  Verified by `test_peaks_length_proportional_to_duration` (±1 tail slack).
- On-disk JSON is camelCase `{version, materialId, durationSec, peaksPerSecond,
  peaks[]}`, compact separators, schema version 1. REST is snake_case
  (`duration_sec`/`peaks_per_second`). Mapping helpers `_build_disk_payload` /
  `_disk_to_rest` keep the two shapes from ever bleeding into each other.
- Idempotent: existing JSON short-circuits without re-extraction unless `force`.
  `_extract_peaks` is the spied seam; `test_generate_is_idempotent` /
  `test_generate_force_reextracts` prove both paths.
- QueueManager-bounded: both the on-demand `POST` (router) and the upload-time
  warm-up (storage_service) enqueue on the SAME `"waveform_generation"` queue
  created with `max_concurrent = settings.waveform.max_concurrent`, so a burst of
  imports cannot spawn unbounded ffmpeg. Queue API
  (`create_queue/enqueue_task/get_task_result/cleanup_task_data` +
  `_wait_for_simple_task_completion`) matches the real signatures.
- `drawWaveform` is pure canvas, peaks-only, zero decode — guarded by an explicit
  "never decodes audio" smoke test. `clearRect` + symmetric bars; empty peaks →
  flat-baseline placeholder (no throw); null ctx → no-op.
- `waveformCache` clip-interval slicing via `slicePeaksForClip` uses spec-01
  `[clipStart, clipEnd)` with `TIME_EPSILON = 0.001`; clamps bounds, returns `[]`
  on inverted/zero-length, whole array when bounds absent or `pps <= 0`. The
  canonical `clip=[2,5] @ 10pps → indices [20,50)` case is tested.
  `AudioWaveformCanvas` correctly pre-slices via `peaksFor` then calls
  `drawWaveform` WITHOUT clip bounds (no double-slice) — comment + code agree.
- `materialId` traversal-safe: `^[A-Za-z0-9._\-]+$` + explicit `{".",".."}`
  rejection. `/`, `\`, `%2f` all fail the regex. The ValueError propagates
  through the queue (`get_task_result` re-raises) and the router maps it to a
  real **400**, not a swallowed `failed`. Verified the full router→queue→service
  error path, not just the direct-call test.

### 2. Code quality — PASS
- Sizes: `waveform_service.py` 486L, `waveformCache.ts` 170, `drawWaveform.ts`
  168, `AudioWaveformCanvas.tsx` 102, `waveformClient.ts` 97 — all < 800; every
  method < 50 lines. `TimelineItem.tsx` is 859 (> 800) but that is the COMBINED
  dev-01(split)+dev-02(filmstrip)+dev-03(~36L waveform) growth; master-plan
  **D10** schedules large-file splits as a separate concern. The waveform
  addition alone is minimal and surgical — not a TODO-04 defect.
- PEP8 + Google docstrings throughout the service (Args/Returns/Raises present on
  every public + non-trivial private method). TS uses `interface` for public
  contracts, named exports, JSDoc. Naming is self-describing.

### 3. Security — PASS (1 minor hardening noted, not blocking)
- The realistic vector — manipulating the storage-relative portion of a
  same-origin `/api/storage/files/...` URL — IS guarded: `_resolve_source_path`
  resolves under `STORAGE_ROOT` and enforces `is_relative_to(root)`, rejecting
  `.../../etc/...`. Endpoints are auth-gated (`get_current_user`).
- Minor: the bare-absolute-path branch (`candidate.is_absolute()`) bypasses
  root-containment (used by the direct-path tests). In this local desktop app an
  authenticated user already owns the filesystem and the output is only an
  amplitude array, so the residual risk is negligible. Optional future
  hardening, not a blocker.

### 4. Integration / contract coexistence — PASS (clean)
- **config.py**: `WaveformConfig` added BEFORE `StorageConfig`; `waveform` field
  on `Settings`; `waveform_config` built + wired in `get_settings()`. dev-02's
  `ThumbnailConfig.filmstrip_*` block is fully present and untouched. No clobber.
- **storage_models.py**: dev-02's `ThumbnailFrameResponse` / `ThumbnailFrameItem`
  / `MaterialThumbnailsResponse` AND dev-03's 3 waveform models both present,
  appended, non-overlapping.
- **storage_router.py**: both `thumbnail_service` and `waveform_service`
  singletons imported and both endpoint pairs present; thumbnail-frame endpoint
  untouched by waveform additions. Coexistence confirmed.
- **storage_service.py**: the video-metadata stream loop change preserves
  dev-02's poster relocation — `width is None` guard takes the FIRST video stream
  (prior `break` behaviour) while ALSO scanning remaining streams for
  `codec_type == "audio"` to set `has_audio`. Poster path
  `static/video/thumbnails/{stem}/poster.jpg` + legacy fallback intact. Audio
  upload + has-audio video both enqueue waveform warm-up; failures are swallowed
  (warm-up must never break upload). Lazy imports keep the import graph acyclic.
- **spec-06 hooks**: `list_material_files(material_id) -> List[str]` (rel paths)
  and `delete_by_material(material_id) -> int` present, ValueError-safe, tested.

### 5. Completeness — PASS
- Every TODO-04 task is done: tests-first (12 backend + 23 frontend), config,
  service, models, both endpoints, upload enqueue, client, cache, drawWaveform,
  TimelineItem audio-branch canvas + degrade, WaveformPreview persisted-first.
- No stubs / NotImplemented / orphan TODOs in any waveform file.
- Observation (not a defect): the lone `WaveformPreview` caller
  (`SilenceRemovalTab.tsx`) does NOT pass the new optional `materialId`, so the
  persisted-peaks fast-path is dormant there and it keeps using wavesurfer live
  decode. The spec explicitly marks this optimization as optional ("可改为优先读
  持久化 peaks"), the prop is backward-compatible, and the plumbing exists for
  future wiring — so this is spec-compliant and intentional.

### 6. TODO compliance — PASS. Matches `todos/04-local-waveform.md` task-for-task.

## Fix applied by reviewer (conservative, in place)

`waveform_service.py` `_decode_mono_pcm` / `_extract_peaks`: pinned the ffmpeg
decode rate with `-ar 44100` (new `_DECODE_SAMPLE_RATE` constant) and pointed the
ffprobe-fallback duration math at the same constant. Previously the decode did
not set `-ar` (output stayed at the source rate) while the fallback divided by a
hard-coded 44100, so a non-44.1 kHz source decoded WITHOUT ffprobe would have
computed a wrong duration → wrong peaks length. Now the decode rate and the
fallback divisor are the same value, making the fallback exact and deterministic.
This only affects the rare ffprobe-missing path (desktop bundles ffprobe), and
the test fixture already produces 44100 Hz, so existing assertions hold.

## Shared-file coexistence finding

All four shared backend edits (`config.py`, `storage_models.py`,
`storage_router.py`, `storage_service.py`) are **purely additive and coexist
cleanly** with TODO-03's thumbnail/filmstrip additions — verified field-by-field
and import-by-import: WaveformConfig vs ThumbnailConfig.filmstrip_*, waveform
models appended after thumbnail models, waveform endpoints appended after
thumbnail endpoints, and the storage_service video-stream loop change PRESERVES
dev-02's poster-relocation (first-video-stream + has-audio scan). No symbol was
removed, renamed, or clobbered. Spec-06 GC hooks (`list_material_files` /
`delete_by_material`) are present and ready.
