# Storyboard Pack — Project Isolation (Spec v2)

> **Feature slug:** `storyboard-pack-project-isolation`
> **Author:** Subtask #0 (方案设计) — solution architect
> **Reviewer:** Subtask #1 (评审与修复) — senior reviewer (Anthropic eng style)
> **Status:** v2 — review applied, P0/P1 resolved
> **Companion subtasks:** #1 评审与修复 ✅ → #2 代码开发 → #3 Review 与提交

---

## 0. 评审记录 (Review Notes)

The v1 design was reviewed against feasibility, completeness, consistency with the existing codebase, and right-sizing. The concerns below were filed during review. **All P0 and P1 issues have been fixed inline in the body of v2; P2 items remain as advisory notes for the implementer.**

| # | Severity | Dimension | Concern | Resolution |
|---|---|---|---|---|
| C1 | **P0** | Consistency | v1 §3.1/§7 R3 proposed `Depends(get_optional_user)`. **No such dependency exists in `app/dependencies/auth.py`** — only `get_current_user`. Optional auth is also incoherent with this design: ownership filtering needs a real `user_id`, and the sibling `video_project_router` already mandates `get_current_user`. Half-authed reads of project-scoped resources would let an unauthenticated client enumerate any project's packs by guessing `project_id`. | v2 mandates `Depends(get_current_user)` on every storyboard endpoint, matching `video_project_router`. R3 in §7 reframed accordingly. |
| C2 | **P0** | Consistency | v1 §3.1 introduced a new top-level package `app/repositories/`. **The codebase has no repositories layer** — the pattern is Router → Service → SQLAlchemy directly (see `video_project_service.py`, `storyboard_service.py`). Adding a new architectural layer for a single feature is over-engineering and inconsistent. | v2 collapses `pack_ownership_repo.py` into `app/services/pack_ownership_service.py`. No new top-level package. |
| C3 | **P0** | Completeness | v1 §2.5 "before deleting the row, inside the same DB transaction" contradicts v1 §7 R4 "exit the DB transaction, then perform disk + OSS cleanup outside the transaction." The implementer would not know which path is authoritative. | v2 §2.5 pins the order: (1) collect pack ids inside the transaction, (2) delete ownership rows inside the same transaction (DB-level consistency), (3) commit the project + ownership row deletion, (4) perform best-effort disk + OSS cleanup *after* commit. |
| C4 | **P0** | Feasibility | v1 §5.1 typed `project_id` as `UUID NOT NULL`, but v1 §7 R6 acknowledges SQLite tests need `String(36)` to match `AgentWorkflow.user_id`. Two columns of conflicting type were proposed for the same field. | v2 §5.1 standardizes on `String(36) NOT NULL` for both `project_id` and `user_id`, matching the precedent set by `AgentWorkflow`. |
| C5 | **P1** | Right-sizing | v1 §3.1 placed `assert_project_writable(db, project_id, user_id)` in `app/dependencies/auth.py`. That helper **queries `VideoProject`** — it is service-layer logic, not an auth dependency. Putting DB queries in `dependencies/auth.py` cross-contaminates concerns. | v2 §3.1 moves the helper into `app/services/video_project_service.py` as `assert_project_writable(db, user_id, project_id) -> VideoProject` and imports it into the storyboard router. |
| C6 | **P1** | Completeness | v1 §4.1 `_assert_pack_owned(pack_id, current_user)` mixes a service-layer call with a router-level object (`current_user`). Services in this codebase take primitive `user_id: str` arguments (see `video_project_service`'s explicit contract). | v2 §4.1 fixes the contract to `_assert_pack_owned(db, pack_id, user_id) -> str`, called from the router (or service helper) with the primitive id. |
| C7 | **P1** | Completeness | v1 §9.2 says "the existing UI temporarily breaks for storyboard list — that is acceptable." For a single-host monorepo where backend and frontend are deployed together via `start.sh`, this is fine, but the spec didn't explicitly forbid splitting the deploy. | v2 §9.2 makes BE+FE atomic deploy a hard requirement (the backend tightening removes the un-filtered list endpoint and the FE *must* be the only consumer reaching it). |
| C8 | **P1** | Completeness | v1 §4.1 states `describe`, `batch-video`, `compose`, `queue/status`, `generate-script`, `revise-script` keep their existing shapes "because they operate on a `pack_id`". But `pack_id` from the URL is not authenticated by ownership unless the helper is wired in. The wording allowed an implementer to ship without the check. | v2 §4.1 makes the harden-by-ownership step **mandatory** for `describe`, `batch-video`, `batch-video/status`, and `compose`. `generate-script` and `revise-script` are read-only LLM calls that take prompts (no `pack_id`) and remain un-gated by ownership. |
| C9 | **P2** | Right-sizing | v1 §11 storing `pack_type` for forward-compat is reasonable, but the spec didn't say whether character/scene packs migrate via the same table or a separate one. | Advisory: keep `pack_type` and reuse the table when §11 lands. No v2 body change. |
| C10 | **P2** | Completeness | v1 acceptance criteria mention `resetVideoEditingStore()` clears `storyboardPacks`, but did not call out verifying the slice's `reset` actually nulls the storyboard collection. | Advisory: confirm `storyboardSlice.reset()` (or the global reset) actually empties `storyboardPacks` during the regression test in §6.2. |
| C11 | **P2** | Completeness | v1 §4.4 says agent tool "refuses with a structured error" when `projectId` is null but did not name the error code. | Advisory: agent tool should throw with `error_code = "STORYBOARD_REQUIRES_PROJECT"` so the agent surfaces a localized user-visible message. |
| C12 | **P2** | Completeness | v1 §3.1 lists `tests/test_storyboard_create_from_shots.py` as "modify", but if no such file currently exists in the repo, it must be created. | Advisory: the implementer should `ls backend-services/basic-service/tests/` first; create rather than modify if the file is absent. |

---

## 1. Overview

### 1.1 What we are building
Today the Video Editing tab's Materials panel (素材管理) shows a single, **flat global list** of storyboard packs (分镜包). Every pack the current backend has ever generated is loaded by `GET /api/storyboard/packs` and rendered for every project the user opens. There is no concept of "this pack belongs to project X". The same is true at the storage layer: packs live under `{STORAGE_ROOT}/storyboard/{YYYYMMDD}/{pack_id}/` with no project marker in their `metadata.json`.

This feature scopes storyboard packs to the **video project** that produced them. After the change:

* Creating a pack inside project A binds it to A; opening project B never sees A's packs.
* Listing packs requires a `project_id`; the server only returns packs that belong to the given project (and to the current user, once auth is wired through — see §10).
* Deleting a project deletes its packs and their on-disk directories (best-effort), matching how `video_projects` already cascades elsewhere in the system.
* Existing pre-feature packs ("legacy unowned") remain readable by direct URL but no longer surface in the per-project list — that is the explicit acceptance bar for "isolated".

### 1.2 Why
The Ecliptrix product flow now puts the user inside a *project* before they enter the editor (`VideoEditorContainer` mounts `VideoEditingInterface` keyed by `projectId`, `resetVideoEditingStore()` is already called on project switch). With storyboard packs leaking across projects, users see unrelated assets in their materials drawer, can accidentally compose them into the wrong timeline, and cannot delete a project cleanly because pack files live on indefinitely. Isolating packs by project closes this gap and is a prerequisite to building per-project material analytics.

### 1.3 Non-goals
* **Sharing** packs across projects (clone/duplicate flow) — out of scope for v1.
* **Character / Scene packs** (`/api/image-pack/character|scene/*`) — they share the same `grid_pack_service` plumbing, but the user's request narrows scope to 分镜 (storyboard). The design leaves a clean extension point (§11) so character/scene can be migrated by a follow-up task using the exact same primitives.
* **Backfilling** old global packs into a pseudo-project. Legacy packs become "orphaned" and are surfaced only through an admin tool (§9.3).
* Adding **auth** to the storyboard router (it currently has none) — we add per-project filtering only; auth tightening is tracked separately.

---

## 2. Technical Design

### 2.1 Current state (recap)

* **Backend** (`backend-services/basic-service/`)
  * Router: `app/routers/storyboard_router.py` (mounted under `/api/storyboard`). No auth dependencies.
  * Service: `app/services/storyboard_service.py` writes packs under `{STORAGE_ROOT}/storyboard/{YYYYMMDD}/{pack_id}/{metadata.json,frames…}`.
  * `list_packs()` walks every date directory under the base and returns every pack found.
  * Persistence is **purely filesystem** — there is no `storyboard_packs` table.
* **Frontend** (`src/`)
  * `VideoEditorContainer` (`src/components/video/projects/VideoEditorContainer.tsx`) loads a project by `projectId` and mounts `VideoEditingInterface key={projectId}`.
  * `MaterialsPanel` calls `listPacks()` on mount via `refreshStoryboardPacks` and stores into local state plus the `storyboardSlice` zustand slice.
  * `lib/api/storyboard.ts` exposes `listPacks`, `getPack`, `deletePack`, `generateStoryboard`, `createPackFromShots`, `describeFrames`, `batchGenerateVideos`, `composeVideo`, etc.

### 2.2 Target architecture
We add an **owner edge** to every storyboard pack:

```
VideoProject (id, user_id, …)        StoryboardPackOwnership (DB)
       │ 1                                   │ N
       └────────────── owns ─────────────────┘
                                              │
                                              ▼
                              {STORAGE_ROOT}/storyboard/{date}/{pack_id}/metadata.json
                                              { "project_id": "<uuid>", "user_id": "<uuid>", … }
```

* **Source of truth for ownership = the DB table `storyboard_packs`.** It is small, indexed, queried on every list call, and trivially supports CASCADE deletion when a project is removed.
* **`metadata.json` carries a denormalized copy** of `project_id` and `user_id` so the on-disk pack remains self-describing (helpful for backups, OSS migration, and the existing `list_packs()` fallback path that reads JSON).
* All write paths (generate, create-from-shots) require a `project_id` and refuse the request if it is missing or does not belong to the caller. All read paths (list/get/delete) accept `project_id` and filter by it.

### 2.3 Sequence — generate a pack inside project P

1. Frontend (MaterialsPanel) issues `POST /api/storyboard/generate` with `project_id: P` (added field).
2. Next.js BFF passthrough route forwards the body unchanged to FastAPI.
3. `storyboard_router.generate_storyboard` calls a new helper `assert_project_writable(project_id, current_user)` — verifies the project exists and is owned by the caller (or by the caller's effective scope when auth is on). On failure → `400 PROJECT_NOT_FOUND`.
4. `storyboard_service.generate_storyboard(request)` runs the existing chained 2×2 pipeline. **Two new behaviours:**
   * `metadata.json` includes `project_id` and `user_id`.
   * After `_finalize_pack` writes `metadata.json`, `pack_ownership_repo.upsert(pack_id, project_id, user_id, created_at)` records a row in `storyboard_packs`.
5. Response shape unchanged — `StoryboardPack` already has `pack_id`/`created_at`; the frontend does not need new fields here because it already knows which project it sent the request from.

### 2.4 Sequence — list packs inside project P

1. `MaterialsPanel.refreshStoryboardPacks(projectId=P)` calls `listPacks(P)`.
2. BFF passthrough adds `project_id=P` query string and forwards.
3. `storyboard_router.list_packs(project_id=P, current_user)` calls `storyboard_service.list_packs(project_id=P, user_id=U)`.
4. Service queries `SELECT pack_id FROM storyboard_packs WHERE project_id = P AND user_id = U ORDER BY created_at DESC`.
5. For each `pack_id`, the service still loads `metadata.json` (existing logic in `_pack_dir + read metadata`) and constructs `StoryboardPack`. Response is the existing `StoryboardListResponse` envelope.

### 2.5 Sequence — delete a project P

The cascade splits cleanly into a DB phase and a filesystem phase. **DB work must finish inside the same transaction as the project-row delete; storage cleanup runs *after* commit so a failing OSS delete cannot roll back the project deletion.**

1. **(In transaction)** `video_project_service.delete_project` calls `pack_ownership_service.collect_pack_ids_for_project(db, P)` to fetch the pack id list with `SELECT pack_id FROM storyboard_packs WHERE project_id = P FOR UPDATE` (or the equivalent without explicit lock — small table, list query already serialized by the project-row lock).
2. **(In transaction)** `pack_ownership_service.delete_rows_by_project(db, P)` deletes the ownership rows for those ids.
3. **(In transaction)** the existing project-row delete runs.
4. **(After commit)** `storyboard_service.cleanup_pack_storage(pack_ids)` walks the collected ids and, for each, removes the on-disk directory (best-effort, mirrors `delete_pack`) and runs OSS cleanup (`oss_client.delete_prefix`, best-effort). Failures are logged but do not surface to the caller (matches the storage-cleanup philosophy elsewhere — disk leaks are recovered by the orphan script in §9.3, not by failing user requests).

### 2.6 Migration / backfill

Legacy packs (those whose `metadata.json` predates the change) have no `project_id`:

* The migration script (§9.3) writes nothing into `storyboard_packs` for them — they are deliberately invisible to the per-project list.
* An admin maintenance script `scripts/list_orphan_storyboard_packs.py` enumerates `metadata.json` files lacking `project_id`/`user_id` so an operator can decide what to do (delete on disk, manually attribute to a project, etc.). Out of scope for v1: a UI to surface orphans.

---

## 3. File / Module Change Plan

### 3.1 Backend (FastAPI / SQLAlchemy)

| File | Type | Intent (one line) |
| --- | --- | --- |
| `backend-services/basic-service/app/models/db_models.py` | modify | Add `StoryboardPackOwnership` ORM model (`pack_id` PK, `project_id`, `user_id`, `created_at`, indexes). |
| `backend-services/basic-service/alembic/versions/007_add_storyboard_pack_ownership.py` | create | Alembic migration: create table `storyboard_packs` with FK-less indices on `(project_id, created_at)` and `(user_id, project_id)`. |
| `backend-services/basic-service/app/services/pack_ownership_service.py` | create | New service module (no new top-level `repositories/` package — see review note C2) exposing `upsert(db, pack_id, project_id, user_id) / get(db, pack_id) / list_by_project(db, project_id, user_id) / delete_by_pack(db, pack_id) / collect_pack_ids_for_project(db, project_id) / delete_rows_by_project(db, project_id)`. |
| `backend-services/basic-service/app/models/storyboard_models.py` | modify | Add `project_id: str` (required) to `StoryboardGenerateRequest` and `StoryboardCreateFromShotsRequest`. Add `project_id` to `StoryboardPack` response model (Optional for legacy reads). |
| `backend-services/basic-service/app/routers/storyboard_router.py` | modify | (a) Add `current_user: User = Depends(get_current_user)` and `db: AsyncSession = Depends(get_db_session)` to every endpoint, matching `video_project_router`. (b) Accept `project_id` query for list/get/delete. (c) Validate write requests' `project_id` via `video_project_service.assert_project_writable`. (d) Pass `current_user.id` (as `str`) into the service call. |
| `backend-services/basic-service/app/services/storyboard_service.py` | modify | (a) Write `project_id`/`user_id` into `metadata.json`. (b) Persist ownership row via `pack_ownership_service.upsert` on success path of `_finalize_pack` and `create_pack_from_shots`. (c) `list_packs(db, project_id, user_id)` — query DB index instead of walking entire base dir. (d) `get_pack`/`delete_pack` enforce ownership via `_assert_pack_owned(db, pack_id, user_id)`. (e) Add `cleanup_pack_storage(pack_ids)` — best-effort filesystem + OSS cleanup, runs after the DB transaction commits. (f) Harden `describe`/`batch-video`/`batch-video/status`/`compose` with the same `_assert_pack_owned` call. |
| `backend-services/basic-service/app/services/video_project_service.py` | modify | (a) Add `assert_project_writable(db, user_id, project_id) -> VideoProject` helper (raises `HTTPException(404, "PROJECT_NOT_FOUND")` on miss). (b) In `delete_project`, before deleting the project row: call `pack_ownership_service.collect_pack_ids_for_project` then `delete_rows_by_project` inside the same transaction; after `db.commit()`, call `storyboard_service.cleanup_pack_storage(pack_ids)`. |
| `backend-services/basic-service/scripts/list_orphan_storyboard_packs.py` | create | Operator script — walks `metadata.json` and prints those without `project_id`. |
| `backend-services/basic-service/tests/test_storyboard_project_isolation.py` | create | New tests: list returns only pack rows for the requested project; cross-project access → 404; delete project removes packs; legacy packs hidden. |
| `backend-services/basic-service/tests/test_storyboard_create_from_shots.py` | modify | Cover the new `project_id` requirement. |
| `backend-services/basic-service/tests/test_video_project_service.py` | modify | Cover the cascade-delete path for owned packs. |

### 3.2 Frontend (Next.js)

| File | Type | Intent (one line) |
| --- | --- | --- |
| `src/types/index.ts` | modify | Extend `StoryboardPack` with optional `projectId?: string`; add `projectId` parameter to `StoryboardGenerateParams`. |
| `src/lib/api/storyboard.ts` | modify | Accept and forward `projectId` (snake_cased to `project_id`) in `listPacks`, `getPack`, `deletePack`, `generateStoryboard`, `createPackFromShots`. |
| `src/app/api/storyboard/generate/route.ts` | modify | Existing passthrough already forwards body unchanged — verify no hard-coded omission. |
| `src/app/api/storyboard/packs/[packId]/route.ts` *(if exists)* / new wrapper | review | Ensure project_id query string is forwarded. |
| `src/app/api/storyboard/packs/route.ts` *(if exists)* / new wrapper | review | Same. |
| `src/components/video/projects/VideoEditorContainer.tsx` | modify | Provide `projectId` to descendants via prop / context (keep prop-drilling pattern used today by `taskId`). |
| `src/components/video/VideoEditingInterface.tsx` | modify | Forward `projectId` to `MaterialsPanel` and to `useStoryboardScriptGeneration` and other storyboard-aware hooks. |
| `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` | modify | Pass `projectId` into `listPacks`, into `CreateStoryboardPackModal`, and into pack delete calls. Refresh effect deps: `[projectId]`. |
| `src/components/video/components/MaterialsPanel/CreateStoryboardPackModal.tsx` | modify | Accept and forward `projectId` into `createPackFromShots`. |
| `src/components/video/hooks/useStoryboardScriptGeneration.ts` | modify | Accept `projectId`, pass into `listPacks` and `generateStoryboard`. |
| `src/components/video/hooks/useStoryboardChat.ts` | modify | Same — surface `projectId` as a parameter. |
| `src/lib/video-editing-agent/tools/generateStoryboard.ts` | modify | The agent tool needs to read `projectId` from its execution context (already plumbed via task context) and include it in the request body. |
| `src/stores/slices/storyboardSlice.ts` | modify | `setStoryboardPacks` already gets reset by `resetVideoEditingStore` on project switch — confirm via test, no logic change. |
| `src/stores/__tests__/videoEditingStore.test.ts` | modify | Add a regression test that switching projects clears `storyboardPacks`. |
| `src/stores/slices/__tests__/storyboardSlice.test.ts` | (no change) | – |
| `src/lib/api/__tests__/storyboard.test.ts` | modify | Cover `project_id` is sent on list/generate/create-from-shots. |

### 3.3 Cross-cutting

| File | Type | Intent |
| --- | --- | --- |
| `docs/plans/storyboard-pack-project-isolation/spec.md` | (this doc) | Design source of truth. |
| `backend-services/basic-service/env.template` | (no change) | – |
| `CLAUDE.md` | (no change) | – |

---

## 4. Interface Design

### 4.1 REST — backend (`/api/storyboard/*`)

All payloads are JSON; all responses keep the existing `BaseResponse`/`StoryboardGenerateResponse` envelope.

**`POST /api/storyboard/generate`** — *modified*
```jsonc
{
  "project_id": "<uuid, required>",
  "prompt": "...", "frame_count": 4, "aspect_ratio": "1:1",
  "reference_image": null, "reference_images": [], "mentioned_images": null,
  "frame_scripts": [], "script_history": [], "locale": "zh", "pack_id": null
}
```
* Missing/invalid `project_id` → `400` with `error_code = "PROJECT_ID_REQUIRED"`.
* Project not owned by current user → `404 PROJECT_NOT_FOUND` (we deliberately mask 403 as 404 to avoid pack-id enumeration, matching the existing `video_project_router` style).

**`POST /api/storyboard/packs/create-from-shots`** — *modified*: same `project_id` requirement.

**`GET /api/storyboard/packs?project_id=<uuid>`** — *modified*: filter mandatory.
* Without `project_id` → `400 PROJECT_ID_REQUIRED` (we tighten rather than fall back to global).

**`GET /api/storyboard/packs/{pack_id}?project_id=<uuid>`** — *modified*
* `project_id` is required and must match the recorded owner → otherwise `404`.
* Direct file URLs (`/api/storage/files/storyboard/...`) remain accessible — file-level ACL is out of scope for this feature.

**`DELETE /api/storyboard/packs/{pack_id}?project_id=<uuid>`** — *modified*: same ownership check, then proceeds to existing delete logic.

**Other endpoints** keep their existing shapes; no `project_id` change to body/query is required because they operate on a `pack_id` that the ownership table already binds to a project. **However**, the following endpoints **must** call `_assert_pack_owned(db, pack_id, user_id)` as their first step (mandatory — see review note C8):

* `POST /api/storyboard/describe`
* `POST /api/storyboard/batch-video`
* `GET /api/storyboard/batch-video/status/{pack_id}`
* `POST /api/storyboard/compose`

The helper signature is `_assert_pack_owned(db: AsyncSession, pack_id: str, user_id: str) -> str` returning the bound `project_id` on success and raising `HTTPException(404, "STORYBOARD_PACK_NOT_FOUND")` otherwise (404 masks 403 to avoid pack-id enumeration).

`generate-script` and `revise-script` are pure LLM calls that take a prompt and a script (no `pack_id`) and remain un-gated by ownership. `queue/status` is a global queue introspection endpoint and stays open.

### 4.2 BFF — Next.js routes

The Next.js routes under `src/app/api/storyboard/**` use `createPassthroughRoute(...)`. Confirmed pattern: passthrough forwards the original body and query string verbatim to `BACKEND_URL`. **No code change** is needed beyond a regression test that the new `project_id` query/body field reaches the backend.

### 4.3 TS API client (`src/lib/api/storyboard.ts`)

```ts
// New / modified signatures
export interface StoryboardGenerateParams {
  projectId: string;            // NEW (required)
  prompt: string; frameCount: number; aspectRatio?: '1:1'|'16:9'|'9:16'|'4:3'|'3:4';
  /* …existing fields unchanged… */
}
export interface CreatePackFromShotsPayload {
  projectId: string;            // NEW (required)
  /* …existing fields unchanged… */
}
export function listPacks(projectId: string): Promise<StoryboardPack[]>;
export function getPack(projectId: string, packId: string): Promise<StoryboardPack>;
export function deletePack(projectId: string, packId: string): Promise<void>;
```

`StoryboardPack` gains an optional `projectId?: string` (populated from `metadata.json.project_id` when the backend reads a pack).

### 4.4 Agent tool surface

`src/lib/video-editing-agent/tools/generateStoryboard.ts` reads the active `projectId` from the agent execution context (already provided by `VideoEditingInterface` → `AgentEventRouter`) and includes it in the request. If the active project is `null` (project list view), the tool refuses with a structured error so the agent surfaces a useful message.

---

## 5. Data Model

### 5.1 New table — `storyboard_packs`

| Column | Type | Notes |
| --- | --- | --- |
| `pack_id` | `VARCHAR(64)` PK | Mirrors the filesystem pack id (16-hex today; future-proofed). |
| `project_id` | `String(36) NOT NULL` (`VARCHAR(36)`) | Logical FK to `video_projects.id`. **Stored as `String(36)`, not `UUID`**, to (a) match the precedent set by `AgentWorkflow.user_id` and (b) keep the SQLite in-memory test backend working without dialect-specific glue. No DB-level FK — keeps the door open for cross-shard moves and matches existing conventions. |
| `user_id` | `String(36) NOT NULL` (`VARCHAR(36)`) | Denormalized for O(1) auth checks. |
| `created_at` | `DateTime(timezone=True)` server_default `now()` | Used for list ordering. |
| `pack_type` | `VARCHAR(32) NOT NULL` default `'storyboard'` | Forward-compat for §11 — character/scene packs will reuse this same table. |

Indexes:

* `ix_storyboard_packs_project_created` on `(project_id, created_at DESC)` — primary list query.
* `ix_storyboard_packs_user_project` on `(user_id, project_id)` — auth filter.

### 5.2 Updated `metadata.json` (on disk)

```jsonc
{
  "pack_id": "abc123…",
  "pack_type": "storyboard",
  "project_id": "11111111-2222-…",   // NEW
  "user_id":   "user-uuid",          // NEW
  "prompt": "...",
  "grid_size": "2x2",
  "aspect_ratio": "1:1",
  "frame_count": 4,
  "created_at": "2026-…",
  "frames": [ … ],
  /* …existing fields kept verbatim… */
}
```

Backwards compatibility: missing `project_id`/`user_id` is allowed when reading (legacy packs), but the ownership table is the only thing that decides visibility.

### 5.3 In-memory shape (`StoryboardPack`)

Add `projectId?: string` to the TS type and `project_id: Optional[str]` to the Pydantic model. Older clients that ignore the field continue to work.

---

## 6. Testing & Acceptance Criteria

### 6.1 Backend tests
1. `tests/test_storyboard_project_isolation.py`
   * Generates two packs into two different projects (A, B) for the same user; asserts `GET /api/storyboard/packs?project_id=A` returns only A's pack.
   * Asserts `GET …?project_id=A` for a project owned by *another* user returns `404`.
   * Asserts `DELETE` cross-project returns `404` and does not touch disk.
   * Asserts deleting project A also deletes its pack rows and pack directories.
   * Asserts a metadata.json missing `project_id` is invisible from list endpoints (legacy hidden).
2. `tests/test_storyboard_create_from_shots.py` updated with `project_id` argument (negative tests for missing/invalid value).
3. `tests/test_video_project_service.py` covers cascade.

### 6.2 Frontend tests
1. `src/lib/api/__tests__/storyboard.test.ts`: list/generate/create-from-shots wire `project_id` correctly into the HTTP body and query.
2. `src/stores/__tests__/videoEditingStore.test.ts`: switching `projectId` resets `storyboardPacks` to `[]`.
3. `src/components/video/projects/__tests__/projectPersistence.integration.test.tsx`: existing autosave test extended to assert pack ids do not leak across project switches in the rendered MaterialsPanel.

### 6.3 Manual / acceptance
* Open project A, generate a pack → it appears in A's Materials panel.
* Switch to project B → the pack is *not* visible.
* Delete project A → its on-disk pack directory is gone (verify via `ls`), the DB row is gone, and project B is unaffected.
* Open the editor without selecting a project → the agent tool `generateStoryboard` returns a clean error and never hits the backend.
* `pytest backend-services/basic-service/tests/ -k storyboard -v` and `npm run type-check && npm run lint` all green.

### 6.4 Definition of Done
* All acceptance steps pass on a fresh dev environment.
* `alembic upgrade head` works on a database created from `001_initial_schema.py` upward.
* No regression in the existing storyboard-generation tests (`test_storyboard_grid`, `test_storyboard_chained`, `test_storyboard_multi_reference`, `test_storyboard_batch_concurrency`, `test_storyboard_video_queue`).

---

## 7. Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | Legacy packs disappear silently from the UI, surprising users with in-flight work. | M | M | Ship operator script `list_orphan_storyboard_packs.py`; release notes flag the change; legacy packs remain reachable by direct URL until manual cleanup. |
| R2 | Race between `_finalize_pack` writing on disk and the DB row insert (process killed in between). | L | M | Insert ownership row **before** the OSS upload step (which is best-effort) and immediately after `metadata.json` is durably flushed. On restart, an idempotent admin `reconcile` script (future work, not this spec) can re-attribute orphans by reading `metadata.json.project_id`. |
| R3 | Storyboard router currently has **no auth dependency**, so adding `current_user` could break anonymous integration tests / agent flows that don't carry a session token. | M | M | **Adopt `Depends(get_current_user)` directly** (the same posture `video_project_router` already uses). Half-authed reads of project-scoped resources are unsafe (review note C1). Update or remove any existing storyboard tests that exercise the router without an authenticated client — the auth fixture used by `video_project_router` tests is the canonical pattern. |
| R4 | `delete_packs_for_project` runs inside the project deletion transaction; long-running disk IO could lock the DB session. | L | M | Mirror the existing pattern: collect pack ids, exit the DB transaction, then perform disk + OSS cleanup outside the transaction. Failures are logged, not raised. |
| R5 | Frontend forgets to forward `projectId` from one of the agent tools, causing the backend to 400. | M | L | Centralize the `projectId` requirement in a small TS helper `requireActiveProjectId()` used by every storyboard tool; unit-test the helper. |
| R6 | Tests use SQLite in-memory; ensure `storyboard_packs.project_id` column type works there too. | L | L | Use `String(36)` rather than `UUID` for `project_id` in the ORM model (matches `AgentWorkflow.user_id` pattern) so SQLite tests work without extra dialect glue. |
| R7 | `metadata.json` schema bump might break old `list_packs` reader. | L | L | Reader treats `project_id`/`user_id` as `meta.get(...)` and tolerates `None`. |
| R8 | OSS deletion cost on bulk project delete. | L | L | Best-effort, batched; failure does not roll back the DB delete. |

---

## 8. Implementation Notes for Subtask #2 (代码开发)

* Match existing commit-prefix convention (`feat:` / `[modify]` style — see CLAUDE.md). Subtask #3 commits with `feat:` per the task board.
* Stick to async SQLAlchemy + asyncpg (matches `video_project_service.py`).
* Reuse `_validate_pack_id`/`validate_pack_id` for path-traversal protection.
* All new strings using `project_id` must be parameterized in queries — never f-stringed.
* Do **not** introduce a new top-level config key; the feature has no tunables.

## 9. Operational / Migration Plan

### 9.1 Schema migration
* `alembic upgrade head` runs `007_add_storyboard_pack_ownership` which creates `storyboard_packs` with the indexes from §5.1.
* Roll back: `alembic downgrade -1` drops the table; the on-disk pack directories survive (idempotent).

### 9.2 Code rollout
**Backend and frontend MUST be deployed atomically** (review note C7). The backend tightening removes the un-filtered list endpoint, and the FE is the only consumer that reaches it; a split deploy where BE leads FE means the in-prod editor's Materials panel will 400 on every refresh. Practically, on this monorepo, that means a single `start.sh` cycle:

1. Apply the Alembic migration (`alembic upgrade head` runs `007_add_storyboard_pack_ownership`).
2. Restart backend and frontend together. Verify the editor loads and the Materials panel surfaces the current project's packs (and only those).
3. Run `python scripts/list_orphan_storyboard_packs.py` in the prod shell to inventory legacy packs; decide whether to delete them or attribute them manually.

If the deployment ever needs to be split (e.g. dark-launch behind a flag), gate the new `project_id` requirement behind a `STORYBOARD_REQUIRE_PROJECT_ID` env flag — out of scope for v1, but recorded here as the only acceptable shape of a split deploy.

### 9.3 Backfill script (`scripts/list_orphan_storyboard_packs.py`)
Walks `STORAGE_ROOT/storyboard/*/*/metadata.json`, prints `(pack_id, created_at)` for any pack missing `project_id`. Read-only — no DB writes. Operator decides next step.

## 10. Open Questions / Follow-ups

* **Q1 — Auth posture.** ~~Should we promote the storyboard router to require `Depends(get_current_user)` in this same PR?~~ **Resolved by review (C1, R3).** The router *will* require `Depends(get_current_user)` in this PR. Optional auth combined with project-scoped reads was deemed unsafe and inconsistent with `video_project_router`.
* **Q2 — UI affordance for orphans.** Do we want a "legacy packs" admin section in v1? This spec says no.
* **Q3 — Agent context shape.** `generateStoryboard` agent tool currently does not receive `projectId`. The minimal change is to pass it via the agent's `tools` execution context. Confirm during code review that no other tool needs the same plumbing.

## 11. Future extension — character / scene packs

`grid_pack_service` already supports `pack_type ∈ {storyboard, character, scene}`. Because §5.1 stored a `pack_type` column up-front, follow-up work to scope character/scene packs by project is purely a router-side change in `image_pack_router.py` and a small `metadata.json` schema bump for those packs — no further migrations or table changes. Out of scope for this spec.

---

*End of v2 design — ready for Subtask #2 implementation.*

---

## 实施过程发现的方案缺陷 (Issues Found During Implementation)

### I1 — BFF passthrough only forwarded query strings on GET

**Where:** `src/lib/api/server/backend-proxy.ts` `executeProxy(...)`.

The v2 design assumed (§4.2): *"Confirmed pattern: passthrough forwards
the original body and query string verbatim to BACKEND_URL."* That is
true for **GET only** in the current implementation — `executeProxy`
guarded the `req.nextUrl.searchParams` forwarding behind
`if (method === 'GET')`. The router design adds `?project_id=<uuid>` to
**DELETE** (`/api/storyboard/packs/{id}?project_id=...`) and to **GET**
on the same path, so without the BFF change the backend would always see
a missing `project_id` on DELETE and answer 400 PROJECT_ID_REQUIRED for
every pack-delete from the editor.

**Fix applied:** removed the GET guard so `searchParams` forwarding
applies to every method. Body precedence on POST/PUT is unchanged —
their bodies are read from `req.text()/formData()` independently of the
URL query, so adding query forwarding has no observable effect on
existing routes that already work today. Documented in the function's
inline comment.

### I2 — Existing storyboard service tests construct request models without `project_id`

**Where:** `tests/test_storyboard_chained.py`, `tests/test_storyboard_grid.py`,
`tests/test_storyboard_multi_reference.py`,
`tests/test_storyboard_reference_image.py`,
`tests/test_storyboard_batch_concurrency.py`.

Several pre-existing tests construct `StoryboardGenerateRequest(...)`
without `project_id`. The v2 design lists those test files under the
"no regression" Definition-of-Done bar (§6.4), so making `project_id`
**required** on the Pydantic model would break them on import.

**Fix applied:** `project_id` stays *Optional* on the Pydantic model;
the **router** is what raises 400 PROJECT_ID_REQUIRED when the field is
missing. The router-level enforcement still satisfies §4.1 ("Missing/
invalid `project_id` → `400` with `error_code = "PROJECT_ID_REQUIRED"`")
because no client reaches the service except via the router.

The new test file `test_storyboard_project_isolation.py` constructs
requests with `project_id` set, and `test_storyboard_create_from_shots.py`
was updated per §3.1.

---

## 评审结论 (Review Verdict)

**有条件通过 (Approved with conditions).**

The v1 design captured the right shape of the feature: DB-indexed ownership table with denormalized `metadata.json`, mandatory `project_id` on write/read, cascade on project delete, no DB-level FK, atomic BE+FE deploy. The architecture is sound and proportionate to the problem.

Conditions for approval (all already applied to v2 body):

1. **Auth tightened**: storyboard router uses `Depends(get_current_user)` — not optional — matching `video_project_router` (C1, R3).
2. **No new top-level `repositories/` package**: ownership logic lives in `app/services/pack_ownership_service.py` (C2).
3. **Cascade order pinned**: DB ownership rows deleted inside the project-delete transaction; filesystem + OSS cleanup runs after commit (C3).
4. **Type alignment**: `project_id` and `user_id` are `String(36)`, not `UUID`, for SQLite test compatibility (C4).
5. **Helper placement**: `assert_project_writable` lives in `video_project_service`, not `dependencies/auth.py` (C5).
6. **Service contract**: `_assert_pack_owned(db, pack_id, user_id) -> str` takes primitive ids and returns the bound `project_id` (C6).
7. **Atomic deploy mandated**: BE+FE deploy together; split deploy only via env flag (out of scope) (C7).
8. **Hardening is mandatory** for `describe`, `batch-video`, `batch-video/status`, `compose`. `generate-script`/`revise-script`/`queue/status` remain un-gated (C8).

P2 items (C9–C12) are advisory and do not block implementation.

The implementer (Subtask #2) should follow v2 as the source of truth. Any deviation from a P0/P1 fix must be flagged in the implementation PR description.
