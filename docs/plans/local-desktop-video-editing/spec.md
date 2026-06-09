# Local Desktop Video Editing Spec v2

## 评审记录

- P0: 未发现阻断性问题。方案方向与桌面端本地素材、FastAPI 本地存储、
  FFmpeg 本地处理的目标一致。
- P1: 原文与 `CLAUDE.md` 中“导出路径读取 `serverUrl || url`，不嵌入
  same-origin cacheUrl”的当前约定冲突。已在 v2 中明确本方案是桌面本地
  编辑语义的替代约定：导出 payload 在桌面模式下优先发送可被后端解析的
  same-origin 本地引用，并要求同步更新相关注释、测试和项目约定。
- P1: 后端已有 `video_composition_service._convert_url_to_local_path`、
  URL guard、FFmpeg allow-list、音频转写路径解析等局部能力，原文容易让
  实现者并行新增重复解析逻辑。已修正为抽取并收敛到共享
  `local_media_resolver`，由剪辑、合成等服务复用。
- P1: 原文只覆盖相对 same-origin 路径，未覆盖前端
  `toAbsolutePlaybackUrl` 可能产生的
  `http://localhost:3000/api/storage/files/...` 绝对同源 URL。已补充要求：
  后端先解析 pathname 并识别本地挂载，再决定是否进入远程 URL 分支。
- P1: 原文的剪辑输出流程仍可能沿用 `storage_service.upload_file` 的
  整文件读入内存模式，长视频剪辑会放大内存风险。已补充要求：剪辑输出
  必须直接写入或流式移动到本地 storage root，缩略图同样避免无必要的
  大文件内存拷贝。
- P1: 原文没有明确 `source_ref` 与既有必填 `video_url` 的 Pydantic
  兼容策略。已补充迁移规则：首版必须接受 `video_url` 和 `source_ref`
  二选一，内部归一化为 `source_ref`，响应字段保持兼容。
- P2: preview-proxy / localProxy / original local file 的优先级仍较复杂。
  v2 已要求测试锁定顺序，但实现阶段仍需用诊断日志确认实际 `<video>.src`
  与 resolver 输出一致。
- P2: 旧远程项目兼容路径保留是合理的，但删除“云上传”代码必须按调用点
  证明，不应批量删除共享存储 helper。

## Overview

Ecliptrix has moved from a primarily web-deployed product toward a Windows
desktop application that runs Electron, Next.js, FastAPI, SQLite, FFmpeg, and
the writable media store on the user's machine. The video editor should now
treat local files as the normal path for timeline editing, clip cutting, and
preview playback. A user may still add media through the existing material
panel, AI generation flows, or imported project data, but once the material is
available to the editor it must be represented by a durable local storage record
and a same-origin playback URL served by the local FastAPI process. The editor
must not require uploading media to a cloud bucket before it can trim, compose,
or preview.

The current codebase already contains part of this direction: storage is served
from the local filesystem, cached remote materials are exposed through
`/api/storage/files`, `selectPlaybackUrl` can prefer same-origin cache and
preview-proxy URLs, and `VideoPlayerPanel` can gate playback until local blob
downloads are ready. The remaining design problem is that several paths still
encode cloud-era assumptions. `VideoCutModal` plays `material.url` directly,
`video_cut_service.py` is named and structured as "cut and upload", composition
still prefers `serverUrl || url` in the frontend adapter, and the playback
resolver contains remote media-proxy / preview-proxy fallback tiers that are
useful for cloud material but should not be the default desktop path.

This feature makes the local backend storage record the canonical editing
medium. The frontend continues using same-origin HTTP URLs for browser safety,
but every edit/export backend request carries enough identity for the backend
to resolve that URL to a validated local path under the desktop storage roots.
Cloud upload logic becomes a legacy compatibility layer used only for imported
old projects or remote search results that have not been ingested yet; dead
OSS/CDN upload code on the video edit/cut/preview path is removed after tests
show no active frontend caller depends on it.

Version v2 explicitly supersedes the older export-path invariant documented in
`CLAUDE.md`, `selectPlaybackUrl`, `CompositionAdapter`, and related tests that
say export must always prefer `serverUrl || url` and must not carry a
same-origin cache/local URL. That invariant was correct for cloud-era
composition, but is now wrong for packaged desktop editing. The implementation
must update those comments and tests alongside the code so future contributors
do not reintroduce remote-first export behavior.

## Technical Design

### Architecture

Use a three-layer local media contract:

1. Renderer-visible URL: a same-origin URL such as
   `/api/storage/files/video/2026/06/09/task-x/file.mp4`,
   `/api/audio/generated/name.mp3`, or
   `/api/storage/files/cached_materials/pexels/id.mp4`. This is the only value
   assigned to `<video>` and `<audio>` elements in desktop mode.
2. Backend local path: an absolute path under an allow-listed root such as
   `settings.storage.root`, `static/audio/generated`, `static/audio/subtitles`,
   `static/timeline_exports`, `static/video/composed`, or the desktop
   `%APPDATA%/Ecliptrix/storage` equivalent injected by the Electron main
   process.
3. Material identity: `MaterialItem.id`, optional `storageKey`, and optional
   `metadata.localPath` never exposed as raw `file://` to the browser. Backend
   APIs resolve these values server-side and validate the final path before
   passing it to FFmpeg.

Frontend playback selection remains centralized. `selectPlaybackUrl` should be
extended to make `cacheUrl` / local storage URLs the default preview candidate
in desktop mode. `resolveSequencePlaybackUrl` should keep `localProxy` first
when the in-memory blob has already been created, then same-origin local file,
then legacy remote fallback. The important change is that a desktop-local
material is considered playable without preview-proxy or media-proxy. If
`material.url` is already same-origin, the resolver should return it directly
instead of attempting remote proxy fallbacks. `VideoCutModal` must use the same
resolver instead of directly reading `material.url`, so the original preview,
clip preview, and timeline preview all share the same URL rules.

Backend cutting and composition should consume local paths first. Extract the
existing local URL conversion and FFmpeg path-guard behavior from
`video_composition_service._convert_url_to_local_path` into a shared
`app/services/local_media_resolver.py` instead of creating a second resolver
with slightly different rules. The public API should be close to
`resolve_media_reference(reference: str, material_id: str | None = None,
allow_remote: bool = False) -> ResolvedMediaPath`.

The resolver should accept same-origin API paths, absolute local paths only
when they are under an allowed root, and remote HTTP URLs only when legacy
compatibility is explicitly allowed. It must normalize both relative paths and
absolute local-server URLs. For example,
`/api/storage/files/video/a.mp4`,
`http://localhost:3000/api/storage/files/video/a.mp4`, and
`http://127.0.0.1:8000/api/storage/files/video/a.mp4` should all resolve by
their pathname when the origin is one of the configured local frontend/backend
origins. A non-local HTTP URL must remain in the remote compatibility branch
and must pass the existing SSRF guard before any download or FFmpeg use.

For `/api/storage/files/...`, strip the route prefix, join with
`settings.storage.root`, normalize, and validate with the same allow-list guard
used by composition. For `/api/audio/generated/...` and
`/api/audio/subtitles/...`, resolve against the static audio roots. For
`/static/timeline_exports/...`, resolve against the timeline export root. The
resolver should also cover existing composed-output public paths if
`/api/video/compose` exposes them through a router rather than a StaticFiles
mount. Reject `file://`, path traversal, private network URLs, unsupported
schemes, and unknown routes with structured errors compatible with the
backend's `ErrorResponse` conventions.

`video_cut_service.py` should be renamed internally from
`cut_and_upload_video_clips` to `cut_video_clips_to_local_storage`, while the
router response contract can remain compatible. The implementation should not
download a same-origin URL with curl. It should resolve the source to a local
path, run FFmpeg against that path, write output clips under a deterministic
local folder such as `video/clips/YYYY/MM/DD/task-<task_id>/`, generate
thumbnails beside the clips, and return same-origin file URLs. The service may
reuse `storage_service` only if it writes or moves from a file path without
loading the entire clip into memory; otherwise add a narrow helper for
path-to-storage moves. The returned result may still use the existing JSON
field `video_url` for compatibility, but the meaning is now "local storage
URL". Any wording in logs, API comments, or i18n that says "upload to cloud" on
this path should be changed to "save to local materials".

Composition already has strong FFmpeg and local path validation, but the
frontend adapter should stop preferring remote durable URLs when a same-origin
local URL is available. `CompositionAdapter.extractVideoSequences` and
`extractAudioSequences` should set `url` to the backend media reference that
will be exported. In desktop mode that means `cacheUrl`, a same-origin `url`,
or a generated local audio URL comes before `serverUrl`. Preview-only fields
such as `previewProxyLocalUrl` and `localProxyUrl` must stay out of export
payloads because they are transient playback optimizations, not canonical
media. For export requests, `buildCompositionRequest` should preserve the
chosen local reference in `video_sequences[].url` and `audio_sequences[].url`,
falling back to `serverUrl || url` only for legacy remote material. On the
backend, composition should call `local_media_resolver` before considering
remote downloads. The existing remote download branch remains only for
imported old projects, Pexels results that failed ingest, or explicit
non-desktop deployments.

### Sequence of Operations

1. User imports or generates a material.
2. Frontend material management receives a response from local FastAPI storage
   and creates a `MaterialItem` with `url`, `serverUrl`, and preferably
   `cacheUrl` set to the same-origin local file URL. `metadata.storageKind`
   should be `local`.
3. User drags material to the timeline. Timeline items keep `materialId`,
   `clipStart`, `clipEnd`, `duration`, and volume, but do not copy raw remote
   URLs.
4. Preview asks `resolveSequencePlaybackUrl(sequence, materials, opts)` for the
   latest material-backed source. The primary source is `localProxyUrl` if
   ready, then same-origin local URL, then legacy proxy/origin fallback.
5. Clip cutting modal opens a video material. It resolves the original and
   preview clip source with the same preview resolver, seeks within one video
   element, and records clip ranges in memory.
6. User exports clips. Frontend calls `POST /api/video-cut` with `source_ref`
   or legacy `video_url`, optional material identity, and clip ranges. Backend
   normalizes the reference, resolves it to a local path, runs FFmpeg, writes
   new local material files, and returns local URLs. Frontend appends returned
   clips to the material panel.
7. User exports the full timeline. Frontend builds `/api/video-compose` payload
   with local references when possible. Backend resolves all media to local
   paths, composes with FFmpeg, and exposes the result through local storage.

## File / Module Change Plan

| File | Change | Intent |
| --- | --- | --- |
| `CLAUDE.md` | Update the storage/export note that currently says export reads `serverUrl||url` and never embeds same-origin storage URLs. | Keep repository guidance consistent with the new desktop local-first export contract. |
| `src/types/index.ts` | Modify `MaterialItem` to document local storage fields; add optional `storageKey`, `storageKind`, and `localResolvedUrl` metadata shape if needed. | Make local material identity explicit without exposing raw `file://` paths. |
| `src/components/video/lib/selectPlaybackUrl.ts` | Modify preview priority so same-origin local URLs are the desktop default; keep remote proxy fallbacks behind options. | One source of truth for local preview URL selection. |
| `src/components/video/lib/resolveSequencePlaybackUrl.ts` | Modify candidate ordering and source labels to include `localStorageUrl`; add tests for same-origin local URL before proxy/origin. | Keep timeline preview and actual `<video>.src` byte-identical. |
| `src/components/video/components/VideoCutModal/VideoCutModal.tsx` | Replace direct `src={material.url}` with the shared playback resolver for original and clip preview; pass resolved source diagnostics to logs. | Make the cut panel play local cached material consistently. |
| `src/components/video/hooks/useMaterialManagement.ts` | Ensure uploaded/imported local files set same-origin `url`, `serverUrl`, `cacheUrl`, and `metadata.storageKind='local'`; rename user messages away from cloud upload. | Create correct local materials at ingestion time. |
| `src/components/video/timeline/domain/ports.ts` | Update comments and optional fields so sequence `url` is a backend media reference, not always `serverUrl||url`; add `cacheUrl`/`sourceRef` typing where needed. | Remove stale export-path invariant from the domain contract. |
| `src/components/video/timeline/infrastructure/CompositionAdapter.ts` | Prefer same-origin local references in composition payloads and keep remote URLs only as fallback. | Ensure backend FFmpeg receives local material references for desktop exports. |
| `src/components/video/timeline/__tests__/CompositionAdapter.cacheUrl.test.ts` | Rewrite old assertions that required export to skip `cacheUrl`; desktop mode should export local references. | Prevent the legacy cloud-era invariant from blocking this feature. |
| `src/components/video/timeline/__tests__/cachePlayback.integration.test.ts` | Update integration expectations so ready `local_url` can flow into export payloads when desktop local mode is active. | Verify material ingest, preview, and export agree on local references. |
| `src/components/video/timeline/infrastructure/__tests__/CompositionAdapter.exportPath.test.ts` | Replace "emit seq.url verbatim and ignore cacheUrl" guard with "emit chosen canonical local media reference". | Lock the new export semantics. |
| `src/lib/api/videoCut.ts` | Keep endpoint path, update request comments and timeout error copy to "local cut/save". | Preserve API compatibility while clarifying semantics. |
| `src/lib/api/__tests__/videoCut.test.ts` | Update existing tests and add local URL payload case. | Lock frontend cut API behavior. |
| `src/components/video/lib/__tests__/selectPlaybackUrl.test.ts` | Add local desktop URL priority tests. | Prevent regression to remote origin playback. |
| `src/components/video/lib/__tests__/resolveSequencePlaybackUrl.test.ts` | Add sequence tests for local storage URL, local blob, and legacy remote fallback. | Verify candidate ordering and fallback chain. |
| `src/components/video/components/VideoPlayerPanel/__tests__/VideoPlayerPanel.localPreview.test.tsx` | Extend coverage for same-origin material playback without preview-proxy. | Confirm preview starts when local media is available. |
| `src/components/video/components/VideoCutModal/__tests__/VideoCutModal.localPreview.test.tsx` | Create test file. | Verify cut modal uses resolved local source for both videos and loops clip preview by range. |
| `backend-services/basic-service/app/services/local_media_resolver.py` | Create. | Centralize same-origin URL to validated local path resolution. |
| `backend-services/basic-service/app/services/video_cut_service.py` | Modify service to resolve local source, cut to local storage, and stop remote curl for same-origin URLs. | Make clip cutting local-first. |
| `backend-services/basic-service/app/services/video_composition_service.py` | Reuse `local_media_resolver` before remote download fallback; keep existing FFmpeg allow-list validation. | Make timeline export local-first. |
| `backend-services/basic-service/app/routers/video_router.py` | Update `/api/video/cut` comments/logs and validate local references. | Clarify endpoint behavior without breaking route. |
| `backend-services/basic-service/app/models/video_models.py` | Add optional `material_id` / `source_ref` aliases if needed while keeping `video_url`. | Allow future clients to avoid copying URLs. |
| `backend-services/basic-service/tests/test_local_media_resolver.py` | Create. | Cover route prefix resolution, traversal rejection, and allowed roots. |
| `backend-services/basic-service/tests/test_video_cut_local_storage.py` | Create. | Verify local cut output and no remote download for same-origin source. |
| `backend-services/basic-service/tests/test_video_composition_local_refs.py` | Create or extend existing composition tests. | Verify compose resolves local URLs to paths and rejects unsafe paths. |
| `src/lib/i18n.ts` | Modify only relevant user-visible copy that says upload/cloud for cut/export local flows. | Match desktop local behavior in UI text. |
| `docs/plans/local-desktop-video-editing/spec.md` | Create. | This implementation design. |

## Interface Design

Existing frontend route remains:

```http
POST /api/video-cut
```

This Next.js route continues to proxy to:

```http
POST /api/video/cut
```

Compatible request shape:

```json
{
  "task_id": "task-123",
  "video_url": "/api/storage/files/video/2026/06/09/task-123/source.mp4",
  "material_id": "video_abc",
  "clips": [
    {
      "id": "clip_1",
      "name": "Clip 1",
      "start_time": 3.2,
      "end_time": 8.7,
      "duration": 5.5
    }
  ],
  "generate_thumbnails": true
}
```

`material_id` is optional for backward compatibility in the first
implementation. `video_url` may be renamed internally to `source_ref`, but the
public model must accept both during migration. Existing clients that send
`video_url` continue to work; new clients may send `source_ref`; requests that
send both must either match after normalization or fail with a structured
validation error. Internally, the router/service should normalize to one
`source_ref` field before calling the resolver.

```json
{
  "task_id": "task-123",
  "source_ref": "/api/storage/files/video/2026/06/09/task-123/source.mp4",
  "material_id": "video_abc",
  "clips": []
}
```

Equivalent absolute same-origin forms are valid inputs and must be normalized
by pathname before remote URL handling:

```json
{
  "task_id": "task-123",
  "source_ref": "http://localhost:3000/api/storage/files/video/2026/06/09/task-123/source.mp4",
  "clips": []
}
```

Response shape stays compatible:

```json
{
  "success": true,
  "message": "Successfully cut and saved 1 video clips locally",
  "clips": [
    {
      "id": "clip_1",
      "name": "Clip 1",
      "video_url": "/api/storage/files/video/clips/2026/06/09/task-task-123/clip_1.mp4",
      "thumbnail_url": "/api/storage/files/video/clips/2026/06/09/task-task-123/clip_1_thumb.jpg",
      "file_size": 1234567,
      "duration": 5.5,
      "width": 1920,
      "height": 1080,
      "format": "mp4"
    }
  ],
  "total_clips": 1,
  "processing_time": 1.23
}
```

Composition route remains:

```http
POST /api/video-compose
```

The payload continues using `video_sequences[].url` and
`audio_sequences[].url`, but frontend should populate those fields with local
same-origin references when available. Backend treats each `url` as a media
reference, not automatically as a network URL. For desktop-local material,
`url` may be a relative same-origin path or an absolute local-server URL; for
legacy remote material, `url` remains the original HTTP URL and is allowed only
through the guarded compatibility branch. Preview-only blob URLs and
preview-proxy URLs are never valid composition inputs.

No new WebSocket or Electron IPC interface is required for this feature. If a
later implementation wants native file picker integration, it should add a
separate Electron preload method that copies selected files into local storage
and returns the same material response shape; it should not pass `file://`
directly to the React editor.

## Data Model

Frontend in-memory `MaterialItem` should support the following local-first
shape:

```ts
interface MaterialItem {
  id: string
  type: 'video' | 'audio' | 'image' | 'subtitle' | ...
  url: string
  serverUrl?: string
  cacheUrl?: string
  localProxyUrl?: string
  localProxyStatus?: LocalProxyStatus
  metadata?: {
    storageKind?: 'local' | 'cached_remote' | 'legacy_remote'
    storageKey?: string
    originalUrl?: string
    fileName?: string
    isLocalFile?: boolean
  }
}
```

For desktop-local materials, set `url`, `serverUrl`, and `cacheUrl` to the
same same-origin local URL unless there is a specific reason to distinguish
them. This minimizes old call-site breakage. For cached remote materials,
`url/serverUrl` can preserve the origin URL for provenance, while `cacheUrl`
and `metadata.storageKind='cached_remote'` identify the playable local file.

Backend resolver output:

```py
@dataclass(frozen=True)
class ResolvedMediaPath:
    input_ref: str
    path: Path
    public_url: str | None
    source_kind: Literal[
        "local_storage",
        "audio_generated",
        "audio_subtitle",
        "timeline_export",
        "video_composed",
        "cached_remote",
    ]
```

Video cut request normalization:

```py
class VideoCutRequest(BaseModel):
    task_id: str
    video_url: str | None = None
    source_ref: str | None = None
    material_id: str | None = None
    clips: list[VideoCutClipRequest]
    generate_thumbnails: bool = True
```

The model or router should validate that at least one of `video_url` or
`source_ref` is present, then pass only the normalized `source_ref` into
`VideoCutService`. Keep `video_url` in examples and responses until all
frontend callers have migrated.

No database migration is required for the first implementation if local storage
URLs remain derivable from current material/project records. If downstream
engineers decide to persist `storageKey`, add it to the project JSON material
payload rather than a new relational table, because video projects already
persist flexible material/timeline data.

## Testing & Acceptance Criteria

Unit tests:

1. `selectPlaybackUrl` returns same-origin `cacheUrl` / local `url` before
   remote `serverUrl` for `purpose:'preview'`.
2. `selectPlaybackUrl({ purpose:'export' })` no longer blindly prefers remote
   origin when a local desktop storage URL is available as the canonical source.
3. `resolveSequencePlaybackUrl` returns `localProxyUrl` first when ready,
   same-origin local URL second, preview-proxy third, and remote fallback last.
4. `VideoCutModal` assigns the resolved local source to both video elements and
   never reads `material.url` directly in JSX.
5. `local_media_resolver` resolves `/api/storage/files/video/a.mp4` to the
   configured storage root; resolves absolute local-server URLs by pathname;
   and rejects `../`, unknown prefixes, `file://`, unsupported schemes, and
   remote URLs when `allow_remote=False`.
6. `VideoCutRequest` accepts `video_url` or `source_ref`, rejects requests with
   neither, and rejects conflicting values when both are supplied.
7. `video_cut_service` with a same-origin URL does not invoke curl or any
   network download branch, and writes clips/thumbnails to local storage
   without reading large video files wholly into memory.
8. `CompositionAdapter` tests that previously asserted export skips `cacheUrl`
   are updated to assert desktop-local export uses the canonical local
   reference while still excluding `localProxyUrl` and preview-proxy URLs.
9. `video_composition_service` resolves local media before remote download and
   preserves the existing FFmpeg protocol/path guard behavior.

Integration tests:

1. Import a local video through the material panel, create two clips in the cut
   modal, export them, and confirm both returned clips appear in the material
   panel with playable local URLs.
2. Add a local video plus a generated local audio file to the timeline, press
   play, and confirm playback starts without waiting on preview-proxy.
3. Export a timeline from local materials and confirm the composed file is
   created under local storage and downloadable through `/api/video/compose/...`.
4. Load a legacy project whose material only has a remote HTTP URL; confirm the
   compatibility ingest/proxy path either localizes it or surfaces a clear
   recoverable error.
5. Export a timeline containing a cached remote material whose `cacheUrl` is
   `/api/storage/files/cached_materials/...`; confirm no external network
   request is made during composition.

Acceptance criteria:

1. Desktop users can cut clips from local video material without any cloud
   upload credentials or public network access.
2. Timeline preview and cut modal preview use the same local-first URL
   selection behavior.
3. Full timeline export succeeds from local video/audio/image materials.
4. Remote/cloud-only branches are not executed for same-origin local media.
5. Unsafe local paths and path traversal are rejected before FFmpeg execution.
6. Existing remote material compatibility tests still pass.
7. UI copy no longer tells users that clip export is uploading to cloud storage.
8. Repository guidance and inline comments no longer describe desktop export as
   `serverUrl || url` remote-first.

Verification commands:

```bash
npm run type-check
npm run test -- src/components/video/lib/__tests__/selectPlaybackUrl.test.ts
npm run test -- src/components/video/lib/__tests__/resolveSequencePlaybackUrl.test.ts
npm run test -- src/components/video/timeline/__tests__/CompositionAdapter.cacheUrl.test.ts
npm run test -- src/components/video/timeline/__tests__/cachePlayback.integration.test.ts
npm run test -- src/components/video/timeline/infrastructure/__tests__/CompositionAdapter.exportPath.test.ts
npm run test -- src/components/video/components/VideoCutModal/__tests__/VideoCutModal.localPreview.test.tsx
npm run test -- src/components/video/components/VideoPlayerPanel/__tests__/VideoPlayerPanel.localPreview.test.tsx
cd backend-services/basic-service
pytest tests/test_local_media_resolver.py -v
pytest tests/test_video_cut_local_storage.py -v
pytest tests/test_video_composition_local_refs.py -v
```

Manual desktop smoke test:

1. Run `cd desktop` then `npm run dev`.
2. Import a local MP4 from the material panel.
3. Open the cut modal, set a range, preview the range, and export clips.
4. Drag the original clip and exported clip to the timeline.
5. Press play, scrub across clip boundaries, and verify no network-origin media
   URL is used in DevTools for local material playback.
6. Export the timeline and play the generated output file.

## Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Exposing raw local file paths to the renderer | Privacy leak and browser playback inconsistency | Keep renderer URLs same-origin HTTP; resolve absolute paths only inside FastAPI. |
| Path traversal through `/api/storage/files/...` | Arbitrary file read or FFmpeg input injection | Normalize with `Path.resolve()`, validate against allowed roots, reject unknown prefixes. |
| Breaking legacy remote projects | Old saved projects fail to preview/export | Keep explicit remote compatibility branch and add tests for `legacy_remote`. |
| Duplicate URL semantics (`url`, `serverUrl`, `cacheUrl`) remain confusing | Future regressions pick remote URLs again | Document local-first priority in `MaterialItem`, centralize selection in `selectPlaybackUrl` and `resolveSequencePlaybackUrl`, add regression tests. |
| Stale export-path comments/tests restore `serverUrl||url` behavior | Local desktop export silently falls back to remote URLs | Update `CLAUDE.md`, adapter comments, domain port comments, and all export-path tests in the same implementation change. |
| Absolute same-origin URLs are misclassified as remote HTTP URLs | Local files hit SSRF guard, curl, or external download logic | Resolver must parse local configured origins by pathname before remote URL validation, with tests for localhost and 127.0.0.1 forms. |
| Cutting large clips reads whole outputs into memory | Desktop export becomes unstable on long local videos | Write or move FFmpeg outputs directly into storage root; only stream small metadata/thumbnail reads when required. |
| Large local preview blobs use too much memory | Playback instability on long videos | Reuse existing `LocalMediaCache` budget warnings; allow streaming same-origin local file without forcing blob download. |
| FFmpeg availability differs between dev and packaged desktop | Cut/export failures in packaged app | Smoke test packaged `desktop/release/win-unpacked` and ensure Electron injects bundled FFmpeg into backend PATH. |
| Cloud upload code removal deletes still-used storage helpers | Regressions in TTS, AI generation, or non-desktop deploys | Remove only call sites proven dead on video cut/preview/export path; keep generic local `storage_service.upload_file` because it writes to local storage. |
| Same-origin URLs from Next.js proxy and FastAPI mounts differ | Backend resolver cannot map a frontend path | Resolver should handle both Next.js proxy path and FastAPI public path, and tests should cover `/api/storage/files/...`, `/api/audio/generated/...`, and `/static/timeline_exports/...`. |

## 评审结论

有条件通过。

P0/P1 问题已在 v2 正文中修复，方案可以交给实现节点执行。剩余条件是：

1. 实现时必须同步更新 `CLAUDE.md`、adapter/domain 注释和旧导出路径测试，
   否则代码评审应阻止合入。
2. 实现时必须证明 same-origin 本地素材不会进入 curl、远程下载或云上传
   分支，且大文件剪辑输出不会整文件读入内存。
3. 实现时必须保留 legacy remote 兼容测试，避免本地优先改造破坏旧项目。
