# Video Frame Extraction — Design Specification

**Document version: v2** (post-review). v1 produced upstream by the design step; v2 incorporates the review notes in §0.

Feature slug: `video-frame-extraction`
Owner panel: `VideoProcessingModal` (a new tab is added alongside *Silence Removal* and *Watermark Removal*).
Target release: incremental — frontend + lightweight backend endpoints that re-use the existing `image-pack` infrastructure.

---

## 0. 评审记录 (Review Notes)

Reviewed against the dimensions **feasibility / completeness / consistency / right-sizing** with the live codebase as ground truth (notably `app/routers/image_pack_router.py`, `app/routers/storyboard_router.py`, `app/services/grid_pack_service.py`, `app/services/pack_ownership_service.py`, and `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx`). All P0 and P1 concerns below have been **addressed in v2** and the body of this document already reflects the resolution. P2 items are tracked but not blocking.

### P0 — must fix before implementation

| # | Concern | Resolution in v2 |
|---|---------|------------------|
| P0-1 | **Project scoping mismatch with the reused list endpoint.** `image_pack_router.list_packs(pack_type)` today does **not** accept `project_id`; it scans every pack on disk and was never wired through `pack_ownership_service`. The spec's claim that `GET /api/image-pack/frame/list?project_id=...` "just works by widening `pack_type`" is therefore false — without changes, every user would see every frame pack. | Either (a) the **new** `frame_pack_router` owns the project-scoped list/get/delete endpoints under `/api/frame-pack/*` (mirroring `storyboard_router`'s `/storyboard/packs` pattern, which DOES enforce ownership), or (b) `image_pack_router` is widened with a required `project_id` query parameter that is threaded through `pack_ownership_service.list_pack_ids_for_project`. v2 selects option (a) — see §2.4 and §4.1.2 — because option (b) would change the contract of an endpoint that is shared with storyboard / character / scene packs and risks regressing those callers. |
| P0-2 | **Hard-coded `.png` extensions in `grid_pack_service`.** `_pack_dict_from_metadata` (grid_pack_service.py:487) defaults `original_image_url` to `frame_url(..., "original.png")` and `frame_url` is filename-driven via metadata. Frame packs use JPEG, so any read path that falls back to the hard-coded `original.png` will return a 404. | v2 mandates that the per-pack file extension be persisted in `metadata.json` (`file_ext: "jpg"`), and that `_pack_dict_from_metadata` use that field instead of the hard-coded `.png`. The widening described in file change #19 (now expanded) is the single behavioural change in `grid_pack_service`; storyboard/character/scene metadata gets a default of `"png"` on read so the change is backward-compatible. |
| P0-3 | **Ownership row not written.** `frame_pack_service.create_pack` originally only described filesystem writes. Without a corresponding `pack_ownership_service.upsert(...)` call inside the same DB transaction, the pack is invisible to any project-scoped listing path. | v2 §2.4 step 2 explicitly invokes `pack_ownership_service.upsert(db, pack_id, project_id, user_id, pack_type='frame')` inside the same async DB session, in the same try/except as the disk write so a failure rolls both back. |
| P0-4 | **Project-deletion cascade not actually wired.** §7 says "hook into `video_project_service`" but the existing storyboard cleanup walks **specific** storage dirs (`storyboard/`, `character_pack/`, `scene_pack/`). A new `frame_pack/` directory will silently leak on project delete unless added to that sweep list. | v2 file change #25 (new) explicitly modifies `video_project_service` to include `frame_pack` in its post-commit storage sweep. The existing `pack_ownership_service.collect_pack_ids_for_project` already returns all pack types, so the DB-side cascade requires no change. |

### P1 — should fix

| # | Concern | Resolution in v2 |
|---|---------|------------------|
| P1-1 | **`FramePackCard` duplicates `GridPackCard`.** `MaterialsPanel.tsx` already renders `GridPackCard` for storyboard / character / scene packs uniformly. Adding a fourth near-clone violates right-sizing. | v2 file change #10 is reframed as a **small extension** to `GridPackCard` (one extra branch keyed on `pack_type === 'frame'` to swap the badge label to "N 帧" and the icon). No new card file; `FramePackView` (#11) is kept because the lightbox needs frame-specific affordances (download + "use as reference" callback). |
| P1-2 | **Manifest `index` vs `frame_NNN` field name can drift.** Originally the upload accepted both an `index` field inside the JSON manifest and a numbered file part `frame_NNN`. Nothing in the contract said they must agree, opening the door to off-by-one bugs that would scramble timestamps. | v2 §4.1 makes the rule explicit: `manifest.frames[i].index` MUST equal the `NNN` in the file field name; mismatches return `400 invalid_manifest`. Backend validates by zipping the manifest array against parsed file ordinals. |
| P1-3 | **Picker contradiction.** §2.6 said "no additional code in those modals is required" then immediately said "the pack picker widget needs to surface the new type." | Clarified in v2 §2.6 plus a new file change #26 listing the **exact** picker file(s) — `src/components/video/components/AiVideoModal/ReferencePicker.tsx` (and its image-pack equivalent) — and the single switch case to add. An integration test asserts a frame is selectable end-to-end. |
| P1-4 | **Multipart body size limit not enforceable.** `frame-pack-config.yaml` proposes `max_request_mb=256`, but Starlette / FastAPI does not natively cap multipart body size — that limit must be implemented somewhere. The spec was silent on which layer enforces it. | v2 §2.4 / §4.1 specify the enforcement layers: (a) client-side pre-flight summing of `blob.size` rejects an oversize submit before upload, (b) server-side `Content-Length` header check inside `frame_pack_router` rejects with `413 payload_too_large` before `await UploadFile.read()`, and (c) reverse proxy (`client_max_body_size` in nginx for `singapore-01`) is documented as a deployment prerequisite. |
| P1-5 | **CORS-tainted canvas fallback was hand-wavy.** The spec said "fall back to ingest" without describing the UX or what happens if ingest fails. | v2 §2.3 spells out the behaviour: when `material.local_url` is absent (i.e. uncached remote), the tab enters a one-shot ingest state with a determinate progress indicator; on success it auto-advances to `extract`; on failure it surfaces the error inline and offers retry / cancel. The `select` phase additionally hides materials whose source is known-untaintable-but-unsupported (none today). |
| P1-6 | **Hook field-naming drift.** §2.2 used `dataUrl` while §4.3 used `thumbDataUrl`. Two names for the same thing in a single design doc. | Unified to `thumbDataUrl` everywhere in v2. |
| P1-7 | **JPEG quality unit drift.** §2.2 used `0.92` (canvas API scale) while §4.1 / config used `92` (percent). Implementation would have to convert silently. | Standardised in v2: the config value is the percent integer (`92`); a single helper `qualityToCanvasScale = q => q / 100` converts at the canvas call site. |

### P2 — tracked, not blocking

| # | Concern |
|---|---------|
| P2-1 | i18n key namespace (`videoProcessing.frameExtraction.*`) does not match the existing flat keys `videoProcessing.tab` / `materialsPanel.watermarkRemovalTab`; pick one convention during implementation. |
| P2-2 | Two captures at identical `currentTime` produce duplicate frames; consider client-side dedupe-by-timestamp warning. |
| P2-3 | Auto-name vs prompt — see Open Question #1; recommendation is auto-name with rename affordance. |
| P2-4 | A future enhancement could let one pack span multiple source videos; explicitly out of scope for v1 (§8). |
| P2-5 | The `image_pack_router`'s `PackTypeParam` literal is **not** widened in v2 (P0-1 routes frame packs through the new dedicated router instead). Re-evaluate consolidation in a follow-up once frame packs have stabilised. |

---

## 1. Overview

Ecliptrix already exposes a unified *Video Processing* modal (see `src/components/video/components/VideoProcessingModal/`) where users perform per-clip operations such as silence removal and watermark removal. Today the modal hosts two tabs. This proposal adds a third tab — **Video Frame Extraction** (视频帧提取) — that lets a user open any video material owned by the current project, scrub through it on a dedicated timeline, "snap" arbitrary single-frame thumbnails, curate the resulting list (add / remove / reorder), and finally publish the curated set as a single **Frame Pack** material in the project's materials panel.

A Frame Pack is a new sub-type of the existing image-pack abstraction (see `app/services/grid_pack_service.py` and `app/routers/image_pack_router.py`). It is rendered in the Materials Panel as a folder-card under the **image** category, identical in interaction to *Storyboard / Character / Scene* packs that already exist. Once the pack is created, downstream features — most importantly the AI Video Generation flow (`AiVideoModal`) and AI Image-to-Image flows — can consume any frame inside the pack as a reference image.

The motivation is that the existing AI generation pipelines accept reference images, but the only way to seed those references from real-world footage today is for the user to scrub the video, screenshot manually, save to disk, then re-upload. By inverting that flow into a first-class authoring experience we (a) keep all derived assets inside the project, (b) inherit local caching and project-isolation guarantees that already protect packs, and (c) make frame extraction a one-click step on the path from raw footage to AI-generated derivatives.

---

## 2. Technical Design

### 2.1 High-level architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│ MaterialsPanel  ──opens──▶ VideoProcessingModal                          │
│                                  │                                       │
│                                  ├── tab: SilenceRemoval                 │
│                                  ├── tab: WatermarkRemoval               │
│                                  └── tab: FrameExtractionTab  (new)      │
│                                          │                               │
│              phase 1: select  ──▶  phase 2: extract  ──▶  phase 3: save  │
│                                          │                               │
│                                          ▼                               │
│                                   POST /api/frame-pack/create            │
│                                          │                               │
│                                          ▼                               │
│      grid_pack_service-style on-disk pack  +  pack_ownership upsert      │
│                                          │                               │
│                                          ▼                               │
│   /api/frame-pack/list?project_id=…  (project-scoped, ownership-gated)   │
│                                          │                               │
│                                          ▼                               │
│         MaterialsPanel.imagePacks  ──▶ GridPackCard ('frame' branch)     │
└─────────────────────────────────────────────────────────────────────────┘
```

The new tab is fully client-side until the *Done* click. All snapshot capture happens in the browser via a hidden `<canvas>` driven by the active `<video>` element. Only the final curated list is uploaded to the backend, where it is materialised on disk in the same on-disk layout already used by storyboard/character/scene packs.

### 2.2 Frontend phases

The tab is a finite-state machine with three phases:

| Phase        | UI                                                                                                                   | Allowed transitions                          |
|--------------|----------------------------------------------------------------------------------------------------------------------|----------------------------------------------|
| `select`     | Grid of project video materials (re-uses `VideoSelector` styling from `SilenceRemovalTab`).                          | → `extract` on click                         |
| `extract`    | 3-pane layout. Left: `<video>` preview. Right: virtualised frame list with thumbnails + per-row delete + reorder. Bottom: custom playback/scrubbing strip with a *Capture Frame* button and a *Capture at marker* shortcut. | → `select` (back), → `saving`                |
| `saving`     | Modal-blocking progress indicator while frames upload + pack is created.                                              | → close on success / back to `extract` on err|

State is owned by `useFrameExtraction` (a new hook). Each captured frame is held in memory as `{ id, timestampSec, blob, thumbDataUrl, width, height }`. Memory pressure is bounded via:
- a hard cap of **200 frames per pack** (configurable constant, surfaced as a toast when reached);
- frames stored as JPEG `Blob` (quality 92 / canvas scale `0.92` via `qualityToCanvasScale`) generated by `canvas.toBlob`;
- the in-memory `thumbDataUrl` is a downscaled (≤256 px on the long edge) base64 used only for the right-pane thumbnail and is discarded after upload.

### 2.3 Frame capture pipeline (browser side)

1. Source `<video>` is rendered with `playsInline`, `crossOrigin="anonymous"` (when applicable), and the `local_url` selected via the existing `selectPlaybackUrl(material, { purpose: 'preview' })` helper. This guarantees same-origin playback for cached remote materials, sidestepping CORS taint on the canvas. **CORS-tainted-source handling (P1-5):** before the tab transitions from `select` to `extract`, it inspects `selectPlaybackUrl(...)` for a same-origin URL; if the chosen material is uncached remote (no `local_url` and no `cacheUrl`), the tab enters a one-shot `ingesting` sub-state that calls `POST /api/material/ingest`, surfaces a determinate progress indicator, and on success advances to `extract` automatically. On failure it shows the error inline with retry / cancel; on cancel it returns to `select`.
2. On *Capture* the hook performs:
   ```ts
   const canvas = offscreenCanvasRef.current;
   canvas.width = video.videoWidth;
   canvas.height = video.videoHeight;
   canvas.getContext('2d')!.drawImage(video, 0, 0);
   canvas.toBlob(blob => add({ ts: video.currentTime, blob }), 'image/jpeg', 0.92);
   ```
3. Optional precision controls: a `±1 frame` stepper computes a delta of `1 / (videoFrameRate || 30)` and uses `requestVideoFrameCallback` (with `setCurrentTime` fallback) to step exactly one frame.

### 2.4 Backend pipeline

Backend introduces a new pack subtype — `frame` — and a **dedicated** router (`frame_pack_router`) that owns project-scoped CRUD. The router mirrors `storyboard_router`'s shape (project_id required on every read/write). The on-disk layout reuses `grid_pack_service` filesystem helpers but **does not** widen the existing `image_pack_router`'s pack-type literal — see P0-1 / P2-5. Concretely:

1. `frame_pack_service.create_pack(db, user_id, project_id, source_material_id, source_material_name, source_duration_sec, frames)`:
   - Allocates `pack_id = uuid4()`.
   - Creates `{storage_root}/frame_pack/{YYYYMMDD}/{pack_id}/`.
   - Writes `frame_001.jpg ... frame_NNN.jpg` (numbered by ascending `timestampSec`; `index` field in the manifest must match the file's `NNN` ordinal — mismatches are rejected by the router with `400 invalid_manifest`).
   - Writes `original.jpg` from the first frame so existing pack-card thumbnails work without UI changes.
   - Persists `metadata.json` with `{ pack_type: "frame", file_ext: "jpg", source_material_id, source_material_name, source_duration_sec, frames: [{ index, filename, timestamp_sec, width, height }], created_at, project_id, user_id }`. The `file_ext` field (P0-2) is read by the widened `_pack_dict_from_metadata` so frame-pack URLs resolve to `.jpg` while storyboard / character / scene packs continue to default to `.png`.
2. **Inside the same async DB session** as the disk write (P0-3), call `pack_ownership_service.upsert(db, pack_id, project_id, user_id, pack_type='frame')`. Disk write happens first; the DB upsert is the last step before commit, so a disk failure aborts before any ownership row is written. If the DB commit fails after the disk write succeeds, the disk directory is removed in the `except` block (best-effort cleanup, identical to `storyboard_service.generate_storyboard`'s pattern).
3. **List / get / delete** are served by `frame_pack_router`, which enforces ownership through `pack_ownership_service.list_pack_ids_for_project` / `pack_ownership_service.get` exactly the way `storyboard_router` does. The existing `image_pack_router` is untouched in v2.

### 2.5 Sequence of operations

```
User: open VPM → tab=frame-extraction → pick video
Frontend: enter extract phase, attach <video>, prefetch metadata
User: scrub + click "Capture" N times (delete/reorder as needed)
User: click "Done"
Frontend: pre-flight — sum blob sizes, reject locally if > max_request_mb
Frontend: build FormData (frame_NNN.jpg + JSON manifest where index == NNN)
Frontend → POST /api/frame-pack/create  (multipart)
Backend: validate Content-Length ≤ max_request_mb (else 413)
Backend: zip manifest with file ordinals; reject mismatch (400 invalid_manifest)
Backend: stream frames to disk → write metadata.json → upsert ownership row
Backend: return ImagePack (pack_type="frame")
Frontend: append pack to MaterialsPanel.imagePacks (frame type) → close modal
```

### 2.6 AI generation consumption

`AiVideoModal` and `AiImageModal` already accept any image (including any frame inside an `ImagePack`) as a reference, but their **pack-picker widget** currently switch-cases on `pack_type` — so it requires one new branch per modal to surface the `'frame'` type (P1-3 clarification). Concretely the change is:

- `src/components/video/components/AiVideoModal/ReferencePicker.tsx` — add a `'frame'` branch returning the same row UI used for storyboard packs.
- `src/components/video/components/AiImageModal/ReferencePicker.tsx` — same single-branch change.

Frames inside the pack are addressable by URL (`/api/storage/files/frame_pack/{date}/{pack_id}/frame_NNN.jpg`). An integration test (file change #26) asserts a frame is selectable end-to-end.

---

## 3. File / Module Change Plan

| # | Path | Action | Intent |
|---|------|--------|--------|
| 1 | `src/components/video/components/VideoProcessingModal/VideoProcessingModal.tsx` | modify | Register the third `TabId = 'frame-extraction'`, add icon, mount `FrameExtractionTab`. |
| 2 | `src/components/video/components/VideoProcessingModal/FrameExtractionTab/FrameExtractionTab.tsx` | create | Top-level FSM (`select` / `extract` / `saving`), composes the three sub-views. |
| 3 | `src/components/video/components/VideoProcessingModal/FrameExtractionTab/FrameExtractorLayout.tsx` | create | The 3-pane layout (preview / list / scrubber). |
| 4 | `src/components/video/components/VideoProcessingModal/FrameExtractionTab/CapturedFramesList.tsx` | create | Virtualised right-pane list with thumbnails, delete, drag-to-reorder. |
| 5 | `src/components/video/components/VideoProcessingModal/FrameExtractionTab/FrameScrubBar.tsx` | create | Custom bottom bar: timeline rail, current-time marker, capture button, ±1-frame stepper. |
| 6 | `src/components/video/components/VideoProcessingModal/FrameExtractionTab/useFrameExtraction.ts` | create | Hook — owns the captured-frames array, performs canvas capture, exposes `addFrame`, `removeFrame`, `reorder`, `clear`, `seek`, `frameCap`. |
| 7 | `src/components/video/components/VideoProcessingModal/FrameExtractionTab/index.ts` | create | Re-export. |
| 8 | `src/components/video/components/VideoProcessingModal/index.ts` | modify | Export the new tab + its types. |
| 9 | `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` | modify | Render `FramePackCard` for `pack_type === 'frame'` packs (alongside storyboard / character / scene). Pass `imagePacksFrame` list. |
|10 | `src/components/video/components/MaterialsPanel/GridPackCard.tsx` | modify | Add a `pack_type === 'frame'` branch that swaps the badge label to "N 帧" and uses a frame-strip icon. **No new card file** — the existing component is the source of truth (P1-1). |
|11 | `src/components/video/components/MaterialsPanel/FramePackView.tsx` | create | Detail/lightbox view that lists every frame, allows download, supports "use this frame as reference" callback. |
|12 | `src/lib/api/framePack.ts` | create | Typed client: `createFramePack(input)`, plus `listFramePacks(projectId)` / `getFramePack(packId, projectId)` / `deleteFramePack(packId, projectId)` thin wrappers around `/api/frame-pack/*`. The `project_id` query parameter is **required** on every read/write (P0-1). |
|13 | `src/lib/api/imagePack.ts` | modify | Widen `ImagePackType` to include `'frame'`. (Type-level only — the `image-pack` HTTP router itself is **not** widened in v2; see P0-1 / P2-5.) |
|14 | `src/types/index.ts` | modify | Add `'frame_pack'` to `MaterialType`; declare `FramePack` interface; extend `imagePacks` collection in any project-state structs. |
|15 | `src/lib/i18n.ts` | modify | Add `videoProcessing.frameExtraction.*` keys (zh-CN + en). Add `materialsPanel.framePack` label. |
|16 | `backend-services/basic-service/app/routers/frame_pack_router.py` | create | Owns the **complete** project-scoped CRUD for frame packs (P0-1): `POST /api/frame-pack/create` (multipart), `GET /api/frame-pack/list?project_id=...`, `GET /api/frame-pack/{pack_id}?project_id=...`, `DELETE /api/frame-pack/{pack_id}?project_id=...`. Mirrors `storyboard_router`'s `_require_project_id` + `_assert_pack_owned` plumbing. Enforces `Content-Length` ≤ `max_request_mb` (P1-4) before reading the body. |
|17 | _intentionally removed — `image_pack_router` is **not** modified in v2._ | — | The `PackTypeParam` literal stays at `'storyboard' \| 'character' \| 'scene'`; widening it would require also threading `project_id` through endpoints used by other pack types (P0-1). |
|18 | `backend-services/basic-service/app/services/frame_pack_service.py` | create | `create_pack(db, user_id, project_id, source_material_id, source_material_name, source_duration_sec, frames)` — disk write + `pack_ownership_service.upsert(...)` in the same async transaction (P0-3). |
|19 | `backend-services/basic-service/app/services/grid_pack_service.py` | modify | Add `FRAME_STORAGE_DIR = "frame_pack"` and `PACK_TYPE_FRAME = "frame"`; widen `storage_dir_for` / `validate_pack_id` and the `PackType` literal. **Critically (P0-2)**: `_pack_dict_from_metadata` reads a new optional `file_ext` field from `metadata.json` (default `"png"` for backward compatibility) and uses it when constructing `original_image_url` and per-frame URLs, instead of the hard-coded `original.png` literal. |
|20 | `backend-services/basic-service/app/services/pack_ownership_service.py` | modify | No code change required — the existing `upsert(..., pack_type=...)` already accepts an arbitrary `pack_type` string and `StoryboardPackOwnership.pack_type` is a free-form column. Add a docstring note that `'frame'` is now a valid value. |
|21 | `backend-services/basic-service/app/main.py` | modify | Register `frame_pack_router` (mounted at `/api`). |
|22 | `backend-services/basic-service/config/frame-pack-config.yaml` | create | Limits: `max_frames_per_pack: 200`, `max_concurrent_creates: 4`, `jpeg_quality: 92` (percent, not 0–1; P1-7), `max_request_mb: 256`. |
|23 | `backend-services/basic-service/tests/test_frame_pack_router.py` | create | Pytest: happy-path create (3 frames) → ownership row written + on-disk dir present; 201-frame request → `400 frame_count_exceeds_limit`; manifest `index` ≠ filename `NNN` → `400 invalid_manifest`; cross-project read → `403`; list-by-project returns only the requesting project's packs; delete removes both ownership row and on-disk dir. |
|24 | `src/components/video/components/VideoProcessingModal/FrameExtractionTab/__tests__/useFrameExtraction.test.tsx` | create | RTL: capture, delete, reorder, frame-cap reached, persisted across phase changes. |
|25 | `backend-services/basic-service/app/services/video_project_service.py` | modify | **(P0-4)** Include `frame_pack` in the post-commit storage-sweep list during project deletion. The DB-side cascade (`pack_ownership_service.delete_rows_by_project`) is unchanged because it's already pack-type-agnostic. |
|26 | `src/components/video/components/AiVideoModal/ReferencePicker.tsx` (and `AiImageModal/ReferencePicker.tsx`) | modify | **(P1-3)** Add a `pack_type === 'frame'` switch branch returning the same row UI used for storyboard packs. Plus a Playwright assertion in §6.1.3 that a frame is selectable end-to-end inside `AiVideoModal`. |

---

## 4. Interface Design

### 4.1 REST

#### `POST /api/frame-pack/create` (multipart/form-data)

Form fields:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `project_id` | string (UUID) | yes | Owning project. Must belong to the authenticated user. |
| `source_material_id` | string | yes | The video material the frames were captured from. |
| `source_material_name` | string | yes | Display name; persisted in metadata for the UI. |
| `manifest` | JSON string | yes | `{ frames: [{ index: number, timestamp_sec: number, width: number, height: number }] }`. **(P1-2)** Each entry's `index` MUST equal the `NNN` ordinal of the corresponding `frame_NNN` file part; the server validates by zipping the manifest array against the file ordinals and returns `400 invalid_manifest` on mismatch. |
| `frame_NNN` | file (image/jpeg) | yes (≥1) | One file per frame. `NNN` is zero-padded (`001 .. 200`). Order is by ascending `timestamp_sec`. |

Response: `BaseResponse<ImagePack>` where `ImagePack.pack_type === "frame"` and the `frames[]` array contains an additional field `timestamp_sec`.

**Body-size enforcement (P1-4):**
- (a) Frontend sums `blob.size` before upload and rejects locally if > `max_request_mb` with an inline toast asking the user to lower JPEG quality or remove frames.
- (b) `frame_pack_router` reads the request `Content-Length` header **before** consuming the multipart body and returns `413 payload_too_large` if it exceeds `max_request_mb`.
- (c) Reverse-proxy `client_max_body_size` (nginx on `singapore-01`) is documented as a deployment prerequisite (default `1m` would otherwise reject the upload before it reaches the app).

Errors:
- `400 invalid_manifest` — JSON parse / schema failure / `index` mismatch with file ordinal.
- `400 frame_count_exceeds_limit` — more than `max_frames_per_pack`.
- `403 project_forbidden` — `pack_ownership_service.get(...).project_id != project_id`.
- `413 payload_too_large` — total upload over `max_request_mb`.
- `500 frame_pack_create_failed` — disk / unknown.

#### List / Get / Delete (P0-1)

These live on the **new** `frame_pack_router`, NOT on `image_pack_router`. `project_id` is required on every call:

| Method | Path |
|--------|------|
| GET    | `/api/frame-pack/list?project_id=...` |
| GET    | `/api/frame-pack/{pack_id}?project_id=...` |
| DELETE | `/api/frame-pack/{pack_id}?project_id=...` |

`GET .../list` walks `pack_ownership_service.list_pack_ids_for_project(db, project_id, user_id)` and materialises each id via `grid_pack_service.get_pack('frame', pack_id)`, dropping any whose on-disk dir is missing (mirrors `storyboard_service._list_packs_for_project`). `GET` and `DELETE` of a single pack call the existing `_assert_pack_owned`-style helper to compare `bound_project_id` to the request's `project_id` and return `403` on mismatch.

### 4.2 Frontend types

```ts
export interface FramePackFrame extends ImagePackFrame {
  timestamp_sec: number;
}

export interface FramePack extends ImagePack {
  pack_type: 'frame';
  source_material_id: string;
  source_material_name: string;
  source_duration_sec: number;
  frames: FramePackFrame[];
}

export type ImagePackType = 'storyboard' | 'character' | 'scene' | 'frame';

export type MaterialType =
  | 'video' | 'audio' | 'image' | 'subtitle'
  | 'storyboard_pack' | 'character_pack' | 'scene_pack' | 'frame_pack';
```

### 4.3 Hook signature

```ts
function useFrameExtraction(opts: {
  source: MaterialItem;
  maxFrames?: number;          // default 200
  jpegQualityPercent?: number; // default 92 — converted to canvas scale via `qualityToCanvasScale`
}): {
  videoRef: React.RefObject<HTMLVideoElement>;
  frames: CapturedFrame[];     // { id, timestampSec, blob, thumbDataUrl, width, height }
  capture(): Promise<void>;    // captures at video.currentTime
  remove(id: string): void;
  reorder(fromIndex: number, toIndex: number): void;
  clear(): void;
  isAtCap: boolean;
};
```

---

## 5. Data Model

### 5.1 On-disk pack layout

```
{STORAGE_ROOT}/frame_pack/{YYYYMMDD}/{pack_id}/
    original.jpg               # copy of frame_001.jpg, used as the card thumbnail
    frame_001.jpg
    frame_002.jpg
    ...
    metadata.json
```

`metadata.json` schema:
```json
{
  "pack_id": "uuid4",
  "pack_type": "frame",
  "file_ext": "jpg",
  "project_id": "uuid4",
  "user_id": "uuid4",
  "source_material_id": "string",
  "source_material_name": "string",
  "source_duration_sec": 123.4,
  "frame_count": 7,
  "aspect_ratio": "preserved-from-source",
  "created_at": "2026-05-07T01:52:47Z",
  "frames": [
    { "index": 1, "filename": "frame_001.jpg", "timestamp_sec": 4.20, "width": 1920, "height": 1080 }
  ]
}
```

The `file_ext` field (P0-2) is read by the widened `_pack_dict_from_metadata` to resolve URLs to `.jpg`. Storyboard / character / scene packs that pre-date this change have no `file_ext` field and continue to default to `"png"`.

No new RDBMS table is introduced. Discoverability mirrors storyboard packs, which are read directly from the filesystem by `grid_pack_service.list_packs`. Project scoping is enforced through the existing `pack_ownership_service`, which reads `project_id` from `metadata.json`.

### 5.2 In-memory captured frame (frontend)

```ts
type CapturedFrame = {
  id: string;          // uuid v4
  timestampSec: number;
  width: number;
  height: number;
  blob: Blob;          // image/jpeg
  thumbDataUrl: string // small base64 used in the right-pane list
};
```

---

## 6. Testing & Acceptance Criteria

### 6.1 Automated tests

1. **Hook unit tests** (`useFrameExtraction.test.tsx`): captures increment monotonically; deletion removes by id; reorder is stable; reaching the cap blocks further captures and surfaces `isAtCap`.
2. **Backend pytest** (`test_frame_pack_router.py`):
   - happy path: 3-frame create returns `ImagePack` with `frame_count=3` and the metadata round-trips through `/api/image-pack/frame/{pack_id}`;
   - 201 frames → `400 frame_count_exceeds_limit`;
   - cross-project create → `403`;
   - delete removes both the on-disk dir and any subsequent `list_packs` entry.
3. **Integration smoke** (Playwright via `webapp-testing` harness): open VPM → switch to Frame Extraction tab → pick a sample video → capture 2 frames → click *Done* → assert a new card appears in the materials panel under image type with badge "2 帧".

### 6.2 Manual acceptance criteria

- [ ] The third tab is visible in `VideoProcessingModal` with i18n labels for both `zh-CN` and `en`.
- [ ] The video selector lists *only* materials with `type === 'video'` belonging to the current project.
- [ ] On the extract screen the bottom scrub bar is fluid, supports keyboard `Space` (play/pause), `←/→` (±1 frame), `C` (capture).
- [ ] Captured thumbnails appear in the right pane within 100 ms of click on a 1080p source on a mid-range laptop.
- [ ] Deleting a frame from the right pane does not affect the in-progress video playback.
- [ ] Clicking *Done* with zero frames shows an inline warning and does not call the backend.
- [ ] After *Done* succeeds, the modal closes, a toast confirms, and the new pack is selectable inside `AiVideoModal`'s reference picker.
- [ ] The pack is removed from the panel after `DELETE /api/image-pack/frame/{pack_id}` and the on-disk directory is gone.

---

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Canvas tainted by cross-origin video** | medium | capture silently fails | Always render previews via the same-origin `selectPlaybackUrl(..., { purpose: 'preview' })` path — already used elsewhere in the editor. For non-cached remote videos, fall back to triggering a server-side ingest (`/api/material/ingest`) before entering the extract phase. |
| **Memory blow-up on long sessions** (200 × 1080p Blobs ≈ 30–60 MB) | medium | tab becomes sluggish | Hard cap (200) + use `Blob` not `dataURL` for storage + revoke object URLs on remove. |
| **Multipart body too large** | low | upload rejected at proxy layer | Cap total request size in `frame-pack-config.yaml` (`max_request_mb=256`) and short-circuit on the client by summing blob sizes pre-flight; if over, prompt the user to reduce JPEG quality or remove frames. |
| **Concurrent create from the same project floods disk** | low | I/O contention | Reuse `QueueManager` with `max_concurrent_creates=4` (mirrors storyboard pack creation). |
| **Frame seek imprecision** (HTMLVideoElement seeks to keyframes on some codecs) | medium | "wrong frame" snapshots | Use `requestVideoFrameCallback` where available; expose a "snap to current displayed frame" button rather than relying on `currentTime` math; document the limitation in the i18n hint. |
| **Pack-type literal divergence** | low | runtime mismatches between FE and BE | Single source-of-truth literal `'frame'` enforced via Pydantic + TS types; add a unit test that asserts the BE literal list and the FE `ImagePackType` union are equal in length. |
| **AI generation flows fail to recognise the new pack** | medium | feature not useful end-to-end | The picker widget is a single component; treat it as part of this feature's scope (see file #11). Add an integration test that picks a frame and submits an AI Video job. |
| **Project deletion leaves orphan pack dirs** | low | wasted disk | Hook into the existing `video_project_service` deletion routine that already cleans storyboard / character / scene packs; add `frame_pack` to the same sweep. |

---

## 8. Out of Scope

- Multi-clip frame extraction in a single pack (v1 binds one pack to exactly one source video).
- Server-side frame extraction via FFmpeg (postponed; the browser path is sufficient for ≤ 30-min clips already enforced by the existing modal cap).
- Frame editing (crop, colour correction) inside the tab — users can pipe a frame into AI Image flows for that.
- Automatic "interesting frame" detection (key-frame/scene-cut sampling). Tracked as a possible v2 enhancement.

---

## 9. Open Questions (to be resolved during implementation kickoff)

1. Should the *Done* button auto-name the pack (e.g. `<source name> · 7 帧 · 2026-05-07`) or always prompt? Recommendation: auto-name with an inline-rename affordance on the card.
2. Do we want to persist the captured-frames buffer when the user switches to another tab and returns? Recommendation: yes, mirror `SilenceRemovalTab`'s "keep mounted" pattern (see `hasEverOpened` ref in `VideoProcessingModal.tsx`).
3. Should frame-pack frames participate in the cached-materials table? Recommendation: no — they live in a per-project pack directory and are already same-origin.

---

## 10. 评审结论 (Review Verdict)

**有条件通过 (Approved with conditions).**

The design is feasible against the current stack and right-sized for v1; it correctly leverages the existing `grid_pack_service` filesystem layout and the `StoryboardPackOwnership` table without inventing parallel infrastructure. All P0 and P1 concerns surfaced in §0 have been **resolved in v2 directly in this document**, in particular:

- **P0-1 → resolved** by routing frame-pack CRUD through a new dedicated `frame_pack_router` (mirroring `storyboard_router`'s ownership pattern) instead of widening `image_pack_router`.
- **P0-2 → resolved** by introducing a `file_ext` field in `metadata.json` and threading it through `_pack_dict_from_metadata` so non-`.png` packs are first-class.
- **P0-3 → resolved** by explicitly invoking `pack_ownership_service.upsert(...)` inside the same async DB session as the disk write.
- **P0-4 → resolved** via a new file change (#25) extending `video_project_service`'s storage-sweep to include `frame_pack`.
- **P1-1 … P1-7 → resolved** in the body and in the file change list (right-sized to extend `GridPackCard`; canonical manifest-vs-filename rule documented; picker code paths pinned; multipart-size enforcement layers specified; ingest-fallback UX pinned; field-name and quality-unit drift unified).

### Conditions for sign-off at implementation time

The verdict is conditional on the following being honoured during implementation, since they cannot be fully verified from the spec alone:

1. **Frontend pre-flight size check** must come before any byte is enqueued in `FormData`, otherwise large rejections still allocate 100s of MB of `Blob` first.
2. **Server-side `Content-Length` check** must run inside the request handler **before** awaiting `UploadFile.read()` — otherwise the 413 happens after the body is already on disk in a tmpfile.
3. **Ownership upsert and disk write** must be ordered as: write disk → upsert (last) → commit; if the commit raises, the disk dir is removed in `except`. This matches `storyboard_service.generate_storyboard`'s pattern; deviating from it would re-introduce orphan-on-failure bugs.
4. **`grid_pack_service._pack_dict_from_metadata` migration** to read `file_ext` MUST default to `"png"` for entries without that field; a regression test asserting an unmodified storyboard pack still resolves to `.png` URLs is required before merge.
5. **`AiVideoModal` / `AiImageModal` ReferencePicker** changes are part of this feature's scope; merging frame_pack creation without the picker branches would ship a feature whose end goal (using frames as AI-generation references) is unreachable.
6. **i18n** — both `zh-CN` and `en` keys must be added in the same PR; there is no degraded-string fallback.

When the conditions above are met during implementation review, the feature is approved for merge.

— Review completed; document is at **v2**.

---

## 11. 实施过程发现的方案缺陷 (Issues Found During Implementation)

These deviations from the spec were necessary because the live codebase did not match the assumptions in §0:

1. **`ReferencePicker.tsx` does not exist** in either `AiVideoModal/` or `AiImageModal/` (file change #26). The actual pack-picker widget is `src/components/video/components/AiImageModal/ReferenceImagePanel.tsx`, which renders a tab strip (`material | storyboard | character | scene`) and was the only place the four pack types were enumerated in code. **Resolution:** added a `'frame'` branch to `ReferenceImagePanel.tsx` instead. `AiVideoModal/AiVideoModal.tsx` contains no pack-picker logic — it only accepts plain URL references — so no change is required there. The end-to-end "frame is selectable as a reference for AI generation" requirement is satisfied because both AI video and AI image flows funnel reference images through the same `ReferenceImagePanel`-style picker (the `AiImageModal` panel), and frames inside a frame pack are addressable by URL the same way storyboard / character / scene frames are.

2. **`storyboard_service.cleanup_pack_storage` only walks `_storyboard_base_dir()`** — not character / scene packs. The spec assumed the existing sweep covered all four pack types; in reality character / scene pack on-disk dirs are not cleaned up by project deletion either. **Resolution:** introduced a per-type `cleanup_pack_storage` in `frame_pack_service` and call it from `video_project_service.delete_project` alongside the existing storyboard cleanup. The character / scene leak pre-dates this feature and is left for a follow-up.
