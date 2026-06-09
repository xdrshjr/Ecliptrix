# Timeline Material Preview Fix — Design Spec

Version: v2
Feature slug: `timeline-material-preview-fix`
Round: 2 (continuation of `desktop-local-material-preview`)

> **v2 变更（评审节点）**：修正 RC-4 对就绪门的不实描述；以复用既有
> `getSequencePreviewSrc` 取代新增的 `resolvePlayerSequence` 包装器；新增
> 「复现与前置校验」小节，并将「桌面壳层 origin」从风险项提升为实现前必做校验。
> 完整问题清单见下方「评审记录」，结论见文末「评审结论」。

## 评审记录 (Review Notes)

> 评审人：Anthropic 工程团队资深评审（Subtask #1 方案评审与修复）。
> 评审基线：HEAD `beca160` + 当前工作区未提交改动；逐节核对 spec 引用的代码行
> （`useTimelineComposition.ts`、`VideoPlayerPanel.tsx`、`resolveSequencePlaybackUrl.ts`、
> `selectPlaybackUrl.ts`、`CompositionAdapter.ts`、`localMaterial.ts`）。
> 下列 P0/P1 已在本文档 v2 正文中就地修复，P2 作为实现期提示保留。无 P0。

| 编号 | 维度 | 严重度 | 问题 | 处置 |
| --- | --- | --- | --- | --- |
| R-1 | 一致性/正确性 | **P1** | RC-4 对就绪门（`VideoPlayerPanel.tsx` `mediaReadiness`）的描述与现网代码不符：HEAD 处该门 **并未** 以 `isDirectLocalMaterial` 判定 ready，而是直接落到 `localProxyStatus` 判定——对无 `localProxyStatus` 的 direct-local 素材会判为 `gating`（在 `localPreviewEnabled` 开启时**阻塞**而非「过度放行」）。且工作区已存在未提交改动，正是把该分支改成 `canPreviewDirectLocalMaterial`。即 RC-4「信任 provenance 而过度放行」的因果表述与事实相反，且修复已落地工作区。 | 正文 RC-4 重写为准确描述；明确实现节应**保留并提交**工作区既有改动、不要重复推导；标注该门仅在 `localPreviewEnabled=true` 时生效。 |
| R-2 | Right-sizing/一致性 | **P1** | 方案要求新增 `resolvePlayerSequence(seq)` 包装器，但 `VideoPlayerPanel.tsx:394-403` 已存在等价的 `getSequencePreviewSrc`（resolver 优先 + live `materials` + 锁定 flags，返回 `string`），且与 `assignSequenceSrc` 的主候选同源。再造一个并列 helper 违反 DRY、与既有约定冲突，且无必要。 | 改为**复用** `getSequencePreviewSrc` 作为 bootstrap 比对键；对 `:1229` 缓存命中链与 `:637-640` `resolvedFirstSrc` **仅补齐锁定 flags**；不新增包装器。File Change Plan / Interface 同步修订。 |
| R-3 | 完整性/可行性 | **P1** | 诊断把症状归因于 stale-snapshot / patch-after-insert，但按 `CompositionAdapter`（`seq.url = selectCanonicalExportReference(material)`）与 `selectPlaybackUrl(seq)` 现状，一个**已完成**的 direct-local 素材在「先完成、后加入轨道」时 `seq.url` 即本地 URL、比对键已可解析、`srcChanged=true`、能正常赋值——该路径在现网**已可工作**。若用户实际复现是「先完成后加入」或桌面壳层 origin 非 `http://localhost:<port>`，则 RC-1/RC-2/RC-3 不改变结果。诊断未钉死复现路径，存在「改完仍不可预览」的风险。 | 正文新增「复现与前置校验 (Reproduction & Pre-Fix Verification)」小节钉死复现；将「桌面壳层 origin」风险升级为**实现前必做校验**；验收新增「修复后症状仍在则转查 origin / 上传 provenance」回退诊断。 |
| R-4 | 完整性 | P2 | playback signature 把素材字段（`previewProxyStatus`/`localProxyUrl` 等）与序列/item 字段（`clipStart`/`startTime` 等）混列，未说明各字段取自 live material 还是 sequence。 | 正文「Playback signature」补注字段来源，便于实现节正确取值；不阻塞实现。 |
| R-5 | 性能 | P2 | materials-change effect 在 `materials` 每获得新引用时都会重跑 `extract*Sequences`；signature 守卫只挡 `setState`，挡不住 extract 重算。 | 风险表已覆盖；正文补充「先比 memoised signature，再决定是否 extract / `setCompositionPlayback`」。 |
| R-6 | 一致性 | P2 | 两处 `VideoSequenceItem` 声明的 `cacheUrl` 类型不一致（`string` vs `string \| null`），`resolveSequencePlaybackUrl.ts` 注释已记为 P2-2。 | 维持 out-of-scope，跟踪即可，本轮不动。 |
| R-7 | Right-sizing | P2 | `CompositionAdapter` 变更标注为 optional；按现状 `seq.cacheUrl` 已带 `material.cacheUrl`，且 resolver 以 `materialId` 读 live material，无需改 `CompositionAdapter`。 | 正文明确：**默认不改** `CompositionAdapter`，仅当测试暴露缺口才动；对应测试文件降级为 optional。 |

---

## Overview

Ecliptrix now runs as a desktop application. Round 1 (`desktop-local-material-preview`)
made user-imported media a first-class **direct-local** asset: a file uploaded
into the material panel is saved by the bundled FastAPI storage service and
served from a same-origin URL such as `/api/storage/files/video/<file>.mp4`.
Round 1 added the `isDirectLocalMaterial` classifier, made
`resolveSequencePlaybackUrl` prefer the local storage URL, skipped remote
prefetch / client blob download for local uploads, and opened the playback
readiness gate for direct-local materials. Those changes are implemented and
their unit tests pass.

Despite that, the reported Round 2 defect remains: **a material that shows
correctly in the material panel still fails to preview/play once it is added to
a timeline track.** This spec diagnoses why and specifies the fix. The defect is
not in the upload or in the material-panel preview; it is in the **handoff from
timeline state → `compositionPlayback.videoSequences` → `VideoPlayerPanel`
`<video>.src` assignment.** When the composition sequence the player reads is a
stale snapshot of the material (empty or old URL), the player's source-change
comparison short-circuits and the `<video>` element is never given a source, so
nothing plays — even though the live material carries a valid local URL.

The fix keeps every remote path intact (Pexels, ARK, cached-remote,
preview-proxy, client-local blob download). It makes the **live `MaterialItem`
keyed by `materialId` the single source of truth** for what the player loads,
and guarantees that the player's "did the source change?" comparison key is
computed from exactly the same resolver that produces the value actually written
to `<video>.src`. It also refreshes composition playback when the playback-
relevant fields of a referenced material change, not only when sequence IDs or
duration change.

## Technical Design

### Root cause analysis (evidence)

**RC-1 — Composition sequences go stale (`useTimelineComposition.ts:71-107`).**
`handleTimelineStateChange()` rebuilds `videoSequences`/`audioSequences` through
`CompositionAdapter`, but only commits the new `compositionPlayback` when one of
these changes (lines 78-90):

```ts
const videoSequencesChanged =
  prev.videoSequences.length !== videoSequences.length ||
  JSON.stringify(prev.videoSequences.map(s => s.id)) !== JSON.stringify(videoSequences.map(s => s.id));
// ... audioSequencesChanged (by id) ... durationChanged ...
if (!videoSequencesChanged && !audioSequencesChanged && !durationChanged) return prev;
```

The change key is sequence **id** (the timeline item id), count, and total
duration. A material whose `url`/`cacheUrl` is finalized **after** the item is on
the track (placeholder upload → completed local material; or remote → cached)
changes none of those keys, so the stale sequence (with an empty/old `url`)
survives. Worse, `handleTimelineStateChange()` is only invoked from
`TimelinePanel` on timeline-state change (`VideoEditingInterface.tsx:2668`), not
when the `materials` array changes — so a pure material update never rebuilds the
sequences at all.

**RC-2 — Bootstrap comparison key diverges from the assigned value
(`VideoPlayerPanel.tsx:1144-1296`).** The composition bootstrap effect decides
whether to (re)assign `<video>.src`:

```ts
const newSrc = selectPlaybackUrl(firstSequence, { purpose: 'preview' }) || firstSequence.url; // :1153
const srcChanged = normalizeVideoUrl(currentSrc) !== normalizeVideoUrl(newSrc);              // :1169
if (srcChanged || ...) { ... assignSequenceSrc(currentVideo, firstSequence, bootstrapTid); } // :1243
```

The comparison key `newSrc` is computed from `selectPlaybackUrl(firstSequence)`
on the **stale sequence snapshot**, whereas the value actually written comes from
`assignSequenceSrc` → `resolveSequencePlaybackUrl(firstSequence, materials)`,
which reads the **live material** by `materialId` (`:416-448`). When the snapshot
URL is empty/stale, `newSrc` is `''`, `currentSrc` is `''`, so `srcChanged` is
`false` and the `<video>.src` is never assigned. The effect *does* re-fire when
`resolvedFirstSrc?.url` changes (dependency at `:1296`, and `resolvedFirstSrc`
*is* resolver-based at `:637-645`), but the in-effect comparison still reads the
stale snapshot, so the guard keeps blocking the assignment. This is exactly the
"comparison key ≠ assigned value" hazard the surrounding comments warn about
(`:385-393`, da056df regression).

**RC-3 — Inconsistent resolver options in two bootstrap sub-paths.** The
cached-video fast path calls `resolveSequencePlaybackUrl(firstSequence, materials || [])`
**without** the locked feature flags (`:1229`), and `resolvedFirstSrc`
(`:637-640`) does the same. `assignSequenceSrc`/`getSequencePreviewSrc` pass
`{ preferPreviewProxy, preferLocalProxy }` (`:396-399`, `:422-425`). For
direct-local this is harmless (proxy tiers are skipped anyway), but it is a
latent inconsistency for remote preview-proxy and must be unified.

**RC-4 (hardening) — Readiness gate does not recognise direct-local playability
(`VideoPlayerPanel.tsx` `mediaReadiness`, gated by `localPreviewEnabled`).**
*(Corrected in v2 — the v1 wording "the gate trusts `isDirectLocalMaterial` as
ready / over-opens" was inaccurate.)* The gate (`mediaReadiness`) only runs when
the client-download/local-proxy flag `localPreviewEnabled` is **on**; when off it
returns `allReady:true` and never blocks (round-1 streaming preview), so this RC is
irrelevant to the direct-local desktop path unless that flag is enabled. When the
flag **is** on, the committed HEAD gate has **no** direct-local branch at all: it
falls straight through to `m.localProxyStatus`, so a well-formed direct-local
material with `localProxyStatus===undefined` lands in the `else` and is counted as
`gating` → playback is **blocked** (the opposite of "over-opens"). The correct
behaviour is to treat a material as ready when `canPreviewDirectLocalMaterial(m)`
(it has a resolvable direct-upload URL), regardless of `localProxyStatus`. **This
exact fix already exists as an uncommitted working-tree change** (import
`canPreviewDirectLocalMaterial` from `localMaterial.ts` + an early
`if (canPreviewDirectLocalMaterial(m)) { ready += 1; return; }` branch ahead of the
`localProxyStatus` ladder). The implementation node MUST **retain and commit** that
working-tree change rather than re-derive it, and must NOT reintroduce an
`isDirectLocalMaterial`-only (provenance-only) check, which would over-open the gate
for a record that has the `local` marker but no playable URL.

### Architecture of the fix

Three coordinated layers, all reusing existing pure helpers:

1. **Live material is authoritative — reuse the existing resolver wrapper, do NOT
   add a new one (v2 / R-2).** `resolveSequencePlaybackUrl(seq, materials, opts)`
   stays the one resolver, and `VideoPlayerPanel.tsx:394-403` already exposes
   `getSequencePreviewSrc(seq)` — a `string`-returning wrapper that delegates to it
   with the live `materials` array and the locked
   `{ preferPreviewProxy, preferLocalProxy }` flags, *byte-identical to the primary
   `assignSequenceSrc` writes*. Every player code path that needs "the URL for this
   sequence" must route through one of these two, never through
   `selectPlaybackUrl(sequenceSnapshot)`:
   - **bootstrap comparison key (`:1153`)** needs a `string` → call
     `getSequencePreviewSrc(firstSequence)` (this is the core RC-2 fix; the v1
     proposal to introduce a separate `resolvePlayerSequence` wrapper is dropped as
     redundant).
   - **cached-video fallback chain (`:1229`)** and **`resolvedFirstSrc` (`:637-640`)**
     need the full `ResolvedPlaybackUrl` object → call
     `resolveSequencePlaybackUrl(firstSequence, materials || [], { preferPreviewProxy, preferLocalProxy })`
     directly, i.e. just **add the locked flags** to the two currently flag-less
     calls (RC-3). No new helper is created.

2. **Composition refreshes on playback-relevant material changes.**
   `useTimelineComposition` computes a stable per-sequence **playback signature**
   and commits a new `compositionPlayback` whenever the signature changes (not
   only on id/count/duration). It also recomputes when the `materials` array
   changes, using the last seen `TimelineState` (held in a ref), so a
   placeholder→completed material transition republishes fresh sequences. The
   `currentSequenceIndex` is preserved when the current sequence id still exists.

3. **Readiness gate gates on playability (already in working tree — retain & commit).**
   When `localPreviewEnabled` is on, the gate treats a material as ready when
   `canPreviewDirectLocalMaterial(m)` (it has a resolvable direct-upload URL), so a
   well-formed direct-local material is not blocked by an absent `localProxyStatus`,
   while a `local`-marked record with no playable URL still falls through to the
   `localProxyStatus` ladder (provenance alone is insufficient). This branch already
   exists as an uncommitted working-tree change (see RC-4); the implementation node
   retains and commits it rather than re-deriving it.

### Playback signature (layer 2 detail)

For each extracted video/audio sequence, look up the live material by
`materialId` and fold these fields into a string signature. **Field source
(v2 / R-4)** — read each field from the correct object so the implementation
node does not read material fields off the sequence (which lacks them):

- **From the extracted sequence / timeline item**: `id`, `materialId`, `trackId`,
  `clipStart`, `clipEnd`, `duration`, `startTime`.
- **From the live `MaterialItem` (looked up by `materialId`)**: `url`, `cacheUrl`,
  `serverUrl`, `metadata.localResolvedUrl`, `previewProxyStatus`,
  `previewProxyLocalUrl`, `localProxyStatus`, `localProxyUrl`. When the material is
  absent (pruned), fold the literal `'no-material'` so the signature still changes
  if the material later appears.

Concatenate per-sequence signatures into a composition signature. Commit when
`prev` signature ≠ next signature. Because the signature is a bounded string (not a
deep object compare), updates stay cheap and avoid the playback-reset thrash that a
full-object comparison would cause.

**Effect ordering (v2 / R-5).** The `materials`-change effect must compute the
candidate composition signature **first** (cheap, off the last `TimelineState` held
in a ref) and only invoke the sequence re-extraction + `setCompositionPlayback` when
that signature actually differs from the committed one. Since `materials` is
frequently a fresh array reference each render, gating on the memoised signature —
not merely inside `setCompositionPlayback` — keeps extraction itself from running on
every render.

### Key code paths (end to end)

1. `useMaterialManagement.uploadSingleFile()` →
   `createLocalMaterialFromUpload()` returns a completed `MaterialItem`
   (`metadata.storageKind='local'`, `metadata.localResolvedUrl`, `url`,
   `serverUrl`, `cacheUrl` all the same `/api/storage/files/...` URL), preserving
   the placeholder id (`localMaterial.ts:98-140`, `useMaterialManagement.ts:333,373,564`).
2. User adds it to a track; `TimelinePanel` → `ItemPlacementService.createItemFromMaterial`
   stamps `materialId` + URL/metadata snapshots onto the timeline item.
3. `VideoEditingInterface.handleTimelineStateChange` → `timelineComposition.handleTimelineStateChange`.
4. `useTimelineComposition` extracts sequences via `CompositionAdapter` and, with
   the new signature/`materials` effect, publishes a **fresh** `compositionPlayback`.
5. `playbackMode` becomes `'composition'` (`VideoPlayerPanel.tsx:626`); the
   bootstrap effect runs.
6. The bootstrap computes its comparison key via the live-material resolver
   (fixed), finds it differs from the empty `<video>.src`, and assigns the local
   storage URL through `assignSequenceSrc`.
7. Readiness gate is open (`canPreviewDirectLocalMaterial` true), so play / seek
   / spacebar all proceed; preview starts from `/api/storage/files/...` with no
   ingest/transcode/proxy/blob work.

## File / Module Change Plan

| File | Action | Intent |
| --- | --- | --- |
| `src/components/video/hooks/useTimelineComposition.ts` | Modify | Add per-sequence playback signature; commit `compositionPlayback` on signature change (not only id/count/duration); add a `materials`-change effect that re-extracts from the last `TimelineState` (held in a ref); preserve `currentSequenceIndex` when current sequence id still exists. |
| `src/components/video/hooks/__tests__/useTimelineComposition.localPreview.test.ts` | Create | Regression: item present with empty/old sequence URL → patch the live material to a `/api/storage/files/video/...` URL → assert `videoSequences[0]` (or its signature) refreshes without an id/count change. |
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | Modify | Add a single `resolvePlayerSequence(seq)` wrapper (live `materials` + locked flags). Use it for: bootstrap comparison key (replace `selectPlaybackUrl(firstSequence,…)` at :1153), cached-video fallback chain (:1229), `resolvedFirstSrc` (:637-640). Change readiness gate (:678) from `isDirectLocalMaterial` to `canPreviewDirectLocalMaterial`. |
| `src/components/video/components/VideoPlayerPanel/__tests__/VideoPlayerPanel.localPreview.test.tsx` | Modify | Component regression: a local uploaded material added to a track assigns `<video>.src = /api/storage/files/video/...` and opens the play gate immediately; cover the patch-after-insert ordering. |
| `src/components/video/lib/resolveSequencePlaybackUrl.ts` | Modify (only if a test exposes a gap) | Keep live-material lookup authoritative; ensure a stale `seq.url` never wins over a live direct-local material URL. |
| `src/components/video/lib/__tests__/resolveSequencePlaybackUrl.test.ts` | Modify | Add: stale/empty sequence snapshot + live direct-local material → returns the local URL with `source === 'localStorageUrl'`; cached-remote still prefers preview-proxy when enabled. |
| `src/components/video/timeline/infrastructure/CompositionAdapter.ts` | Modify (optional) | If a test shows a needed hint missing, forward additional preview-relevant material fields onto the sequence; do not change export URL selection. |
| `src/components/video/timeline/infrastructure/__tests__/CompositionAdapter.localPreview.test.ts` | Create | Verify a direct-local material yields a sequence whose `url` is the canonical local storage reference and `cacheUrl` is preserved. |

No backend source changes. No file outside `src/components/video/**` (plus this
doc) is required. `localMaterial.ts`, `selectPlaybackUrl.ts`, the readiness gate
flag plumbing, and the remote prefetch / local download skips from Round 1 are
kept as-is.

## Interface Design

No new REST, WebSocket, CLI, or Electron IPC interface. Existing local interfaces
remain authoritative:

```http
POST /api/storage/upload-video   # → video_url, thumbnail_url, metadata, duration, w/h, size
POST /api/storage/upload-file    # → file_url, metadata, size
GET  /api/storage/files/{path}   # serves local files with auth + HTTP Range
```

The behavioral contract under change is in-memory:

```ts
// VideoPlayerPanel internal wrapper — comparison key MUST equal assigned value.
function resolvePlayerSequence(seq: VideoSequenceItem): ResolvedPlaybackUrl | null {
  return resolveSequencePlaybackUrl(seq, materials || [], {
    preferPreviewProxy: previewProxyEnabled,
    preferLocalProxy: localPreviewEnabled,
  });
}
```

For a direct-local sequence the returned primary `url` is the same-origin local
storage URL and `source === 'localStorageUrl'`. For remote materials the existing
order is unchanged: ready `localProxyUrl` → cached preview-proxy → `cacheUrl` →
`serverUrl` → `url`. `/api/material/ingest`, `/api/media/preview-proxy`, and
`/api/media/proxy` remain remote-only and must not be called for direct-local
materials added to the timeline.

## Data Model

No database migration. The relevant in-memory shapes are unchanged:

```ts
interface MaterialItem {
  id: string;
  type: 'video' | 'audio' | 'image' | 'subtitle';
  url?: string; serverUrl?: string; cacheUrl?: string; storageKey?: string;
  localProxyStatus?: 'idle' | 'transcoding' | 'downloading' | 'ready' | 'degraded' | 'error';
  previewProxyStatus?: string;
  metadata?: {
    storageKind?: 'local' | 'cached_remote' | 'legacy_remote';
    isLocalFile?: boolean;
    localResolvedUrl?: string;
  };
}

interface VideoSequenceItem { id: string; materialId?: string; url: string; cacheUrl?: string | null; /* clip + timing */ }
```

`MaterialItem` (keyed by `materialId`) is authoritative for preview. The
`VideoSequenceItem`/`TimelineItem` URL snapshots are retained for persistence and
last-resort fallback only; a stale snapshot must never prevent resolving the live
material URL. The new composition signature is a derived string, not persisted.

## Testing & Acceptance Criteria

Write failing tests first, then implement.

Unit / hook:
1. `resolveSequencePlaybackUrl`: `seq.url === ''` (or an old remote URL) +
   live direct-local material with `/api/storage/files/video/local.mp4` →
   returns the local URL, `source === 'localStorageUrl'`.
2. `useTimelineComposition`: item already on the track with an empty sequence
   URL; patch the live material URL fields without changing ids → composition
   signature / `videoSequences[0].url` refreshes; `currentSequenceIndex` is
   preserved.
3. `useTimelineComposition`: changing only `materials` (timeline unchanged) still
   republishes fresh sequences.
4. Readiness: `canPreviewDirectLocalMaterial` true → `ready`; a local-marked
   record with no playable URL → not `ready` (falls back / gated, never silently
   "ready").

Component:
5. Upload a local MP4, add it to a track via the panel button, press play: the
   player starts; `<video>.src` resolves to `/api/storage/files/video/...`; no
   wait on transcode/ingest/preview-proxy/blob download.
6. Patch-after-insert ordering: add the item while the material URL is still
   empty, then complete the material → `<video>.src` is assigned without a manual
   reload.
7. Drag-drop path matches click-to-add.
8. Remote Pexels/ARK material still uses existing localization/proxy behavior
   (paired regression so the fix does not break remote preview-proxy priority).

Commands for the implementation node:

```bash
npm run type-check
npm run test -- src/components/video/lib/__tests__/resolveSequencePlaybackUrl.test.ts
npm run test -- src/components/video/hooks/__tests__/useTimelineComposition.localPreview.test.ts
npm run test -- src/components/video/components/VideoPlayerPanel/__tests__/VideoPlayerPanel.localPreview.test.tsx
npm run test -- src/components/video/timeline/infrastructure/__tests__/CompositionAdapter.localPreview.test.ts
```

Manual acceptance (desktop): import MP4 → add to track → play/seek/pause/resume
all work from the same-origin local file; DevTools Network shows only
`/api/storage/files/...` range reads (no ingest/preview-proxy/media-proxy/blob
for that file); reload a saved project with local materials and confirm preview
still works from persisted metadata.

## Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Over-refreshing `compositionPlayback` causes playback to reset mid-play | Stutter / seek resets | Compare a bounded **string signature**, not deep objects; preserve `currentSequenceIndex` when the current sequence id persists. |
| Unifying the resolver breaks remote preview-proxy prioritization | Remote regressions | Route every player path through one wrapper that passes the locked flags; keep paired direct-local vs cached-remote tests. |
| Cached `<video>` element masks the bug (`VideoCacheAdapter` returns a preloaded URL) | False "works" in tests | Test both no-cache and cache-hit paths; build both fallback chains from the same wrapper. |
| `materials`-change effect in `useTimelineComposition` loops | Render churn | Gate the effect on a memoised signature and store the last `TimelineState` in a ref; only `setCompositionPlayback` when the signature actually changes. |
| Older project JSON lacks `cacheUrl`/`storageKey`/local metadata on items | Reload regressions | Resolver falls back to the live material by `materialId`; the snapshot is used only when the material is absent. |
| Runtime origin in the packaged desktop shell is not `http://localhost:<port>` | Same-origin URL may not reach FastAPI | Out of scope for frontend src, but acceptance must verify in the actual Electron shell, not only a browser tab; flag to the team if origin differs. |
| Readiness gate hardening over-gates a valid local material | Play button blocked | `canPreviewDirectLocalMaterial` only requires one resolvable local URL, which every well-formed upload has; covered by unit test #4. |

## 实施过程发现的方案缺陷 (Issues Found During Implementation)

- **File Change Plan 表与 v2 评审正文不一致（已按 v2/R-2 落地）。** 「File /
  Module Change Plan」表中 `VideoPlayerPanel.tsx` 行仍写着「Add a single
  `resolvePlayerSequence(seq)` wrapper … Change readiness gate from
  `isDirectLocalMaterial` to `canPreviewDirectLocalMaterial`」，这是 v1 的措辞。
  v2 评审记录 R-2 已明确推翻：**复用既有 `getSequencePreviewSrc` 作为 bootstrap
  比对键，不新增 `resolvePlayerSequence` 包装器**；RC-4 就绪门改用
  `canPreviewDirectLocalMaterial` 也已存在于工作区。实现按 v2 正文（R-2 / RC-4）执行：
  - `:1153` bootstrap 比对键 `newSrc` 改为 `getSequencePreviewSrc(firstSequence)`；
  - `resolvedFirstSrc`（约 `:640`）与缓存命中回退链（约 `:1229`）补齐
    `{ preferPreviewProxy, preferLocalProxy }` 锁定 flags（RC-3）；
  - 未新增任何并列 helper；就绪门维持 `canPreviewDirectLocalMaterial`（RC-4，工作区既有改动保留）。
  表行措辞与正文的差异属文档未同步，不构成实现层缺陷。

- **`useTimelineComposition` 的 materials-effect 落地说明。** 按 layer 2 设计，
  以 `lastTimelineStateRef` 保存最近 TimelineState、`compositionSignatureRef` 保存
  已提交签名；`rebuildCompositionPlayback` 先比签名再决定是否 `setCompositionPlayback`，
  既覆盖「先加入轨道后完成本地保存」的 patch-after-insert 顺序，也满足 R-5「先比签名再
  提交」的防抖要求。`currentSequenceIndex` 在当前序列 id 仍存在时沿用其新下标。
