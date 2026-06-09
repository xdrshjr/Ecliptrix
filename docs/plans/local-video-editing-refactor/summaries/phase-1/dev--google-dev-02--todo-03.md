# Dev Summary — TODO 03 本地缩略图 (poster + filmstrip)

> Agent: `google-dev-02` | Phase 1 | Spec: `specs/03-local-thumbnails.md`

## Meta

- **Verdict: COMPLETED**
- Tests: backend `pytest tests/test_thumbnail_service.py` → **16 passed**;
  frontend `vitest filmstripCache.test.ts` → **14 passed**,
  `TimelineItem.filmstrip.test.tsx` → **6 passed** (+ existing
  `TimelineItem.localDownload` 11 still green). `npm run type-check` → **no
  errors in any TODO-03 file** (the only failures are dev-03's not-yet-created
  `waveformCache`/`waveformClient` modules — out of my scope).
- Files ≤800 / methods ≤50 respected for all new files. `TimelineItem.tsx` is
  827 lines AFTER the concurrent dev-01/dev-03 merges (`splitAction`,
  `onDetachAudio`) + my ~140-line filmstrip block; see Issues.

## Key Decisions

1. **Poster material key = stored file stem.** The backend upload path has no
   frontend `materialId` at write time, so the poster lands at
   `static/video/thumbnails/{fileStem}/poster.jpg` where `fileStem` is the
   UUID-prefixed unique stored filename (deterministic, collision-free). Legacy
   co-located `thumb_{stem}.jpg` is still READ as a fallback in
   `_create_file_info` (no old files deleted — spec 06 orphan reclaim owns that).
2. **Zoom-tier labels are `[A-Za-z0-9]+`-safe.** The backend frame-filename
   regex pins the tier group to `[A-Za-z0-9]+`. Fractional tiers therefore use a
   `q` prefix (`0.25→q025`, `0.5→q05`, `1→1x`, `2→2x`, `4→4x`) — NOT `0.25x`,
   which would break the path parser. This is the load-bearing contract between
   `filmstripCache.quantizeZoomTier` and `ThumbnailService._FRAME_RE`.
3. **Density formula** = `N = clamp(round(clip.duration * ZoomLevel.toPixelsPerSecond() / slotPx), 1, maxFrames)`,
   sampled at slot centers `t_i = clipStart + (i+0.5)*span/N` inside
   `[clipStart, clipEnd]` (spec §2.3; honours spec-01 clip interval).
4. **Per-material LRU at tier granularity.** Capacity eviction removes whole
   oldest zoom tiers (coherent strip, not holey) once
   `filmstrip_max_frames_per_material` is exceeded; poster never counted/evicted.
5. **Shared decode core.** `extractVideoFrameBlobAt` and the existing
   `extractVideoFrameAt` (data-URL) now share one `withSeekedFrame` helper so the
   blob/data-URL variants cannot diverge; the data-URL variant is preserved
   byte-for-byte for existing callers.
6. **Same-origin extraction only.** Filmstrip source URL comes from
   `selectPlaybackUrl(item,{purpose:'preview'})` → direct-local
   `/api/storage/files/...`, never `/api/video-proxy`.

## Execution Flow (TDD)

1. Wrote failing `tests/test_thumbnail_service.py` (path scheme, frame
   write/list, capacity LRU, `delete_by_material`, `list_material_dirs`, router
   endpoints) → added `ThumbnailConfig` filmstrip params → built
   `thumbnail_service.py` → green.
2. Added `ThumbnailFrameResponse`/`MaterialThumbnailsResponse` models +
   `POST /storage/thumbnail-frame` & `GET /storage/thumbnails/{material_id}` →
   relocated poster in `storage_service.upload_video_file` + dual-read in
   `_create_file_info` → green (incl. 3 TestClient endpoint tests).
3. Wrote failing `filmstripCache.test.ts` → added `extractVideoFrameBlobAt` →
   built `filmstripCache.ts` + `thumbnailClient.ts` → green.
4. Wrote failing `TimelineItem.filmstrip.test.tsx` (source-level, `jsx:preserve`
   blocks compile) → wired multi-frame tiling into `TimelineItem.tsx` → green.
5. `npm run type-check` clean for all TODO-03 files.

## Artifacts

Backend:
- `app/services/thumbnail_service.py` (NEW) — path scheme, `save_frame`,
  `list_material`, `delete_by_material`, `list_material_dirs`, capacity LRU.
- `app/config.py` (SHARED, additive) — `ThumbnailConfig` filmstrip params.
- `app/models/storage_models.py` (SHARED, additive) — thumbnail-frame models.
- `app/routers/storage_router.py` (SHARED, additive) — 2 endpoints + imports.
- `app/services/storage_service.py` — poster relocation + dual-read.
- `tests/test_thumbnail_service.py` (NEW).

Frontend:
- `src/components/video/utils/extractVideoThumbnail.ts` — `extractVideoFrameBlobAt`
  + shared `withSeekedFrame` core (data-URL variant preserved).
- `src/components/video/lib/filmstrip/filmstripCache.ts` (NEW).
- `src/components/video/lib/api/thumbnailClient.ts` (NEW).
- `src/components/video/timeline/TimelineItem.tsx` — filmstrip tiling render.
- `src/components/video/lib/filmstrip/__tests__/filmstripCache.test.ts` (NEW).
- `src/components/video/timeline/__tests__/TimelineItem.filmstrip.test.tsx` (NEW).

## Interfaces Touched

### REST (same-origin, session-authed)

```http
POST /api/storage/thumbnail-frame
  multipart: material_id (str), zoom_tier (str), t_ms (int), frame (jpeg blob)
  → 200 { success, url, relative_path, message }
     url = /api/storage/files/static/video/thumbnails/{material_id}/strip_{zoom_tier}_{t_ms}.jpg
  Rejects: non-image content-type, empty/>2MiB body, negative t_ms (success=false).

GET  /api/storage/thumbnails/{material_id}
  → 200 { success, poster: url|null, frames: [{ zoom_tier, t_ms, url }] }
```

### thumbnail_service hooks for spec 06

```python
thumbnail_service.delete_by_material(material_id) -> {success, removed, material_id}
    # removes the whole static/video/thumbnails/{material_id}/ dir; missing = noop, removed=0
thumbnail_service.list_material_dirs() -> List[str]
    # every material_id owning a thumbnail dir; diff vs live ids for orphan reclaim
thumbnail_service.list_material(material_id) -> {poster: url|None, frames: [...]}
thumbnail_service.poster_relative_path(material_id) -> "static/video/thumbnails/{id}/poster.jpg"
```

### Frontend cache contract

```ts
quantizeZoomTier(zoomValue: number): string          // q025|q05|1x|2x|4x ([A-Za-z0-9]+)
computeFrameTimestamps(item, zoom, {slotPx,maxFrames}): number[]   // source-seconds in [clipStart,clipEnd]
new FilmstripCache({slotPx,maxFrames,quality})
  .framesFor(item, zoom): { tMs, url|null }[]         // pure cache read
  .ensure(item, zoom): Promise<void>                  // extract+persist missing; coalesced; never throws
  .seed(materialId, tier, tMs, url): void             // pre-warm from backend listing
```

## Issues & Risks

- **`TimelineItem.tsx` = 827 lines (> 800).** It was 651 pre-edit; the 800+
  state is the SUM of three concurrent Phase-1 devs (my filmstrip +
  dev-01 `splitAction`/split UI + dev-03 `onDetachAudio`). Splitting it now would
  collide with their in-flight edits. Recommend a dedicated post-Phase-1 split
  task (extract `renderItemContent`/overlays/filmstrip into child components),
  NOT during the merge window. Flagging for reviewer.
- **Poster key vs frontend materialId.** Poster dir is keyed by stored file
  stem; filmstrip frames are keyed by the frontend `materialId`. These differ
  for the SAME material. Spec 06 GC must treat BOTH as derived dirs under
  `static/video/thumbnails/` — see Context for Downstream.
- **Two stale pre-existing storage tests** (`test_upload_file_success`,
  `test_sanitize_filename`) fail on base independent of this work — they assert
  the OLD `_sanitize_filename` behaviour (`test_txt`) while the current sanitizer
  keeps the `.txt` extension. NOT touched (out of scope, would risk collision).
- `python-multipart` was absent from the local anaconda env (needed by the
  `Form`/`File` router tests, exactly like the existing `upload_video` route).
  Installed it to verify the 3 endpoint tests; the real backend venv ships it
  (`requirements: python-multipart==0.0.6`).
- FFmpeg/ffprobe not exercised by tests (poster generation is mocked-free but
  metadata-gated); the relocation logic is covered by the dual-read path test.

## Context for Downstream (spec 06 — Persistence + Cache GC)

- All derived thumbnails live under `STORAGE_ROOT/static/video/thumbnails/{key}/`.
  Use `thumbnail_service.list_material_dirs()` to enumerate `{key}`s.
- **Two key spaces to reconcile**: (a) poster dirs keyed by stored-file STEM,
  (b) filmstrip dirs keyed by frontend `materialId`. Orphan reclaim should keep a
  dir if EITHER (i) a live cached_material/upload maps to that stem, or
  (ii) a live material id equals that key. To delete-联动 a material, call
  `thumbnail_service.delete_by_material(materialId)` AND, for the poster,
  `delete_by_material(fileStem)` (or generalise to delete by the storageKey stem).
- `delete_by_material` returns `removed` count for the GC report; missing dir is a
  safe no-op. All operations are synchronous filesystem ops — safe to call from a
  startup GC pass without the request loop.
- Project JSON need NOT store frame URLs: clip keeps `materialId`; poster +
  filmstrip re-resolve by key. Narrow-clip single `thumbnailUrl` snapshot is a
  valid bootstrap fallback.

## Shared-file edits (for dev-03 merge cleanliness)

Already co-exist with dev-03's waveform additions (verified after their merge
landed):
- `config.py`: appended `filmstrip_*` fields to existing `ThumbnailConfig` only.
- `storage_models.py`: appended `ThumbnailFrameResponse`, `ThumbnailFrameItem`,
  `MaterialThumbnailsResponse` (waveform models sit in a separate block below).
- `storage_router.py`: added thumbnail imports + 2 endpoints at end of file;
  waveform imports/endpoints untouched and present.
- `storage_service.py`: poster relocation is thumbnail-only; no waveform overlap.

## Fix Pass — wire persisted-frame pre-warm (reload "不重抽") + move type-compat test

> Agent: `google-dev-02` (returning) | Addresses tester gap #1 (MEDIUM) + the
> spec-01 §6 #6 minor coverage gap. TDD: failing test first, then wiring.

### What was unwired (RCA confirmed)

The persisted-frame pre-warm path (`listMaterialThumbnails` + `FilmstripCache.seed`)
was implemented and unit-tested but **never called from the editor**, so a
project/material reload re-extracted and re-POSTed every visible frame instead of
reusing the already-persisted ones — violating spec 03 §6's manual criterion
"重载项目后 filmstrip 仍在（持久化命中，**不重抽**)".

### What was wired (and where)

- **`src/components/video/lib/filmstrip/filmstripCache.ts`** (the chosen wiring
  point — NOT `TimelineItem.tsx`):
  - Added `FilmstripCache.prewarm(materialId, signal?)`: calls
    `listMaterialThumbnails(materialId)` once and `seed`s every returned frame
    into the URL cache. Deduped via a `prewarmed: Map<materialId, Promise>` — one
    backend listing per materialId per session (repeated calls await the first).
    Degrades silently (never throws) on a failed/empty listing → falls back to
    extraction exactly as before.
  - `ensure()` now awaits `prewarm(materialId)` **before** `extractMissing(...)`,
    so persisted frames are reused and the extract/persist loop skips them
    (the existing per-frame `urls.has(...)` guard does the reuse; pre-warm just
    populates `urls` first).
  - Imported `listMaterialThumbnails` alongside `persistThumbnailFrame`.

- **`TimelineItem.tsx`: ZERO changes.** The editor already calls
  `filmstripCache.ensure(filmstripItem, zoom)` once per video item in a throttled
  effect; routing pre-warm through `ensure()` means the reload path is fixed
  without touching the 859-line component (honouring the "do not inflate"
  constraint). The single shared `filmstripCache` instance owns the per-session
  dedupe.

**Why this wiring point:** lowest-risk and cleanest. The cache is the framework-
agnostic owner of extract/persist orchestration and already holds the session
lifetime (one process-wide instance). Doing the dedupe + listing there keeps it
testable without React, avoids a second mount/effect in an over-threshold file,
and guarantees pre-warm runs exactly once per material regardless of how many
TimelineItems reference it.

### New tests

- **`filmstripCache.test.ts`** (+4, failing-first then green):
  - `seeds the cache from the backend listing so framesFor resolves with NO extraction` —
    backend lists persisted frames for the clip's slots → after `prewarm`,
    `framesFor` returns all URLs and a subsequent `ensure` calls
    `extractVideoFrameBlobAt` / `persistThumbnailFrame` **zero** times (the
    "不重抽" contract).
  - `only queries the backend once per materialId per session` — three
    `prewarm` calls → `listMaterialThumbnails` called once.
  - `degrades silently when the listing fails — extraction still proceeds` —
    rejected listing → `prewarm` resolves, then `ensure` extracts all 6 frames.
  - `ensure() auto-prewarms once before extracting, reusing persisted frames` —
    proves the editor's single `ensure()` call hits the pre-warm path with no
    re-extraction (mirrors the real wiring).
  - Extended the `thumbnailClient` vi.mock to also export `listMaterialThumbnails`.

- **`moveItem.typeCompat.test.ts`** (NEW, +2; spec-01 §6 #6, test-only):
  - `rejects moving a video item onto a subtitle track` and
    `... onto an audio track` — `TimelineAggregate.moveItem(itemId, t, targetTrackId)`
    cross-track move throws `/cannot accept material of type "video"/` via the
    existing `Track.canAcceptMaterial` guard (target track's `addItem`), and the
    target track stays empty. Matches `swapItems.test.ts` style
    (`buildTimeline`/`item` helpers). NO production code changed.
    Note: the existing aggregate `moveItem` is non-atomic (it removes from source
    before the target `addItem` throws), so the test asserts only the documented
    contract — rejection + the incompatible item never lands on the target.

### Test output (actual)

```
$ npm run type-check                 (tsc --noEmit)
 (clean — no diagnostics)

$ npx vitest run src/components/video/lib/filmstrip src/components/video/timeline
 Test Files  27 passed (27)
      Tests  209 passed (209)        # was 26 / 203 baseline → +1 file, +6 tests

$ npx vitest run src/components/video       (regression guard)
 Test Files  93 passed (93)
      Tests  739 passed (739)        # 733 prior + 6 new, no regressions
```

### Contract verification — "不重抽" now satisfied

The reload-no-reextract requirement is now met. On project/material load the
editor's existing `ensure()` triggers a one-shot `prewarm(materialId)` that lists
the backend's persisted `static/video/thumbnails/{materialId}/strip_*` frames and
seeds them into the URL cache; `extractMissing` then finds every slot already
cached and performs **no** canvas decode and **no** `POST /storage/thumbnail-frame`.
Persisted frames are reused, not re-cut — directly proven by the
`ensure() auto-prewarms ... reusing persisted frames` test asserting both
`extractVideoFrameBlobAt` and `persistThumbnailFrame` are called zero times.
On a cold material (no persisted frames) or a failed listing, pre-warm degrades
silently and extraction proceeds exactly as before.
