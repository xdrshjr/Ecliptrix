# Dev Summary — TODO 06 持久化与缓存治理 (persistence + cache GC)

> Agent: `google-dev-02` | Phase 3 | Spec: `specs/06-persistence-and-cache-gc.md`

## Meta

- **Role:** DEV  **Task:** todo-06  **Phase:** 3  **Verdict:** COMPLETED
- **Frontend:** `npm run type-check` — clean for all my files (the only 5
  errors are in google-dev-01's parallel TODO-05 files —
  `CompositionAdapter.ts` + `useVideoExport.localExport.test.ts` — which I do
  NOT touch). `vitest run src/components/video` → **104 files / 852 passed / 0
  failed** (was 825 baseline → +27, no regression). My 3 new test files = **23
  passed**.
- **Backend:** `pytest tests/test_derived_gc.py` → **12 passed**. Combined
  thumbnail+waveform+derived_gc+storage → **50 passed, 2 failed**; the 2 are the
  pre-existing `test_upload_file_success` / `test_sanitize_filename` drift
  failures documented in BOTH Phase-1 summaries (I never touch
  `storage_service.py`). `py_compile` clean on all 4 backend files.
- Files ≤800 lines / methods ≤50 for every NEW file
  (`derived_gc_service.py` 351, `projectHydration.ts` 251,
  `materialCacheClient.ts` 120). `useMaterialManagement.ts` was already ~1208L
  pre-edit (out-of-scope D10 debt); my delete-flow wiring added ~87L.

## Key Decisions

1. **Reuse, don't rebuild — the 03/04 service hooks already existed.**
   `thumbnail_service.delete_by_material`/`list_material_dirs` and
   `waveform_service.delete_by_material`/`list_material_files` were built in
   Phase 1 exactly to spec; spec 06 only ADDS `derived_gc_service.py` on top of
   them. No changes to the two services were needed.
2. **Method A (directory convention), NO DB migration.** Thumbnails enumerate
   via `static/video/thumbnails/{key}/`, waveforms via
   `static/audio/waveforms/{key}.json`.
3. **Two thumbnail key-spaces reconciled (the TODO-03 footgun).** Poster dirs
   are keyed by the stored-file STEM; filmstrip dirs by the frontend
   `materialId`. `delete_material(material_id, extra_keys=[...])` cascades BOTH;
   the frontend supplies the stem in `extra_keys` (derived from `storageKey`),
   and `reclaim`'s referenced set must contain BOTH key spaces (the frontend
   already includes the library ids; project refs carry materialIds; the stem
   keys are kept by the same upload row staying in the library).
4. **ORPHAN-RECLAIM SAFETY — empty/abnormal referenced set ⇒ SKIP.**
   `reclaim(referenced)` returns `{dirs:0,files:0,bytes:0,skipped:true}` and
   deletes NOTHING when `referenced` is not a non-empty `set`. "When unsure,
   keep." A `dry_run` mode logs intended deletions without touching disk.
5. **Startup pass is DRY-RUN diagnostic only.** The backend alone cannot
   enumerate the *complete* referenced set (local project refs live
   client-side), so the `main.py` startup hook schedules a rate-limited,
   non-blocking, off-loop reclaim with `referenced_provider=set` (empty) AND
   `dry_run=True` — doubly safe, it cannot delete a file. The AUTHORITATIVE
   destructive reclaim is frontend-driven via `POST /api/storage/reclaim-orphans`
   with the full referenced set.
6. **Live-material authority on hydration (RC-B black-screen guard).**
   `projectHydration.resolveItemPreviewUrl` feeds only `{materialId, url,
   cacheUrl}` to spec-02 `resolveSequencePlaybackUrl`; the snapshot `url` is the
   resolver's LAST-RESORT candidate and is demoted below any live direct-local
   URL. Test pins that a stale `https://cdn…` snapshot url does NOT override the
   live `/api/storage/files/...` URL.
7. **Stop inlining `waveformData` on export; tolerate it on import.** Export no
   longer writes the large peaks array (re-resolved by materialId per spec 04);
   import still READS a legacy inline value as a first-paint fallback.
8. **INV-3 regularized once, conservatively.** Both `TimelineRepository.import`
   and `projectHydration.hydrateProject` recompute `duration = clipEnd -
   clipStart` for violating items, leave `startTime` untouched, and log. Idempotent.
9. **DELETE uses query params (not a body).** The shared `http.del` drops the
   request body, so `source_path` + repeatable `extra_keys` are query params on
   `DELETE /storage/material/{id}`; the BFF passthrough forwards query strings
   for all methods.
10. **Shared cache singletons so eviction hits what the renderer reads.**
    Exported a `filmstripCache` singleton (mirroring `waveformCache`) and made
    `TimelineItem.tsx` use it; added module-level `dropVideoCacheMaterial` to
    `useVideoCache`; exposed `evictLocalMaterial` from `useLocalMaterialDownload`.

## Execution Flow (TDD)

1. (Backend, failing-first) Wrote `tests/test_derived_gc.py` (12 cases:
   reclaim only-unreferenced, empty-set safety skip, dry-run, delete cascade
   incl. extra_keys + source, missing-derived no-op, startup rate-limit) →
   built `derived_gc_service.py` → green 12/12.
2. Added `MaterialDeleteResponse`/`ReclaimOrphans*` models →
   `DELETE /storage/material/{id}` + `POST /storage/reclaim-orphans` in
   `storage_router.py` → `main.py` dry-run startup hook → `py_compile` clean.
3. (Frontend) Extended domain `TimelineItemData`/`CreateItemProps` with
   `transitionIn/Out`; updated `TimelineRepository` export (drop waveformData,
   add audioDetached/transition) + import (regularize INV-3, tolerate legacy
   peaks) → wrote `TimelineRepository.persistence.test.ts` (9 cases) → green.
4. Built `projectHydration.ts` → wrote `projectHydration.test.ts` (9 cases) →
   green.
5. Added `evict`/`drop` to the 4 caches; exported `filmstripCache` singleton;
   wired `useMaterialManagement.executeDelete` → backend cascade + 4-cache
   eviction; created `materialCacheClient.ts` + 2 BFF routes → wrote
   `deleteMaterialCacheEviction.test.ts` (7 cases) → green.
6. Resolved a PRE-EXISTING merge-conflict marker in `src/types/index.ts` (a
   stash artifact unrelated to my task; kept the `chatType` superset) to unblock
   type-check. `npm run type-check` clean for all my files; full video suite
   852/0.

## Artifacts

**Backend (new):**
- `app/services/derived_gc_service.py` — `delete_material`, `reclaim`,
  `run_startup_reclaim` (rate-limited, off-loop), filesystem size helpers.
- `tests/test_derived_gc.py` — 12 tests.

**Backend (modified, additive):**
- `app/models/storage_models.py` — `MaterialDeleteResponse`/`Deleted`,
  `ReclaimOrphansRequest`/`Report`/`Response`.
- `app/routers/storage_router.py` — `DELETE /storage/material/{material_id}`
  (query params), `POST /storage/reclaim-orphans`; imports `Query`/`List`,
  `derived_gc_service`.
- `app/main.py` — startup `asyncio.create_task` scheduling the dry-run
  diagnostic reclaim (non-blocking).

**Frontend (new):**
- `src/components/video/lib/projectHydration.ts`.
- `src/components/video/lib/api/materialCacheClient.ts`.
- `src/app/api/storage/material/[material_id]/route.ts` (BFF DELETE).
- `src/app/api/storage/reclaim-orphans/route.ts` (BFF POST).
- `src/components/video/timeline/infrastructure/__tests__/TimelineRepository.persistence.test.ts`.
- `src/components/video/lib/__tests__/projectHydration.test.ts`.
- `src/components/video/lib/__tests__/deleteMaterialCacheEviction.test.ts`.

**Frontend (modified):**
- `timeline/infrastructure/TimelineRepository.ts` — export drops waveformData +
  adds audioDetached/transitionIn/transitionOut; import regularizes INV-3 +
  reads new fields + tolerates legacy peaks.
- `timeline/domain/types.ts` — `TimelineItemData`/`CreateItemProps` +
  `transitionIn/Out`; new `SequenceTransitionData`.
- `timeline/infrastructure/LocalMediaCache.ts` — `evict(materialId)`.
- `timeline/infrastructure/VideoCacheAdapter.ts` — `drop(materialId)`.
- `lib/filmstrip/filmstripCache.ts` — `evict(materialId)` + `clear()` +
  exported `filmstripCache` singleton.
- `lib/waveform/waveformCache.ts` — `evict(materialId)` (alias of invalidate).
- `timeline/TimelineItem.tsx` — use shared `filmstripCache` singleton.
- `hooks/useLocalMaterialDownload.ts` — `evictLocalMaterial` in returned API.
- `hooks/useVideoCache.ts` — module-level `dropVideoCacheMaterial`.
- `hooks/useMaterialManagement.ts` — `executeDelete` cascades backend delete +
  4-cache eviction; source-path / poster-stem derivation helpers.
- `src/types/index.ts` — resolved a pre-existing stash merge-conflict marker.

## Interfaces Touched (CONTRACTS)

### CONSUMES (verified Y/N · method · peer)

- **spec-01 `clip/split/audioDetached`** — Y · persistence round-trip test
  asserts split-product clip intervals + `audioDetached` survive export→import ·
  peer dev (TODO-01).
- **spec-02 `transitionIn/transitionOut/opacity`** — Y · round-trip test asserts
  `transitionIn:{fade,0.5}` / `transitionOut:{dissolve,0.75}` / `opacity:0.8`
  restored · peer TODO-02 (sequence passthrough fields).
- **spec-02 `resolveSequencePlaybackUrl` (live authority RC-B)** — Y ·
  `projectHydration.test.ts` "black-screen guard" asserts a stale snapshot url
  does NOT override the live `/api/storage/files/...` URL · peer TODO-02.
- **spec-03 `thumbnail_service.delete_by_material` / `list_material_dirs`** — Y ·
  `test_derived_gc.py` delete-cascade + reclaim assert the dir is removed /
  enumerated · peer google-dev-02 (TODO-03, me, Phase 1).
- **spec-04 `waveform_service.delete_by_material` / `list_material_files`** — Y ·
  `test_derived_gc.py` asserts the JSON is removed / enumerated · peer
  google-dev-03 (TODO-04).

### PRODUCES (verified Y/N · method · peer)

- **`DELETE /api/storage/material/{material_id}?source_path=&extra_keys=`** →
  `{success, deleted:{source,thumbnails,waveform}}` — Y · service-level tests
  (`test_delete_material_cascade_*`) + `py_compile` of router; BFF route created
  · consumer = `useMaterialManagement.executeDelete` via `materialCacheClient`.
- **`POST /api/storage/reclaim-orphans`** `{referenced_material_ids[], dry_run}`
  → `{success, reclaimed:{dirs,files,bytes,skipped,dry_run}}` — Y · reclaim
  service tests + router compile; BFF route created · consumer = frontend
  (full referenced set).
- **`derived_gc_service.reclaim(referenced:set[str]) -> {dirs,files,bytes,
  skipped,dry_run}`** — Y · 7 reclaim tests incl. the empty-set safety threshold.
- **Frontend cache-eviction contract** `filmstripCache.evict` /
  `waveformCache.evict` / `LocalMediaCache.evict` / `VideoCacheAdapter.drop` —
  Y · `deleteMaterialCacheEviction.test.ts` (7 cases) asserts each removes the
  material's entries and is a safe no-op for absent keys · consumer =
  `useMaterialManagement.evictMaterialCaches`.

## Issues & Risks

- **Orphan-reclaim safety (the load-bearing design).** Guaranteed by THREE
  layers: (1) `reclaim` SKIPS on a non-`set`/empty referenced set
  (`test_reclaim_empty_referenced_set_deletes_nothing` /
  `..._none_...`); (2) the startup pass runs DRY-RUN with an empty provider so
  it can never delete even if the threshold were misread; (3) the destructive
  path is frontend-driven and only runs with the COMPLETE referenced set. A
  partial/empty frontend list ⇒ backend keeps everything.
- **What ONLY a desktop walkthrough verifies (jsdom/pytest cannot):**
  - The full save → close → REOPEN cycle restoring a live-previewable timeline
    (canvas compositor + audio cannot run in jsdom — Phase-2 already flagged
    this as a mandatory manual gate).
  - That reopened thumbnails/waveforms HIT the persisted files (no re-extract) —
    the persisted-frame pre-warm path is unit-pinned (TODO-03) but the on-disk
    hit on reopen is a desktop observation.
  - That deleting a material in the real UI makes its thumbnail/waveform files
    disappear on disk and that a restart shows no orphan growth.
- **cv2 env breakage:** `app.main` cannot be imported in this anaconda env
  (broken OpenCV binary, pre-existing — same constraint Phase-1 devs hit). The
  pytest suite imports services directly and is unaffected; `py_compile`
  confirms router/main syntax. The real backend venv has a working cv2.
- **Two key-spaces:** if a future change stops keeping the upload row in the
  library after timeline removal, the poster-stem key could be reclaimed while
  the materialId is still referenced — mitigated because reclaim only runs with
  the FULL referenced set and the stem is currently always co-resident with its
  upload row.
- **dev-01 parallel collision (informational):** `CompositionAdapter.ts` +
  `useVideoExport.localExport.test.ts` currently fail type-check in the shared
  tree — these are dev-01's in-flight TODO-05 files, disjoint from mine; I did
  not touch them.

## Context for Downstream

- **Frontend must call `reclaimOrphans(referenced)` with the COMPLETE set**
  (material library ∪ every materialId AND poster-stem referenced by any local
  project). An empty/partial list is SAFE (skip) but reclaims nothing — the
  caller owns completeness.
- **`hydrateProject(timelineData, liveMaterials)`** returns the regularized
  timeline (isPlaying:false), per-item resolved preview URLs, and
  `derivedToRegenerate` — the editor's load effect should feed that list to
  `filmstripCache.ensure` / `waveformCache.ensure` to repopulate missing
  derived resources on reopen.
- **The delete flow is fully wired end-to-end:** `executeDelete` evicts the 4
  caches AND calls the backend cascade (source + thumbnails + waveform), then
  removes local state — not just state removal as before.
