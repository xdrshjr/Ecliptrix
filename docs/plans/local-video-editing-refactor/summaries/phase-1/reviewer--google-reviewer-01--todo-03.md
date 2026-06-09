# Reviewer Summary — TODO 03 本地缩略图 (poster + filmstrip)

> Meta: Role=REVIEWER | Task=todo-03 | Phase=1 | Reviewer=`google-reviewer-01`
> | Dev=`google-dev-02` | Spec=`specs/03-local-thumbnails.md`
> **Verdict: PASS WITH FIXES** (one integration gap fixed by reviewer; two
> issues flagged for follow-up — neither blocks TODO-03 runtime).

## Scope reviewed

Backend `thumbnail_service.py` (+test), `storage_service.py` poster relocation +
dual-read, `storage_router.py` 2 endpoints, `storage_models.py`, `config.py`
`ThumbnailConfig`. Frontend `extractVideoThumbnail.ts`, `filmstripCache.ts`
(+test), `thumbnailClient.ts`, `TimelineItem.tsx` filmstrip tiling
(+`TimelineItem.filmstrip.test.tsx`). Tests NOT executed (per protocol);
correctness verified by reading.

## What was done well

- **Path scheme + round-trip integrity is airtight.** `frame_relative_path`
  produces `static/video/thumbnails/{id}/strip_{tier}_{tMs}.jpg`; I traced it
  through `write_to_well_known_slot` → `_sanitize_filename`. `strip_1x_1500.jpg`
  has no unsafe chars, `.jpg` is not in `_DANGEROUS_EXTENSIONS`, the stem is not
  a reserved name → the sanitizer returns it byte-for-byte, so the persisted
  `file_path` re-matches `_FRAME_RE` on `list_material`/eviction. No silent
  divergence.
- **Tier-label ↔ backend-regex contract is correct and tested.**
  `quantizeZoomTier` emits only `[A-Za-z0-9]+` labels (`q025|q05|1x|2x|4x`),
  matching `_FRAME_RE`'s `(?P<tier>[A-Za-z0-9]+)`. `filmstripCache.test.ts`
  pins this with an explicit `/^[A-Za-z0-9]+$/` assertion across fractional
  zooms — exactly the load-bearing contract the dev called out.
- **Density formula matches spec §2.3 verbatim** —
  `N = clamp(round(span * zoom.toPixelsPerSecond() / slotPx), 1, maxFrames)`,
  sampled at slot centers inside `[clipStart, clipEnd]`. Verified
  `ZoomLevel.toPixelsPerSecond() = value * 50`. Tests cover N, both clamp
  bounds, in-range placement, and zoom-driven density growth.
- **Same-origin extraction enforced** — `filmstripItem.url` comes from
  `selectPlaybackUrl(item,{purpose:'preview'})` (direct-local
  `/api/storage/files`), and `proxiedVideoUrl` only rewrites cross-origin, so
  local materials never touch `/api/video-proxy`. Asserted in both the cache
  test and the source-level TimelineItem test (spec §6.6).
- **Shared decode core is genuinely DRY** — `extractVideoFrameAt` (data-URL,
  preserved at quality 0.92 for existing callers) and `extractVideoFrameBlobAt`
  (blob, 0.7) share `withSeekedFrame` with one seek-timeout + clamp +
  finish-once guard. Cannot diverge.
- **Security**: dual-layer traversal defence (`_safe_segment` collapse +
  `_validate_path` root jail, with a traversal test); both endpoints
  session-authed; upload validates content-type/size(≤2MiB)/t_ms≥0/non-empty.
- **spec-06 hooks present and clean**: `delete_by_material` (returns `removed`
  count, missing=no-op), `list_material_dirs`, `list_material`,
  `poster_relative_path` — all synchronous filesystem ops, all tested.
- **Poster relocation + legacy dual-read correct**: writes to
  `thumbnails/{stem}/poster.jpg`, returns same-origin URL; `_create_file_info`
  prefers the relocated poster → legacy `thumb_{stem}.jpg` → video URL.

## Integration / contract findings (checklist item 4)

- **Shared files are ADDITIVE and coexist with TODO-04 (waveform).** Verified:
  `config.py` appended `filmstrip_*` to the existing `ThumbnailConfig` (waveform
  has its own `WaveformConfig`); `storage_models.py` has the 3 thumbnail models
  in one block and the 3 waveform models in a separate block below — no clobber;
  `storage_router.py` imports/mounts BOTH thumbnail and waveform endpoints with
  a comment fence between them. No regressions to either set.

- **[FIXED by reviewer] Missing Next.js BFF passthrough routes — was a hard
  end-to-end break.** This codebase has NO catch-all proxy and NO rewrites
  (`next.config.js` confirmed): every backend endpoint needs an explicit
  `createPassthroughRoute` file under `src/app/api/`. `thumbnailClient` calls
  `/api/storage/thumbnail-frame` and `/api/storage/thumbnails/{id}`, but neither
  route file existed, so every persist/list call would 404 at the Next layer and
  never reach FastAPI — filmstrip frames would extract but never persist or
  pre-warm. The spec's §3 file-change table did not list BFF routes and the dev
  summary did not mention them (the sibling TODO-04 waveform endpoints are
  missing their BFF routes too — that is out of my scope to fix, flagged below).
  I added, matching the established pattern exactly:
  - `src/app/api/storage/thumbnail-frame/route.ts` (POST passthrough)
  - `src/app/api/storage/thumbnails/[material_id]/route.ts` (GET, dynamic param)

- **[FLAG — Important, spec-06 hazard, NOT a TODO-03 bug] Two key spaces.**
  Confirmed real: the poster dir is keyed by the backend **stored-file stem**
  (`Path(relative_path).stem`, assigned at upload before any frontend
  materialId exists), while filmstrip dirs are keyed by the frontend
  **materialId**. For the same material these are different values, so:
  - Runtime impact on TODO-03 = **none**: the poster reaches the editor via the
    material lookup's `thumbnail_url` (independent of the materialId listing),
    and `TimelineItem` uses `item.thumbnailUrl` as the per-slot fallback. Poster
    rendering and filmstrip rendering both work.
  - `GET /storage/thumbnails/{materialId}` returns `poster: null` because the
    poster physically lives in the stem-keyed dir — acceptable, the listing is
    a filmstrip pre-warm aid, not the poster's delivery channel.
  - **The real hazard is spec-06 GC**: a naive `list_material_dirs()` diff
    against live material IDs alone would classify EVERY stem-keyed poster dir
    as an orphan and delete all posters. spec-06 MUST reconcile BOTH key spaces
    (stem→live upload/cached_material, materialId→live material) and, on delete-
    联动, call `delete_by_material(materialId)` AND `delete_by_material(fileStem)`.
    The dev documented this precisely in "Context for Downstream"; I am
    re-raising it as a binding spec-06 acceptance item, not a TODO-03 defect.
    Cleaner long-term fix (out of TODO-03 scope): unify the poster key to the
    frontend materialId once spec 01's material binding is authoritative at
    upload time.

## Code-quality / completeness findings

- **[FLAG — Important] `TimelineItem.tsx` = 859 lines (> 800 threshold).**
  (Dev summary said 827; it is 859 now after further Phase-1 merges.) This is the
  SUM of three concurrent Phase-1 devs (filmstrip + dev-01 split + dev-03
  detach-audio), not TODO-03 alone — the filmstrip block itself is cleanly
  extracted into `renderFilmstrip`/memoized hooks. Splitting now would collide
  with in-flight merges. Agree with the dev: schedule a dedicated post-Phase-1
  split task (extract `renderItemContent`/overlays/filmstrip into children). Not
  fixed during the merge window. `storage_service.py` (936) /
  `storage_router.py` (880) also exceed 800 but were already large pre-TODO-03;
  this work's edits to them are small + additive. All NEW files are well under
  threshold (thumbnail_service 287, filmstripCache 237, thumbnailClient 83).
- **Completeness**: no stubs. Every spec §3 file delivered; both spec-06 hooks
  present; tests are real (filmstripCache.test.ts is behavioral; the
  TimelineItem test is source-level text-assertion, matching the project's
  documented `jsx:preserve` constraint and the sibling localDownload pattern —
  acceptable, with behavioral coverage living in the cache test).
- **Minor (no action)**: `_enforce_capacity`'s `m.group("tier") if m else
  "unknown"` branch is dead code (the list is pre-filtered by `_FRAME_RE`),
  harmless. `setFilmstripVersion` increments even when no new frame resolved,
  causing a benign re-render of a pure cache read.

## Fixes applied by reviewer

1. Created `src/app/api/storage/thumbnail-frame/route.ts` — POST passthrough.
2. Created `src/app/api/storage/thumbnails/[material_id]/route.ts` — GET
   passthrough with dynamic `material_id` param.

## Follow-ups handed off (not fixed here)

1. **spec-06**: reconcile the two thumbnail key spaces in GC + orphan reclaim
   (binding acceptance item; see above).
2. **post-Phase-1**: split `TimelineItem.tsx` back under 800 lines.
3. **out-of-scope note**: TODO-04 waveform endpoints (`/storage/waveform/*`)
   appear to lack their own BFF passthrough routes too — flag to that reviewer.
