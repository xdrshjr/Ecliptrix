# Tester Summary — TODO 06 持久化与缓存治理 (persistence + cache GC)

> Agent: `google-tester-01` (Google SET / TESTER) | Phase 3 |
> Spec: `specs/06-persistence-and-cache-gc.md` | Acceptance-testing: `google-dev-02`
> Reviewer verdict consumed: `google-reviewer-01` = **PASS** (judged independently)

## Meta

- **Role:** TESTER  **Task:** todo-06  **Phase:** 3  **Verdict:** ALL PASS
- Independent acceptance test of the persistence + cache-GC delivery. The
  destructive surface (orphan reclaim, material delete cascade) was probed
  hardest via a real MUTATION PROOF of the empty-set safety guard. No issue the
  reviewer missed; one pre-existing file-size debt + two NITs confirmed (all
  already documented by dev/reviewer). I added one integration boundary test to
  the TODO-06-owned backend test file (additive only).

## Key Decisions

1. **PASS upheld independently.** Every spec-06 §6 acceptance case (1–9, minus
   the desktop-only manual gate) is implemented, test-covered, and green. The
   reclaim safety threshold — the load-bearing invariant — is genuinely sound,
   proven by mutation, not just asserted.
2. **No false bugs raised.** The poster-stem reclaim residual (reviewer ISSUE #1)
   is genuinely UNREACHABLE today: `reclaimOrphans` has NO production caller in
   `src/` (confirmed by full-tree grep). Classifying it as a shipped bug would be
   a false positive; it is a correctly-documented residual risk.
3. **Touched ONLY the TODO-06 backend test file** (`tests/test_derived_gc.py`),
   never source, to respect the concurrent TODO-05 tester. The mutation probe was
   applied to source then byte-restored (verified: no residue, guard intact).

## Execution Flow

1. Read upstream (dev + reviewer Meta verdict + global-context) and all planning
   specs (06 authoritative §6 cases + §7 risks; 01 INV-3; 02 resolver authority;
   03/04 derived hooks; task-orchestration).
2. Read all TODO-06 code (backend `derived_gc_service` / `thumbnail_service` /
   `waveform_service` delete+list / `storage_router` DELETE+POST / `storage_models`
   / `main.py` startup hook; frontend `TimelineRepository` / `projectHydration` /
   `resolveSequencePlaybackUrl` / `materialCacheClient` / 2 BFF routes /
   4 caches / `useMaterialManagement` delete wiring / `TimelineItem` singleton).
3. **Ran all required test commands** (exact counts below).
4. **Reclaim-safety MUTATION PROOF**: weakened the guard to allow empty set
   through → 2 safety tests FAILED catching a mass-delete (`Thumbnail dir
   deleted` logged for a material that must be kept) → restored → 12 green.
5. Independent probes: poster-stem cascade (both key spaces), delete-flow wiring
   (4 caches + backend BEFORE state removal), persistence round-trip, hydration
   black-screen guard, BFF query-string forwarding, path-traversal safety.
6. Added one integration boundary test (complete-reference-set keeps both key
   spaces, reclaims only the true orphan) → 13 green.
7. Wrote this summary.

## TESTS RUN (exact counts)

- **Backend** `python -m pytest tests/test_derived_gc.py -q` → **12 passed**
  (then **13 passed** after my added boundary test).
- **Frontend (3 TODO-06 files)** `npx vitest run TimelineRepository.persistence
  + projectHydration + deleteMaterialCacheEviction` → **3 files / 23 passed**.
- **`npm run type-check`** → **clean across the whole tree** (0 errors).
- **Full `npx vitest run src/components/video`** → **104 files / 852 passed /
  0 failed** (matches the claimed baseline exactly; no regression).

## Reclaim-safety MUTATION-PROOF result — PASS (CRITICAL)

- Mutation applied: changed `if not isinstance(referenced, set) or
  len(referenced) == 0:` → `if not isinstance(referenced, set):` (let an empty
  set bypass the guard).
- Result: **2 tests FAILED** as required —
  `test_reclaim_empty_referenced_set_deletes_nothing` (direct empty-set) and
  `test_startup_reclaim_skips_when_provider_empty` (startup empty provider).
  Log showed an actual `Thumbnail dir deleted` for material "a" that the safety
  threshold must keep → the guard genuinely prevents a mass-delete, and the
  tests genuinely catch its removal.
- Restored source to byte-identical (`len(referenced) == 0` present, no
  MUTATION-PROBE residue) → 12/12 green.
- Confirmed: empty set → 0 deletes (`skipped:true`); `None` → 0 deletes
  (`skipped:true`); a complete referenced set → deletes ONLY unreferenced
  dirs/files, keeps referenced (existing tests + my added boundary test).
- Startup pass CANNOT delete: `main.py:176` calls `run_startup_reclaim(
  referenced_provider=set, dry_run=True)` — `set()` yields an EMPTY set (guard
  skips) AND `dry_run=True` (no unlink even if the guard were misread). Doubly
  safe. Only two reclaim callers exist (startup hook + POST endpoint).

## Poster-stem cascade finding — HANDLED (cascade) / RESIDUAL UNREACHABLE (reclaim)

- Verified the two key spaces are REAL: poster lands at
  `static/video/thumbnails/{STEM}/poster.jpg` (`storage_service.py:637`
  `poster_key = Path(relative_path).stem`); filmstrip frames keyed by frontend
  `materialId` (`thumbnail_service.save_frame`).
- DELETE cascade removes BOTH: `delete_material` builds `keys=[material_id,
  *extra_keys]` and deletes each thumbnail dir, plus `waveforms/{materialId}.json`
  (waveform keyed by materialId only). Frontend supplies the stem via
  `extraThumbnailKeysForDelete` (basename-minus-extension, only when
  `stem !== material.id`) — matches Python `Path(...).stem`. Pinned by
  `test_delete_material_also_cleans_extra_keys` (thumbnails == 4).
- Reclaim residual (reviewer ISSUE #1) is GENUINELY UNREACHABLE today:
  `reclaimOrphans` in `materialCacheClient.ts:102` has **no production caller**
  anywhere in `src/` (full grep: only its own def + BFF route + tests). The
  partial-set mis-classification cannot fire without a destructive caller. I
  confirm the reviewer's classification — documented residual risk, NOT a bug.
- Added boundary test proves the documented mitigation: a COMPLETE referenced
  set carrying both `mat-1` AND `stored-stem` keeps both dirs and reclaims only
  a genuine orphan.

## Delete-flow-wired finding — VERIFIED (Phase-1 footgun closed)

- `executeDelete` (`useMaterialManagement.ts:247`) calls, per id, BEFORE
  `setMaterials(filter)`: `evictMaterialCaches(id)` (all 4 caches) +
  `cascadeDeleteMaterial(id)` (backend DELETE). Not just state removal.
- 4-cache eviction hits the keys the renderer reads: `filmstripCache.evict` +
  `waveformCache.evict` are now SHARED singletons; `TimelineItem.tsx` imports the
  exported `filmstripCache` singleton (line 13) and uses it for `framesFor`/
  `ensure` — closing the "eviction misses what the renderer reads" footgun.
  `dropVideoCacheMaterial` → `VideoCacheAdapter.drop` (alias of `evict`),
  `evictLocalMaterialRef` → `LocalMediaCache.evict`. All four pinned by
  `deleteMaterialCacheEviction.test.ts` (7 cases incl. safe no-ops).
- Backend DELETE reuses `thumbnail_service`/`waveform_service.delete_by_material`
  (not reimplemented) + `storage_service.delete_file` for the source.
- Path-traversal safety holds on the destructive path: `thumbnail._safe_segment`
  collapses non-`[A-Za-z0-9_-]` to `_`; `waveform._safe_stem` rejects separators
  and `..` (raises ValueError, caught). A malicious materialId cannot escape root.

## Persistence / hydration findings — VERIFIED

- **Round-trip** restores split products (exact clip intervals 2/5/3 and 5/8/3),
  trim, `audioDetached`, `transitionIn:{fade,0.5}` / `transitionOut:{dissolve,
  0.75}`, `opacity:0.8`, track order (z). Selection NOT persisted (isSelected
  false), history/playback NOT persisted (isPlaying false). Export STOPS inlining
  `waveformData`; import TOLERATES legacy inline peaks; new+old mixed round-trips
  without error. Pinned by `TimelineRepository.persistence.test.ts` (9 cases).
- **INV-3 regularized conservatively** in both `TimelineRepository.import`
  (`regularizeClipInvariant`) and `projectHydration.hydrateProject`
  (`regularizeItem`): recompute `duration = clipEnd - clipStart`, leave
  `startTime` untouched, log, idempotent, no-op when self-consistent / clip
  absent.
- **Hydration black-screen guard** VERIFIED in `resolveSequencePlaybackUrl.ts`:
  when a live material is found, the snapshot `seq.url` is used ONLY as a last
  resort (line 163, material has NO usable URL); a live direct-local
  `/api/storage/files/...` URL always wins. Pinned by `projectHydration.test.ts`
  ("black-screen guard": stale `cdn.example.com` url does not override the local
  URL). `hydrateProject` returns `isPlaying:false`.

## SPEC TRACEABILITY (spec 06 §6 cases 1–9)

| # | Case | Implemented? | Test Exists? | Test Passes? | Notes |
|---|------|--------------|--------------|--------------|-------|
| 1 | Round-trip full restore (trim/split/transition/detach/multi-track) | Y | Y `persistence.test` | Y | item count, clip intervals, audioDetached, transitions, track order all asserted |
| 2 | Hydrate → materialId→live → 02 resolver hits local URL; missing derived → regenerate | Y | Y `projectHydration.test` | Y | preview `localStorageUrl`; `listDerivedToRegenerate` reports missing poster/waveform. Live preview pixels = desktop-only |
| 3 | Old-data INV-3 regularize (duration != clipEnd-clipStart) | Y | Y (both repo + hydration) | Y | corrected to clip span, startTime untouched, logged |
| 4 | Selection/undo history not persisted | Y | Y `persistence.test` | Y | isSelected false, isPlaying false on import |
| 5 | Export drops inline waveformData; import tolerates legacy; new+old mixed | Y | Y `persistence.test` (3 cases) | Y | fresh export has no item `waveformData`; legacy inline read as fallback |
| 6 | DELETE /material/{id}: source + thumbnails/{id}/* + waveforms/{id}.json | Y | Y `test_derived_gc` (4 cascade cases) | Y | extra_keys cascades poster-stem dir too |
| 7 | reclaim: orphans deleted, referenced kept, empty set safety threshold | Y | Y `test_derived_gc` (6 + my +1) | Y | MUTATION-PROVEN; +my complete-set boundary test |
| 8 | Startup reclaim: background, rate-limited, reports | Y | Y `test_derived_gc` (2 cases) | Y | cooldown runs once; empty provider skips; dry-run at startup |
| 9 | Delete evicts LocalMediaCache/VideoCacheAdapter/filmstrip/waveform | Y | Y `deleteMaterialCacheEviction.test` (7) | Y | shared singletons; safe no-ops |
| — | save→close→REOPEN live-previewable; reopened derived HIT persisted files; deleted material files vanish on disk; no orphan growth on restart | Deferred to desktop walkthrough | n/a (jsdom/pytest cannot run canvas/audio/on-disk-reopen) | — | mandatory manual gate (Phase-2 flagged); wiring is unit-pinned |

## Completeness (STEP 5.5)

- No stubs / TODO / FIXME / NotImplementedError / empty-except in TODO-06 source
  (grep clean on `derived_gc_service.py`).
- File sizes: `derived_gc_service.py` 351, `projectHydration.ts` 251,
  `materialCacheClient.ts` 120 — all ≤ 800. `useMaterialManagement.ts` is 1295
  (> 800) but was 1209 at HEAD pre-edit — PRE-EXISTING D10 debt; the delete
  wiring added ~86 lines, did NOT take a compliant file over threshold.
- Method sizes: `reclaim()` ≈ 61 code lines (excl. 17-line docstring), slightly
  over the 50-line soft threshold (reviewer NIT #2). Conscious decision to NOT
  refactor a destructive path for a style nit — I concur (refactor risk >
  reward). All other methods within threshold.

## Issues & Risks

1. **[NIT, confirmed — not blocking] `reclaim()` ≈ 61 code lines** > 50 soft
   threshold. Cohesive single responsibility (two parallel delete loops). Leave
   as-is on a destructive path. (reviewer NIT #2)
2. **[NIT, confirmed — cosmetic] DELETE docstring drift:** router/BFF docstrings
   say "optional JSON body may carry extra_keys" but the impl uses query params.
   No behavioral impact (client uses query params correctly). (reviewer NIT #3)
3. **[PRE-EXISTING debt] `useMaterialManagement.ts` 1295 > 800** — out-of-scope
   D10 split, documented by dev. Not introduced by TODO-06.
4. **[RESIDUAL, UNREACHABLE] poster-stem reclaim mis-delete** on a future
   materialId-only referenced set. No destructive caller exists; mitigation
   (pass both key spaces) is now boundary-tested. Downstream UI-wiring task owns
   it. (reviewer ISSUE #1 — concur)

## Context for Downstream

- The destructive reclaim is intentionally DORMANT (no UI caller). Whoever wires
  the real `reclaimOrphans` trigger MUST pass a COMPLETE referenced set =
  material library ∪ every materialId AND every poster STEM referenced by any
  local project — or keep it dry-run-only. The empty/partial-set case is SAFE
  (skip) but reclaims nothing; the caller owns completeness.
- Mandatory desktop walkthrough (jsdom/pytest cannot verify): save→close→REOPEN
  restoring a live-previewable timeline (canvas + audio); reopened thumbnails/
  waveforms hitting persisted files (no re-extract); deleting a material making
  its on-disk thumbnail/waveform files disappear; no orphan growth on restart.
- I added one additive backend test (`test_reclaim_with_complete_set_keeps_both
  _key_spaces`) to `tests/test_derived_gc.py` (13 passing). No source touched.
