# Local Desktop Video Preview Spec

Version: v2

## 评审记录

- P1 - Upload success handling was under-specified: the v1 draft allowed
  `createLocalMaterialFromUpload()` to mark a material completed even if the
  storage response lacked a playable same-origin `/api/storage/files/...` URL.
  Resolved in v2 by requiring URL validation and an upload-failed state instead
  of creating a completed direct-local material with an empty or unsafe URL.
- P1 - URL resolution did not explicitly cover the existing nested
  `MaterialItem.metadata.localResolvedUrl` shape. The current stack stores
  local provenance there, while `selectPlaybackUrl()` also accepts flat
  playback inputs. Resolved in v2 by requiring shared URL selectors and sequence
  resolvers to read nested metadata when a full `MaterialItem` is supplied.
- P1 - Readiness and skip rules could classify malformed stale local records as
  ready based on provenance flags alone. Resolved in v2 by distinguishing
  direct-local provenance from preview readiness: state-machine bypasses and the
  player readiness gate must require `canPreviewDirectLocalMaterial()`.
- P2 - Automatic video analysis after upload remains an intentional non-preview
  side effect. The implementation should keep it separate from preview playback
  and leave product-level opt-out decisions out of this change.

## Overview

Ecliptrix has moved into a desktop-oriented runtime where user-selected media
files are stored and served locally by the bundled backend. In the video editor,
the current user workflow is: upload a local video into the material library,
add that material to the lower timeline editing area, and preview the timeline
immediately inside the editor. For that workflow, the product no longer needs
cloud-oriented adaptation steps such as remote material ingest, backend preview
proxy transcode, client blob re-download, or any extra upload/download loop
after the local storage upload has already completed.

This design keeps the existing remote-material optimization path for search,
ARK, Pexels, and legacy CDN materials, but makes direct local uploads a
separate first-class path. A direct local material should be treated as already
preview-ready once the storage API returns a same-origin `/api/storage/files/...`
URL. Adding that material to the timeline must not enqueue `/api/material/ingest`,
must not enqueue preview-proxy transcode, must not enter `useLocalMaterialDownload`,
and must not block the play button behind the local-proxy readiness gate.

The implementation should remove or bypass deprecated assumptions that all video
timeline materials need a cache/download/transcode lifecycle. The editor should
use the durable local storage URL directly for material panel preview, timeline
composition preview, playback v2 canvas preview, and export sequence creation.
The result is simpler desktop playback: upload once to local storage, persist a
local material record, drop it into the timeline, and play it through the same
origin local file route with browser Range support.

## Technical Design

### Architecture

The design introduces a clear branch at the material provenance layer:

- Direct local material: trusted local-upload provenance plus at least one
  durable, playable same-origin path. Provenance is
  `metadata.storageKind === 'local'` or `metadata.isLocalFile === true`;
  preview readiness additionally requires a non-empty local URL in
  `metadata.localResolvedUrl`, `url`, `serverUrl`, or `cacheUrl`.
- Cached remote material: `metadata.storageKind === 'cached_remote'` or
  `cacheUrl` under `/api/storage/files/cached_materials/...`.
- Legacy remote material: cross-origin `serverUrl || url`, optionally later
  converted to cached remote by the existing prefetch path.

`src/components/video/lib/localMaterial.ts` remains the single source of truth
for that classification. Downstream code must call `isDirectLocalMaterial()` or
`canPreviewDirectLocalMaterial()` instead of duplicating path checks. This is
important because cached remote files are also local filesystem files, but they
still represent remote-source material and may need the existing cache/proxy
lifecycle. Any path that skips cache/download/proxy state machines or opens the
player readiness gate must use `canPreviewDirectLocalMaterial()`, not provenance
flags alone, so stale project data with local markers but no playable URL still
falls back to the normal recovery path.

### Sequence Of Operations

1. User clicks upload or drags files into `MaterialsPanel`.
2. `useMaterialManagement.processFileUpload()` creates placeholder
   `MaterialItem`s with stable ids and upload progress.
3. `uploadSingleFile()` posts the file once to `/api/storage/upload-video` for
   videos or `/api/storage/upload-file` for audio/images. This is the only
   required transfer for a user local file.
4. `createLocalMaterialFromUpload()` converts a valid successful response to a
   completed direct local material. Before conversion, it must validate that the
   response includes `video_url` or `file_url`, that the URL resolves to
   `/api/storage/files/video/...`, `/api/storage/files/audio/...`, or
   `/api/storage/files/images/...`, and that
   it is not under `/api/storage/files/cached_materials/...`. If validation
   fails, keep the placeholder in `uploadStatus = 'failed'` with an explicit
   error instead of creating a completed direct-local material. For valid
   responses, set `url`, `serverUrl`, and `cacheUrl` to the returned
   same-origin local URL, set `storageKey`, and set
   `metadata.storageKind = 'local'`, `metadata.isLocalFile = true`, and
   `metadata.localResolvedUrl` to the same local URL.
5. The material is visible in `MaterialsPanel` immediately and may be previewed
   with the same URL selected by `selectPlaybackUrl(material, { purpose:
   'preview' })`.
6. When the material is added to the timeline through `TimelinePanel` or the
   programmatic `materialsToAdd` flow, `handleMaterialDrop()` copies the local
   URL and metadata into the timeline store via `MaterialData`.
7. Timeline add triggers normal history, item placement, and auto-organize only.
   It must not trigger remote material ingest, preview-proxy transcode, or local
   blob download for direct local materials.
8. `VideoPlayerPanel` resolves each active sequence through
   `resolveSequencePlaybackUrl()` and `selectPlaybackUrl()`. Direct local
   material resolves to the same-origin local file before proxy, blob, cache, or
   origin fallback. URL selectors must support both existing flat playback
   inputs (`localResolvedUrl`) and full `MaterialItem` inputs where the durable
   URL lives at `metadata.localResolvedUrl`.
9. The readiness gate treats direct local video/audio materials as ready. It
   does not count them as `gating` only when
   `canPreviewDirectLocalMaterial(material)` is true. Malformed local-marked
   records without a playable local URL remain gated or fall back like legacy
   material instead of silently skipping every recovery mechanism.
10. Export keeps using canonical local backend references so FFmpeg receives a
    backend-resolvable `/api/storage/files/...` style path, not a `blob:`,
    media-proxy, or preview-proxy URL.

### Code Path Rules

`useRemoteMaterialPrefetch()` already skips direct local material. Keep that
behavior for valid preview-ready local uploads and strengthen tests around the
timeline-triggered preview-proxy branch. A direct local upload added to
`timelineVideoMaterialIds` must not call `MediaProxyClient.enqueuePreviewProxy()`
and must not call `RemoteMaterialPrefetchAdapter.ingest()`. If a persisted item
has local provenance markers but fails `canPreviewDirectLocalMaterial()`, do not
use the direct-local skip as a blanket bypass; allow the resolver or existing
legacy fallback path to surface the missing source.

`useLocalMaterialDownload()` already skips valid direct local materials in
cleanup and download evaluation. Keep that behavior, but make it explicit that
preview-ready direct local materials do not receive `localProxyStatus` overlays
and do not consume in-memory blob budget. The hook should only process remote
video/audio materials that need download-first playback.

`TimelinePanel.handleMaterialDrop()` may keep preloading local videos with
`videoCache.preloadVideo(previewUrl, material.id)`, but it must treat that as an
opportunistic browser/video-element warmup. It must not change the material
state to downloading, pending, transcoding, or failed.

`selectPlaybackUrl()` should keep the `purpose` split:

- `purpose: 'preview'`: for direct local material, return
  `metadata.localResolvedUrl || localResolvedUrl || cacheUrl || url ||
  serverUrl` once converted to an absolute same-origin URL when possible. Do
  this before preview-proxy and media-proxy logic. This function must read the
  nested `metadata.localResolvedUrl` when the caller passes a full
  `MaterialItem`; callers should not have to flatten metadata first.
- `purpose: 'export'`: return a durable local backend reference for direct local
  material. Never return `localProxyUrl`, `previewProxyLocalUrl`,
  `/api/media/proxy`, or any `blob:` URL.

`resolveSequencePlaybackUrl()` should preserve a direct-local primary candidate
and still include safe fallbacks for stale project data. If a stale sequence only
contains `url` but the live material contains a stronger `metadata.localResolvedUrl`,
the live material wins. For export and preview helpers, relative
`/api/storage/files/...` references are valid durable backend references even
when `window` is unavailable; do not drop them solely because they cannot be
absolutized in SSR/test contexts.

## File / Module Change Plan

| File | Intent |
| --- | --- |
| `src/components/video/lib/localMaterial.ts` | Keep as provenance source of truth; add helpers only if direct-local URL selection is duplicated elsewhere. |
| `src/components/video/lib/selectPlaybackUrl.ts` | Make direct local preview/export priority explicit before proxy paths, including nested `metadata.localResolvedUrl` on full `MaterialItem` inputs. |
| `src/components/video/lib/resolveSequencePlaybackUrl.ts` | Ensure live direct-local material URLs override stale sequence URLs and exclude proxy/blob URLs from export fallbacks. |
| `src/components/video/hooks/useMaterialManagement.ts` | Keep single storage upload, validate returned local storage URLs, remove any local-upload path that triggers remote cache/download/transcode, and patch state only with completed local material fields after validation. |
| `src/components/video/hooks/useRemoteMaterialPrefetch.ts` | Harden preview-ready direct-local skip for both material-library prefetch and timeline preview-proxy enqueue. |
| `src/components/video/hooks/useLocalMaterialDownload.ts` | Keep preview-ready direct-local materials outside blob download and budget logic. |
| `src/components/video/timeline/TimelinePanel.tsx` | Preserve material metadata when adding to timeline; keep preload as non-stateful warmup only. |
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | Ensure readiness gate and sequence resolver treat direct local video/audio as immediately ready. |
| `src/components/video/timeline/infrastructure/CompositionAdapter.ts` | Ensure export sequence URLs prefer durable local storage references for direct local material. |
| `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` | Ensure material cards and preview modal consume the same direct local URL without showing download/transcode affordances. |
| `src/types/index.ts` | Document direct local material field semantics; no schema migration required. |
| `src/components/video/lib/__tests__/localMaterial.test.ts` | Expand direct-local classification and cached-remote exclusion coverage. |
| `src/components/video/lib/__tests__/selectPlaybackUrl.test.ts` | Add preview/export URL priority tests for direct local uploads. |
| `src/components/video/lib/__tests__/resolveSequencePlaybackUrl.test.ts` | Add stale sequence plus live local material tests. |
| `src/components/video/hooks/__tests__/useMaterialManagement.localUpload.test.ts` | Assert upload creates completed direct local materials and does not mark cache/proxy/download states. |
| `src/components/video/hooks/__tests__/useRemoteMaterialPrefetch*.test.ts` | Assert direct local timeline references do not ingest or enqueue preview proxy. |
| `src/components/video/hooks/__tests__/useLocalMaterialDownload.test.ts` | Assert direct local video/audio are skipped and do not receive localProxy fields. |
| `src/components/video/components/VideoPlayerPanel/__tests__/VideoPlayerPanel.localPreview.test.tsx` | Assert playback readiness is open and assigned src is the local storage URL. |
| `src/components/video/timeline/__tests__/TimelineItem.localDownload.test.ts` | Assert no download/transcode overlay appears for direct local timeline items. |

## Interface Design

No new REST, WebSocket, or CLI interface is required. Existing interfaces remain:

- `POST /api/storage/upload-video`: accepts multipart file, `task_id`,
  `generate_thumbnail`, and optional `user_id`; returns `video_url`,
  `thumbnail_url`, metadata, duration, dimensions, and size.
- `POST /api/storage/upload-file`: accepts multipart file, `task_id`, and
  optional `user_id`; returns `file_url`, metadata, and size.
- `GET /api/storage/files/{path}`: serves local files with authentication and
  Range support. This is the runtime preview/export reference for direct local
  material.

The following interfaces are explicitly not used for direct local uploads after
the upload response is committed:

- `POST /api/material/ingest`
- `GET /api/material/lookup`
- preview-proxy enqueue/status APIs through `MediaProxyClient`
- `/api/media/proxy` for local upload playback

Remote materials continue to use those existing interfaces unchanged.

## Data Model

No database migration is needed. The relevant in-memory and persisted project
shape is `MaterialItem`:

```ts
interface DirectLocalMaterialShape {
  url: string;                 // /api/storage/files/video/<file>
  serverUrl: string;           // same as url for compatibility
  cacheUrl: string;            // same as url; direct local is already cached
  storageKey?: string;         // backend storage key, never file://
  uploadStatus: 'completed';
  uploadProgress: 100;
  cacheStatus?: undefined;
  previewProxyStatus?: undefined;
  localProxyStatus?: undefined;
  metadata: {
    storageKind: 'local';
    isLocalFile: true;
    localResolvedUrl: string;
    originalUrl: string;
    storageKey?: string;
    fileName: string;
  };
}
```

`cacheUrl` is intentionally populated for direct local material, but it does not
mean the material came from the remote `cached_materials` table. Code must use
`metadata.storageKind` and `isDirectLocalMaterial()` to distinguish those cases.
`storageKey` is a backend-relative key only; raw desktop paths and `file://`
URLs must not be stored in project JSON or sent to the frontend.

Timeline `MaterialData` should carry `url`, `serverUrl`, `cacheUrl`,
`storageKey`, and `metadata` so project autosave/hydration keeps the direct
local identity intact across reloads.

Completed direct local material must never have an empty `url`, a `file://`
URL, a raw Windows or POSIX filesystem path, or a
`/api/storage/files/cached_materials/...` URL as its primary local identity.
Those cases are invalid upload results or legacy/cached-remote records and must
not be marked `uploadStatus: 'completed'` with `metadata.storageKind = 'local'`.

## Testing & Acceptance Criteria

1. Unit: `createLocalMaterialFromUpload()` returns a completed direct local
   material with identical `url`, `serverUrl`, and `cacheUrl`.
2. Unit: `createLocalMaterialFromUpload()` rejects or leaves failed any
   successful upload response that lacks a non-cached `/api/storage/files/...`
   URL; it must not create a completed material with an empty URL.
3. Unit: `isDirectLocalMaterial()` returns true for storage upload paths under
   video/audio/images and false for `/api/storage/files/cached_materials/...`.
4. Unit: `canPreviewDirectLocalMaterial()` returns false for local-provenance
   records that lack a playable local URL.
5. Unit: `selectPlaybackUrl(local, { purpose: 'preview' })` returns the local
   storage URL before preview-proxy, media-proxy, or remote origin candidates.
6. Unit: `selectPlaybackUrl()` and `resolveSequencePlaybackUrl()` prefer
   `metadata.localResolvedUrl` when a full `MaterialItem` has stale `url` or
   sequence snapshots.
7. Unit: `selectPlaybackUrl(local, { purpose: 'export' })` returns the durable
   local storage URL and never returns `blob:` or proxy URLs.
8. Hook: uploading a local video calls only `/api/storage/upload-video`; it does
   not call `/api/material/ingest` or preview-proxy enqueue.
9. Hook: when a direct local video id appears in timeline referenced ids,
   `useRemoteMaterialPrefetch()` and `useLocalMaterialDownload()` do not patch
   `cacheStatus`, `previewProxyStatus`, or `localProxyStatus`.
10. Component: adding a completed local material to the timeline creates an item
   with the same `materialId` and local URL metadata.
11. Component: the play button is not blocked by readiness gate for
   `canPreviewDirectLocalMaterial()` video/audio materials.
12. Component: the timeline item does not show transcoding/downloading/retry
   masks for valid direct local material.
13. Integration: upload a local mp4, add it to the timeline, press play, seek,
    pause, and resume. The assigned `<video>.src` is same-origin local storage,
    and no network request is made to material ingest, lookup, preview-proxy, or
    media-proxy for that material.
14. Integration: a remote Pexels/ARK material still follows existing ingest,
    preview-proxy, and local blob behavior.
15. Type check and tests: run `npm run type-check` and the focused Vitest files
    above. Run broader `npm test -- --run src/components/video` if the resolver
    or shared hooks are changed.

## Risks & Mitigations

Risk: cached remote files and direct local uploads both use same-origin local
paths, so a naive path-only check can bypass transcode for remote heavy assets.
Mitigation: provenance checks must use `metadata.storageKind` through
`isDirectLocalMaterial()`, and cached remote paths remain explicitly excluded.

Risk: project JSON from older versions may contain local-looking URLs without
metadata. Mitigation: `isDirectLocalMaterial()` can accept direct upload storage
paths with `storageKey`, but the implementation should avoid classifying
`cached_materials` and remote http URLs as direct local.

Risk: direct local original videos may be very large and decode slowly compared
with 480p preview-proxy output. Mitigation: the requirement prioritizes desktop
local direct preview over transcoding. Keep the remote preview-proxy path
available for non-local sources; do not silently transcode user uploads.

Risk: export may accidentally receive a `blob:` or preview-only URL if playback
fields leak into sequence generation. Mitigation: keep export URL selection
separate from preview selection and add explicit export tests.

Risk: automatic video analysis after upload still calls `/api/video/analyze`.
This is not a preview/transcode/upload/download operation, but it is a backend
side effect. If product wants upload to be completely side-effect free, gate
`triggerAutoAnalysis()` behind a separate setting or user action; do not conflate
that decision with local preview playback.

## 评审结论

通过。v2 resolves all P1 review concerns in the document body. The remaining P2
item is a product decision about automatic analysis and does not block the local
desktop preview implementation.
