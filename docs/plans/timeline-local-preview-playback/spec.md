# Timeline Local Preview Playback Spec

## Overview

The previous desktop-local material work moved uploaded media away from the
cloud-era transcode, upload, download, and preview-proxy assumptions. A file
imported by a desktop user should become a local material backed by the FastAPI
storage mount, then play directly from a same-origin URL such as
`/api/storage/files/video/...` after it is added to the editing timeline. The
remaining defect is narrower: materials that appear correctly in the material
panel still fail to play normally once they become timeline track items.

The likely failure is not the storage upload itself. The current code already
creates local material metadata in `src/components/video/lib/localMaterial.ts`
and the timeline drop path forwards `url`, `serverUrl`, `cacheUrl`,
`storageKey`, and `metadata` into `MaterialData`. The fragile area is the
handoff from timeline state to `compositionPlayback.videoSequences`, then from
those sequences into `VideoPlayerPanel` source assignment. Some of those paths
still use frozen sequence snapshots or memoization keys that only notice item
IDs and duration. When material playback fields are patched after insertion, or
when a placeholder upload material is replaced with the completed local
material, the player can keep an old empty/remote URL and never re-bootstrap to
the direct local storage URL.

This plan fixes the timeline preview contract end to end. The source of truth
for playable URLs must be the live `MaterialItem` list keyed by `materialId`,
not the stale `TimelineItem.url` or `VideoSequenceItem.url` snapshot. Timeline
items should still retain URL snapshots for persistence and diagnostics, but
preview playback must recompute against the current material on every relevant
material URL change. The implementation must preserve remote-material behavior:
Pexels, ARK, cached remote assets, preview-proxy, and client-local blob download
remain available for non-direct-local material types.

## Technical Design

### Architecture

The fix has three layers.

First, centralize local-preview URL selection in the existing pure helpers.
`isDirectLocalMaterial()` should remain the classifier for direct desktop
uploads. `resolveSequencePlaybackUrl()` should keep resolving a sequence by
`seq.materialId` against the live `materials` array. For direct-local materials,
its primary candidate must be the current local storage URL from
`metadata.localResolvedUrl`, `cacheUrl`, `url`, or `serverUrl`, excluding
`cached_materials`. It must not prefer `localProxyUrl` or preview-proxy for
direct local files. The resolver should expose enough diagnostic information in
tests to prove the selected source is `localStorageUrl`.

Second, make `useTimelineComposition` refresh composition sequences when
playback-relevant material fields change. Today `handleTimelineStateChange()`
updates `compositionPlayback` only when sequence count, sequence IDs, audio
sequence IDs, or total duration change. That misses the important transition
from an upload placeholder or stale snapshot to a completed local material URL.
The hook should compute a stable playback signature for every video and audio
sequence. The signature should include sequence ID, material ID, track ID,
`url`, `cacheUrl`, `serverUrl`, `metadata.localResolvedUrl`,
`previewProxyLocalUrl`, `previewProxyStatus`, `localProxyUrl`,
`localProxyStatus`, `clipStart`, `clipEnd`, `duration`, and `startTime`. The
state update should run whenever the signature changes, while preserving the
current sequence index if the current sequence still exists.

Third, ensure every player bootstrap and sequence switch uses the same resolver
options as the assignment path. `VideoPlayerPanel.getSequencePreviewSrc()` and
`assignSequenceSrc()` already call `resolveSequencePlaybackUrl()` with
`preferPreviewProxy` and `preferLocalProxy`; however `resolvedFirstSrc` and
some cached-video fallback paths call the resolver without those options, and
the initial bootstrap effect still computes `newSrc` via `selectPlaybackUrl`
on the sequence snapshot. That creates inconsistent comparison and assignment
keys. Replace those comparison paths with a small local helper:
`resolvePlayerSequence(seq): ResolvedPlaybackUrl | null`, which always passes
the locked feature flags and live materials. Source-change checks,
bootstrap assignment, fallback-chain construction, seek switching, and
preview-proxy hot-swap must all consume that helper.

### Key Code Paths

1. User imports a local video in `useMaterialManagement`.
2. `createLocalMaterialFromUpload()` returns a completed `MaterialItem` with
   `url`, `serverUrl`, `cacheUrl`, `metadata.storageKind='local'`, and
   `metadata.localResolvedUrl` all pointing at the same local storage file.
3. User clicks add-to-timeline from `VideoEditingInterface`, which sets
   `materialsToAddToTimeline`.
4. `TimelinePanel.handleAddMaterialsToTimeline()` calls
   `handleMaterialDrop()`, converts the material to `MaterialData`, and calls
   `addItemAction()`.
5. `ItemPlacementService.createItemFromMaterial()` creates a `TimelineItemData`
   with the material ID and local URL snapshots.
6. `VideoEditingInterface.handleTimelineStateChange()` mirrors timeline state
   into the video editing store and delegates to
   `timelineComposition.handleTimelineStateChange()`.
7. `useTimelineComposition` extracts sequences using `CompositionAdapter`.
   The updated playback signature detects the local URL fields and publishes a
   fresh `compositionPlayback`.
8. `VideoPlayerPanel` resolves the active sequence against live materials,
   assigns the local storage URL to `<video>`, and does not wait for local
   download or preview-proxy readiness for direct local materials.

## File / Module Change Plan

| File | Action | Intent |
| --- | --- | --- |
| `src/components/video/hooks/useTimelineComposition.ts` | Modify | Add playback signatures for extracted video/audio sequences and update `compositionPlayback` when URL/proxy/local material fields change, not only when IDs or duration change. |
| `src/components/video/hooks/__tests__/useTimelineComposition.localPreview.test.ts` | Create | Reproduce the regression: a timeline item first resolves to an empty/stale URL, the material is patched to a local storage URL, and composition playback refreshes without adding a new item. |
| `src/components/video/timeline/infrastructure/CompositionAdapter.ts` | Modify | Ensure video and audio sequences carry all preview-relevant hints available from the live material: `cacheUrl`, local resolved URL if the type supports it, and stable `materialId`. |
| `src/components/video/timeline/infrastructure/__tests__/CompositionAdapter.localPreview.test.ts` | Create | Verify local uploaded materials produce sequences with `url` set to the canonical local storage reference and `cacheUrl` preserved. |
| `src/components/video/lib/resolveSequencePlaybackUrl.ts` | Modify | Keep live-material lookup authoritative; add direct-local fallback ordering tests if any current branch can prefer a stale sequence URL over live local storage. |
| `src/components/video/lib/__tests__/resolveSequencePlaybackUrl.test.ts` | Modify | Add tests for placeholder-to-local material replacement, direct-local priority over sequence snapshot, and cached remote still preferring preview-proxy when enabled. |
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | Modify | Introduce one resolver wrapper used by bootstrap source comparison, assignment, cached fallback chains, sequence switching, and hot-swap logic. Remove direct `selectPlaybackUrl(firstSequence)` use from composition bootstrap. |
| `src/components/video/components/VideoPlayerPanel/__tests__/VideoPlayerPanel.localPreview.test.tsx` | Modify | Add a component-level regression proving a local uploaded material added to a track sets `<video>.src` to `/api/storage/files/video/...` and the play gate opens immediately. |
| `src/components/video/timeline/TimelinePanel.tsx` | Modify | Keep forwarding local playback fields during drop/programmatic add; adjust only if tests show `metadata.localResolvedUrl` or `storageKey` can be lost in one add path. |
| `src/components/video/timeline/__tests__/TimelinePanel.localPreview.test.tsx` | Create | Cover click-to-add and drag/drop paths so both preserve material ID and local playback snapshots. |
| `src/types/index.ts` | Modify | If needed, document optional direct-local timeline fields on `TimelineItem`; avoid new required fields. |

No backend source file should change. The local storage endpoints and static
file serving are already the durable media interface for the desktop app.

## Interface Design

No new REST, WebSocket, CLI, or Electron IPC interface is required. The frontend
continues to use existing local storage URLs:

```http
POST /api/storage/upload-video
POST /api/storage/upload-file
GET  /api/storage/files/{path}
```

The important interface is the in-memory resolver contract:

```ts
resolveSequencePlaybackUrl(
  seq,
  materials,
  {
    preferPreviewProxy: previewProxyEnabled,
    preferLocalProxy: localPreviewEnabled,
  },
)
```

For a direct-local material, the returned primary URL must be the local storage
URL and `source` should be `localStorageUrl`. For remote material, the existing
ordering remains: ready `localProxyUrl`, cached preview proxy, `cacheUrl`,
`serverUrl`, then `url`.

## Data Model

No database schema changes are needed. The relevant frontend shapes are:

```ts
MaterialItem {
  id: string;
  type: "video" | "audio" | "image" | "subtitle";
  url?: string;
  serverUrl?: string;
  cacheUrl?: string;
  storageKey?: string;
  metadata?: {
    storageKind?: "local" | "cached_remote" | "legacy_remote";
    isLocalFile?: boolean;
    localResolvedUrl?: string;
  };
}

TimelineItem {
  materialId?: string;
  url?: string;
  serverUrl?: string;
  cacheUrl?: string;
  storageKey?: string;
  metadata?: MaterialItem["metadata"];
}

VideoSequenceItem {
  materialId?: string;
  url: string;
  cacheUrl?: string | null;
}
```

`MaterialItem` remains authoritative for preview. `TimelineItem` and
`VideoSequenceItem` may hold snapshots, but a stale snapshot must never prevent
the player from resolving the live material URL.

## Testing & Acceptance Criteria

Add failing tests before implementation. The core unit test should build a
sequence with `url: ""` or an old remote URL and a live direct-local
`MaterialItem` with `/api/storage/files/video/local.mp4`; the resolver must
return the local URL. The composition hook test should simulate a timeline item
already present, then patch the material URL fields without changing item IDs;
`compositionPlayback.videoSequences[0].url` or its playback signature must
refresh.

Component acceptance:

- Upload a local MP4, add it to the timeline via the material panel button, and
  click preview play. The player starts without waiting for transcode, ingest,
  preview-proxy, media-proxy, or local blob download.
- Drag the same local MP4 onto a video track. Behavior matches click-to-add.
- Browser network shows normal range/file reads for `/api/storage/files/video/`
  only. There are no `/api/material/ingest`, `/api/media/preview-proxy`, or
  `/api/media/proxy` calls for that local file.
- Remote materials still use existing localization/proxy behavior.
- Running `npm run test -- src/components/video/lib/__tests__/resolveSequencePlaybackUrl.test.ts src/components/video/hooks/__tests__/useTimelineComposition.localPreview.test.ts src/components/video/components/VideoPlayerPanel/__tests__/VideoPlayerPanel.localPreview.test.tsx` passes.
- Running `npm run type-check` passes.

## Risks & Mitigations

The largest risk is over-updating `compositionPlayback` and causing playback to
reset too often. Mitigate this by comparing stable signatures, not full material
objects, and by preserving `currentSequenceIndex` when the same sequence ID is
still present.

Another risk is breaking remote preview-proxy prioritization while fixing local
files. Mitigate with paired tests: one direct-local case where proxy fields are
ignored, and one cached remote case where preview-proxy still wins when enabled.

Cached video elements can also mask the bug because `VideoCacheAdapter` may
return a previously preloaded URL. The player tests must include a no-cache path
and a cache-hit path, and both fallback chains must be built from the same
resolver wrapper.

Finally, timeline snapshots are persisted in project data. The implementation
must remain backward compatible with older projects whose timeline items lack
`cacheUrl`, `storageKey`, or local metadata. The resolver fallback to live
material by `materialId` is the compatibility mechanism; if the material is
missing, only then should the sequence snapshot be used as the last resort.
