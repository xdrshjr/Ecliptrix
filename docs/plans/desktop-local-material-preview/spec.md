# Desktop Local Material Preview Spec

Version: v2

## 璇勫璁板綍

- P1 - Direct-local classification was too broad because a same-origin
  `cacheUrl` can also mean a cached remote asset under
  `/api/storage/files/cached_materials/...`. Resolved by requiring explicit
  local-upload provenance or non-cached local storage paths, and by making
  cached remote assets a negative test case.
- P1 - The existing preview-proxy trigger can enqueue same-origin local uploads
  after timeline insertion because `_previewProxyInputResolvable` treats
  `/api/storage/files/...` as transcode input. Resolved by requiring
  `isDirectLocalMaterial` skips before remote prefetch key derivation and
  before preview-proxy eligibility.
- P1 - The existing client-local download state machine blocks video/audio
  readiness until `localProxyStatus` becomes `ready` or `degraded`. Direct local
  uploads do not enter that state machine, so they need an explicit readiness
  bypass and stale `localProxy*` cleanup. Resolved in the hook and player
  sections.
- P1 - Upload completion currently risks replacing an `upload_*` temporary
  material ID with a new `video_*` / `audio_*` ID, which can break timeline
  references if a card is used while saving. Resolved by requiring completed
  local materials to preserve the original material ID.
- P1 - Timeline snapshots need `cacheUrl`, `serverUrl`, `storageKey`, and local
  metadata typed in the domain `MaterialData`; otherwise implementation would
  rely on `as any` casts and lose local playback fields. Resolved by adding
  `src/components/video/timeline/domain/types.ts` to the change plan.
- P2 - Manual QA must distinguish browser HTTP range reads from prohibited
  remote ingest/proxy/download calls. The acceptance criteria now state that
  local storage playback requests are expected, but material ingest,
  preview-proxy, media-proxy, and blob download are not.

## Overview

Ecliptrix is now used as a desktop application, so video materials selected by
the user should be treated as local editor assets after they enter the material
panel. The current editor already saves uploaded files through the local
FastAPI storage service and receives same-origin URLs such as
`/api/storage/files/video/...`. However, the preview pipeline still contains
cloud-era and remote-material assumptions: timeline membership can trigger
preview-proxy transcoding, remote ingest polling, client-side whole-file
download, and local blob readiness gates. Those paths are useful for Pexels,
ARK, or legacy remote materials, but they are unnecessary work for a video the
user just imported from disk.

This feature narrows the desktop local path. Once a user selects or drags a
video/audio/image file into the material panel and that file has been copied to
the local storage root, the resulting `MaterialItem` is immediately considered
preview-ready. Adding it to the lower timeline must not enqueue preview-proxy
transcoding, must not call `/api/material/ingest` for the same file, must not
download the file back into a browser `blob:`, and must not block playback on
`localProxyStatus`. Preview should read the same-origin local storage URL
directly through the existing playback resolver.

The design intentionally does not remove remote compatibility. Remote search
results, generated videos that initially return an external URL, and imported
old projects may still use `useRemoteMaterialPrefetch`,
`previewProxyStatus`, and `useLocalMaterialDownload`. The implementation should
split the two paths clearly: local desktop uploads are direct local playback;
remote materials are localized or proxied by the existing remote pipeline.

## Technical Design

### Architecture

Introduce a small local-material classifier shared by material management,
timeline prefetching, and playback readiness. The classifier should answer two
questions:

1. Is this material already backed by local desktop storage?
2. Can the editor preview it directly without transcode/download preparation?

The classifier should live in a pure frontend helper, for example
`src/components/video/lib/localMaterial.ts`, because most decisions are in the
renderer and tests can cover it without mounting React. It should use existing
signals rather than inventing a new persistence format, but it must not treat
all same-origin cache URLs as direct local. Remote assets that have already
been cached under `/api/storage/files/cached_materials/...` are still remote
materials for preview-policy purposes and may continue to use preview-proxy or
client-local download.

Direct-local classification should return true only when one of these
provenance checks succeeds:

- `metadata.storageKind === 'local'`
- `metadata.isLocalFile === true`
- `metadata.localResolvedUrl` points to a local storage path that is not under
  `/api/storage/files/cached_materials/`
- `storageKey` is present and the selected playback URL is a same-origin
  storage path outside `cached_materials`
- `url`, `serverUrl`, or `cacheUrl` points to a local upload path such as
  `/api/storage/files/video/...`, `/api/storage/files/audio/...`, or
  `/api/storage/files/images/...`, excluding `/api/storage/files/cached_materials/...`

`cacheUrl` alone is not sufficient evidence of direct local status because
remote Pexels/ARK materials also receive same-origin `cacheUrl` values after
background localization.

`useMaterialManagement.uploadSingleFile()` already creates local material
objects for upload responses with `url`, `serverUrl`, and `cacheUrl` set to the
same local URL. The implementation should tighten that contract and normalize
all local uploads through a helper such as `createLocalMaterialFromUpload()`.
The material should be inserted as completed immediately after the local
storage API returns. It should not use placeholder IDs that are later replaced
by unrelated IDs; if a temporary card is still needed for progress,
`createLocalMaterialFromUpload()` must receive the existing placeholder
material and preserve `material.id` in the completed `MaterialItem` so timeline
references cannot break.

The main behavior change is in the two prefetch hooks mounted by
`useMaterialManagement`:

- `useRemoteMaterialPrefetch` should continue to skip same-origin URLs and must
  also skip any material classified as direct local. The skip must run before
  `shouldPrefetch()` derives a remote material key, before
  `_previewProxyEligible()` checks size/dimension heuristics, and before the
  timeline-membership preview-proxy branch calls `requestPreviewProxy()`. It
  must not enqueue preview-proxy transcoding for local uploaded videos merely
  because they are large or have unknown dimensions.
- `useLocalMaterialDownload` should skip direct-local materials. The hook is
  designed to fetch a low-bitrate proxy into `blob:` memory. That is the wrong
  default for a local desktop upload, because the local storage URL is already
  available and adding a timeline item should not download the same file again.
  When it skips a direct-local material, it should clear stale `localProxyUrl`,
  `localProxyStatus`, `localProxyProgress`, `localProxyBytes`, and
  `localProxyError` values left by an old project/session without patching the
  material into `transcoding`, `downloading`, `error`, or `degraded`.

Playback readiness should not overload `localProxyStatus='degraded'` to mean
"direct local". Instead, `VideoPlayerPanel.mediaReadiness` should read the live
`MaterialItem` by `materialId` and treat a timeline video/audio material as
ready when either the material is direct local, `localProxyStatus === 'ready'`,
or `localProxyStatus === 'degraded'` for a true remote fallback. This preserves
the semantics of `degraded` as "could not localize, will stream" and keeps
local uploads from showing misleading degraded labels.

URL selection should stay centralized. `resolveSequencePlaybackUrl` already
orders `localProxyUrl`, preview proxy, local storage/cache URL, `serverUrl`, and
`url`. For direct-local materials, the resolver should return the same-origin
local storage URL as the primary candidate when no ready `localProxyUrl`
exists. The call sites in `VideoPlayerPanel` should keep using
`resolveSequencePlaybackUrl(..., { preferPreviewProxy, preferLocalProxy })`,
but the helper must ensure direct local storage wins before any media-proxy or
remote origin fallback.

### Sequence of Operations

1. User clicks upload or drops files into `MaterialsPanel`.
2. `useMaterialManagement.processFileUpload()` validates file type and calls
   the local storage endpoint through the existing Next.js API proxy.
3. FastAPI writes the file under the local storage root and returns
   `video_url` or `file_url`, thumbnail metadata, duration, dimensions, and
   storage metadata.
4. `useMaterialManagement` creates a `MaterialItem` with
   `metadata.storageKind='local'`, `metadata.isLocalFile=true`, `url`,
   `serverUrl`, `cacheUrl`, and `metadata.localResolvedUrl` all pointing to the
   local same-origin URL. If this material completes a temporary upload card,
   it keeps the temporary card's existing `id`.
5. The material appears in the material panel as completed and draggable.
6. User clicks "add to timeline" or drags the material to the lower timeline.
7. Timeline state records `materialId` and the local material URL snapshot.
8. Prefetch hooks observe the timeline state, classify the material as direct
   local, clear any stale local-proxy fields, and do no ingest, preview-proxy,
   media-proxy, or client blob download work.
9. `VideoPlayerPanel` resolves the active sequence by `materialId`, selects the
   same-origin local storage URL, and starts preview without waiting for
   transcode/download state.

## File / Module Change Plan

| File | Action | Intent |
| --- | --- | --- |
| `src/components/video/lib/localMaterial.ts` | Create | Pure helpers: `isDirectLocalMaterial`, `canPreviewDirectLocalMaterial`, and optional upload normalization predicates. |
| `src/components/video/lib/__tests__/localMaterial.test.ts` | Create | Lock classification for local upload, cached remote, legacy remote, blob-only, and empty URL cases. |
| `src/components/video/hooks/useMaterialManagement.ts` | Modify | Normalize local upload material creation; remove auto-triggered preview preparation for direct-local uploads; pass direct-local skips into prefetch/download hooks. |
| `src/components/video/hooks/__tests__/useMaterialManagement.localUpload.test.ts` | Create | Verify uploaded local videos become completed material cards with local metadata and no remote ingest/download side effects. |
| `src/components/video/hooks/useRemoteMaterialPrefetch.ts` | Modify | Skip direct-local materials before remote key derivation and before preview-proxy eligibility. |
| `src/components/video/hooks/__tests__/useRemoteMaterialPrefetch.test.ts` | Modify | Add assertion that a same-origin local uploaded video added to timeline does not enqueue preview-proxy. |
| `src/components/video/hooks/useLocalMaterialDownload.ts` | Modify | Skip direct-local video/audio materials and clear stale `localProxy*` fields if they were previously set by an old session. |
| `src/components/video/hooks/__tests__/useLocalMaterialDownload.test.ts` | Modify | Add local upload cases proving no fetch, no blob URL, no readiness gate work. |
| `src/components/video/lib/resolveSequencePlaybackUrl.ts` | Modify | Ensure direct local storage URL is primary before preview-proxy/media-proxy/origin when no ready `localProxyUrl` exists. |
| `src/components/video/lib/__tests__/resolveSequencePlaybackUrl.test.ts` | Modify | Add direct-local material priority tests and legacy remote fallback tests. |
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | Modify | Update `mediaReadiness` to count direct-local video/audio materials as ready without `localProxyStatus`. |
| `src/components/video/components/VideoPlayerPanel/__tests__/VideoPlayerPanel.localPreview.test.tsx` | Modify | Verify play is not gated for local uploaded timeline materials and current source is the local storage URL. |
| `src/components/video/timeline/domain/types.ts` | Modify | Extend `MaterialData` with optional `serverUrl`, `cacheUrl`, `storageKey`, and local metadata fields so timeline snapshots can carry local playback references without `as any`. |
| `src/components/video/timeline/domain/entities/TimelineItem.ts` | Modify | Preserve local playback snapshot fields when timeline domain items are created, hydrated, and serialized. |
| `src/components/video/timeline/domain/services/ItemPlacementService.ts` | Modify | Forward local playback fields from `MaterialData` into created timeline items. |
| `src/components/video/timeline/TimelinePanel.tsx` | Modify | Ensure programmatic add/drop preserves `cacheUrl`, `storageKey`, and local metadata in `MaterialData` snapshots. |
| `src/components/video/timeline/TimelineItem.tsx` | Modify | Do not render "transcoding/downloading" overlays for direct-local materials. |
| `src/components/video/timeline/__tests__/TimelineItem.localDownload.test.ts` | Modify | Assert direct-local materials show normal timeline blocks, while remote materials still show local download states. |
| `src/types/index.ts` | Modify | Document `metadata.storageKind='local'` and direct-local preview semantics; no new required field. |
| `src/lib/i18n.ts` | Modify | Rename visible copy for local file import from cloud-style "uploading" where needed to "saving/importing locally". |

No source file outside this table should need modification. Backend storage
endpoints are kept because the local backend still owns durable file copy,
metadata probing, thumbnail generation, and authenticated playback.

## Interface Design

No new REST, WebSocket, CLI, or Electron IPC interface is required.

Existing local import endpoints remain:

```http
POST /api/storage/upload-video
POST /api/storage/upload-file
GET  /api/storage/files/{path}
```

The frontend continues to call the Next.js API routes, which proxy to FastAPI.
The semantic change is in the material object produced from the response.

Expected frontend shape after local video import:

```ts
const material: MaterialItem = {
  id: existingUploadMaterial.id,
  name: file.name,
  type: "video",
  format: "mp4",
  size: result.file_size,
  duration: result.duration,
  width: result.width,
  height: result.height,
  thumbnailUrl: result.thumbnail_url,
  url: result.video_url,
  serverUrl: result.video_url,
  cacheUrl: result.video_url,
  storageKey: result.metadata?.storage_key,
  createdAt: new Date(),
  uploadStatus: "completed",
  uploadProgress: 100,
  metadata: {
    storageKind: "local",
    storageKey: result.metadata?.storage_key,
    localResolvedUrl: result.video_url,
    originalUrl: result.video_url,
    fileName: file.name,
    isLocalFile: true
  }
};
```

`/api/material/ingest`, `/api/media/preview-proxy`, and
`/api/media/proxy` remain remote-material interfaces. They must not be called
for materials classified as direct local.

The upload normalization helper should have a contract equivalent to:

```ts
function createLocalMaterialFromUpload(
  existingMaterial: MaterialItem,
  file: File,
  result: StorageUploadResult
): MaterialItem;
```

The returned item must preserve `existingMaterial.id`, set
`uploadStatus='completed'`, and populate direct-local metadata. If the UI does
not allow dragging while an upload is in progress, preserving the ID is still
required because state updates and timeline actions can interleave in React.

## Data Model

No database migration is required. The feature relies on the existing
`MaterialItem` flexible metadata object.

Recommended in-memory shape:

```ts
type StorageKind = "local" | "cached_remote" | "legacy_remote";

interface DirectLocalMaterialMetadata {
  storageKind: "local";
  storageKey?: string;
  localResolvedUrl: string;
  originalUrl?: string;
  fileName?: string;
  isLocalFile: true;
}
```

Timeline material snapshots should be typed to preserve the local reference:

```ts
interface MaterialData {
  id: string;
  name: string;
  type: MaterialType;
  duration?: number;
  thumbnailUrl?: string;
  url?: string;
  serverUrl?: string;
  cacheUrl?: string;
  storageKey?: string;
  metadata?: MaterialItem["metadata"];
  sentenceSegments?: AudioSentenceSegment;
}
```

Cached remote materials must not be rewritten to `storageKind='local'` merely
because the backend has produced a same-origin cache file. They should keep
remote provenance such as `metadata.source`, `metadata.sourceId`, or
`metadata.storageKind='cached_remote'` when that field is available.

`localProxyStatus` and `localProxyUrl` remain available for remote or proxied
preview. Direct local materials do not need those fields. If an old project
snapshot has both local metadata and stale `localProxy*` fields, the classifier
should still treat it as direct local and the cleanup path in
`useLocalMaterialDownload` should clear stale local proxy state.

Timeline item data should keep `materialId` as the authoritative link. URL
snapshots can exist for backward compatibility, but every preview resolver call
should first look up the live `MaterialItem` by `materialId` so refreshed local
metadata wins over stale sequence URLs.

## Testing & Acceptance Criteria

Unit tests:

1. `isDirectLocalMaterial` returns true for local upload materials whose
   `url/serverUrl/cacheUrl` are `/api/storage/files/...`.
2. The classifier returns false for remote HTTP-only materials, cached remote
   materials whose `cacheUrl` is `/api/storage/files/cached_materials/...`,
   `blob:`-only temporary materials, and generated placeholders with no URL.
3. `useRemoteMaterialPrefetch` does not call ingest, lookup, or preview-proxy
   enqueue for direct-local materials when they are added to the timeline,
   including large local uploads with unknown bitrate/dimensions.
4. `useLocalMaterialDownload` does not call `fetch`, `LocalMediaCache`, or
   `MediaProxyClient` for direct-local video/audio materials, and clears stale
   `localProxy*` fields without marking the material degraded.
5. `VideoPlayerPanel` readiness considers direct-local video/audio timeline
   materials ready without `localProxyStatus`, while cached remote materials
   still require `ready` or `degraded`.
6. `resolveSequencePlaybackUrl` chooses the local storage URL for direct-local
   materials and still chooses ready `localProxyUrl` for remote materials that
   have completed client-local download.
7. `TimelineItem` renders no downloading/transcoding overlay for direct-local
   materials.
8. Local upload completion preserves the placeholder material ID.
9. `TimelinePanel` forwards `serverUrl`, `cacheUrl`, `storageKey`, and
   `metadata` into `MaterialData` without an untyped cast.

Integration/manual acceptance:

1. Import a local MP4 into the material panel. It appears as completed after
   the local save finishes, with a playable thumbnail/preview.
2. Add that MP4 to the lower timeline. No request is sent to
   `/api/material/ingest`, `/api/media/preview-proxy`, `/api/media/proxy`, or
   the client-local blob download path. Browser requests to
   `/api/storage/files/...` for normal local playback/range reads are expected.
3. Press play immediately. Preview starts from the same-origin local storage
   URL and is not blocked by a "material downloading" gate.
4. Add a remote Pexels/ARK material. Existing remote localization and low-res
   preview behavior still works.
5. Reload a saved project with local uploaded materials. The same local-first
   direct preview behavior is restored from persisted material metadata.

Verification commands for the implementation node:

```bash
npm run type-check
npm run test -- src/components/video/lib/__tests__/localMaterial.test.ts
npm run test -- src/components/video/hooks/__tests__/useRemoteMaterialPrefetch.test.ts
npm run test -- src/components/video/hooks/__tests__/useLocalMaterialDownload.test.ts
npm run test -- src/components/video/lib/__tests__/resolveSequencePlaybackUrl.test.ts
npm run test -- src/components/video/components/VideoPlayerPanel/__tests__/VideoPlayerPanel.localPreview.test.tsx
npm run test -- src/components/video/timeline/__tests__/TimelineItem.localDownload.test.ts
```

## Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Misclassifying remote material as direct local | Remote assets skip needed localization and fail playback | Require same-origin local URL or explicit local metadata; test remote HTTP-only cases. |
| Misclassifying local material as remote | Timeline add still triggers transcode/download and delays preview | Centralize the classifier and use it in all three places: remote prefetch, local download, readiness. |
| Stale `localProxy*` fields on saved local materials | UI may show false downloading/degraded state | Direct-local classification wins; `useLocalMaterialDownload` clears stale fields for skipped local materials. |
| Direct same-origin playback still uses local HTTP range requests | DevTools may show storage requests, confusing "zero download" validation | Acceptance should distinguish local storage playback from preview-proxy/client-download; no remote ingest/transcode/download calls are allowed. |
| Removing too much remote logic | Pexels, ARK, and legacy projects regress | Keep remote branches intact and add regression tests for remote materials. |
| Temporary upload card ID replacement breaks timeline references | A user can drag a card while upload is completing and lose the source | Preserve material IDs across upload completion or disable dragging until completion. |
| UI copy still says cloud upload/download | User believes unnecessary network work is happening | Update only visible local import/preparation copy; keep backend route names for compatibility. |
| Images on video tracks are incorrectly included in video readiness | Pure image timelines can become blocked | Read the live `MaterialItem.type`, not only timeline item track type, when deciding readiness. |

## 璇勫缁撹

**鏈夋潯浠堕€氳繃**

No P0 or P1 concerns remain unresolved in v2. The implementation node should
treat the P2 QA distinction as a condition: local storage playback/range
requests are allowed, but direct-local timeline insertion must not call remote
ingest, preview-proxy, media-proxy, or client blob download paths.
