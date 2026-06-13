# 已下载素材拖到轨道后仍显示「转码中」— 问题定位与根因分析

> Bug slug: `downloaded-material-stuck-transcoding-on-track`
> 节点：Subtask #0「问题定位与分析」（**本节点只产出分析文档，不写修复代码、不 `git commit`**）
> 分析基线：当前仓库 `main` 分支源码，已逐条核对行号与数据流。
> 关联前序方案：`docs/plans/video-editor-client-preview-download/spec.md`（第 2 轮）、`docs/plans/video-editor-track-download-progress/spec.md`（第 3 轮）、`docs/plans/video-editor-track-download-trigger-fix/spec.md`（第 4 轮）。

---

## 1. 问题描述（Problem description）

用户在「素材库」中搜索互联网视频（Pexels 官方库 / YouTube），将其添加到「素材管理面板」。添加后会触发对应素材的下载（落地到本地 `cached_materials/`）。用户报告了两组缺陷：

**症状 A（主缺陷）— 已下载素材拖到轨道仍显示「转码中」**
- 即使该素材在面板里**已经下载完成**，当用户把它拖到下方视频/音频轨道时，轨道片段上仍长时间显示 **「转码中」** 遮罩，并且播放被门控拦住。
- 用户期望：**下载完成后**这条素材就等同于「本地视频」，应当**完全复用『用户上传视频』的添加与预览逻辑**——直接用本地文件播放，不再走「互联网视频」的服务端 480p 转码 + 流式预览那一套，也不该再显示「转码中」。

**症状 B（增强诉求）— 下载体验三件套**
1. 素材卡片处于下载状态时，应在**卡片标题栏正下方、紧贴标题**显示一条**下载进度条**并展示真实进度（当前没有）。
2. 下载中途出错时应能**重连/续传**，保证下载稳健（当前失败即终止，需手动移除重加）。
3. 当对应 API 凭证失效时应有**轮换重试**机制（当前下载链路无凭证轮换）。

本报告对症状 A 给出完整根因 + 证据 + 候选修复，对症状 B 给出现状差距分析与候选方案。

---

## 2. 复现步骤（Reproduction steps）

环境：按 `CLAUDE.md` 启动前后端（`npm run dev` + 后端 `uvicorn app.main:app`，桌面包同理），确保本地 `ffmpeg` 可用、Pexels 搜索可返回结果。预览本地化特性默认开启（`isLocalPreviewEnabled()` 默认 ON）。

复现症状 A：
1. 进入视频编辑器，打开素材搜索弹窗，选择「官方库（PEXELS）」，搜索任意关键词（如 `city`）。
2. 勾选 1 个 **1080p** 的视频结果，点击「添加」。素材出现在「素材管理面板」。
   - 此时后台 `useRemoteMaterialPrefetch` 静默触发 `/api/material/ingest`，把该视频下载进 `STORAGE_ROOT/cached_materials/...`，并把 `cacheStatus` 推进到 `ready`、回写 `cacheUrl`（同源 `/api/storage/files/cached_materials/...`）。
3. **等待下载完成**（素材已经是本地文件；用浏览器直接访问其 `cacheUrl` 可 200/206 命中本地文件）。
4. 把该素材拖到下方**视频轨道**。
5. **观察缺陷**：轨道片段上出现「转码中」遮罩（`TimelineItemDownloadOverlay`），并维持一段时间：
   - 若该素材命中 480p 代理启发式（如 1080p）：会等待服务端真实转码完成（数秒~数十秒）后再把**整文件重新抓取成 blob**；
   - 若该素材**不命中**启发式（小文件/≤480p）：服务端根本不会发起转码，前端会卡在「转码中」直到 **60s 超时**才降级（`degraded`）回退到流式。
6. 在素材「转码中/未就绪」期间点击播放 → 弹「已就绪 N/M」toast 且不播放（门控拦截）。

> 预期：第 4 步拖入后应**立即**像「上传的本地视频」一样可用——无「转码中」、无二次下载、门控直接计为 ready、点击即播放（直接用 `cacheUrl` 本地文件）。

复现「下载完成前即可拖入」（与症状 A 同源的连带问题）：
- 在第 2 步添加后**立刻**（`cacheStatus` 仍为 `pending`/`downloading` 时）拖动该素材——**仍可拖入轨道**，因为卡片 `draggable` 只看 `downloadStatus`/`uploadStatus`，不看 `cacheStatus`（见 §4 证据）。这与用户「下载完成后才允许添加」的诉求相悖。

复现症状 B-1（无紧贴标题的进度条）：
- 重复第 1~2 步并紧盯卡片：PEXELS 下载过程中**卡片上不出现任何下载进度条**（缩略图上也没有）；只有 YouTube 那条 `downloadStatus='downloading'` 的路径才会在**缩略图上**叠一个圈+小进度条，而非「标题栏正下方」。

---

## 3. 根因分析（Root cause analysis，含证据）

### 3.1 一句话根因

存在一个**贯穿四处消费方的中心判定** `canPreviewDirectLocalMaterial(material)`，它决定一条素材是否「可直接本地预览」（= 走上传视频路径）。该判定**刻意把已下载的远程素材（`cached_materials/` 文件、`storageKind='cached_remote'`）排除在外**，于是「已下载完成」的互联网素材被强制走『服务端 480p 转码 + 整文件 blob 下载 + 就绪门控』这条「互联网视频」路径——这正是轨道上「转码中」的来源。换言之：**素材已落地为本地文件，但分类器仍把它当『远程素材』对待**。

### 3.2 中心判定：哪条素材算「可直接本地预览」

`src/components/video/lib/localMaterial.ts:62-83`：

```ts
export function isDirectLocalMaterial(material): boolean {
  const metadata = material.metadata;
  if (metadata?.storageKind === 'cached_remote') return false;   // ← 已下载远程素材被排除
  if (metadata?.storageKind === 'legacy_remote') return false;
  if (metadata?.storageKind === 'local') return true;
  if (metadata?.isLocalFile === true) return true;
  if (isDirectUploadStoragePath(metadata?.localResolvedUrl)) return true;
  if (material.storageKey && hasDirectLocalPlaybackUrl(material)) return true;
  return false;
}
export function canPreviewDirectLocalMaterial(material): boolean {
  if (!material || !isDirectLocalMaterial(material)) return false;
  return hasDirectLocalPlaybackUrl(material);
}
```

而 `hasDirectLocalPlaybackUrl` 只认 `DIRECT_UPLOAD_PREFIXES`（`/api/storage/files/{video,audio,images,image}/`），并在 `isDirectUploadStoragePath` 里**显式把 `cached_materials/` 排除**：

`src/components/video/lib/localMaterial.ts:4-48`：

```ts
const CACHED_MATERIALS_PATH = '/api/storage/files/cached_materials/';
const DIRECT_UPLOAD_PREFIXES = ['/api/storage/files/video/', '/audio/', '/images/', '/image/'];
function isCachedRemoteStoragePath(value) {
  return normalizePath(value).startsWith(CACHED_MATERIALS_PATH);
}
function isDirectUploadStoragePath(value) {
  const path = normalizePath(value);
  if (!path || isCachedRemoteStoragePath(path)) return false;   // ← cached_materials 一律不算直接本地
  return DIRECT_UPLOAD_PREFIXES.some(prefix => path.startsWith(prefix));
}
```

**这一设计被单测固化**（`src/components/video/lib/__tests__/localMaterial.test.ts:40-50`）：

```ts
it('does not treat cached remote storage paths as direct local', () => {
  const cachedRemote = material({
    cacheUrl: '/api/storage/files/cached_materials/pexels/123.mp4',
    metadata: { storageKind: 'cached_remote', source: 'pexels' },
  });
  expect(isDirectLocalMaterial(cachedRemote)).toBe(false);
  expect(canPreviewDirectLocalMaterial(cachedRemote)).toBe(false);
});
```

结论：一条**已经下载到 `cached_materials/` 的 PEXELS/YouTube 视频**，`canPreviewDirectLocalMaterial` 恒为 `false`。

> 旁证（实现细节）：生产代码里**从未把 `storageKind` 写成 `'cached_remote'`**（全仓库该字面量仅出现在测试与读取处；写入处只有 `'local'`，见 `localMaterial.ts:138`、`VideoEditingInterface.tsx:1326`）。PEXELS 素材（`videoSearchService.ts:423-454`）连 `metadata.storageKind` / `metadata.source` 都没写——但这**不影响结论**：因为 `cacheUrl` 落在 `cached_materials/`，`isDirectUploadStoragePath` 这一关就直接判否，分类器照样把它当非本地。

### 3.3 这把「中心开关」被三处关键消费方共用

`canPreviewDirectLocalMaterial` 是「上传视频 vs 互联网视频」分流的**唯一闸门**，被以下三处同时消费：

1. **就绪门控**（`src/components/video/components/VideoPlayerPanel/useCompositionTransport.ts:70-81`）：

   ```ts
   if (canPreviewDirectLocalMaterial(m)) { ready += 1; return; }       // 直接本地 → 立刻就绪
   const status = m.localProxyStatus;
   if (status === 'ready') ready += 1;
   else if (status === 'degraded') degraded += 1;                       // 流式，不阻塞
   else gating += 1;                                                    // idle/transcoding/downloading/error → 阻塞播放
   ```
   既然 cached_remote 不是直接本地，它必须等 `localProxyStatus==='ready'`，否则按 `transcoding`→`gating` 阻塞播放。

2. **本地下载状态机**（`src/components/video/hooks/useLocalMaterialDownload.ts:417-444`）：

   ```ts
   if (canPreviewDirectLocalMaterial(m)) {        // 直接本地 → 清空 localProxy 并跳过，不下载、不转码
     cleanupMaterial(id, true);
     if (_hasLocalProxyFields(m)) patchRef.current(id, _CLEAR_LOCAL_PROXY);
     return;
   }
   ...
   if (m.type === 'video') {
     const pp = m.previewProxyStatus;
     if (pp !== 'cached') {
       if (status !== 'transcoding') patchRef.current(id, { localProxyStatus: 'transcoding' });  // ← 「转码中」从这里写入
       armTranscodeTimeout(id);   // 60s 超时 → degraded
       return;
     }
   }
   const url = _resolveLocalDownloadUrl(m, client);   // 480p 代理 or cacheUrl
   startDownload(id, url);                              // ← 已在磁盘上的整文件被重新抓取成 blob
   ```
   非直接本地的视频会**先卡在 `transcoding` 等服务端 480p**，`cached` 后再把整文件**重新下载**成 blob——尽管该文件早已在本地磁盘且可被 Range 直接读取。

3. **远程预取 / 480p 转码触发**（`src/components/video/hooks/useRemoteMaterialPrefetch.ts:92,110,241`）：
   - `_previewProxyEligible`（:108-139）对非直接本地视频返回 `true`（1080p 既不命中小文件 <8MB 也不命中 ≤480p 豁免）→ **POST 一次 480p 转码**；
   - `shouldPrefetch`（:240-254）对非直接本地视频在 `cacheStatus` 未 ready 时返回 `true` → 触发 `cached_materials` 下载。

### 3.4 「转码中」文案的渲染链

- 轨道遮罩：`src/components/video/timeline/TimelineItemDownloadOverlay.tsx:122-133`——当 `status==='transcoding'` 时渲染 `labels.localTranscoding` + 旋转 spinner 的脉冲遮罩。
- 文案接线：`src/components/video/timeline/TimelineItem.tsx:617` → `localTranscoding: t.timeline.track.localTranscoding`。
- i18n：`src/lib/i18n.ts:5832`（zh `'转码中'`）、`:3366`（en `'Transcoding'`）。

`status` 取自 `localProxyStatusMap.get(materialId).status`，即 `material.localProxyStatus`，而该值唯一被 `useLocalMaterialDownload.ts:442` 写成 `'transcoding'`。三处证据互相闭环。

### 3.5 因果链小结

```
PEXELS 视频(url=远程CDN, 无 storageKind) 添加到面板
  → useRemoteMaterialPrefetch 下载到 cached_materials/，cacheStatus=ready，cacheUrl=同源本地文件   ← 「下载完成」
拖到视频轨
  → canPreviewDirectLocalMaterial(m) == false（cacheUrl 在 cached_materials/，被排除）            ← 根因
  → useRemoteMaterialPrefetch 仍 POST 480p 转码（_previewProxyEligible=true）
  → useLocalMaterialDownload 见 previewProxyStatus!=='cached' → localProxyStatus='transcoding'    ← 「转码中」
  → 门控 computeMediaReadiness 把它计为 gating（阻塞播放）
  → 转码完成后再把整文件重新抓成 blob；若不命中启发式则 60s 超时 degraded
```

---

## 4. 连带问题与症状 B 的现状差距

### 4.1（连带）下载完成前即可拖入轨道
`src/components/video/components/MaterialsPanel/MaterialsPanel.tsx:2090,2094`：卡片 `draggable` 与禁用样式只判 `downloadStatus`/`uploadStatus`，**不判 `cacheStatus`**：

```tsx
draggable={material.downloadStatus !== 'downloading' && material.downloadStatus !== 'generating'
  && material.uploadStatus !== 'uploading' && material.uploadStatus !== 'waiting'}
```

PEXELS 素材的 `downloadStatus` 始终为 `undefined`（`videoSearchService.ts` 不写），故**整个 cached_materials 下载期间卡片都可拖动**，与「下载完成后才允许添加」相悖。

### 4.2 症状 B-1：进度条位置/来源
`MaterialsPanel.tsx:2137-2150`：下载进度条只在 `downloadStatus==='downloading'` 时、**叠在缩略图上**渲染（16px 小条），且只覆盖 YouTube/AI 生成路径。**PEXELS 的 `cacheStatus` 下载没有任何进度条**，更没有「标题栏正下方紧贴」的样式。此外进度本身是**粗粒度桶**而非真实字节进度：`useRemoteMaterialPrefetch.ts:274-287` 的 `progressFor` 仅 `pending→10 / downloading→60 / ready→100`（后端不上报字节级进度）。

### 4.3 症状 B-2：重连/续传
- 后端 `backend-services/basic-service/app/services/material_download_service.py:636-667` `_download_to_path` 用 `ffmpeg -i url -c copy` 下载，`max_retries=3` + 指数退避（`time.sleep(min(2**attempt,8))`）——**有重试**，但每次重试都先 `os.remove(target_path)` 从头来过（:645-649），**不是断点续传**，大文件中断后整段重下。
- 前端把 `cacheStatus==='failed'` 视为**终态、不自动重试**（`useRemoteMaterialPrefetch.ts:249-253` 明确注释「do NOT auto-retry」），用户须移除重加才会再下。即「下载中途出错→自动重连」在前端是缺失的。

### 4.4 症状 B-3：API 凭证轮换
- `material_download_service.py` 的下载链路对 URL 直连（PEXELS 视频 CDN 不需凭证），**全程无任何 API key 轮换**；CDN URL 轮换只是「保存最新 URL」（:202-204），不是凭证轮换。
- 对需要凭证的源（如 ByteDance ARK 生成视频回写、TTS 等），当前下载/拉取链路同样**无 401/403/429 触发的 key 轮换**。`config.py` 中 `PEXELS_API_KEY` 为单值，而 `UNSPLASH_ACCESS_KEYS`/`TAVILY_API_KEYS` 为复数（搜索侧已有「多 key」雏形），但**下载侧未接入轮换**。这是一处需要新增的机制，而非已有逻辑的 bug。

---

## 5. 影响面（Impact surface）

| 受影响对象 | 说明 |
|---|---|
| 所有「互联网视频→已下载」的素材 | PEXELS 官方库、YouTube 下载、ARK 生成视频等任何落地到 `cached_materials/` 的视频，拖到轨道都会经历「转码中」+ 二次 blob 下载，而非直接本地播放 |
| 预览体验/性能 | 已在磁盘的整文件被**重复**抓取进内存 blob；不命中 480p 启发式者要白等 60s 才降级；门控期间无法播放 |
| 上传视频 | **不受影响**（`storageKind='local'` / `/video/` 路径 → `canPreviewDirectLocalMaterial=true`，本就是目标路径），可作为「正确对照组」验证修复 |
| 图片/字幕素材 | 不受影响（消费端按 `material.type` 二次过滤，不进下载/门控） |
| 删除级联 | `materialDeleteHelpers.ts:9-15` 依据 `storageKind` 与 `storageKey` 判断是否删源文件——修复**不得**给 cached_remote 素材赋可删除的 `storageKey`，否则会误删共享缓存源（**修复约束，见 §6 风险**） |

特性开关：`isLocalPreviewEnabled()` 关闭时，门控恒 `allReady` 且下载 hook 直接 return，本缺陷不出现（纯流式）——确认本环境为默认 ON。

---

## 6. 候选修复方案（Candidate fixes）

### 症状 A（主修复）

| 方案 | 做法 | 侵入性 | 风险 | 工作量 |
|---|---|---|---|---|
| **A1（推荐）扩展中心判定** | 让「已完成下载的 cached_remote 素材」被判为**可直接本地预览**：新增/扩展谓词（如 `canPreviewDirectLocalMaterial` 增加分支，或加 `canPreviewLocalCachedMaterial`），当素材有**就绪的同源 `cached_materials/` 文件**（`cacheUrl` 命中 `cached_materials/` 且 `cacheStatus==='ready'`）时返回 `true`。三处消费方（门控/下载/预取）**零改动**即自动复用上传视频路径：门控直接计 ready、下载 hook 清空 localProxy 跳过、预取不再发起 480p 转码 | **低**（改 1 个 lib 文件 + 同步更新单测） | 中：① 必须**仅在下载完成后**翻转（`cacheStatus==='ready'`），下载中仍须保持非本地以展示进度；② **不得**触碰删除语义（不赋 `storageKey`，`sourcePathForDelete` 行为不变）；③ 需更新 `localMaterial.test.ts:40-50` 这条「固化旧设计」的断言为「ready 后算本地」 | 小 |
| **A2 仅改下载状态机** | 在 `useLocalMaterialDownload` 内，对 cacheUrl 已就绪的 cached_remote 视频跳过 480p 等待，直接以 `cacheUrl` 标记 `ready`（不抓 blob） | 中 | 高：门控仍读 `canPreviewDirectLocalMaterial`/`localProxyStatus`，且 `useRemoteMaterialPrefetch` **仍会 POST 480p 转码**；要同时改三处才完整，反而比 A1 散 | 中 |
| **A3 仅停转码触发** | 让 `_previewProxyEligible` 在 `cacheStatus==='ready'` 时返回 `false` | 低 | 高：去掉了转码，但 blob 下载与门控仍在，「转码中」可能变「下载中」，**未达成『等同上传视频』** | 小 |

**为何推荐 A1**：`canPreviewDirectLocalMaterial` 是「上传 vs 互联网」分流的**唯一闸门**，已被门控（`useCompositionTransport.ts:70`）、下载（`useLocalMaterialDownload.ts:417`）、预取（`useRemoteMaterialPrefetch.ts:92/110/241`）三处一致消费。只翻转这一个谓词，就能让「已下载素材」**整条链**自动走上传视频路径——无「转码中」、不二次下载、门控即时就绪、播放直接用 `cacheUrl`（`selectPlaybackUrl` 的 P3 已支持同源 cache 直读，后端已对 storage 媒体支持 206 Range）。这与第 2~4 轮既有架构（单一中心谓词）完全契合，改动面最小且语义最干净。

**配套（同属症状 A 的「下载完成才允许添加」）**：在 `MaterialsPanel.tsx:2090/2094` 的 `draggable`/禁用判断中**纳入 `cacheStatus`**——`cacheStatus==='pending'|'downloading'` 时禁止拖入，与 `downloadStatus==='downloading'` 同级对待。

### 症状 B（增强）

| 子项 | 候选做法 | 侵入性 | 备注 |
|---|---|---|---|
| B-1 紧贴标题的进度条 | 在卡片标题行**正下方**新增一条细进度条组件，数据源统一为 `downloadStatus/cacheStatus` + `downloadProgress`；把 PEXELS 的 `cacheStatus` 下载也纳入展示 | 低~中 | 需要后端/前端补**真实字节进度**才能告别 `progressFor` 粗粒度桶（`useRemoteMaterialPrefetch.ts:274-287`） |
| B-2 重连/续传 | 前端：放开 `cacheStatus==='failed'` 的「不自动重试」（`useRemoteMaterialPrefetch.ts:249-253`），改为有限次自动退避重连；后端：把 `_download_to_path`（ffmpeg 整段重下）换成可续传的 HTTP 下载（`httpx` + `Range`，保留断点字节），或在 ffmpeg 失败后保留分片续抓 | 中 | 当前后端仅「失败重试 3 次（从头）」，无真正续传 |
| B-3 凭证轮换 | 为需要凭证的源建立 key 池，在 401/403/429 时轮换并重试；复用搜索侧 `*_KEYS` 复数约定，扩展到下载/回写链路 | 中 | PEXELS 视频 CDN 直连无需 key；本项主要面向 ARK 等需鉴权的源 |

> 症状 B 属于「新增能力/差距补齐」，建议在 Subtask #2 落地时与症状 A 主修复**分阶段**实现，避免一次性扩大破坏面。下游评审（Subtask #1）请重点确认 A1 的「翻转时机仅限下载完成」与「不影响删除语义」两条约束。

---

## 7. 推荐方案（Recommended fix）

**采纳 A1（扩展中心判定 `canPreviewDirectLocalMaterial`）+ 配套放开 `MaterialsPanel` 的 `cacheStatus` 拖拽门禁**，作为症状 A 的最小、最干净修复：

1. **核心改动**：在 `src/components/video/lib/localMaterial.ts` 增加「**已完成下载的同源缓存文件 = 可直接本地预览**」分支：当素材的 `cacheUrl`（规范化后）命中 `/api/storage/files/cached_materials/` **且** `cacheStatus==='ready'` 时，`canPreviewDirectLocalMaterial` 返回 `true`。下载完成前（`pending`/`downloading`/`failed`）保持 `false`，以维持进度展示与门控。
2. **零改三处消费方**：门控、下载状态机、预取的判定语句不动，自动复用上传视频路径 → 「转码中」消失、不再二次抓 blob、门控即时 ready、播放走 `cacheUrl` 本地直读。
3. **配套门禁**：`MaterialsPanel.tsx` 的 `draggable`/禁用条件纳入 `cacheStatus`，实现「下载完成后才允许拖入轨道」。
4. **必须遵守的约束（交 Subtask #1 复核）**：
   - 翻转**仅在 `cacheStatus==='ready'`** 时发生（否则下载中会丢进度、过早开门控）。
   - **不得**给 cached_remote 素材写入可删除的 `storageKey`，保持 `sourcePathForDelete`（`materialDeleteHelpers.ts:9-15`）对共享缓存源「不删除」的语义。
   - 同步更新 `src/components/video/lib/__tests__/localMaterial.test.ts:40-50`：新增「`cacheStatus==='ready'` 的 cached_materials 素材 → `canPreviewDirectLocalMaterial===true`」「下载中仍为 false」两条用例，固化新契约。
   - 回归保证：`useLocalMaterialDownload.test.ts`、`useRemoteMaterialPrefetch.*.test.ts`、`computeMediaReadiness.test.ts` 全绿；上传视频路径（对照组）行为不变。

**理由**：该缺陷的本质是「素材已落地为本地文件，但分类器仍按远程素材对待」。`canPreviewDirectLocalMaterial` 是控制这一分类的唯一中心开关，三处下游已一致消费它；只在「下载完成」这一确定时点翻转它，即可用**一处改动**让已下载素材**整条链**等同于上传视频——精确命中用户诉求「下载完成后按上传视频逻辑处理，不再走互联网视频/流式预览」，且不破坏删除、导出与特性开关语义。

---

## 8. 关键证据索引（便于 Subtask #1 复核）

- 中心判定排除 cached_remote：`src/components/video/lib/localMaterial.ts:40-48`、`62-83`
- 旧设计单测固化：`src/components/video/lib/__tests__/localMaterial.test.ts:40-50`
- 「转码中」状态写入：`src/components/video/hooks/useLocalMaterialDownload.ts:417-444`（:441-442 写 `transcoding`）
- 「转码中」遮罩渲染：`src/components/video/timeline/TimelineItemDownloadOverlay.tsx:122-133`；接线 `TimelineItem.tsx:617`；文案 `src/lib/i18n.ts:5832 / 3366`
- 门控以中心判定计就绪：`src/components/video/components/VideoPlayerPanel/useCompositionTransport.ts:70-81`
- 预取/转码触发以中心判定为闸门：`src/components/video/hooks/useRemoteMaterialPrefetch.ts:92,108-139,240-254`
- PEXELS 素材不写 downloadStatus/storageKind：`src/components/video/services/videoSearchService.ts:423-454`
- 卡片拖拽/进度只看 downloadStatus：`src/components/video/components/MaterialsPanel/MaterialsPanel.tsx:2090,2094,2137-2150`
- 后端下载重试无续传、无凭证轮换：`backend-services/basic-service/app/services/material_download_service.py:202-204,636-667`
- 前端失败终态不自动重试：`src/components/video/hooks/useRemoteMaterialPrefetch.ts:249-253`
- 删除级联依赖 storageKind/storageKey：`src/components/video/hooks/materialManagement/materialDeleteHelpers.ts:9-15`

---

## 9. 评审补充证据与更正（Subtask #1 评审，逐条复核源码后写入）

> 本节由「分析报告评审」节点补全，目的是把 §3~§8 的证据链补到**滴水不漏**。复核方式：对 §8 索引的每条 `file:line` 实读源码，并对「中心判定」做了**全仓库消费方盘点**（`grep canPreviewDirectLocalMaterial|isDirectLocalMaterial`）。结论：**根因判定与推荐方案 A1 成立**；但原文对「消费方数量」存在低估，需补全后修复才安全。下列更正/补强均已并入证据链。

### 9.1【证据补强·关键】中心判定的真实消费方是 **8 处**（原文 §3.1 写「四处」、§3.3 列「三处」，均低估）

`canPreviewDirectLocalMaterial` 的生产消费点（`grep` 实测，排除测试/文档）共 **8** 处。原文只审了其中 3 处（门控/下载/预取）。**只翻转这一个谓词必须对全部 8 处都安全**，否则「零下游改动」的论断不成立。逐处复核如下（✅=翻转后安全且符合预期；★=本处正是修复「生效」的关键路径，原文遗漏）：

| # | 消费点 | 现状（翻转前） | 翻转为 `true`（仅 `cacheStatus==='ready'`）后的行为 | 判定 |
|---|---|---|---|---|
| 1 | `useCompositionTransport.ts:70`（`computeMediaReadiness` 就绪门） | cached_remote→`false`→按 `localProxyStatus` 计 `gating`，阻塞播放 | `ready+=1`，门即开 | ✅ 符合预期（原文 §3.3-1 已列） |
| 2 | `useLocalMaterialDownload.ts:417` 下载状态机 | `false`→走 `previewProxyStatus!=='cached'`→写 `localProxyStatus:'transcoding'`（:441-442） | `cleanupMaterial`+清空 localProxy 字段后 `return`，**不写 transcoding、不抓 blob** | ✅ 符合预期（原文 §3.3-2 已列） |
| 3 | `useRemoteMaterialPrefetch.ts:92 / 110 / 241` 预取与 480p 触发 | `false`→`_previewProxyEligible`=true→POST 480p 转码 | 三处均 `return false`→**不再 POST 转码**；`shouldPrefetch` 在 `cacheStatus==='ready'` 本就已 `return false`（:245） | ✅ 符合预期（原文 §3.3-3 已列） |
| 4 ★ | `resolveSequencePlaybackUrl.ts:102`（合成器**实际取播放 URL** 的权威） | `directLocal=false`→可走 blob(-1) / 480p proxy(0) 候选层 | `directLocal=true`→**跳过** blob 与 proxy 候选（:111-112、:130），落到 `localStorageReference`（含 `cacheUrl`，候选#1，:147-154）→**直接播本地缓存文件** | ✅ **原文遗漏**；此处证明「翻转后播放走 `cacheUrl` 本地直读」并非臆测，是代码必然。配合后端 storage 媒体 206 Range（提交 `8db055f`），可正常 seek |
| 5 ★ | `useCompositionPlayback.ts:206`（`isCompositionReady` —— **第二道就绪门**） | `false`→需 `resolveSequencePlaybackUrl` 解析出 URL 才 ready | `true`→`continue`（即时 ready） | ✅ **原文遗漏**；存在**两道**就绪门（#1 与 #5），翻转后二者一致放行，不会一门开一门关 |
| 6 ★ | `TimelinePanel.tsx:103`（构建 `localProxyStatusMap`） | `false`→把 `localProxyStatus` 写入 map（status=`transcoding`） | `true`→`return` 跳过→**map 无此条目**→`TimelineItemDownloadOverlay`（:122-133）拿不到 `transcoding`→**「转码中」遮罩不渲染** | ✅ **原文遗漏**；§3.4 只指到遮罩渲染处，未指出 map 的**数据源**就在此——这是「转码中」消失的**直接渲染路径**，是修复生效的关键一环 |
| 7 | `MaterialsPanel.tsx:2289`（`MaterialCacheBadge` 渲染门） | `false`→远程视频卡片显示缓存徽章 | `ready` 后 `true`→徽章隐藏；**下载中（非 ready）仍 `false`→进度环照常显示** | ✅ **原文遗漏**；不影响下载进行中的进度展示，仅在「下载完成」隐藏角标，符合预期 |
| 8 | `projectHydration.ts:228`（`HydratedItem.isDirectLocal`） | 产出布尔字段 | ready-cached→`true` | ✅ **原文遗漏**；该字段**仅被测试消费**（`projectHydration.test.ts:121/164`，生产端 grep 无读取），且两条测试夹具均非 ready-cached（:121=本地上传→true、:164=素材缺失→false）→**无生产回归、无测试回归** |

**评审结论（本小节）**：原文「三处消费方、零下游改动」的**方向正确**，但**枚举不全**。补全后 8 处全部安全，且第 4/5/6 处恰是让修复「端到端生效」的机制（解析到 `cacheUrl`、第二道门放行、移除遮罩）。故「单点翻转谓词即整链复用上传路径」的论断**经全量盘点后成立且更强**。Subtask #2 落地前应以本表为回归清单。

### 9.2【实现精度·必读】修复**必须**加在 `canPreviewDirectLocalMaterial`，且不能只改 `isDirectLocalMaterial`

复核 `localMaterial.ts:50-83` 后发现一处**会导致「按原文一行改 `isDirectLocalMaterial`」修不好 bug** 的结构陷阱：

- `canPreviewDirectLocalMaterial`（:78-83）= `isDirectLocalMaterial(material)` **且** `hasDirectLocalPlaybackUrl(material)` 两道与门；
- `hasDirectLocalPlaybackUrl`（:50-60）对 `[localResolvedUrl, url, serverUrl, cacheUrl]` 逐一调用 `isDirectUploadStoragePath`，而后者（:44-48）**显式把 `cached_materials/` 判否**。

因此对一条 ready 的 cached_remote 素材：即便把 `isDirectLocalMaterial` 改成 `true`，第二道 `hasDirectLocalPlaybackUrl` 仍因 `cacheUrl∈cached_materials/`、`url/serverUrl=远程 CDN` 而返回 `false`，谓词**整体仍为 false，bug 照旧**。

**正确的最小插桩点**：在 `canPreviewDirectLocalMaterial` 顶部新增一个**独立早返回分支**，绕过上述两道与门：

```ts
// localMaterial.ts —— 新增：已完成下载的同源缓存文件 = 可直接本地预览
function isReadyCachedLocalMaterial(material: MaterialItem): boolean {
  return material.cacheStatus === 'ready'
    && isCachedRemoteStoragePath(material.cacheUrl);   // 复用现有 :40-42 的同源 cached_materials 判定
}

export function canPreviewDirectLocalMaterial(material): boolean {
  if (!material) return false;
  if (isReadyCachedLocalMaterial(material)) return true;   // ← 新分支，置于两道与门之前
  if (!isDirectLocalMaterial(material)) return false;
  return hasDirectLocalPlaybackUrl(material);
}
```

字段可用性已核实：`MaterialItem.cacheStatus` / `cacheUrl` 均存在（`src/types/index.ts:541-542`）。`isCachedRemoteStoragePath` 已存在（:40-42），无需新增工具。**不要**触碰 `isDirectLocalMaterial`、`hasDirectLocalPlaybackUrl`、`isDirectUploadStoragePath`（动它们会波及上传/导出语义）。

### 9.3【更正·测试约束】原文「需更新 `localMaterial.test.ts:40-50` 旧断言」表述不准——该用例应**保留**并**新增**用例

复核 `localMaterial.test.ts:40-50` 的夹具：它带 `metadata.storageKind:'cached_remote'` 但**不带 `cacheStatus`**。按 §9.2 的修复（分支条件 `cacheStatus==='ready'`），该夹具 `cacheStatus===undefined`→新分支不触发→`canPreviewDirectLocalMaterial` **仍为 `false`**，**两条断言（:48/:49）继续成立、无需改动**。

故原文 §6/§7 把它称作「固化旧设计、需改为 ready 后算本地」的断言**不准确**：它固化的其实是**仍然正确**的不变量「**缓存未就绪 → 不算直接本地**」（正是 §9.1#2 防止「下载中过早开门」所依赖的契约）。**正确做法 = 保留该用例 + 新增两条用例**：

1. `cacheStatus:'ready'` + `cacheUrl∈cached_materials/` → `canPreviewDirectLocalMaterial===true`（修复目标）；
2. `cacheStatus:'downloading'`（或 `pending`/`failed`） + 同一 `cacheUrl` → 仍为 `false`（守住「仅下载完成才翻转」）。

### 9.4【更正·症状 B-1 现状】原文「PEXELS 下载无任何进度条」与事实有出入

复核 `MaterialsPanel.tsx:2289-2296` + `MaterialCacheBadge.tsx`：PEXELS 的 `cacheStatus` 下载**并非「没有任何进度条」**，而是渲染了一个 **22px 环形进度+重试角标**（`MaterialCacheBadge`，位于缩略图**左下角** `absolute bottom-1 left-1`）：`pending`=旋转虚线环、`downloading`=按 `downloadProgress` 填充的实心环、`ready`=绿勾（2s 淡出）、`failed`=红叹号+点击重试。因此症状 B-1 的**真实差距**应更正为：

1. 现有指示是**缩略图角标环形**，而用户要的是**标题栏正下方紧贴的线性进度条**（位置/形态差异，非「从无到有」）；
2. 进度仍是 `progressFor` 粗粒度桶（`useRemoteMaterialPrefetch.ts:274-287`，`downloading` 恒 60%），**非真实字节进度**（此条原文 §4.2 正确）；
3. `failed` **已有手动点击重试入口**（`onRetryDownload`→`videoSearch.retryVideoDownload`，`VideoEditingInterface.tsx:2664`、`MaterialsPanel.tsx:2227/2293`），但 prefetch effect 仍 `cacheStatus==='failed' → return false`（不**自动**重连，§4.3 准确）。故 B-2 的真实差距是「**自动**重连 + **断点续传**」，而非「完全没有重试」。

> 以上更正不改变症状 A 的根因与修复结论，仅令症状 B 的差距描述与现状一致，避免 Subtask #2 在已存在 `MaterialCacheBadge`/`onRetryDownload` 的情况下重复造轮子。

---

## 评审结论（Review Verdict）

**最终推荐修复（单一方案）：采纳 A1 ——「在中心判定 `canPreviewDirectLocalMaterial` 顶部新增『已就绪的同源缓存文件即可直接本地预览』早返回分支」，并配套在 `MaterialsPanel` 拖拽门禁纳入 `cacheStatus`。** 这是同时解决「轨道显示转码中」与「下载完成才允许添加」的**最小、最干净**改动。

**为何是它（理由）**

1. **根因经全量复核成立**：缺陷本质是「素材已落地为 `cached_materials/` 本地文件，但分类器仍按远程素材对待」。`canPreviewDirectLocalMaterial` 是「上传 vs 互联网」分流的唯一中心闸门，本次复核确认它被 **8 处**生产代码一致消费（§9.1），其中下载状态机（`useLocalMaterialDownload.ts:441-442`）是 `localProxyStatus:'transcoding'` 的**唯一写入者**（`grep` 实证），渲染链 `TimelinePanel.ts:103 → localProxyStatusMap → TimelineItemDownloadOverlay.tsx:122-133` 闭环。证据链滴水不漏。
2. **改动面最小、回归面可控**：仅改 1 个 lib 文件（`localMaterial.ts`，按 §9.2 加 1 个分支 + 1 个私有谓词）+ `MaterialsPanel.tsx` 拖拽门禁 + 同步单测。8 处消费方**零代码改动**即整链复用上传视频路径；其中第 4/5/6 处（播放 URL 解析、第二道就绪门、遮罩 map）恰好是让修复端到端生效的机制。
3. **不破坏既有语义**：删除级联 `sourcePathForDelete`（`materialDeleteHelpers.ts:9-15`）键于 `metadata.storageKind`，**与本谓词正交**——只要修复**不写 `storageKind`、不赋 `storageKey`**（§9.2 已约束），共享缓存源「不删除」语义保持不变；上传视频（对照组）与导出路径行为不变；`isLocalPreviewEnabled()` 关闭分支不受影响。
4. **A2/A3 被否**：A2（只改下载状态机）/A3（只停转码触发）都需多点修改且留有 blob 下载或门控未闭合的尾巴，破坏面**反而更大**（原文 §6 对比成立，本评审复核认可）。

**必须遵守的实现约束（交 Subtask #2 执行，Subtask #3 验收）**

- **A. 插桩点**：分支加在 `canPreviewDirectLocalMaterial`（**非** `isDirectLocalMaterial`），条件 `cacheStatus==='ready' && isCachedRemoteStoragePath(cacheUrl)`；下载中（`pending`/`downloading`）与失败（`failed`）保持 `false`（守住进度展示与门控）。理由见 §9.2 的「两道与门」结构陷阱。
- **B. 拖拽门禁**：`MaterialsPanel.tsx:2090/2094` 的 `draggable`/禁用样式纳入 `cacheStatus`，用 **block-list**（`cacheStatus==='pending' || cacheStatus==='downloading'` 才禁拖），**禁止**写成 `cacheStatus!=='ready'`——否则会误禁无 `cacheStatus` 的**上传视频/音频/图片**（它们 `cacheStatus===undefined`）。`failed` 是否禁拖留给产品决策；建议保持可拖（回退流式）或引导重试，但**至少不得回归上传素材的可拖性**。
- **C. 测试**：保留 `localMaterial.test.ts:40-50`（它守的是「未就绪→非本地」的正确不变量），**新增** ready→true / downloading→false 两条用例（§9.3）。回归绿灯清单：`useLocalMaterialDownload.test.ts`、`useRemoteMaterialPrefetch.*.test.ts`、`projectHydration.test.ts`、`computeMediaReadiness`/`useCompositionTransport` 相关用例，以及 §9.1 八处消费方的现有断言（尤其 `TimelineItem.localDownload.test.ts`、`MaterialCacheBadge.test.tsx`）。
- **D. 边界**：拖拽与 `cacheStatus` 翻转存在竞态（ready 前抢拖）——加了约束 B 的拖拽门禁后用户无法在 ready 前拖入，竞态被关闭；即便偶发，`useLocalMaterialDownload.ts:417` 会在 ready 后 `cleanup` 自愈，不会卡死。ARK 生成视频（`source='ark'` 回写 `cached_materials/`，`cacheStatus='ready'`）同样被本分支覆盖→一并获得本地直读，属预期增益（见 §5 影响表）。

**范围边界**：本结论只敲定**症状 A**（轨道「转码中」+「下载完成才允许添加」）的修复，这是 Subtask #2 的必做项。**症状 B（紧贴标题的线性进度条 / 自动重连续传 / 凭证轮换）**按原文建议**分阶段**实施，且应复用已存在的 `MaterialCacheBadge`/`onRetryDownload` 而非另起炉灶（§9.4）；本评审不将其列入症状 A 的最小修复，以免扩大破坏面。

**Definition of Done 核对**：✅ 证据链已补到 8 处消费方全覆盖、单写入者闭环、删除语义正交，airtight；✅ 本节给出**单一**推荐修复（A1 + 拖拽门禁）及其理由、最小性论证、回归与边界约束。可进入 Subtask #2。
