# Reviewer Summary — TODO 06 持久化与缓存治理 (persistence + cache GC)

> Agent: `google-reviewer-01` (Google readability REVIEWER) | Phase 3 |
> Spec: `specs/06-persistence-and-cache-gc.md` | Reviewing: `google-dev-02`

## Meta

- **Role:** REVIEWER  **Task:** todo-06  **Phase:** 3  **Verdict:** PASS
- Verification run by reviewer (not tester output):
  - `npm run type-check` → **clean across the whole tree** (the dev-01 TODO-05
    type errors the dev summary flagged are now resolved; all TODO-06 files +
    dev-01 shared edits coexist).
  - `pytest tests/test_derived_gc.py -q` → **12 passed**.
  - `npx vitest run` on the 3 TODO-06 test files → **23 passed (3 files)**.

## Key Decisions

1. **PASS, not PASS-WITH-FIXES.** No defect found that warrants an edit; the
   one style nit (`reclaim` body ~at the 50-line soft threshold) does NOT
   justify touching a destructive code path. I changed no files.
2. **Reclaim safety is genuinely triple-layered AND the destructive path is
   currently dormant** (no frontend caller of `reclaimOrphans`), which makes
   the poster-stem footgun a documented residual risk, not a shipped bug.
3. **Coherence with dev-01 confirmed by a clean full-tree type-check** — the
   shared `src/types/index.ts` / `ports.ts` / `CompositionAdapter.ts` edits
   (dev-01's TODO-05 export work) and dev-02's persistence/GC edits compile
   together. I did not edit dev-01's files.

## Execution Flow (review)

1. Read upstream (dev summary + global-context) and all planning specs
   (06 authoritative, 01 INV-3, 02 resolver authority, 03/04 derived hooks,
   task-orchestration).
2. Backend: read `derived_gc_service.py`, `thumbnail_service.py`,
   `waveform_service.py`, `storage_router.py`, `storage_models.py`,
   `main.py` startup hook, `test_derived_gc.py`; traced every `rmtree`/`unlink`
   against the empty-set guard.
3. Reconciled the poster-stem-vs-materialId key spaces against the REAL
   Phase-1 code (`storage_service.upload_video_file` poster_key = stored-file
   stem; `thumbnail_service.save_frame` keyed by frontend materialId).
4. Frontend: read `projectHydration.ts` + `resolveSequencePlaybackUrl.ts`
   (black-screen guard), `TimelineRepository.ts` diff, `materialCacheClient.ts`,
   2 BFF routes + `backend-proxy.ts` (query-string forwarding), the 4 cache
   diffs, `useMaterialManagement.ts` delete wiring, `TimelineItem.tsx`
   singleton swap, `http-client.del`.
5. Ran type-check + backend pytest + the 3 vitest files; scanned for
   stubs/TODO/file-size.

## Artifacts (reviewed, not modified)

Backend: `derived_gc_service.py` (351L), `storage_router.py` (+DELETE/+POST),
`storage_models.py` (+5 models), `main.py` (dry-run startup hook),
`test_derived_gc.py` (12). Frontend: `projectHydration.ts` (251L, new),
`materialCacheClient.ts` (120L, new), 2 BFF routes (new),
`TimelineRepository.ts`, domain `types.ts`, 4 caches
(LocalMediaCache/VideoCacheAdapter/filmstripCache/waveformCache),
`TimelineItem.tsx`, `useMaterialManagement.ts`, `useLocalMaterialDownload.ts`,
`useVideoCache.ts`, 3 test files (23).

## Findings

### ORPHAN-RECLAIM SAFETY (CRITICAL) — VERIFIED SAFE

- **Guard precedes every destructive op.** `reclaim()`
  (`derived_gc_service.py:191`): `if not isinstance(referenced, set) or
  len(referenced) == 0:` returns the empty report BEFORE orphan-key computation
  (199) or any `delete_by_material` call. The only `os`-level destructive ops
  are `thumbnail_service.delete_by_material → shutil.rmtree` (thumbnail_service
  :273) and `waveform_service.delete_by_material → unlink` (waveform_service
  :407); both are reached ONLY after the guard passes.
- **Startup pass is doubly safe.** `main.py:176` calls
  `run_startup_reclaim(referenced_provider=set, dry_run=True)` — `set` called
  with no args yields an EMPTY set (→ guard skips) AND `dry_run=True` (→ no
  unlink even if the guard were misread). Verified the only two reclaim callers
  are this startup hook and the POST endpoint.
- **Destructive path is COMPLETE-set-only and currently DORMANT.** The POST
  `/storage/reclaim-orphans` endpoint passes the full referenced set + the
  reclaim guard. `reclaimOrphans()` exists in `materialCacheClient.ts:102` but
  has **no frontend caller** — so no live code path runs a destructive reclaim
  with a partial set today. Tests pin empty-set, None-set, and dry-run safety
  (`test_reclaim_empty/none/dry_run`).

### POSTER-STEM vs materialId KEY (dev's flagged footgun) — HANDLED (cascade) / RESIDUAL (reclaim)

- **Confirmed the two key spaces are REAL:** poster lands at
  `static/video/thumbnails/{STEM}/poster.jpg` (`storage_service.py:637`
  `poster_key = Path(relative_path).stem`); filmstrip frames at
  `.../{materialId}/strip_*.jpg` (`thumbnail_service.save_frame`). The dev
  summary's "poster keyed by stem" is accurate; spec-03 §2.2's "keyed by
  materialId" is the *aspiration* the current upload code does not yet meet.
- **Delete cascade handles BOTH** via `extra_keys`: `delete_material` builds
  `keys = [material_id, *extra_keys]` and deletes each dir
  (`derived_gc_service.py:130-137`). The frontend supplies the stem in
  `extraThumbnailKeysForDelete` (`useMaterialManagement.ts`), deriving it from
  the source-path basename minus extension, guarded so it is only added when
  `stem !== material.id`. Test `test_delete_material_also_cleans_extra_keys`
  pins both dirs removed (thumbnails == 4).
- **Reclaim residual risk (documented, not a shipped bug):** `reclaim`
  enumerates ALL dir names (`list_material_dirs`) — both materialId-keyed and
  stem-keyed. If a future caller passes a materialId-ONLY referenced set, a
  referenced poster-stem dir would be mis-classified as an orphan and deleted.
  This cannot fire today (no destructive reclaim caller) and the dev correctly
  documented it in the summary's Issues & Risks ("the stem keys are kept by the
  same upload row staying in the library"; "mitigated because reclaim only runs
  with the FULL referenced set"). See ISSUES #1.

### PERSISTENCE / HYDRATION — VERIFIED

- **Round-trip restores** split products (exact clip intervals), trim ranges,
  `audioDetached`, `transitionIn/Out`, `opacity`, track order (z); selection +
  history NOT persisted (`isPlaying:false`, `isSelected:false`). Export STOPS
  inlining `waveformData`; import TOLERATES legacy inline peaks; new+old mixed
  round-trips without error. Pinned by the 9-case
  `TimelineRepository.persistence.test.ts`.
- **INV-3 regularized conservatively:** `regularizeClipInvariant`
  (`TimelineRepository.ts`) and `regularizeItem` (`projectHydration.ts`)
  recompute `duration = clipEnd - clipStart`, leave `startTime` untouched, log,
  and are idempotent / no-op when self-consistent or clip interval absent.
- **Hydration live authority (black-screen guard):**
  `resolveItemPreviewUrl` feeds `{materialId, url, cacheUrl}` to spec-02
  `resolveSequencePlaybackUrl` with `liveMaterials` as authority. Verified in
  `resolveSequencePlaybackUrl.ts`: when a live material is found, `seq.url` is
  used ONLY as a last resort (no usable material URL / material pruned); the
  snapshot never overrides a live direct-local URL. Pinned by
  `projectHydration.test.ts` "black-screen guard" (stale `cdn.example.com` url
  does not win over `/api/storage/files/...`).

### DELETE CASCADE WIRED END-TO-END — VERIFIED

- `executeDelete` (`useMaterialManagement.ts`) now calls, per id, BEFORE state
  removal: `evictMaterialCaches(id)` (all 4 caches) + `cascadeDeleteMaterial(id)`
  (backend DELETE) — NOT just `setMaterials(filter)` as in the Phase-1 footgun.
- 4-cache eviction is real and hits the keys the renderer reads:
  `filmstripCache.evict` + `waveformCache.evict` (now SHARED singletons;
  `TimelineItem.tsx` switched from a module-private `new FilmstripCache()` to
  the exported `filmstripCache` singleton — this is the fix that closes the
  "eviction misses what the renderer reads" footgun), `dropVideoCacheMaterial`
  (→ `VideoCacheAdapter.drop` = alias of existing `evict`),
  `evictLocalMaterialRef` (→ `LocalMediaCache.evict`). All four contracts pinned
  by `deleteMaterialCacheEviction.test.ts` (7 cases, incl. safe no-ops).
- Backend DELETE reuses `thumbnail_service`/`waveform_service.delete_by_material`
  (does NOT reimplement) and `storage_service.delete_file` for the source.
- BFF: `createPassthroughRoute` forwards the query string for ALL methods
  (`backend-proxy.ts:213-216`), so `?source_path=&extra_keys=` reach FastAPI;
  `http.del` sends no body and keeps the query on the path (matches dev #9).

### NO DB MIGRATION — VERIFIED

`storage_models.py` additions are request/response Pydantic models only;
method-A directory convention used throughout. No alembic change needed.

### EXTRA-FILE TOUCHES — LEGIT (no scope creep)

- `TimelineItem.tsx` / `useLocalMaterialDownload.ts` / `useVideoCache.ts` are
  all cache-eviction wiring (singleton swap, `evictLocalMaterial`,
  module-level `dropVideoCacheMaterial`). Justified.
- `ports.ts` / `CompositionAdapter.ts` / `useVideoExport.ts` in the working
  tree are **dev-01's TODO-05** export work (z-order/opacity/`transition_*` in
  `VideoCompositionRequest`, export-reference selection refactor) — NOT
  dev-02's. I did not review them as TODO-06 and did not edit them.

## CONTRACT VERIFICATION (confirmed)

- **`DELETE /api/storage/material/{id}?source_path=&extra_keys=`** →
  `{success, deleted:{source,thumbnails,waveform}}` — router
  `storage_router.py:912`, service `derived_gc_service.delete_material:99`, BFF
  `src/app/api/storage/material/[material_id]/route.ts`, client
  `materialCacheClient.deleteMaterialDerived`, caller
  `useMaterialManagement.cascadeDeleteMaterial`. Tests:
  `test_delete_material_cascade_*` (4). ✅
- **`POST /api/storage/reclaim-orphans`** `{referenced_material_ids[],dry_run}` →
  `{success, reclaimed:{dirs,files,bytes,skipped,dry_run}}` — router
  `storage_router.py:962`, service `reclaim:165`, BFF
  `reclaim-orphans/route.ts`, client `reclaimOrphans` (no UI caller yet —
  dormant). Empty-set safety pinned. ✅
- **4-cache eviction** `filmstripCache.evict` / `waveformCache.evict` /
  `LocalMediaCache.evict` / `VideoCacheAdapter.drop` — all present, aliased
  correctly, pinned by `deleteMaterialCacheEviction.test.ts`. ✅
- **Derived hooks reused** `thumbnail_service.delete_by_material/
  list_material_dirs`, `waveform_service.delete_by_material/list_material_files`
  — consumed by `derived_gc_service`, not reimplemented. ✅

## Issues & Risks

1. **[MINOR / DOCUMENTED] Reclaim mis-deletes poster-stem dirs IF a future
   caller passes a materialId-only referenced set.** `derived_gc_service.py`
   `reclaim` enumerates both key spaces but the safety only protects the
   empty-set case, not the partial-set case. Not a shipped bug (no destructive
   caller exists; dev documented it). **Fix when wiring the real reclaim:** the
   frontend `reclaimOrphans(referenced)` MUST include BOTH every materialId AND
   every poster STEM referenced by the library/projects — OR (more robust)
   `reclaim` should be taught to treat any dir containing only `poster.jpg`
   whose stem maps to a referenced upload row as referenced. Recommend the
   downstream UI-wiring task own this. (file: `derived_gc_service.py:244-251`)

2. **[NIT] `reclaim()` body is at/slightly over the 50-line soft threshold**
   (two structurally-parallel delete loops). Cohesive single responsibility;
   could extract a `_reclaim_one_kind(...)` helper. Not blocking.
   (file: `derived_gc_service.py:165-242`)

3. **[NIT] DELETE endpoint docstring drift:** the router/BFF docstrings say the
   "optional JSON body may carry extra_keys", but the implementation correctly
   uses query params (dev #9). Cosmetic doc-only mismatch. (file:
   `storage_router.py:907-910`, `material/[material_id]/route.ts:4-5`)

4. **[INFO] Cross-machine stem match assumption:** the cascade's poster-stem
   derivation assumes the frontend `storageKey` basename == backend upload
   `relative_path` stem. True for same-machine local uploads (the only
   supported case this phase); cross-machine project copies degrade to
   "stem dir orphaned" — acceptable per spec 06 §7 single-machine scope.

## Context for Downstream

- **Tester:** focus the manual desktop gate on (a) save→close→REOPEN restoring a
  live-previewable timeline (jsdom cannot run canvas/audio), (b) reopened
  thumbnails/waveforms HITTING persisted files (no re-extract), (c) deleting a
  material making its on-disk thumbnail/waveform files disappear and no orphan
  growth on restart. The wiring is unit-pinned; pixels/sound/on-disk are
  desktop-only observations.
- **Whoever wires the real `reclaimOrphans` trigger:** address ISSUE #1 — the
  referenced set MUST include poster stems, or reclaim stays dry-run-only.
- The destructive reclaim is intentionally dormant; the startup pass is
  dry-run + empty-provider and only LOGS.
