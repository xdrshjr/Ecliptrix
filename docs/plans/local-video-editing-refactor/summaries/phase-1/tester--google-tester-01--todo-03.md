# Tester Acceptance — TODO 03 本地缩略图 (poster + filmstrip)

## Meta

- **Role:** TESTER
- **Task:** todo-03
- **Phase:** 1
- **Agent:** `google-tester-01`
- **Spec:** `docs/plans/local-video-editing-refactor/specs/03-local-thumbnails.md` (§6 acceptance)
- **Branch:** `feat/local-video-editing-refactor` (HEAD `dd9c676`; todo-03 changes are uncommitted working-tree state)
- **Verdict: ISSUES FOUND** — every spec §6 *automated* acceptance item has impl + passing test, and the reviewer-added BFF passthrough routes resolve end-to-end. The one shortfall is the spec §6 **manual-walkthrough** criterion "重载项目后 filmstrip 仍在（持久化命中，**不重抽**)": the pre-warm path (`listMaterialThumbnails` + `FilmstripCache.seed`) is implemented and unit-tested but **never wired into the editor**, so a project reload re-extracts + re-POSTs every frame instead of hitting persisted frames. Functionally correct (frames still appear; re-POST overwrites by path), but it violates the "不重抽" (no re-extraction) clause. Plus the known `TimelineItem.tsx` size-threshold breach (now 859 lines) and the binding spec-06 two-key-space hazard.

## Test Output (actual)

```
$ npx vitest run filmstripCache.test.ts TimelineItem.filmstrip.test.tsx
 Test Files  2 passed (2)
      Tests  20 passed (20)         # 14 filmstripCache + 6 TimelineItem.filmstrip
   Duration  1.74s

$ npm run type-check          (tsc --noEmit)
 (no diagnostics — clean)

$ python -m pytest tests/test_thumbnail_service.py -q
 16 passed, 36 warnings in 4.47s   # warnings = pre-existing Pydantic V1 deprecations, unrelated
```

All three command groups from spec §6 pass. (Dev summary claimed 16 / 14 / 6 + clean type-check — reproduced exactly.)

## Spec §6 Acceptance Traceability Matrix

| # | §6 acceptance item | Impl file(s) | Test(s) | Status |
|---|---|---|---|---|
| 1 | Upload video → poster lands at `static/video/thumbnails/{id}/poster.jpg`, `thumbnail_url` same-origin | `storage_service.upload_video_file` (poster relocation L630-660) + `_create_file_info` dual-read (L370-386) | `test_poster_relative_path_is_under_thumbnails_dir`, `test_poster_url_is_same_origin_storage_files` (service-level); relocation logic itself not run through real ffmpeg (mocked-free but metadata-gated) | PASS (impl + test for path scheme; ffmpeg extraction itself untested — acceptable, ffmpeg not in CI) |
| 2 | `POST /storage/thumbnail-frame` → frame at canonical path, same-origin URL, re-GET-able | `thumbnail_service.save_frame`; `storage_router.save_thumbnail_frame` (L655-735); `write_to_well_known_slot` | `test_save_frame_writes_to_canonical_path`, `test_post_thumbnail_frame_persists_and_returns_url`, `test_post_thumbnail_frame_rejects_non_image`, `test_save_frame_rejects_empty_payload` | PASS |
| 3 | `thumbnail_service` list/delete all frames by materialId (spec 06 hook) | `thumbnail_service.list_material`, `delete_by_material`, `list_material_dirs`; `GET /storage/thumbnails/{id}` (L738-767) | `test_list_material_returns_poster_and_frames`, `test_delete_by_material_removes_dir_and_counts`, `test_delete_by_material_missing_is_noop`, `test_list_material_dirs_enumerates_material_ids`, `test_list_material_dirs_empty_when_no_thumbnails`, `test_get_material_thumbnails_lists_poster_and_frames` | PASS |
| 4 | `filmstripCache`: density formula count; tier quantization hit-reuse; missing triggers extract | `filmstripCache.computeFrameTimestamps`, `quantizeZoomTier`, `FilmstripCache.framesFor/ensure` | `computeFrameTimestamps` ×5, `quantizeZoomTier` ×3, `FilmstripCache.ensure` hit-reuse + extract | PASS |
| 5 | `TimelineItem`: wide=multi-tile, narrow=single, visible-range only, fail→poster | `TimelineItem.tsx` `renderFilmstrip` (L424-456), `filmstripSlots`/`ensure` effect (L174-194) | `TimelineItem.filmstrip.test.tsx` ×6 — **SOURCE-LEVEL grep test** (reads .tsx as string, asserts substrings; no real render due to `jsx:preserve`) | PASS (weak test — see Gaps) |
| 6 | Local material extracts via same-origin `/api/storage/files`, NOT `/api/video-proxy` | `filmstripCache.ts` uses `selectPlaybackUrl(item,'preview')`; `extractVideoThumbnail.proxiedVideoUrl` only proxies cross-origin | `filmstripCache.test.ts` "extracts via same-origin ... NOT /api/video-proxy"; `TimelineItem.filmstrip.test.tsx` same-origin assertion | PASS |
| §6 manual | Reload project → filmstrip persists, **不重抽** (persistence hit, no re-extract) | pre-warm `thumbnailClient.listMaterialThumbnails` + `FilmstripCache.seed` exist | **NOT wired** — only referenced by their own unit test; no editor mount/effect calls them | **GAP** — re-extracts on reload |

### todos/03 task → artifact mapping (file-change plan §3)

| Spec §3 planned file | Action | Present? | Notes |
|---|---|---|---|
| `storage_service.py` | poster relocation + keep mid-point | YES | L630-660 relocate; L378-384 legacy `thumb_{stem}.jpg` dual-read |
| `thumbnail_service.py` | NEW — persist/path/list/delete | YES | 287 lines; `_FRAME_RE = ^strip_(?P<tier>[A-Za-z0-9]+)_(?P<tms>\d+)\.jpg$` |
| `storage_router.py` | +POST frame, +GET list | YES | 2 endpoints, session-authed, 2 MiB cap, non-image/empty/negative-t_ms rejected |
| `storage_models.py` | thumbnail-frame models | YES | `ThumbnailFrameResponse`, `ThumbnailFrameItem`, `MaterialThumbnailsResponse` |
| `config.py` | ThumbnailConfig filmstrip params | YES | `filmstrip_slot_px=80`, `_max_frames=24`, `_quality=0.7`, `_max_frames_per_material=240` |
| `tests/test_thumbnail_service.py` | NEW | YES | 16 tests (incl. 3 router TestClient tests) |
| `extractVideoThumbnail.ts` | +blob variant, shared core | YES | `extractVideoFrameBlobAt` + `withSeekedFrame` shared seek/decode; data-URL variant preserved |
| `filmstripCache.ts` | NEW | YES | 237 lines; density + tier quantize + in-memory URL cache + ensure orchestration |
| `thumbnailClient.ts` | NEW — POST frame | YES | `persistThumbnailFrame` (POST), `listMaterialThumbnails` (GET) |
| `TimelineItem.tsx` | multi-frame tiling | YES | `renderFilmstrip` tiling + throttled `ensure` effect; **859 lines (> 800 threshold)** |
| `filmstripCache.test.ts` | NEW | YES | 14 tests |
| `TimelineItem.filmstrip.test.tsx` | NEW | YES | 6 tests (source-level) |

## Targeted Verification (per tester brief items 3–5)

**Item 3 — BFF passthrough resolves end-to-end (reviewer-added routes):** CONFIRMED present and exact.
- `src/app/api/storage/thumbnail-frame/route.ts` → `createPassthroughRoute('/api/storage/thumbnail-frame')` exports `POST`.
- `src/app/api/storage/thumbnails/[material_id]/route.ts` → `createPassthroughRoute((p) => /api/storage/thumbnails/${p.material_id})` exports `GET`. Folder param `[material_id]` matches the builder key `p.material_id`.
- Client paths (`thumbnailClient.ts`): `POST /api/storage/thumbnail-frame`, `GET /api/storage/thumbnails/${encodeURIComponent(materialId)}` — match the route file paths exactly.
- Backend mount: `storage_router` prefix `/storage` + `include_router(prefix="/api")` ⇒ `/api/storage/thumbnail-frame` and `/api/storage/thumbnails/{material_id}` — match the BFF targets exactly.
- Chain: browser → BFF (forwards Authorization + x-session-token, streams multipart untouched) → FastAPI session-authed endpoint. Verified sound.
- (Note: the `Glob` tool returned "No files found" for these untracked new route files — an indexing quirk for untracked files; `find`/`Read` confirm they exist on disk.)

**Item 4 — invariants:** ALL HOLD.
- Zoom-tier labels `[A-Za-z0-9]+` only: `ZOOM_TIERS` = `q025 / q05 / 1x / 2x / 4x` — all satisfy backend `_FRAME_RE` tier group. Fractional tiers correctly use `q` prefix (NOT `0.25x`, which would break the path parser). Unit-tested against `/^[A-Za-z0-9]+$/`.
- Poster relocation keeps legacy read: `_create_file_info` checks relocated `static/video/thumbnails/{stem}/poster.jpg` first, then legacy co-located `thumb_{stem}.jpg`, then falls back to the video URL.
- Local extraction same-origin: `filmstripCache.ensure` sources from `selectPlaybackUrl(item,'preview')`; `proxiedVideoUrl` only rewrites cross-origin URLs to `/api/video-proxy`, so same-origin `/api/storage/files` passes through directly. Asserted by both frontend suites.

**Item 5 — two-key-space hazard (binding spec-06 acceptance item):** CONFIRMED and RAISED.
- Poster dir keyed by **stored-file STEM** (`Path(relative_path).stem`, set at backend upload time, no frontend materialId available).
- Filmstrip dirs keyed by frontend **materialId** (`item.materialId`).
- For the SAME material these two keys DIFFER, producing **two sibling dirs** under `static/video/thumbnails/`.
- Binding requirement for spec-06 GC: orphan reclaim must keep a dir if EITHER (i) a live upload/cached_material maps to that stem, OR (ii) a live material id equals that key; delete-联动 must call `delete_by_material(materialId)` AND `delete_by_material(fileStem)`. This is a real acceptance constraint that spec-06 MUST honour — flagged here as a downstream binding item.

## Gaps / Issues Found

1. **[MEDIUM — manual-acceptance shortfall] Pre-warm path is dead code.** `listMaterialThumbnails` (client) and `FilmstripCache.seed` (cache) are implemented and unit-tested but invoked ONLY by their own test. No editor effect calls them on project/material load. Consequence: spec §6 manual walkthrough "重载项目后 filmstrip 仍在（持久化命中，**不重抽**)" is NOT met — on reload the module-level in-memory cache is empty and every visible frame is re-decoded on the canvas and re-POSTed (overwriting the existing file by path). Frames still display (no functional regression), but the "no re-extraction" guarantee — the whole point of persisting frames across reloads — is unmet. Recommend wiring `listMaterialThumbnails(materialId)` → `cache.seed(...)` on item mount (or a material-load hook) in a follow-up.

2. **[LOW — known, dev-flagged] `TimelineItem.tsx` exceeds the 800-line CLAUDE.md threshold — now 859 lines** (dev summary reported 827; it has grown further with concurrent Phase-1 merges). Dev recommended a dedicated post-Phase-1 split (extract `renderFilmstrip`/overlays into child components). Confirm that follow-up is tracked.

3. **[LOW — test quality] `TimelineItem.filmstrip.test.tsx` is a source-grep test, not a behavioral render test.** It reads `TimelineItem.tsx` as a string and asserts substrings (`renderFilmstrip`, `.map(`, `.ensure(`, `?? item.thumbnailUrl`, absence of `video-proxy.*filmstrip`). Justified by the project's `jsx:preserve` tsconfig (esbuild won't compile the .tsx so `render()` fails at load — same pattern as the sibling `TimelineItem.localDownload` test). It guards wiring presence but NOT runtime tiling/degrade behaviour. Acceptable for this repo's constraints; noting it does not prove the multi-tile / single-tile / poster-fallback render paths execute correctly — only that the code referencing them exists.

4. **[INFO — out of scope, pre-existing] Two stale storage tests** (`test_upload_file_success`, `test_sanitize_filename`) fail on base independent of todo-03 (assert old `_sanitize_filename` behaviour). NOT touched by dev-02; NOT run in the todo-03 focused command set; not a todo-03 regression.

5. **[INFO] ffmpeg poster generation not exercised by tests.** The relocation *path scheme* is tested; the actual ffmpeg mid-point extraction is metadata-gated and not run in CI (ffmpeg may be absent). The dual-read fallback path is covered. Acceptable.

## Conclusion

Automated spec §6 acceptance (items 1–6) + the §3 file-change plan are fully implemented and green: 20 frontend tests, 16 backend tests, clean type-check. The reviewer's BFF passthrough routes are present and resolve end-to-end with exact path/param matching. Invariants (regex-safe tiers, legacy poster read, same-origin extraction) all hold. The two-key-space hazard is real and is a binding constraint on spec-06 GC.

**Verdict: ISSUES FOUND** — block-free for the automated acceptance surface, but the spec §6 manual "不重抽 on reload" criterion is unmet because the persisted-frame pre-warm (`listMaterialThumbnails`+`seed`) is unwired dead code. Recommend: (a) wire the pre-warm before declaring the manual walkthrough passed, (b) track the `TimelineItem.tsx` 859-line split, (c) hand the two-key-space contract to spec-06 as a binding GC requirement.
