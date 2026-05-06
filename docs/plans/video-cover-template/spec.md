# Spec — Video Cover Template

> **Feature slug:** `video-cover-template`
> **Owner:** Ecliptrix video editing team
> **Status:** **v2** — reviewed 2026-05-07 (P0/P1 review concerns resolved inline), ready for implementation
> **Document version:** v2
> **Source-of-truth references in this folder:** `master-plan.md`, `specs/01..07.md`, `todos/01..07.md`, `task-orchestration.md`. This `spec.md` is the consolidated, line-item implementable design document.

---

## 1. Overview

The Ecliptrix video editor currently exposes an aspect-ratio control row inside `VideoPlayerPanel` but offers no way to author a thumbnail/cover for the project. This feature adds a **Cover** button next to the aspect-ratio button group (80/20 split) that opens a 90vw × 85vh modal with a left/right layout: the **left 40%** hosts a 4-template picker plus a contextual text-style toolbar; the **right 60%** is a live preview that respects the project's selected aspect ratio, with a **frame scrubber** below it that walks a *virtual timeline* concatenating every video clip on the timeline (skipping empty gaps and audio-only segments). Users can pick a template, double-click any text layer to edit content/font/size/color/alignment, drag the scrubber to choose a background frame, optionally swap to a locally uploaded image, and finally export a 1080p PNG of the cover.

The cover state (template id, text layers, decorations, image source, virtual frame time, uploaded image URL, aspect ratio) is persisted in a new `project_covers` table via a small FastAPI router; the most recently rendered PNG is uploaded to `STORAGE_ROOT` and its URL is written back into the existing `video_projects.cover_url` column so project cards can display it. PNG generation happens entirely in the browser via `html-to-image` — no server-side rendering, no Puppeteer, no FFmpeg pipeline. The PNG is **standalone**: it is *not* embedded into exported MP4s in this version. The architecture nevertheless reserves a `cover_render_metadata` extension hook so a future "burn cover as first frame" feature can reuse the same data model.

This spec is scoped strictly to the cover authoring experience. AI cover generation, multi-cover history, drag/rotate text layers, custom aspect ratios beyond what `VideoPlayerPanel` already supports, user-uploaded templates, and backend-rendered templates are explicitly **non-goals** for v1 (see §11). The implementation must match Ecliptrix conventions: Next.js 15 App Router BFF proxying to FastAPI, async SQLAlchemy + Alembic, async/await throughout, theme-aware via existing CSS variables, and i18n keys added to `src/lib/i18n.ts`.

---

## 评审记录 (Review Notes — v2)

> Reviewer: senior reviewer, 2026-05-07. Severity legend: **P0** = blocks implementation or will produce a broken artifact; **P1** = will require rework if not addressed before coding; **P2** = readability / minor polish. All P0 and P1 items are resolved inline in the body below; P2 items are listed for the implementer's awareness.

### P0 — must fix before coding (resolved in v2)

| # | Section | Concern | Resolution |
|---|---------|---------|------------|
| P0-1 | §2.2.D, §2.2.E, §4.2 | Storage paths in v1 doubled the prefix: `STORAGE_ROOT/static/uploads/projects/...`. `STORAGE_ROOT` (default `static/uploads`, see `app/main.py:527-532`) is **already** the directory mounted at `/api/storage/files`, so the v1 path resolved to `static/uploads/static/uploads/projects/<id>/cover.png` on disk while the URL `/api/storage/files/projects/<id>/cover.png` would 404. | Rewrote all backend file paths in §2.2.D, §2.2.E and §4.2 to `STORAGE_ROOT/projects/<project_id>/<filename>`. The URL pattern under `/api/storage/files/...` is unchanged and now resolves correctly. |
| P0-2 | §5.1 | DB-level FK `project_id → video_projects(id) ON DELETE CASCADE` contradicts the codebase's house style. The closest analogue, `storyboard_packs` (`db_models.py:201-228`), explicitly states "No DB-level FK to `video_projects`" and enforces ownership / cascade at the service layer. Adding a FK here would be the *only* such FK among project-owned tables and would also fail on legacy environments where orphan rows pre-date the migration. | Removed the DB-level FK. `project_id` remains `unique` + indexed; ownership and cascade-delete are enforced at the service layer (the existing `delete_video_project` flow now also deletes the `project_covers` row + its on-disk PNG/uploaded background before deleting the project). |

### P1 — must fix before coding (resolved in v2)

| # | Section | Concern | Resolution |
|---|---------|---------|------------|
| P1-1 | §4.2 | `INSERT ... ON CONFLICT (project_id) DO UPDATE` is dialect-specific in SQLAlchemy (`postgresql.insert` vs `sqlite.insert`). Backend tests use SQLite in-memory (per `CLAUDE.md`); a Postgres-only path forces a second code path or breaks tests. | Switched to a portable upsert: `SELECT` by `project_id` inside the transaction; if found, mutate columns and `flush`; else `add()` a new row. The UNIQUE constraint catches the rare race; the service catches `IntegrityError` and retries the SELECT branch. Same code path on Postgres + SQLite. |
| P1-2 | §9 (font fallback risk) | `html-to-image`'s `fontEmbedCSS` requires fetching `@font-face` declarations and inlining as data URLs — non-trivial, and the v1 spec did not specify *how* the CSS would be assembled. Without it, the downloaded PNG falls back to a generic font and looks nothing like the in-app preview. | Committed to the simpler path for v1: template defaults restrict to web-safe / system stacks (`system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif`) so OS rendering is faithful, and `fontEmbedCSS` is **omitted** from `toBlob` calls. Custom-font support is deferred to v2 (Open Question added to §12). |
| P1-3 | §5.2, §4.2 | `video_projects.cover_url` is a stable URL; after re-render the PNG bytes change but the URL doesn't — browsers / CDN serve stale thumbnails on the project list. | Both the URL written to `cover_url` and the URL returned by `POST png-cache` carry an `?v=<updated_at_unix>` query suffix. Frontend treats `cover_url` as opaque and never strips the query. The static mount ignores the query string and serves the file. |
| P1-4 | §4.2 | v1 said "via existing storage uploader", but `StorageService.upload_file` builds date-bucketed paths (`{folder}/YYYY/MM/DD/user_<id>/...`, see `storage_service.py:45-67`) and has no "well-known slot per project" helper. Without clarification the implementer either gets date-bucketed URLs (breaks the well-known overwrite contract) or writes outside `StorageService` and bypasses its sanitisation. | Added a thin helper `StorageService.write_to_well_known_slot(rel_path, content, content_type)` that reuses `_validate_path` + `_sanitize_filename` on the **filename component** while accepting an opinionated parent (`projects/<project_id>/`). The cover-PNG and uploaded-background paths go through this helper. `upload_file` is left untouched. |
| P1-5 | §5.4, §2.1 | `useFrameExtraction(materials, timelineItems)` referenced types that weren't anchored. Re-declaring `TimelineItem` or `VideoMaterial` would violate the codebase's single-source-of-truth rule. | Made the source explicit: hook signatures import `VideoMaterial` and `TimelineItem` from `src/types/index.ts`. `VideoCoverModal/types.ts` declares only **new** cover-specific types and never re-declares timeline / material types. |
| P1-6 | §10 / RSC boundary | Modal subtree depends on refs (`forwardRef`), `URL.createObjectURL`, `<video>` seek hacks, and `html-to-image` — all client-only. Next.js 15 App Router defaults files to RSC; v1 didn't declare the components as client components. | Added explicit rule: every new file under `src/components/video/components/VideoCoverModal/**` starts with `"use client"`. BFF routes use the default `runtime = 'nodejs'` (no Edge). |

### P2 — informational (acknowledged in v2)

| # | Section | Concern | Note |
|---|---------|---------|------|
| P2-1 | §7.1 | "Vitest/Jest per existing project setup" was fuzzy. | Project uses **Vitest** exclusively (`package.json` test scripts: `vitest run`). Tightened. |
| P2-2 | §5.1 | `cover_config` typed as `JSON / JSONB`. | Existing models all use `JSON` (e.g. `video_projects.project_data`). Tightened to `JSON`. |
| P2-3 | §10 | "`html-to-image` (~9 KB gz)". | Actual size ~17 KB gz / ~62 KB unpacked at v1.11.x. Tightened. |
| P2-4 | §6 | i18n key list is structural rather than fully enumerated. | Implementer enumerates leaves alongside component creation; review accepts the structural form as sufficient. |
| P2-5 | §12 Q1 | Slugified Chinese filename behaviour was unspecified. | Documented fallback: if the slug is empty after non-ASCII strip, use `cover-{projectId}.png`. |

---

## 2. Technical Design

### 2.1 Module composition

```
VideoEditingInterface (page)
  └─ VideoPlayerPanel
       └─ aspect-ratio-row (flex)
            ├─ aspect-ratio-group (flex: 4)        ◀── 80%
            └─ <CoverButton onClick=openModal /> (flex: 1)  ◀── 20%
  └─ <VideoCoverModal isOpen ...>
       ├─ Left 40%
       │   ├─ <TemplatePicker />          (4 templates, grid)
       │   └─ <TextStyleToolbar />        (active when a text layer is selected)
       └─ Right 60%
           ├─ <CoverPreview />            (aspect-ratio-clamped, layered DOM)
           │    ├─ background layer (frame dataURL OR uploaded image)
           │    ├─ <EditableTextLayer /> per text layer
           │    └─ <DecorationLayer />    (SVG/CSS shapes)
           ├─ source toggle: ◉ Frame  ○ Upload
           └─ <FrameScrubber /> OR <ImageUploadInput />   (mutually exclusive)
       └─ Footer: [Cancel] [Download Cover]
```

Hooks introduced:

| Hook | Responsibility |
|------|---------------|
| `useFrameExtraction(materials, timelineItems)` | Build the virtual timeline; expose `extractAt(virtualTimeSec)` returning a JPEG dataURL via the existing `/api/video-proxy` route + `<video>`/canvas pipeline. |
| `useCoverRender(previewRef, aspectRatio)` | Convert the preview DOM subtree into a 1080p PNG (`html-to-image.toBlob`) at the resolution computed from the aspect ratio. |
| `useCoverPersistence(projectId)` | Load initial state via `GET`, debounce-save via `PUT`, upload PNG via `POST /png-cache`. |

### 2.2 Sequence — open / edit / download

**A. Open modal**
1. `CoverButton` click → `setOpenCoverModal(true)`.
2. `VideoCoverModal` mounts; `useCoverPersistence.load(projectId)` issues `GET /api/video-cover/<id>`.
3. Loaded state hydrates `templateId`, `config.textLayers`, `imageSource`, `frameVirtualTimeMs`, `uploadedImageUrl`, `aspectRatio`. If absent, `makeDefaultState({ templateId: 'title', aspectRatio: <player current> })` runs.
4. `<CoverPreview>` renders. On first paint it calls `useFrameExtraction.extractAt(0)` to populate the background.

**B. Pick / edit template**
1. Click thumbnail → `applyTemplate(nextTemplateId, prevState)`:
   - Walks `prev.config.textLayers`; for each `key` that exists in the new template's `defaultConfig.textLayers`, **carry over the user's `text` content**, reset font/size/color/align/weight to the new template's defaults.
   - Replaces decorations wholesale with the new template's defaults.
2. Double-click a text layer → `setEditingLayerId(layer.key)`; the layer becomes `contenteditable`. `TextStyleToolbar` binds to that layer.
3. Toolbar interactions update the layer's style fields directly in React state.
4. `Esc`, `blur`, or clicking outside commits and exits edit mode.

**C. Frame scrubbing**
1. Compute virtual timeline:
   ```
   buildVirtualSegments(timelineItems):
     videoItems = filter(timelineItems, mediaType == 'video')
     sort by startTime
     cumulative = 0
     for item in videoItems:
       duration = item.endTime - item.startTime
       segments.push({ virtualStart: cumulative, virtualEnd: cumulative+duration,
                       material: item.material, clipOffset: item.materialStart })
       cumulative += duration
     return { segments, totalVirtualDurationMs: cumulative*1000 }
   ```
2. Scrubber `max = totalVirtualDurationMs / 1000`; if `videoItems.length === 0`, scrubber is locked and source auto-flips to "Upload".
3. On drag (200 ms debounce):
   `mapVirtualTimeToClip(t, segments) → { material, localTime }` then `extractVideoFrameAt(material.url, localTime)` returns a JPEG dataURL.
4. On drag end → `useCoverPersistence.save(state)` (also debounced 600 ms inside the hook).

**D. Source toggle**
- Frame → Upload: clear `frameVirtualTimeMs`; show `<ImageUploadInput>` (`accept="image/*"`, max 10 MB; in-memory `URL.createObjectURL` + upload to `STORAGE_ROOT/projects/<project_id>/cover-bg-<uuid>.<ext>` via the new `StorageService.write_to_well_known_slot()` helper — see §4.2). Resolved URL: `/api/storage/files/projects/<project_id>/cover-bg-<uuid>.<ext>`.
- Upload → Frame: clear `uploadedImageUrl`; restore scrubber.

> Note: `STORAGE_ROOT` (default `static/uploads`) is *itself* the directory mounted at `/api/storage/files` (see `app/main.py:527-532`). Paths must therefore start at `STORAGE_ROOT/projects/...`, **not** `STORAGE_ROOT/static/uploads/projects/...` — that would resolve to a non-existent doubled path.

**E. Download**
1. Click `Download Cover` → `useCoverRender.render()`:
   - Compute `{ width, height }` from `aspectRatio` (1080 short side): 16:9 → 1920×1080, 9:16 → 1080×1920, 1:1 → 1080×1080, 4:3 → 1440×1080, 21:9 → 2520×1080.
   - Call `htmlToImage.toBlob(previewRef.current, { width, height, pixelRatio: width / previewRef.clientWidth, cacheBust: false })`. **`fontEmbedCSS` is intentionally omitted** (P1-2): v1 templates restrict text to web-safe / system stacks (`system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif`) so OS rendering matches the in-app preview.
2. `URL.createObjectURL(blob)` + invisible `<a download="{slugify(projectName)}-cover.png">`. If the slug is empty after non-ASCII strip, fall back to `cover-{projectId}.png`.
3. In parallel: `useCoverPersistence.uploadPng(blob)` → `POST /api/video-cover/<id>/png-cache`. Backend writes to `STORAGE_ROOT/projects/<project_id>/cover.png` (overwrite) via `StorageService.write_to_well_known_slot()`, updates `video_projects.cover_url` to `/api/storage/files/projects/<project_id>/cover.png?v=<updated_at_unix>` for cache-busting (P1-3), and returns `{ url, updated_at }` with the same query-suffixed URL.

### 2.3 Frame extraction reuse

The existing `src/components/video/utils/extractVideoThumbnail.ts` only seeks to a fixed time and downscales to 320 px wide — unsuitable for full-resolution scrubbing. Add a new exported function in the **same module** (no new file) so its `proxiedVideoUrl()` cross-origin proxy logic is shared:

```ts
export async function extractVideoFrameAt(
  videoUrl: string,
  timeSec: number,
  opts?: { maxWidth?: number; quality?: number }   // default: full resolution, q=0.92
): Promise<string>;   // JPEG dataURL
```

The original `extractVideoThumbnail()` is preserved unchanged for existing callers.

### 2.4 Theming & i18n

- All modal chrome reads from existing CSS variables (`--background`, `--foreground`, `--border`, `--primary`, `--muted-foreground`). No hard-coded hex.
- The preview *stage* (the rendered cover area) is intentionally **independent** of the app theme — it shows the final cover colors. A subtle checkerboard renders behind transparent regions.
- All user-visible strings registered under `videoCoverModal.*` in `src/lib/i18n.ts` (zh + en). Keys enumerated in §6.

---

## 3. File / Module Change Plan

| # | Path | Action | One-line intent |
|---|------|--------|-----------------|
| 1 | `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | modify | Wrap aspect-ratio buttons in flex:4 container; add `<CoverButton flex:1>` and `<VideoCoverModal>` mount |
| 2 | `src/components/video/components/VideoCoverModal/index.tsx` | create | Public re-export of `VideoCoverModal` |
| 3 | `src/components/video/components/VideoCoverModal/VideoCoverModal.tsx` | create | Modal container (overlay + Esc-close + click-outside), grid 40/60, wires hooks |
| 4 | `src/components/video/components/VideoCoverModal/CoverButton.tsx` | create | Lucide `Image`/`Frame` icon + i18n label, styled like `aspect-ratio-btn` |
| 5 | `src/components/video/components/VideoCoverModal/types.ts` | create | `CoverTemplateId`, `ImageSource`, `CoverAspectRatio`, `CoverTextLayer`, `CoverDecoration`, `CoverConfig`, `CoverState`, `CoverTemplateDefinition` |
| 6 | `src/components/video/components/VideoCoverModal/templates/titleTemplate.ts` | create | `defaultConfig` + thumbnail SVG for the "Title" template |
| 7 | `src/components/video/components/VideoCoverModal/templates/tutorialTemplate.ts` | create | "Tutorial" template definition |
| 8 | `src/components/video/components/VideoCoverModal/templates/clickTemplate.ts` | create | "Click-bait" template definition |
| 9 | `src/components/video/components/VideoCoverModal/templates/minimalTemplate.ts` | create | "Minimal" template definition |
| 10 | `src/components/video/components/VideoCoverModal/templates/index.ts` | create | `COVER_TEMPLATES` registry; `applyTemplate(id, prev)`; `makeDefaultState(opts)` |
| 11 | `src/components/video/components/VideoCoverModal/components/TemplatePicker.tsx` | create | 2×2 grid of thumbnails; current selection highlighted |
| 12 | `src/components/video/components/VideoCoverModal/components/TextStyleToolbar.tsx` | create | Font / size / color / align / B/I/U controls bound to active layer |
| 13 | `src/components/video/components/VideoCoverModal/components/CoverPreview.tsx` | create | `forwardRef` container; renders bg + text + decoration layers; respects aspect ratio |
| 14 | `src/components/video/components/VideoCoverModal/components/EditableTextLayer.tsx` | create | `contenteditable` text layer with IME-safe submit (Esc/blur/Enter) |
| 15 | `src/components/video/components/VideoCoverModal/components/DecorationLayer.tsx` | create | Renders `CoverDecoration[]` as SVG/CSS rects/lines/badges |
| 16 | `src/components/video/components/VideoCoverModal/components/FrameScrubber.tsx` | create | Range slider over virtual timeline; shows current `mm:ss`; locked when no video items |
| 17 | `src/components/video/components/VideoCoverModal/components/ImageUploadInput.tsx` | create | File picker + uploader + preview chip; calls existing storage api |
| 18 | `src/components/video/components/VideoCoverModal/components/SourceToggle.tsx` | create | Radio: Frame / Upload, mutually exclusive state |
| 19 | `src/components/video/components/VideoCoverModal/hooks/useFrameExtraction.ts` | create | `buildVirtualSegments` + `extractAt(virtualTimeSec)` with LRU(8) cache |
| 20 | `src/components/video/components/VideoCoverModal/hooks/useCoverRender.ts` | create | `html-to-image` → 1080p PNG blob; concurrency lock; 720p fallback |
| 21 | `src/components/video/components/VideoCoverModal/hooks/useCoverPersistence.ts` | create | `load`/`save` (debounced 600 ms)/`flush`/`uploadPng` |
| 22 | `src/components/video/components/VideoCoverModal/utils/aspectRatioToSize.ts` | create | `(ratio) => { width, height }` for export |
| 23 | `src/components/video/components/VideoCoverModal/utils/applyTemplate.ts` | create | Merges prior text content into new template config by `key` |
| 24 | `src/components/video/utils/extractVideoThumbnail.ts` | modify | Add `extractVideoFrameAt(url, timeSec, opts?)` exported alongside existing function |
| 25 | `src/lib/api/videoCover.ts` | create | Typed client: `getCover`, `putCover`, `uploadCoverPng` |
| 26 | `src/app/api/video-cover/[projectId]/route.ts` | create | BFF: `GET`/`PUT` proxy to `${BACKEND_URL}/api/video-cover/{projectId}` |
| 27 | `src/app/api/video-cover/[projectId]/png-cache/route.ts` | create | BFF: `POST` multipart proxy |
| 28 | `src/lib/i18n.ts` | modify | Add `videoCoverModal.*` keys (zh + en) |
| 29 | `package.json` | modify | Add `html-to-image` dependency |
| 30 | `package-lock.json` | modify | Lockfile update |
| 31 | `backend-services/basic-service/app/models/db_models.py` | modify | Add `ProjectCover` ORM class |
| 32 | `backend-services/basic-service/app/schemas/video_cover.py` | create | Pydantic `CoverStateIn/Out`, `PngCacheResponse` |
| 33 | `backend-services/basic-service/app/services/video_cover_service.py` | create | `get_by_project`, `upsert` (portable two-step, P1-1), `store_png_and_update_project`, `delete_for_project` (called from project-delete service path, P0-2) |
| 33b | `backend-services/basic-service/app/services/storage_service.py` | modify | Add `write_to_well_known_slot(rel_path, content, content_type)` helper (P1-4); reuse `_validate_path` + `_sanitize_filename` on the filename component only |
| 33c | `backend-services/basic-service/app/services/video_project_service.py` | modify | In the existing `delete_video_project` flow, invoke `video_cover_service.delete_for_project(project_id)` before deleting the project row (P0-2) |
| 34 | `backend-services/basic-service/app/routers/video_cover.py` | create | `GET`/`PUT`/`POST png-cache` (+ optional `DELETE`); auth via existing dependency |
| 35 | `backend-services/basic-service/app/main.py` | modify | Register `video_cover_router` under `/api` prefix |
| 36 | `backend-services/basic-service/alembic/versions/<ts>_add_project_covers.py` | create | Up: create `project_covers` table + indexes; Down: drop table |
| 37 | `backend-services/basic-service/tests/test_video_cover.py` | create | Pytest: GET-empty, PUT upsert (covers both INSERT and UPDATE branches of the portable upsert, P1-1), GET-after-PUT, POST png-cache (asserts `cover_url` carries `?v=...`, P1-3), service-layer cascade-delete (deleting a project drops its `project_covers` row + on-disk PNG, P0-2), auth-denied, 404 cases |
| 38 | `src/components/video/components/VideoCoverModal/__tests__/applyTemplate.test.ts` | create | Unit test: text content carry-over by key |
| 39 | `src/components/video/components/VideoCoverModal/__tests__/buildVirtualSegments.test.ts` | create | Unit test: virtual timeline with gaps + audio-only items |
| 40 | `src/components/video/components/VideoCoverModal/__tests__/aspectRatioToSize.test.ts` | create | Unit test: 5 ratios → expected pixel sizes |

---

## 4. Interface Design

### 4.1 BFF (Next.js, `src/app/api/video-cover/...`)

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| `GET` | `/api/video-cover/[projectId]` | session cookie | — | `CoverState \| null` (200) |
| `PUT` | `/api/video-cover/[projectId]` | session cookie | `CoverState` (JSON) | `CoverState` (200) |
| `POST` | `/api/video-cover/[projectId]/png-cache` | session cookie | `multipart/form-data` field `file` (image/png ≤ 10 MB) | `{ url: string }` (200) |

All three forward to FastAPI by reading `process.env.BACKEND_URL` (server-side only, no `NEXT_PUBLIC_` prefix; strict no-fallback per memory). On non-2xx, propagate the upstream status + JSON body.

### 4.2 FastAPI (`/api/video-cover`)

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/api/video-cover/{project_id}` | — | `CoverStateOut \| null` |
| `PUT` | `/api/video-cover/{project_id}` | `CoverStateIn` | `CoverStateOut` |
| `POST` | `/api/video-cover/{project_id}/png-cache` | multipart: `file` | `{ url, updated_at }` |
| `DELETE` | `/api/video-cover/{project_id}` *(optional)* | — | `{ deleted: true }` |

All routes:
- Reuse the auth dependency from `app/dependencies/auth.py` (`get_current_user`), exactly as `video_project_router.py` does (`current_user: User = Depends(get_current_user)`).
- Verify `project_id` belongs to the user; otherwise `404` (do not leak existence).
- `PUT` is **upsert via a portable two-step pattern** (resolves P1-1):
  ```python
  async def upsert(db, project_id, payload, user_id):
      stmt = select(ProjectCover).where(ProjectCover.project_id == project_id)
      row = (await db.execute(stmt)).scalar_one_or_none()
      if row is None:
          row = ProjectCover(project_id=project_id, user_id=user_id, **payload)
          db.add(row)
      else:
          for k, v in payload.items():
              setattr(row, k, v)
      try:
          await db.flush()
      except IntegrityError:                     # rare cross-tx race
          await db.rollback()
          row = (await db.execute(stmt)).scalar_one()
          for k, v in payload.items():
              setattr(row, k, v)
          await db.flush()
      return row
  ```
  The same code runs against PostgreSQL (prod) and SQLite (tests). Pydantic validates `template_id` ∈ {title, tutorial, click, minimal}, `image_source` ∈ {frame, upload}, `aspect_ratio` ∈ {16:9, 9:16, 1:1, 4:3, 21:9}, and structurally validates `cover_config` (v1 schema) — unknown fields rejected with `422`.
- `POST png-cache`: validate `image/png`, ≤ 10 MB, write to `STORAGE_ROOT/projects/<project_id>/cover.png` (overwrite) via `StorageService.write_to_well_known_slot()` (resolves P1-4 — bypass the date-bucketing path used by `upload_file`). Update `video_projects.cover_url` to `/api/storage/files/projects/<project_id>/cover.png?v=<updated_at_unix>` (resolves P1-3) and return `{ url, updated_at }`.
- **Cascade on project delete** (resolves P0-2): there is **no DB-level FK** between `project_covers` and `video_projects` (mirrors `storyboard_packs`'s ownership-without-FK pattern). The existing `delete_video_project` service path is extended to: (a) load the matching `project_covers` row inside the same transaction; (b) delete the on-disk PNG at `STORAGE_ROOT/projects/<project_id>/cover.png` and any `cover-bg-*.{ext}` files in that directory (best-effort, swallow `FileNotFoundError`); (c) delete the cover row. All of this is in the same async transaction as the project delete, before commit.

### 4.3 Frontend API client (`src/lib/api/videoCover.ts`)

```ts
export async function getCover(projectId: string): Promise<CoverState | null>;
export async function putCover(projectId: string, state: CoverState): Promise<CoverState>;
export async function uploadCoverPng(projectId: string, blob: Blob): Promise<{ url: string }>;
```

### 4.4 Internal hook contracts

```ts
// useCoverPersistence
interface UseCoverPersistenceResult {
  initialState: CoverState | null;
  isLoading: boolean;
  loadError: Error | null;
  save: (state: CoverState) => void;     // debounced 600 ms
  flush: () => Promise<void>;            // forces immediate PUT
  uploadPng: (blob: Blob) => Promise<string>;
}

// useFrameExtraction
interface UseFrameExtractionResult {
  totalVirtualDurationSec: number;
  extractAt: (virtualTimeSec: number) => Promise<string | null>;   // JPEG dataURL
}

// useCoverRender
interface UseCoverRenderResult {
  render: () => Promise<{ blob: Blob; dataUrl: string; width: number; height: number }>;
  isRendering: boolean;
  lastError: Error | null;
}
```

---

## 5. Data Model

### 5.1 New table `project_covers` (PostgreSQL)

| Column | Type | Constraint | Notes |
|--------|------|------------|-------|
| `id` | UUID | PK, default `uuid_generate_v4()` | |
| `project_id` | UUID | not null, **unique**, indexed | One cover per project. **No DB-level FK** to `video_projects` — ownership and cascade-delete are enforced at the service layer (P0-2), mirroring `storyboard_packs` (`db_models.py:201-228`). |
| `user_id` | varchar(36) | not null, indexed | denormalized for ownership checks |
| `template_id` | varchar(50) | not null, CHECK in 4 ids | |
| `cover_config` | JSON | not null | full `CoverConfig` (see 5.3); use `JSON` (not `JSONB`) to match the project's existing convention (`video_projects.project_data`, etc.). |
| `image_source` | varchar(20) | not null, CHECK in {frame, upload} | |
| `frame_virtual_time_ms` | int | nullable | required when `image_source='frame'` (validated app-side) |
| `uploaded_image_url` | varchar(1000) | nullable | required when `image_source='upload'` |
| `aspect_ratio` | varchar(20) | not null | one of 5 values |
| `created_at` | timestamptz | default `now()` | |
| `updated_at` | timestamptz | default `now()`, on update `now()` | |

Composite index: `(user_id, updated_at DESC)` for future "recent covers" listing.

### 5.2 Reused field

`video_projects.cover_url` (already present, `db_models.py:188`) holds the latest rendered PNG URL. Resolution semantics: a non-null value here is the *cached* render; the authoring config lives in `project_covers`. URLs written here always carry a `?v=<updated_at_unix>` query suffix so browsers/CDN refresh thumbnails after re-renders (P1-3); the static mount ignores the query string and serves the file regardless. Frontend treats `cover_url` as opaque and never strips the query.

If a pre-existing auto-setter writes `cover_url` (e.g. project-card auto-pick), manual covers always win: the cover-modal write is the last writer and is explicitly invoked by user action; auto-setters must be checked at implementation time and gated to *only* fire when `cover_url IS NULL`.

### 5.3 `CoverConfig` JSON shape

```jsonc
{
  "version": 1,
  "textLayers": [
    {
      "key": "title",          // template-defined identity, immutable
      "text": "我的视频标题",
      "fontFamily": "system-ui",
      "fontSize": 72,           // px @ 1080-short-side canvas
      "color": "#ffffff",
      "fontWeight": 700,
      "italic": false,
      "underline": false,
      "align": "center"
    }
  ],
  "decorations": [
    { "type": "rect", "x": 0.05, "y": 0.85, "w": 0.30, "h": 0.04, "fill": "#ff5500" }
  ]
}
```

Coordinates are normalized 0..1 against the canvas. Backend reader honors `version` for forward compatibility (only v1 exists today).

### 5.4 Frontend types

Cover-specific types (`CoverTemplateId`, `ImageSource`, `CoverAspectRatio`, `CoverTextLayer`, `CoverDecoration`, `CoverConfig`, `CoverState`, `CoverTemplateDefinition`) are defined verbatim in `VideoCoverModal/types.ts`. Cross-file imports come from this single source — multi-agent coordination explicitly forbids re-declaring these types elsewhere (see `task-orchestration.md §4`).

**Reused timeline / material types** (resolves P1-5): `useFrameExtraction`, `FrameScrubber`, and any other consumer that needs `VideoMaterial` or `TimelineItem` imports them from `src/types/index.ts` (the project-wide single source of truth). `VideoCoverModal/types.ts` does **not** redeclare these — re-declaration is a type-check-time review failure.

---

## 6. i18n Keys

Added under `videoCoverModal` in `src/lib/i18n.ts` (both `zh-CN` and `en-US`):

```
videoCoverModal: {
  title, button,
  templates: { title, tutorial, click, minimal },
  source: { label, frame, upload },
  scrubber: { tooltip, atTime, noVideoItems },
  textTools: { font, size, color, align, alignLeft, alignCenter, alignRight, bold, italic, underline },
  upload: { hint, drop, browse, tooLarge, wrongType },
  actions: { cancel, download, downloadFilename },
  errors: { extractFailed, saveFailed, uploadFailed, renderFailed }
}
```

---

## 7. Testing & Acceptance Criteria

### 7.1 Unit tests (frontend, **Vitest** — `package.json` test scripts: `vitest run`, `vitest run --coverage`)

- `applyTemplate.test.ts` — switching templates **preserves** `text` content for keys present in both, **replaces** font/size/color/align/weight, **replaces** decorations entirely.
- `buildVirtualSegments.test.ts` — given a timeline with: (a) one video clip; (b) gap + audio-only + video; (c) zero video items → returns `totalVirtualDuration === 0` and an empty segment array.
- `aspectRatioToSize.test.ts` — exact pixel outputs for 5 ratios.
- `useFrameExtraction.test.ts` — mocked `extractVideoFrameAt` returns deterministic dataURL; LRU cap = 8.

### 7.2 Component tests

- Open `VideoCoverModal`, mock persistence to return `null` → default state renders, "title" template selected.
- Double-click title → `contenteditable=true`; type "Hello"; press `Esc` → state.text === "Hello", editing exited.
- Drag scrubber → `extractAt` called with mapped virtual time; preview background updates.
- Toggle source to "Upload" → scrubber unmounts; upload chip appears; uploaded URL set.
- Click "Download Cover" → `useCoverRender.render` called; blob downloaded via anchor; `uploadPng` called once.

### 7.3 Backend tests (pytest, SQLite in-memory)

- `GET` empty → `null`.
- `PUT` valid → returns saved row; `GET` returns same payload (covers INSERT branch of the portable upsert, P1-1).
- `PUT` again with new template → upsert (single row by `project_id`; covers UPDATE branch).
- `PUT` invalid template id / aspect ratio / unknown `cover_config` field → 422.
- `PUT` for project owned by different user → 404.
- `POST png-cache` valid PNG → file written under `STORAGE_ROOT/projects/<id>/cover.png` (P0-1); `video_projects.cover_url` updated and matches `^/api/storage/files/projects/<id>/cover\.png\?v=\d+$` (P1-3); URL (sans query) reachable via static mount.
- `POST png-cache` non-PNG / oversized → 400 / 413.
- Project-delete cascade (P0-2): create project + cover + PNG; call `delete_video_project`; assert `project_covers` row gone, on-disk PNG gone, no orphan.

### 7.4 Manual / E2E acceptance

| # | Goal (from master-plan §2) | Pass condition |
|---|---|---|
| G1 | Cover button in `VideoPlayerPanel` info row | Visible at flex:1 right of aspect-ratio group; click opens modal |
| G2 | Modal layout 90vw × 85vh, 40/60 | Verified in Chromium @ 1920×1080 |
| G3 | 4 built-in templates | All four selectable; thumbnails render; switching applies defaults |
| G4 | Double-click text edit + style controls | Enter/blur/Esc behaviors; toolbar binds to active layer |
| G5 | Frame scrubber over virtual timeline | Skips gaps & audio; preview shows full-resolution frame |
| G6 | Local image upload as alt source | Mutually exclusive with frame; clearing one resets state |
| G7 | One-click PNG download at correct resolution | 16:9 → 1920×1080 file; 9:16 → 1080×1920; etc. |
| G8 | Persistence + PNG cache | Reopen project → previous state restored; project card shows cached PNG |
| G9 | Theme adaptation | Dark/light toggle re-themes chrome; preview stage colors unaffected |

### 7.5 Definition of Done

- All unit + backend tests green.
- `npm run type-check` and `npm run lint` clean for new/changed files.
- `pytest tests/ -v` all green; `alembic upgrade head` and `alembic downgrade -1` both succeed.
- Manual acceptance G1–G9 verified in dev (`bash start.sh`) + reviewed by another engineer.
- No `.env` overwrites in deploy (memory rule respected); no `__pycache__/` or `.next/` in commits.

---

## 8. Implementation Phases (compressed from `task-orchestration.md`)

```
Phase 1 (parallel):  T01 Modal shell || T06 Backend table+router
Phase 2 (parallel):  T02 Templates  || T04 Frame scrubber+upload || T07 BFF+persistence hook
Phase 3:             T03 Preview & text editing
Phase 4:             T05 Render & download
```

Critical path = T01 → T02 → T03 → T05 (length 4). T06/T07 run on a parallel branch and converge at T05.

Single-engineer order: T06 → T01 → T07 → T02 → T04 → T03 → T05.

---

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Cross-origin video URL taints canvas, blocking PNG export | Low | High | Reuse existing `/api/video-proxy` same-origin proxy in `extractVideoThumbnail.ts`; on failure, surface a toast and prompt user to switch to "Upload". |
| `html-to-image` font fallback (custom fonts not embedded) | Medium | High | v1 commits to web-safe / system stacks (`system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif`) and **omits** `fontEmbedCSS` from `toBlob` (resolves P1-2). Custom-font support is a v2 follow-up; per-template font registry hook is left in `CoverTemplateDefinition` but unused in v1. |
| Cached PNG goes stale on the project card after re-render | High | Medium | URL written to `cover_url` and returned by `POST png-cache` carries `?v=<updated_at_unix>` (resolves P1-3). Static mount ignores the query string. |
| BFF route accidentally runs on Edge (cannot read `process.env.BACKEND_URL`) | Low | High | All new BFF routes use the default `runtime = 'nodejs'`; do not set `export const runtime = 'edge'`. Memory rule: `BACKEND_URL` strict-no-fallback. |
| Modal subtree silently rendered as RSC (refs / DOM APIs / `URL.createObjectURL` break) | Medium | High | All new files under `VideoCoverModal/**` start with `"use client"` (resolves P1-6). |
| `StorageService.upload_file` produces date-bucketed paths instead of well-known slot | Medium | High | Cover/upload-bg writes go through new `StorageService.write_to_well_known_slot()` helper (resolves P1-4); never call `upload_file` for cover artifacts. |
| Frame extraction stalls scrubber UX | Medium | Medium | 200 ms debounce + LRU(8) frame cache + skeleton overlay while seeking. |
| No video items on timeline | High | Low | Lock scrubber, auto-flip to Upload, show empty-state copy. |
| 1080p render OOM on low-end devices | Low | Medium | `isRendering` lock prevents concurrency; on render error, retry once at 720p short-side. |
| Schema drift breaking saved configs | Medium | Medium | `cover_config.version` field; backend tolerates unknown future versions by 200-with-warning; only v1 exists today. |
| Theme switch flicker | Low | Low | All chrome via CSS variables; no inline color styles. |
| Alembic migration not run on prod | Low | High | Deploy script runs `alembic upgrade head` explicitly; backend writes a startup health log. Down migration provided. |
| Concurrent multi-device cover edits | Medium | Low | Backend upsert "last write wins"; frontend serializes saves and shows toast on conflict status. |
| `cover_url` column collision with project-card auto-set | Low | Medium | Prior to ship, audit current writers of `cover_url`; if any auto-setter exists, define precedence (manual cover > auto). |
| `.env` overwrite during tarball deploy (per memory) | High | High | Deploy script preserves `.env` across extract; `BACKEND_URL` strict-no-fallback rule respected; pre-deploy dry-run mandatory. |
| `requirements.txt` UTF-16 LE in git (per memory) | High | Medium | Backend deploy step converts to UTF-8 before `pip install`; do **not** add new Python deps without re-converting. |

---

## 10. External Dependencies

- **Frontend npm**: `html-to-image` (~17 KB gz / ~62 KB unpacked at v1.11.x; MIT-licensed). No Puppeteer, no canvas-render libs.
- **Reused frontend modules**: `extractVideoThumbnail.ts` (extended with `extractVideoFrameAt`), `VideoPlayerPanel.tsx` (host), `src/lib/i18n.ts`, `ConfirmationDialog.tsx` (style reference for self-built modal — project has no shared `dialog.tsx`), `src/types/index.ts` (`VideoMaterial`, `TimelineItem`).
- **Backend**: existing async SQLAlchemy + Alembic; existing `StorageService` (extended with a `write_to_well_known_slot` helper — see §4.2 / P1-4); existing `get_current_user` auth dependency from `app/dependencies/auth.py`.
- **RSC boundary** (P1-6): every new file under `src/components/video/components/VideoCoverModal/**` declares `"use client"` at the top of the module — the entire subtree depends on refs, DOM APIs, `URL.createObjectURL`, `<video>` seek, and `html-to-image`, none of which are valid in RSC.

---

## 11. Non-Goals (explicit)

- Embedding the cover as the first frame of the exported MP4. Architecture leaves a `cover_render_metadata` extension hook in `cover_config` for a future pass.
- AI-generated cover backgrounds (existing `AiImageModal` is **not** wired in v1).
- Drag/rotate/resize text layers — only style edits within preset positions.
- Multi-cover history or version management.
- Custom aspect ratios beyond the player's existing five.
- Backend-driven dynamic templates — the four are frontend-hardcoded in v1.
- Filter / mask / foreground decoration sticker layers.
- User-uploaded or shared templates.

---

## 12. Open Questions (deferrable; do not block Phase 1)

1. Download filename format: `{slugify(projectName)}-cover.png` vs `cover-{projectId}-{timestamp}.png`. Default: the former. Behavior on CJK / empty-after-strip names: fall back to `cover-{projectId}.png` (P2-5).
2. Watermark on downloaded PNG. Default: none.
3. Template thumbnails: inlined SVG strings vs pre-rendered PNG. Default: inline SVG.
4. Compact layout for screens < 1280 px. Default: proportional scale.
5. New project-level coverage threshold for tests. Default: keep current.
6. i18n languages beyond zh-CN and en-US at launch. Default: those two only.
7. Custom-font support in cover templates (deferred from v1 per P1-2). Default v2 plan: ship a curated font registry on the backend (`/api/fonts/registry`), preload `@font-face` and pass a fully-resolved `fontEmbedCSS` into `htmlToImage.toBlob`.

---

## 评审结论 (Review Verdict)

**结论：通过（v2）** — Approved.

Reviewed against feasibility, completeness, consistency (vs `CLAUDE.md` and visible code), and right-sizing. All P0 and P1 concerns documented in §"评审记录" are resolved inline in this v2 document:

- P0-1 storage path doubling — fixed in §2.2.D, §2.2.E, §4.2; consistent with the actual `/api/storage/files` mount in `app/main.py:527-532`.
- P0-2 stray DB-level FK — removed from §5.1; cascade now lives in `video_project_service.delete_video_project` (added to §3 row 33c).
- P1-1 dialect-portable upsert — concrete code shape provided in §4.2.
- P1-2 font fallback — committed to system stacks; `fontEmbedCSS` deferred to v2 (Open Question §12.7).
- P1-3 cache-busting `?v=<updated_at_unix>` — applied in §2.2.E, §4.2, §5.2, §9.
- P1-4 well-known slot helper — `StorageService.write_to_well_known_slot` added to §3 row 33b.
- P1-5 type anchoring — §5.4 explicitly imports `VideoMaterial`/`TimelineItem` from `src/types/index.ts`.
- P1-6 RSC client boundary — `"use client"` directive required for all `VideoCoverModal/**` files (§9, §10).

**Outstanding (non-blocking):** P2-1 through P2-5 are minor editorial/typing tightenings already applied. The Open Questions in §12 (download filename slug fallback, watermark, thumbnail format, compact layout, coverage threshold, i18n languages, custom fonts) remain explicit defaults; none block Phase 1.

**Implementation may begin** against the file change plan in §3 and the phase plan in §8. The implementer should validate the upsert against both PostgreSQL (dev) and SQLite (test fixture) before declaring §7.3 green; the static-mount URL check in §7.3 is the canonical guard against re-introducing P0-1.

---

*End of spec (v2) — implementation may begin against `specs/01..07.md` and `todos/01..07.md` per the dependency graph in §8.*

---

## 实施过程发现的方案缺陷 (Issues Found During Implementation)

> Logged during the implementation phase. Each entry documents a deviation from the v2 plan in §3 and the rationale for the corrected approach.

### I-1 — Pydantic schemas live under `app/models/`, not `app/schemas/`

**§3 row 32** placed Pydantic models at `backend-services/basic-service/app/schemas/video_cover.py`, but the existing backend has no `app/schemas/` directory: every other feature's request/response models are stored in `app/models/<feature>_models.py` (`video_project_models.py`, `chat_models.py`, `tts_models.py`, …) and re-exported from `app/models/__init__.py`. Creating a parallel `app/schemas/` tree would split the convention.

**Resolution (applied):** Pydantic models created at `backend-services/basic-service/app/models/video_cover_models.py`, mirroring `video_project_models.py`. `app/main.py` registration unchanged (rows 34/35 still apply).

### I-2 — Cascade-delete hook lives in `delete_project` (the project's delete name), not `delete_video_project`

**§3 row 33c** referred to a `delete_video_project` service method on `VideoProjectService`. The actual public method is `video_project_service.delete_project` — `delete_video_project` is the *router* function name. The intent is identical; the hook is added to the existing `delete_project` so the cascade fires regardless of caller (router or future internal user).

**Resolution (applied):** `video_cover_service.delete_for_project(...)` is invoked from `VideoProjectService.delete_project` *after* `pack_ids` are collected and *before* the row is deleted from the DB, so the project-row delete + cover-row delete share a single async transaction (matches the existing pattern for storyboard pack ownership rows).

### I-3 — Frontend timeline/material types are `MaterialItem` and `TimelineItem`, not `VideoMaterial`

**§5.4** mandated importing `VideoMaterial` from `src/types/index.ts`. The codebase uses `MaterialItem` for that role; there is no `VideoMaterial` type. The single-source-of-truth rule still applies — the cover module imports `MaterialItem` and `TimelineItem` from `@/types`.

**Resolution (applied):** `useFrameExtraction`, `FrameScrubber`, and any other consumer imports `MaterialItem, TimelineItem` from `@/types`. No type re-declaration.
