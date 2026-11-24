# 桌面端从 YouTube 添加素材「下载失败」根因诊断

> 诊断日期：2026-11-24（会话节点 #0，只做定位与取证）
> 范围声明：**本节点不改产品代码、不执行 `git commit`**。修复方案见第 5/6 节，
> 实施留给修复节点。复现产物在同目录 `repro/`，实测证据在 `evidence/`。
>
> 阅读范围：`CLAUDE.md`（架构 / 素材库与 Agent 工具层 / 命令）、`README.md`
> （"YouTube download/upload uses `yt-dlp` and needs no API key"、项目结构）、
> `.claude-index/index.md`（YouTube 相关模块、`cached_materials` 与导出链路），
> 以及 `.agentmesh/*/logs` 下的桌面端实测日志与 `ecliptrix.db`（只读）。

---

## 1. 问题描述（Problem description）

用户在桌面端「搜索在线视频」里搜到 YouTube 视频，勾选后点击添加，期望视频进入右侧
**素材库**并可以直接拖到时间线。实际结果是：视频本体确实被下载并保存进本地存储，但素材卡上
出现红色失败状态（「缓存失败 / 下载失败」），卡片没有封面缩略图，点「重试」也不会好。
用户据此判断为「桌面端下载失败」。

结论先说：**这不是下载失败。** YouTube 下载链路（`yt-dlp` → `ffmpeg` 归一化 → 存储）
在同一次操作里 100% 成功；失败的是随后**另一条并行的通用素材缓存管线**——它把
「YouTube 观看页 URL」当成可直接抓取的远程媒体地址，用 `ffmpeg -i <url>` 去下载，
`ffmpeg` 没有 YouTube 抽取器，必然失败，并把 `cached_materials` 那一行**永久**写成
`status='failed'`，前端随即把 `cacheStatus='failed'` 刷到素材上。

三条可核对的现象：

| 现象 | 实测 | 证据位置 |
| --- | --- | --- |
| 下载本身成功 | 10.14 s 拿到 `media.mp4`（2 552 552 B，1280×720，25.008 s），上传存储返回 `success: True` | `evidence/desktop-app-log-2026-11-24-excerpt.txt` 02:48:57 |
| 同时另一条管线失败 | `Cached material download failed: source=url id=73b0fcdb err=cale 9. 5.101 …` | 同上 02:48:57 |
| 素材最终状态自相矛盾 | `downloadStatus: "completed"` + `cacheStatus: "failed"` + 原始 ffmpeg stderr | `evidence/project-material-youtube.json` 第 42–47 行 |

---

## 2. 复现步骤（Reproduction steps）

### 2.1 手工复现（桌面端，用户视角）

前置：桌面端能联网访问 YouTube（本机靠系统代理/TUN 出口），后端端口 18321。

1. 从仓库根目录 `M:\takoAI\Ecliptrix` 启动桌面端：`npm --prefix desktop run dev`
   （或直接运行打包产物）。等首屏进入视频编辑工作区。
2. 打开素材库面板 → 「搜索在线视频」（`videoSearchModal`）→ 切到 **「Youtube视频库」**
   标签页。
3. 搜索任意关键词（实测：`data center servers computer code on screen artificial intelligence`），
   进入结果列表，勾选任一视频（实测：`https://www.youtube.com/watch?v=Rsh8TmczwrM`）。
4. 点 **「确认添加」**。**≤ 1 秒内**素材卡出现在右侧素材库，进入「下载中」。
5. 观察 10 秒左右：视频会下载完成（`downloadProgress` → 100），
   **同时/随后**素材卡出现红色「缓存失败」标记，tooltip 里是一段 ffmpeg stderr，
   封面缩略图为空。此时点击红色标记（`MaterialCard` 的 `onRetry`）只会重新触发一次
   完整下载，红色标记**不会**消失。
6. 看日志与数据库核对：

   ```powershell
   # 1) 后端日志：下载成功 + 缓存管线失败
   Get-Content "$env:APPDATA\ecliptrix-desktop\logs\app.log" -Tail 400 |
     Select-String -Pattern 'youtube/download-and-upload|Cached material download failed|Error opening input file'

   # 2) 数据库：观看页 URL 的 cached_materials 行被写成 failed（只读脚本）
   python -X utf8 docs/diagnoses/youtube-desktop-add-material-download-failed/repro/inspect-cached-materials.py
   ```

   预期输出（本机实测 3 条，节选第一条）：

   ```text
   source=url source_id=73b0fcdb status=failed file_size=None
   url=https://www.youtube.com/watch?v=Rsh8TmczwrM
   error_message=cale      9.  5.101 /  9.  5.101 /  libswresample   6.  3.101 / … [in#0 @ …
   ```

### 2.2 最小复现（不启动桌面端）

**A. 后端那一半（一条命令，只需要 ffmpeg）**

```powershell
powershell -ExecutionPolicy Bypass -File `
  docs/diagnoses/youtube-desktop-add-material-download-failed/repro/ffmpeg-watch-url-repro.ps1
```

脚本跑的就是 `MaterialDownloadService._download_to_path()` 里那条命令
（`ffmpeg -y -i <url> -c copy <target>`），并打印 stderr 的**最后 300 字符**——即
`_do_download()` 写进 `cached_materials.error_message` 的那一段。实测输出见
`repro/ffmpeg-output.txt`：

```text
== ffmpeg exit code: -1094995529  (non-zero => _download_to_path records a failure)
== output file created: False
    9.  0.100 /  9.  0.100
  libswresample   6.  0.100 /  6.  0.100
[in#0 @ 0000020c7fb28700] Error opening input: Invalid data found when processing input
Error opening input file https://www.youtube.com/watch?v=Rsh8TmczwrM.
```

**B. 前端那一半（特征化测试，无需网络）**

```powershell
npx vitest run --config docs/diagnoses/youtube-desktop-add-material-download-failed/repro/vitest.repro.config.ts
```

4 条断言全部通过（`repro/vitest-repro-output.txt`），锁定以下缺陷行为：

1. `youtubeVideoSearchService.convertToMaterials()` 产出的素材 `url` 是**观看页**，
   `serverUrl` 为空；
2. 其 composite key 退化成 `('url', hashUrl(watchUrl))`，hash 值 `73b0fcdb`
   与线上失败行 `source_id` **逐字节一致**；
3. `useRemoteMaterialPrefetch()` 立刻用这条 key 发起 `ingest` + `pollUntilReady`，
   并把 `failed` 回写成 `cacheStatus='failed'`；
4. 下载完成后 `url` 换成同源 `storage` 路径时管线不再接管——**证明失败只可能发生在
   下载之前的那段窗口**，不是下载本身。

---

## 3. 根因分析（Root cause analysis）

### 3.1 一次操作里有两条互不知情的「下载」管线

```text
点击「确认添加」
        │
        ├──(1) 素材入列：onAddMaterials(materials)
        │        material.url = https://www.youtube.com/watch?v=…   ← 观看页！
        │        material.downloadStatus = 'downloading'
        │        （src/components/video/hooks/useVideoSearch.ts:494-499, 510）
        │
        ├──(2) A 管线（正确的）：POST /api/youtube/download-and-upload
        │        yt-dlp 下载 → ffmpeg 归一化 → 上传 storage → success:true
        │        → 用 storage URL 回填素材（useVideoSearch.ts:560-599）
        │
        └──(3) B 管线（被误触发）：useRemoteMaterialPrefetch 看到 url 是「远程地址」
                 → POST /api/material/ingest {source:'url', source_id:'73b0fcdb', url:观看页}
                 → 后端 MaterialDownloadService 用 ffmpeg 直接抓这个 URL → 必然失败
                 → cached_materials.status='failed'（永久）
                 → poll 返回 failed → 素材 cacheStatus='failed'
```

B 管线本来是给 **Pexels / Freesound / ARK 这类直链 CDN** 用的（缓存到本地换取流畅预览与
可导出），它的判定条件只有「http(s) 且不同源」，没有任何「这个 URL 需要专用抽取器」的概念。

### 3.2 触发器：`shouldPrefetch` 只问「是不是远程 URL」

```ts
// src/components/video/hooks/useRemoteMaterialPrefetch.ts:250-269
function shouldPrefetch(material: MaterialItem, isRemote: (u: string) => boolean): boolean {
  if (canPreviewDirectLocalMaterial(material)) return false;
  if (isPexelsVideo(material) && material.metadata?.downloadMode !== 'manual') return false;
  if (material.type !== 'video' && material.type !== 'audio') return false;
  if (!material.url) return false;
  if (material.cacheStatus === 'ready' && material.cacheUrl) return false;
  if (material.cacheStatus === 'downloading' || material.cacheStatus === 'pending') return false;
  if (material.cacheStatus === 'failed') return false;      // 终态，不再自动重试
  return isRemote(material.url);                            // ← 唯一来源判定
}
```

`defaultIsRemoteUrl`（同文件 `:225-238`）对 `https://www.youtube.com/watch?v=…` 返回
`true`。素材来自 `convertToMaterials`，`metadata.source` 是 `'youtube'`：

```ts
// src/components/video/services/youtubeVideoSearchService.ts:323-346
const material = {
  id: `youtube-${video.id}`,
  type: 'video' as MaterialType,
  url: video.videoUrl,                    // https://www.youtube.com/watch?v=…
  metadata: { source: 'youtube', youtubeId: video.id, originalUrl: video.videoUrl, … },
};
```

于是 hook 在 `:399-404` 直接 `pollUntilReady(key)` → `RemoteMaterialPrefetchAdapter.runPoll`
（`RemoteMaterialPrefetchAdapter.ts:246-273`）→ `ingest` → 后端排队下载。

### 3.3 后端：ingest 对任意 URL 都用 ffmpeg 抓

```python
# backend-services/basic-service/app/routers/material_router.py:98-110
@router.post("/ingest", response_model=MaterialIngestResponse)
async def ingest_materials(request: MaterialIngestRequest) -> MaterialIngestResponse:
    svc = get_material_download_service()
    for item in request.items:
        res = await svc.enqueue(item.source, item.source_id, item.url)   # 不校验 URL 类型
```

```python
# backend-services/basic-service/app/services/material_download_service.py:855-886
def _download_to_path(self, url: str, target_path: str) -> Tuple[bool, Optional[str]]:
    ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
    for attempt in range(max_retries):
        ...
        cmd = [ffmpeg, "-y", "-i", url, "-c", "copy", target_path]      # :869
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if proc.returncode != 0:
            last_err = (proc.stderr or "ffmpeg returned nonzero")[-300:]  # :874
        ...
    return False, last_err
```

`_do_download`（`:790-826`）随后把结果写库：

```python
row.status = "failed"                                  # :821
row.error_message = (err or "unknown error")[:500]      # :822  ← 就是那段 stderr 截断
logger.warning(f"Cached material download failed: source={source} id={source_id} err={row.error_message}")
```

**证据（线上实跑，2026-11-24 02:48:57）**

```text
2026-11-24 02:48:57 - app.services.material_download_service - WARNING - _do_download:823 -
Cached material download failed: source=url id=73b0fcdb err=cale      9.  5.101 /  9.  5.101
2026-11-24 02:48:57 - app.services.youtube_service - INFO - _download_and_upload_internal:794 -
YouTube视频下载成功: …\youtube_media.mp4, 文件大小: 2552552 bytes
```

同一条素材的两侧证据：

* `cached_materials`（`evidence/cached-materials-failed-rows.txt`）：

  ```text
  8b2612f948764a4dbf1e40c5166657bc | url | 73b0fcdb | failed | None | 2026-11-24 07:48:47 |
    https://www.youtube.com/watch?v=Rsh8TmczwrM
    error_message:
      cale      9.  5.101 /  9.  5.101
        libswresample   6.  3.101 /  6.  3.101
      [in#0 @ 0000022857044340] Error opening input: Invalid data found when processing input
      Error opening input file https://www.youtube.com/watch?v=Rsh8TmczwrM.
  ```

  同一张表里还有 `e2643bae`（2026-11-20，`FfHDxu0SRao`）和 `c4a29188`
  （2026-07-02，`g35UG6VTDbU`）两条同型失败行——**这是长期存在的老问题，
  不是最近的回归**。

* 素材卡（`evidence/project-material-youtube.json`，渲染进程写回 `project_data` 的原值）：

  ```json
  "url": "/api/storage/files/video/2026/11/24/user_anonymous/task-1790169051088-3sao0c82f/youtube_media.mp4",
  "downloadStatus": "completed",
  "downloadProgress": 100,
  "cacheStatus": "failed",
  "cacheError": "cale      9.  5.101 /  9.  5.101\n … Error opening input file https://www.youtube.com/watch?v=Rsh8TmczwrM.\n"
  ```

### 3.4 这条 failed 行会被永久复用：key 退化 + 终态语义

**key 退化**：素材元数据里写的是 `youtubeId`，而 composite key 只读
`sourceId` / `id` / `video_id`：

```ts
// src/components/video/lib/materialKey.ts:71-79
const metaSource = typeof meta.source === 'string' ? meta.source : '';
const metaSourceId = asIdString(meta.sourceId) || asIdString(meta.id) || asIdString(meta.video_id);
const source = metaSource && metaSource !== 'ark-ai-video' ? metaSource : '';
if (source && metaSourceId) return { source, source_id: metaSourceId };
// Fall back to a url-derived stable identifier.
return { source: 'url', source_id: hashUrl(url) };
```

`metadata.source='youtube'` 但没有 `sourceId`，于是落到回退分支 →
`('url', hashUrl(watchUrl))`。`hashUrl`（`:35-42`）对
`https://www.youtube.com/watch?v=Rsh8TmczwrM` 正好是 `73b0fcdb`（复现测试第 ② 条断言）。
这就是为什么失败行的 `source` 是 `url` 而不是 `youtube`，也意味着它**不会**被任何来源
维度的清理规则命中。

**终态语义**：`RemoteMaterialPrefetchAdapter.runPoll` 遇到 `failed` 直接返回，不再轮询
（`RemoteMaterialPrefetchAdapter.ts:271-273`）；`shouldPrefetch` 对
`cacheStatus === 'failed'` 也不再自动重试（`useRemoteMaterialPrefetch.ts:267`）。也就是说
一旦这条行被写成 failed，它对该 URL 恒为失败，直到有人手工删行。

> **评审补证：这个「永久」是前端造成的，不是数据库造成的。** 后端
> `_enqueue_impl` 每次被调用都会把 `failed` 重置回 `pending` 并重新排队
> （`material_download_service.py:203-217`：`if row.status == "failed": row.status = "pending";
> row.error_message = None; schedule_download = True`）。所以：
> 1. 终态是**前端闸门**（`useRemoteMaterialPrefetch.ts:267`）制造的，后端本身是可重试的
>    —— 这一点决定了修复必须落在前端判定上（见第 7 节与评审结论），只清数据库没用；
> 2. 代价是**每次重新添加同一视频都会再赔一次 doomed 的 ffmpeg**：新素材没有
>    `cacheStatus`，闸门放行 → `enqueue` 复用同一行（表在 `(source, source_id)` 上唯一）
>    → 重置为 pending → 3 次尝试 + 1+2+4 s 退避（`material_download_service.py:862-884`）→
>    又写回 failed。第 4 节第 6 条的「3 次重试」应表述为「3 次尝试 + 3 次退避合计 7 s 起」，
>    且**最后一次退避（4 s）发生在最后一次尝试之后，纯属浪费**。

**「重试」是空转**：素材卡红色标记的点击回调是 `onRetry` →
`actions.onRetryDownload`（`MaterialCard.tsx:336`）→
`videoSearch.retryVideoDownload`（`VideoEditingInterface.tsx:2300`）→ 再次
`POST /api/youtube/download-and-upload`。它只重跑 A 管线，`retryVideoDownload` 用
`{...material}` 展开还**带着** `cacheStatus:'failed'`
（`useVideoSearch.ts:704-712`），所以重试成功也不会清掉红色标记——这正是用户 02:49:02
重试一次、02:49:13 再次下载成功后仍然「失败」的机制。

### 3.5 次要缺陷：YouTube 缩略图 100% 上传失败

```python
# backend-services/basic-service/app/services/youtube_service.py:919-933
thumb_result = await storage_service.upload_file(
    file_data=thumb_data,
    filename=thumbnail_filename,      # thumb_youtube_media.jpg
    content_type="image/jpeg",
    folder="video",                   # ← 与 jpeg 不兼容
    …
)
if thumb_result.get("success", False):
    thumbnail_url = thumb_result.get("file_url", "")
else:
    logger.warning(f"缩略图上传失败: {thumb_result.get('message', '未知错误')}")
```

```python
# backend-services/basic-service/app/services/storage_service.py:329-344
mapping = {"video": self.config.allowed_video_types, "audio": …, "image": …, "images": …}
allowed = mapping.get(folder)
if allowed is None:      # "files" 或未知 folder 才放行
    return True
return content_type in allowed     # 'image/jpeg' ∉ allowed_video_types
```

线上日志：`缩略图上传失败: File type 'image/jpeg' is not allowed for folder 'video'`
（2026-11-24 02:48:57、02:49:13 各一次）。后果：`thumbnail_url=null` →
素材 `thumbnailUrl: ""`（`evidence/project-material-youtube.json:11`）→ 卡片没有封面；
并且 `useMaterialManagement.addMaterials` 的自动解析要求 `hasThumbnail` 为真
（`useMaterialManagement.ts:432-443`），YouTube 素材因此**永远不会**触发自动解析。

> **评审更正（2026-11-24，本节点补证）：这一格的因果链是「过度决定」的，不能把
> `thumbnailUrl: ""` 当作 D 的症状证据。** 下载成功回填时写的是
> `thumbnailUrl: result.thumbnail_url || material.thumbnailUrl`（`useVideoSearch.ts:579`），
> 而素材进列表时带的是搜索结果的 `video.thumbnail_url || ''`
> （`youtubeVideoSearchService.ts:218`）：这两个来源**任一为空**都会让最终值是 `""`。
> 真实值来自后端 `entry.get('thumbnail', '')`（`youtube_service.py:506`），yt-dlp 的
> flat 搜索条目通常只给 `thumbnails` 列表而不给 `thumbnail` 键 —— 也就是说
> **下载完成之前，素材卡本来就没有封面**，与上传失败无关。
> 能**单独**证明上传失败的是 `metadata.thumbnailUrl: null`
> （`evidence/project-material-youtube.json:27`，对应 `youtube_service.py:891` 的
> `thumbnail_url = None` 与 `:971` 的回传）。
> 结论不变（D 仍值得做：修好后新添加的视频**才会有**封面），但 D 修不掉「下载中那 10 秒
> 也没有封面」，也修不掉搜索列表页的封面缺失——那是一个**独立缺陷**，应另开任务，
> 不要并进本 bug 的修复范围。

### 3.6 可诊断性缺陷：错误原文被丢掉，日志还会误导

* `youtube_worker.py:120-132` 的 `error_code()` 只保留分类码：任何含 `login` /
  `sign in to confirm` 的错误都归为 `SIGN_IN_REQUIRED`，原文丢弃；
* `youtube_runtime.py:183-186` 启动 worker 时 `stderr=subprocess.DEVNULL`，
  `QuietLogger`（`youtube_worker.py:135-138`）也是空实现 —— yt-dlp 的真实报错在桌面端
  **无处可查**；
* `youtube_service.py:782-787` 先打印「步骤1: 视频下载完成」**再**判断
  `download_result.success`，导致 2026-11-20 那一轮把
  `SIGN_IN_REQUIRED` 误读成「下载完成后才失败」（见
  `docs/diagnoses/youtube-preview-and-ytdlp-update/analysis.md` 与
  `.agentmesh/youtube-implementation/desktop-user/logs/backend.log:777-779`
  ——「步骤1: 视频下载完成，耗时: 11.18秒」紧接「SIGN_IN_REQUIRED」错误行）。

这次能定位，靠的正是「下载成功 / 缓存失败」两条日志同时出现 + 数据库行 + 项目状态三方对照。

### 3.7 已排除的假设（避免下游重复排查）

| 假设 | 结论 | 反证 |
| --- | --- | --- |
| yt-dlp 版本太旧 | 排除 | 桌面端运行时已是 `2026.10.26`（`youtube-runtime/state.json`：`active_version 2026.10.26, last_result no_update`），且同一分钟下载成功 |
| 网络/代理不通 | 排除 | 同一分钟内搜索、预览（206）与下载（10 s 拿到 2.5 MB）全部成功 |
| YouTube 要求登录（`SIGN_IN_REQUIRED`） | 排除（本次） | 2026-11-24 两次尝试都是 `success: True`；该分类只在 11-20 那轮出现 |
| 桌面端打包差异 | 排除 | 出错链路（hook + ingest + ffmpeg）是前后端同源代码，浏览器 `npm run dev` 同样会命中 |
| 存储/上传失败 | 排除 | `File uploaded successfully`，`video_url` 已生成并可 206 Range 播放 |

---

## 4. 影响面（Impact surface）

**受影响功能**

1. 素材库 → 搜索在线视频 → **YouTube 视频库** → 添加任意视频（每条视频每次添加都会命中）。
2. 素材卡状态机：`cacheStatus='failed'` 的红标 + 原始 ffmpeg stderr 直接暴露给用户。

   *评审更正（引用精度）*：红标本体在 `MaterialsPanel/MaterialCard.tsx:263-264`
   （`showCacheBadge = material.type === 'video' && !canPreviewDirectLocalMaterial(material)`）
   + `:331-338`（渲染 `<MaterialCacheBadge onRetry=…>`）；**stderr 文本**由
   `MaterialCacheBadge.tsx:60-75`（tooltip 拼 `cacheError`）与 `:172-181`
   （`title` / `aria-label`）暴露。
   原报告引的 `MaterialStatusOverlays.tsx:110-131` **本次并未渲染** —— 那段只在
   `material.downloadStatus === 'error'` 时出现，而本次 `downloadStatus === 'completed'`
   （`evidence/project-material-youtube.json:42`）。用户看到的红字是「缓存失败」
   （`i18n.ts:10462` zh / `:5766` en「Cache failed」），不是「下载失败」
   （`i18n.ts:10456`，那是另一个 overlay）。第 1 节的「缓存失败 / 下载失败」建议只保留
   「缓存失败」以免误导修复节点。
3. 封面缩略图：YouTube 素材恒无缩略图（3.5 节），素材卡只能显示占位。
4. 自动解析：因缺缩略图被 `hasThumbnail` 条件挡掉，YouTube 素材不会进入 AI 解析流程。
5. 数据卫生：`cached_materials` 每次添加都会新增/复用一条永久 `failed` 行
   （已累积 3 条，最早 2026-07-02）。
6. 无效算力：每条视频 3 次 `ffmpeg` 尝试 + 3 次退避 `1+2+4 = 7 s` 起
   （`material_download_service.py:862-884`；末次 4 s 退避发生在末次尝试之后，纯属浪费；
   实测区间 ≈7–11 s），与真实下载并行抢占磁盘/CPU。

**不受影响（已核对，避免过度修复）**

* 视频本体与播放：素材 `url` 最终是 `/api/storage/files/…`，预览、Range 拖动都正常。
* 导出/合成：导出走 `resolve_local_media`（`video_composition_service.py:1312-1324`），
  同源 storage 路径可直接本地解析，`failed` 缓存行不参与。
  *评审补证的**直接**证据*：导出请求体的 `(source, source_id)` 由
  `videoExportItems.ts:183` 用 `materialCompositeKey(material)` 现算，而此刻素材
  `url` 已换成 storage 路径 → 键是 `('url', hashUrl(storageUrl))`，
  **不等于** `('url', '73b0fcdb')`；后端 `resolve_cached_path` 必然 miss
  （`material_download_service.py:461-491`，miss 即回退下载/本地解析）。
  ⇒ 这条 failed 行对导出是**惰性数据**，删掉它不影响任何导出路径（见评审结论的数据清理）。
* Pexels / Freesound / ARK 素材：这些是真正的直链 CDN，B 管线对它们是正确设计。

**用户感知**：用户会认为「下载失败」，反复重试（实测 02:48:47、02:49:02 两次），
即便两次都成功仍然显示失败，最终放弃或怀疑网络/YouTube 账号问题。

---

## 5. 候选修复（Candidate fixes）

| # | 方案 | 改动点 | 侵入性 | 风险 | 工作量 | 覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| **A** | **前端不再让通用缓存管线接管 YouTube 素材**：`shouldPrefetch` 增加「需要专用抽取器的来源」判定（`metadata.source === 'youtube'` / `metadata.isYoutubeVideo` / `metadata.youtubeUrl`），并在 `downloadSingleVideo` 成功回填时清掉 `cacheStatus`/`cacheError` | `useRemoteMaterialPrefetch.ts:250-269`、`useVideoSearch.ts:560-599` | 小（纯前端、单文件 + 一处 patch） | 低：YouTube 素材本来也不需要缓存管线（下载已经落到 storage，且导出用 storage 路径） | 0.5–1 人时 | 直接消除用户可见红标与无效 ffmpeg |
| **B** | 后端拒绝/转交「页面 URL」：`POST /api/material/ingest` 对 YouTube 等需抽取器的 URL 返回 `status:'unsupported'`（或直接转 `youtube_service`），不再用 ffmpeg 抓 | `material_router.py:98-173`、`material_download_service.py:855-886` | 中（协议新增一个状态值，需同步前端 `statusToCacheStatus`） | 中：新状态要贯通 ingest/lookup/前端映射，漏改会退化成 pending 长轮询 | 2–3 人时 | 纵深防御：vimeo/bilibili/抖音等页面 URL 同型问题一并解决 |
| **C** | key 修复 + 脏数据清理：`convertToMaterials` 写 `metadata.sourceId = video.id`（或让 `materialKey` 认 `youtubeId`），并对已存在的 `('url', hash)` failed 行做一次性重置/清理 | `youtubeVideoSearchService.ts:338-345`、`materialKey.ts:71-79`（+ 迁移脚本或 `database.py` 启动清理） | 中 | 中：改 key 会让「导出查询 key」与历史行不一致，必须同时清理历史行，否则导出会重新下载 | 1–2 人时 | 消除 key 污染；配合 A 之后失败的键不再落库 |
| **D** | 缩略图修复：`youtube_service.py` 上传缩略图改用 `folder="image"`（或 `folder="files"`），保留 `image/jpeg` | `youtube_service.py:919-926` | 极小（1 行） | 极低：`allowed_image_types` 含 jpeg | 5 分钟 | 恢复封面 + 触发自动解析 |
| E | 仅改展示：把 `failed` 对 youtube 来源静默成无标记 | `MaterialCacheBadge.tsx` / `statusToCacheStatus` | 小 | 高：掩盖状态，其它来源也会被误伤，且 ingested 失败仍留脏行 | — | 不推荐，只治表象 |

---

## 6. 推荐修复（Recommended fix）

**本次一并做 A + D，随后补 C，B 作为后续纵深项。**理由：

1. **A 直接命中根因且风险最低**：「YouTube 素材的本地化由专用管线（yt-dlp + storage）完成，
   通用缓存管线对它是错配」——这是设计与职责边界修正，不是打补丁。落地后
   `POST /api/material/ingest` 根本不会被这条素材触发，用户可见的红色失败与
   7–11 s 的无效 ffmpeg 一起消失。同时必须在下载成功回填时清掉
   `cacheStatus`/`cacheError`，否则 `project_data` 里已持久化的
   `cacheStatus:'failed'`（`evidence/project-material-youtube.json:46`）会在下次打开项目
   被 hydrate 回来，老用户的问题看起来「没修好」。
2. **D 是一行改动的高性价比修复**：没有缩略图既伤观感，又静默关闭了自动解析；
   与 A 无耦合，可以同批提交。
3. **C 必须紧随其后**：只要 key 仍是 `('url', hashUrl)`，任何未来的 ingest 尝试都会继续
   撞上同一行 failed 记录；把 `metadata.sourceId = video.id` 写进去，key 变成
   `('youtube', 'Rsh8TmczwrM')`，语义正确且可被来源维度清理。历史
   `source='url'` 的 YouTube failed 行要一次性删除（可安全删除：`local_path` 为空、
   无引用者；删除后素材会按 A 的逻辑重新走专用管线）。
4. **B 留作后续**：它更彻底（任何页面 URL 都不该进 ffmpeg 管线），但需要新增状态值并
   贯通 ingest/lookup/前端映射，属于协议级改动，风险与测试面都更大。建议单独开一个
   plan，并配套 `tests/test_material_ingest_page_url.py` 之类的后端测试。

**修复后的验收（建议写进修复节点的 DoD）**

1. `repro/prefetch-claims-youtube.repro.test.tsx` 第 ③ 条期望值翻转为
   「`adapter.keys` 为空」；① ② 保持（② 改为断 `('youtube', id)`）。
2. `POST /api/material/ingest` 对 YouTube 观看页 URL 在修复后**不再被前端调用**；
   手工调用仍会失败（B 未做），因此第 2 节 2.2A 的 ffmpeg 复现应保留为「已知边界」。
3. 桌面端手工验证：添加视频 → 素材卡 `downloadStatus=completed`、
   `cacheStatus` 为 `undefined`、缩略图有值；`project_data` 里不再出现
   `cacheError`；`cached_materials` 不新增 `source_url LIKE '%youtube.com/watch%'` 的行。
4. 已存在的 failed 行清理后，旧项目重新打开不再显示红标（验证 A 的 patch 覆盖 hydrate 路径）。

**本节点未做的验证（如实记录）**：未重新打包桌面端跑端到端（需要 `npm --prefix desktop run build`
+ 安装耗时，且 F-12 那条遗留同样未做桌面手工验收）；本次以「真实用户数据的数据库行 +
真实 ffmpeg 复现 + 生产代码特征化测试」替代，三者互相印证，结论不依赖猜测。

> **评审裁定（覆盖本节推荐，以文末「评审结论」为准）**：本节「一并做 A + D，随后补 C」
> 在评审中被**收窄为「只做 A」**。理由：C 在 A 落地后收益为零而引入导出键一致性风险
> （`materialKey.ts:1-11` 与 `videoExportItems.ts:183` 共用派生）；D 属于并列缺陷、
> 与本 bug 根因无关，应单独提交。方向性判断（A 是根因修复、B 是纵深、E 拒绝）经复核**成立**。

---

## 附录：本目录内容

| 文件 | 用途 |
| --- | --- |
| `analysis.md` | 本报告 |
| `repro/ffmpeg-watch-url-repro.ps1` | 最小后端复现（一条 ffmpeg 命令，打印写入 DB 的那段 stderr） |
| `repro/ffmpeg-output.txt` | 上述脚本本机实测输出 |
| `repro/prefetch-claims-youtube.repro.test.tsx` | 最小前端复现（4 条特征化断言） |
| `repro/vitest.repro.config.ts` | 独立 vitest 入口，不影响项目默认测试集 |
| `repro/vitest-repro-output.txt` | `4 passed` 实测输出 |
| `evidence/desktop-app-log-2026-11-24-excerpt.txt` | 桌面端后端日志摘录（02:48:40–02:49:15） |
| `evidence/cached-materials-failed-rows.txt` | 3 条 YouTube failed 缓存行（含 2026-07-02 的历史行） |
| `evidence/project-material-youtube.json` | 渲染进程写回的素材原值（`completed` + `failed` 并存） |
| `repro/inspect-cached-materials.py` | 只读脚本：列出桌面端库里所有 YouTube 观看页的 `cached_materials` 行 |

---

## 7. 评审补证（Reviewer addendum）

> 本节由评审节点追加。**只补证据与更正，不改产品代码、不写修复。**
> 所有行号均于 2026-11-24 在本工作区对磁盘源码逐条复核。

### 7.1 独立复核：原报告的复现我重跑过，结论成立

| 复核项 | 做法 | 结果 |
| --- | --- | --- |
| 前端特征化复现 | `npx vitest run --config docs/…/repro/vitest.repro.config.ts` | `Test Files 1 passed (1)` / `Tests 4 passed (4)`，`Duration 4.48s` |
| `hashUrl` 复算 | 按 `materialKey.ts:35-42` 独立实现 32 位 `Math.imul(31,h)+code` 求值 | `0x73b0fcdb`，与 DB 行 `source_id`、与线上 lookup 的 `source_id=73b0fcdb`（`evidence/desktop-app-log-…txt:16`）三方一致 |
| ffmpeg 复现脚本是否等价 | 对比 `repro/ffmpeg-watch-url-repro.ps1:31` 与 `material_download_service.py:869` | argv 形状一致（`-y -i <url> -c copy <out>`）；脚本只跑 1 次、服务端跑 3 次（`:862`），不影响「观看页不可读」这一结论 |

### 7.2 「被引用的代码确实在失败路径上」——用调用方反证（原报告缺这一条）

`shouldPrefetch` 能当**唯一闸门**，依据是「全仓库只有一个 ingest 发起者」，可核对：

```text
src/ 中 material/ingest  → 只有 RemoteMaterialPrefetchAdapter.ts:165（生产路径，走 http-client）
                            :178（test-only fetchImpl 分支）
后端 .enqueue(           → material_router.py:109（/ingest 路由）
                            material_download_service.py:163（pexels 转交 video_library）
                            preview_proxy_service.py:233（见 7.6）
```

`useRemoteMaterialPrefetch.ts:399-400` 是全仓库唯一调用 `pollUntilReady` 的位置，因此
B 管线**入口唯一**，日志 02:48:47 那条 `POST /api/material/ingest` 只可能来自它。
同一份日志还独立证明「那一刻该素材的 url 就是观看页」：
`:16`/`:20`/`:22`/`:24` 的 lookup 全部带 `url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DRsh8TmczwrM`，
而 `:27` 到 02:48:57 才写出 `media.mp4` —— 即**失败发生在下载成功之前约 10.5 s**。

### 7.3 为什么红标「一定」渲染（不是截图偶然）

* `MaterialCard.tsx:263-264`：`showCacheBadge = type === 'video' && !canPreviewDirectLocalMaterial(material)`。
* `downloadSingleVideo` 的成功回填（`useVideoSearch.ts:572-597`）只写
  `url` / `serverUrl` / `size` / `thumbnailUrl` / `duration` / `width` / `height` / `metadata`，
  **既不写 `storageKey`，也不写 `metadata.storageKind`**。
* 于是 `isDirectLocalMaterial`（`localMaterial.ts:62-76`）四条判据全不命中 →
  `canPreviewDirectLocalMaterial` 为 false（`:92-99`）→ badge 照常渲染；
  `cacheStatus='failed'` → 红叉 + tooltip 拼 `cacheError`（`MaterialCacheBadge.tsx:60-75`、`:155-168`）。

**这解释了本 bug 最矛盾的一处现象**：视频能正常播放（url 已是同源 storage）与卡上红叉
（cacheStatus 仍是 failed）可以同时成立，二者读的是不同字段。

### 7.4 竞态 / 并发：已排除，不是偶发

* 同一视频在一次添加里只登记一次：hook 侧 `inflightKeysRef` 去重
  （`useRemoteMaterialPrefetch.ts:347-350`），adapter 侧 `pollers` 去重
  （`RemoteMaterialPrefetchAdapter.ts:205-237`，键为 `${source}::${source_id}`）。
* 多选并发下载（`downloadVideosInParallel`，`useVideoSearch.ts:636-692`）中每个视频一个
  watch URL ⇒ 一个独立 key，互不覆盖。
* 日志两次尝试（02:48:47 / 02:49:02）区间不重叠，`:44` 与 `:77` 的
  `Response: 200 - 10.561s / 11.033s` 说明串行；三次「获得下载槽位 1/20」说明无排队饥饿。

⇒ **确定性缺陷**，不是竞态；不需要「加锁 / 加重试」类修复。

### 7.5 修复 A 的必须约束：只挡 ingest 分支，**不能**挡 preview-proxy 分支

同一 hook 里还有第三条分支（480p 预览代理 `_previewProxyEligible`，`:114-148`）。
它对 YouTube 素材**合法且必要**：下载完成后 `url` 变成 `/api/storage/files/…`，
`_previewProxyInputResolvable`（`:92-100`）命中，素材 >50 MB 或未知尺寸时就会排队转码
（H1/H2/H3 `:61-78`，小文件豁免 `:126-134`；本次 2.5 MB/1280×720 恰好被豁免）。
**因此守卫只能落在 `shouldPrefetch`（`:250-269`）**；若把「youtube 素材一律跳过」写进
`_previewProxyEligible` 或共享 helper，大体积 YouTube 素材会失去 480p 预览通道 ——
这是 A 最容易被实现错的地方。

### 7.6 B 必须覆盖**第二个**后端入口（原报告漏记）

```python
# preview_proxy_service.py:229-240
source_id = uuid.uuid5(uuid.NAMESPACE_URL, source_url).hex
row_meta = await mds.enqueue("url", source_id, source_url)   # :233
```

它与 `/api/material/ingest` 走**同一条** `_download_to_path`（ffmpeg），只是 id 空间不同
（`uuid5` 而非 `hashUrl`）。当前没被打到，是因为前端 `_previewProxyInputResolvable` 先拦住了
非本地输入 —— 这是**前端单点防御**。将来做 B 时若只改 `/ingest`，仍可从
`/api/preview-proxy/ensure` 走同一条 doomed ffmpeg。

### 7.7 D 的三项前置核对（原报告未核对，会影响实施）

1. `folder="image"` 放行 jpeg：`config.py:284-287` 的 `allowed_image_types` 默认含
   `image/jpeg` ✔；`storage_service.py:329-344` 的 `mapping` 里 `image` 与 `images` 都指向它。
2. 换目录会改变产物 URL 前缀。前端只有 `localMaterial.ts:5-10` 的
   `DIRECT_UPLOAD_PREFIXES` 里的前缀才算「直传本地素材」，该列表同时含 `/image/` 与 `/images/` ✔。
3. 没有既有测试把「缩略图走 `folder='video'`」当契约 ——
   `tests/test_storage_video_thumbnail.py` 测的是 `upload_video_file` 的封面逻辑，与本处无关 ✔。

### 7.8 对「影响面」的两处收窄

* 第 4 节第 3、4 条（无封面 → 自动解析被跳）**成立但原因不止一个**（见 3.5 节更正）：
  搜索阶段 `thumbnailUrl` 大概率为空；D 修好后新添加的素材才会有封面。要让自动解析真正
  生效，还需确认 `result.thumbnail_url` 非空落库（`useVideoSearch.ts:579`）。
* 第 4 节「用户感知」成立，但红字是**缓存失败**而非「下载失败」；用户会口头称「下载失败」，
  与任务标题一致，文档标题不必改。

---

## 评审结论

### 一、最终推荐修复：**只做 A**（`shouldPrefetch` 守卫 + 下载成功回填时清缓存态）

**A 是本次唯一推荐修复。** 具体范围（两处，缺一不可）：

1. **堵住误接管**：`useRemoteMaterialPrefetch.ts:250-269` 的 `shouldPrefetch` 增加一条
   「该来源需要专用抽取器，不得走通用 ffmpeg 缓存」的判定
   （`metadata.source === 'youtube'` / `metadata.isYoutubeVideo === true` /
   `metadata.youtubeId` / `metadata.youtubeUrl` 任一命中即 `return false`），
   位置**必须在这个函数内部**，不得下沉到共享 helper、更不得放进 `_previewProxyEligible`
   （理由见 7.5：否则大体积 YouTube 素材会丢 480p 预览通道）。
2. **清掉已污染的状态**：`useVideoSearch.ts:572-597` 的成功回填里显式写
   `cacheStatus: undefined`、`cacheError: undefined`。**不要**顺手写
   `cacheUrl: result.video_url` —— `cacheUrl` 的语义是 `cached_materials/` 下的共享缓存
   （`localMaterial.ts:87-90` 只认 `/api/storage/files/cached_materials/` 前缀），
   storage 路径写进去会给后续 `selectPlaybackUrl` / 预览代理判据制造新的错配。
   清 `cacheError` 不只是观感：`project_data` 会把 `cacheError` 原样持久化
   （`evidence/project-material-youtube.json:47`），不清就永久留一段 ffmpeg stderr 在用户项目里。

外加一个**纯数据动作**（不是代码改动）：一次性删除 `cached_materials` 里
`source='url'` 且 `source_url LIKE '%youtube.com/watch%'` 的 `failed` 行（当前 3 条）。
**可以安全删除**——`local_path` 为空、无引用者，导出也不会命中它（直接证据见 4 节
「导出/合成」的评审补证：导出键由当前 `url` 现算，早已不是 `('url','73b0fcdb')`）。

### 二、为什么是 A（而不是 A+D+C）

1. **它命中唯一的因果链，且是一条判定**。7.2 已用调用方反证：全仓库只有一个 ingest
   发起者、一个 `pollUntilReady` 调用者，所以 `shouldPrefetch` 是本 bug 的**唯一入口**。
   在这里加一条判定，等于把「YouTube 的本地化由专用管线（yt-dlp + storage）负责」这条
   职责边界写回代码，而不是给症状打补丁。
2. **它是唯一能同时消灭三件事的最小改动**：用户可见红标、每次添加 ~7–11 s 的无效 ffmpeg
   （`material_download_service.py:862-884`）、以及新脏行的产生。B/C/D/E 都做不到「同时」。
3. **风险最低且可回归**。它不触碰导出、不触碰播放、不触碰 `materialKey`（见第三节 C 的裁定），
   影响面就是「YouTube 素材不再进入通用缓存管线」——而这个管线对 YouTube **本来就是错配**
   （素材最终 url 是 `/api/storage/files/…`，本身就是同源可 Range 的本地文件，
   `canPreviewDirectLocalMaterial` 之外的缓存对它没有任何收益）。
4. **它同时修掉老用户的存量症状**。第 2 处改动让「重新下载成功」能清掉已持久化的
   `cacheStatus:'failed'`，否则老项目一 hydrate 就还是红标，用户会认为「没修好」。

### 三、其他候选的裁定

| # | 裁定 | 理由 |
| --- | --- | --- |
| **A** | **采纳（本次唯一推荐）** | 见上。 |
| **B** | **不进本次，作为纵深项单开任务**（必要时**升级**为独立 plan） | 方向完全正确（任何页面 URL 都不该进 ffmpeg），但它是协议级改动：新增状态值要贯通 ingest → lookup → `statusToCacheStatus`（`useRemoteMaterialPrefetch.ts:271-286`）。**且原报告的改动点清单不完整**：必须同时覆盖 `/api/material/ingest` 与 `/api/preview-proxy/ensure` 两个入口（7.6），最好收敛到 `_download_to_path` 一层，否则「修完 ingest 仍可从 preview-proxy 打到同一条 ffmpeg」。 |
| **C** | **不采纳为本 bug 的一部分** | 这是本次评审与原报告最大的分歧。原报告把 C 列为「必须紧随其后」，但 A 落地后**根本不再产生 YouTube 缓存行**，改 key 的收益为零；而代价是实打实的：`materialKey.ts:1-11` 的契约注释明确要求 ingest 与导出（`videoExportItems.ts:183`）**必须用同一个 key 派生**，改 `('url', hash)` → `('youtube', id)` 会同时改变导出侧查询键，历史行与新键不一致时导出会退回联网下载路径（这正是 `video-export-redownloads-cached-materials` 那个已修 bug 的形状）。若确实要修 key 语义，必须与「历史行迁移」原子配套并单独评审。**本次替代方案**：不改 key，只删 3 条历史脏行（见第一节末尾）。 |
| **D** | **拆成独立任务，不与 A 混在同一提交** | D 修的**不是**本 bug 的根因：缩略图缺失是并列缺陷，去掉它不会让红标消失，也不影响下载成功率。而且 3.5 节的更正说明「无封面」实际有**两个**原因（上传失败 + 搜索阶段本就为空），单独做 D 才能把这条链走完整（`useVideoSearch.ts:579` 的 `\|\|` 回退会一直掩盖搜索侧的空值）。技术上 D 是安全的（7.7 三项前置核对全过），风险低不等于应该塞进本 bug 的提交里 —— 一次提交只修一个根因，回归时才定得住位。 |
| **E** | **拒绝** | 只把红标对 youtube 来源静默掉，等于让显示层替数据层撒谎；`ingested` 失败仍会继续产生脏行，其它来源也随时会被误伤。 |

### 四、A 的边界覆盖（审计「是否覆盖并发 / 错误路径 / 边界输入」）

| 边界 | 结论 |
| --- | --- |
| 同一视频重复添加 / 双击 | 已由双层去重覆盖（`useRemoteMaterialPrefetch.ts:347-350` + `RemoteMaterialPrefetchAdapter.ts:205-237`），A 之后连 ingest 都不会发 |
| 多选一次加 N 个视频 | 每个 watch URL 一个独立 key，A 对每个都生效；`downloadVideosInParallel`（`:636-692`）无需改动 |
| 下载失败（`downloadStatus='error'`） | **A 之后 url 仍是观看页**，靠 `metadata.source` 判定依然拦截 —— 这正是「不能只靠 `downloadStatus === 'downloading'` 守卫」的原因（那条守卫在 error 态会失效） |
| 老项目 hydrate（`project_data` 里已存 `cacheStatus:'failed'`） | 双保险：`shouldPrefetch:267` 本来就跳过 failed；回填清理让它在下次成功下载后消失。**注意**：只重开项目不会自动清，必须有一次成功下载或一次 migrate |
| 已有 failed 行被新 ingest 重置为 pending | A 之后不再有 ingest，无从触发；历史行按第一节末尾删除 |
| 用户手动清 `cacheStatus` 想重试 | 会被 A 的新守卫挡住（这是**期望**行为：YouTube 素材的正确重试入口是 `retryVideoDownload` → `/api/youtube/download-and-upload`，不是缓存管线） |

### 五、A 的回归面（我实际查过的地方）

* **导出**：不依赖该缓存行（`videoExportItems.ts:183` + 4 节补证）；YouTube 素材导出走同源
  storage 路径 → `resolve_local_media`。**无回归**。
* **播放/预览**：素材本地化本来就由 storage 路径承担（`canPreviewDirectLocalMaterial` 判据里
  `cached_materials` 只是其中一条）；A 之后 YouTube 素材不进 `cached_materials`，
  但它也从来不是**以那种方式**被播放的（`evidence/project-material-youtube.json:12` 证明
  落库的是 `/api/storage/files/video/…`）。**无回归**。
* **480p 预览代理**：`_previewProxyEligible` 与 `shouldPrefetch` 是两条独立判据，A 只改后者
  （7.5）。**只要实现时守住位置，无回归**。
* **Pexels / Freesound / ARK**：`metadata.source` 不含 `youtube`，判据不命中，行为不变。
  建议修复节点补一条「pexels 素材仍然 prefetch」的断言，防止守卫写宽（例如误写成
  `if (material.metadata?.source) return false`）。

### 六、修复节点的 DoD（可直接抄进验收）

1. 复现测试翻转为期望：`repro/prefetch-claims-youtube.repro.test.tsx` 第 ③ 条改为
   `expect(adapter.keys).toEqual([])`；第 ① ④ 条保持不变；第 ② 条**保持**
   `('url','73b0fcdb')`（因为本次不改 key —— 这与原报告第 6 节的建议不同，以本结论为准）。
2. 新增特征化断言：`metadata.source='youtube'` 的素材 **不触发** ingest；
   `metadata.source='pexels'` 的素材**仍然触发**（防守卫写宽）。
3. 下载成功回填后 `cacheStatus === undefined && cacheError === undefined`，
   且**没有**新增 `cacheUrl`（避免把 storage 路径塞进缓存字段）。
4. 桌面端手工验收：添加视频 → `downloadStatus=completed`、无红标、tooltip 无 ffmpeg stderr；
   重开项目后仍无红标；`cached_materials` 不再新增 `source_url LIKE '%youtube.com/watch%'` 的行。
5. 后端不新增任何代码（B 不在本次范围），因此 `POST /api/material/ingest` 手工调用仍会失败 ——
   这是**已知边界**，保留 `repro/ffmpeg-watch-url-repro.ps1` 作为该边界的记录。

### 七、本次评审未做的验证（如实记录）

* 未重新打包桌面端跑端到端（与上一节点同样的限制：`desktop` 打包 + 安装耗时，
  且遗留项 F-12「桌面手工验收」仍未做）。
* 未联网实跑一次 YouTube 搜索去证实「搜索结果的 `thumbnail_url` 为空」——
  该结论来自代码路径（`youtube_service.py:506` 读 `entry.get('thumbnail')`）与
  `metadata.thumbnailUrl: null` 的推理，**尚未实测**。因此本结论把它标为「独立缺陷、待实测」，
  并**没有**把它作为修复 A 的任何依据。
* 未验证修复 A 之后 YouTube 大文件（>50 MB）的 480p 预览代理是否仍按预期排队
  （需要一件大素材实测）；7.5 只证明了判据路径未被 A 改动。


---

## 实施过程发现的方案缺陷

> 本节由**修复节点**追加（2026-11-24）。结论先说：**「只做 A」这个方案没有被推翻**，
> 落地时既没有改判定位置、也没有扩大范围。下面是实施时确认的两条事实、一处 DoD 措辞收窄，
> 以及最终落地清单，供提交节点 / 验收节点核对。

### 1. 回填清理能生效的前提是 `addMaterials` 做「整条替换」

`useVideoSearch.downloadSingleVideo` 的成功回填只把整个 `MaterialItem` 交给
`onAddMaterials`，而 `useMaterialManagement.addMaterials`
（`useMaterialManagement.ts:404-419`）对同 id 素材是
`updatedMaterials[index] = newMaterial` 的**整条替换**，所以写
`cacheStatus: undefined` / `cacheError: undefined` 才真能清掉 `project_data` 里已持久化的旧值。

若将来该合并逻辑退化成「只覆盖已定义字段」，本次清理会**静默失效**（下载成功也不会清红标）。
已在 `src/components/video/hooks/__tests__/useVideoSearch.materialize.test.ts` 加断言钉住：
`cacheStatus/cacheError === undefined`，且**不新增** `cacheUrl`。

### 2. DoD 第 4 条「重开项目后仍无红标」只对修复后新添加的素材成立

旧项目的 `project_data` 里已经存了 `cacheStatus:'failed'`；A 只改「写入口」与「下载成功时的清理」，
**不会在 hydrate 时主动擦字段** —— 这与「评审结论 四、老项目 hydrate」一行的说法一致
（"只重开项目不会自动清，必须有一次成功下载或一次 migrate"）。因此手工验收要分两步：

* a) **新添加**一条 YouTube 视频 → `downloadStatus=completed`、无红标、tooltip 无 ffmpeg stderr；
* b) **老项目**重开 → 红标可能仍在，点素材卡「重试」（`retryVideoDownload` → A 管线）成功一次后消失。

连 (b) 也做成自动，需要 hydrate 清理或一次性数据迁移 —— 那是**新的**改动，
不属于本次「只做 A」的范围，按评审裁定不做。

### 3. 最终落地清单（与「评审结论」逐条对齐，无偏离）

| # | 文件 | 改动 |
| --- | --- | --- |
| 1 | `src/components/video/hooks/useRemoteMaterialPrefetch.ts` | 新增 `needsDedicatedExtractor()`，并在 `shouldPrefetch` **函数内部**加一条守卫：`metadata.source==='youtube'` / `metadata.isYoutubeVideo===true` / `metadata.youtubeId` / `metadata.youtubeUrl` / 顶层 `MaterialItem.youtubeUrl` 任一命中即 `return false`。**未**下沉到共享 helper、**未**触碰 `_previewProxyEligible`（守住 7.5 的 480p 预览通道）。 |
| 2 | `src/components/video/hooks/useVideoSearch.ts` | 成功回填显式 `cacheStatus: undefined` / `cacheError: undefined`；**没有**写 `cacheUrl`（避免把 storage 路径塞进缓存语义）。 |
| 3 | `cached_materials`（一次性数据动作，非代码） | 删除 `source='url' AND source_url LIKE '%youtube.com/watch%' AND status='failed'` 的 **3 行**。删前核对：`local_path` 全为空、`preview_proxy_status` 全为 `absent`、22 个项目的 `project_data` 里对这些 id / source_id 零引用；删前已做物理备份 + 逻辑导出 JSON。 |
| 4 | `repro/prefetch-claims-youtube.repro.test.tsx` | 第 ③ 条翻转为「`adapter.keys` 为空且 `onPatch` 未被调用」；① ② ④ 保持原样（**未**改 key，符合「评审结论 三、C」）。 |

### 4. 实施时跑的验证

| 命令 | 结果 |
| --- | --- |
| `npx vitest run --config docs/diagnoses/youtube-desktop-add-material-download-failed/repro/vitest.repro.config.ts` | `4 passed`（③ 已按修复后行为断言） |
| `npx vitest run src/components/video/hooks/__tests__` | `60 files / 532 tests passed` |
| 新增断言 | YouTube 素材**不再**触发 ingest；下载失败路径（`downloadStatus='error'`、仅 `metadata.isYoutubeVideo`）**仍被拦**；Pexels 素材**仍会**触发（防守卫写宽） |
| `npx tsc --noEmit` | 本次改动的 4 个文件无错误；工作区仍剩 1 条**既有**错误 `src/components/skillrouter/__tests__/SkillRouterSettingsPanel.test.tsx:145`（本次未触碰该文件） |
| `python -X utf8 repro/inspect-cached-materials.py` | 删行前 `3 row(s) found` → 删行后 `no YouTube watch-page rows` |

**未做的验证（如实记录）**：未重新打包桌面端跑端到端（与诊断 / 评审两个节点同样的限制）。
本次以「生产代码特征化测试翻转为期望 + 真实桌面库脏行清理前后对照 + `tsc` 通过」替代；
B（后端拒绝页面 URL）按裁定不在本次范围，`POST /api/material/ingest` 手工调用仍会失败，
`repro/ffmpeg-watch-url-repro.ps1` 继续作为该已知边界的记录。

---

## 提交前终审（Commit review）

> 本节由**提交（终审）节点**追加（2026-11-24）。它记录三件事：对修复 diff 的逐项裁定、
> 终审时直接改掉的 4 处问题、以及本提交的验证证据与残余边界。

### 1. 逐项裁定：改动是否命中根因

| 评审问题 | 裁定 | 依据 |
| --- | --- | --- |
| 是否命中根因，还是只遮症状？ | **命中根因** | 改动落在 `shouldPrefetch`（全仓库唯一的 ingest 入口，`useRemoteMaterialPrefetch.ts:278-303`），把「YouTube 的本地化由 yt-dlp + storage 负责」这条职责边界写回代码；没有落到展示层（方案 E 被拒的理由成立） |
| 第二处改动是否必要？ | **必要** | `useVideoSearch.ts:571-606` 的成功回填清 `cacheStatus`/`cacheError` 只有在 `addMaterials` 整条替换时才生效——终审复核 `useMaterialManagement.ts:409-419` 确实是 `updatedMaterials[index] = newMaterial`，结论成立 |
| 是否夹带了本次范围外的改动？ | **没有** | 产出代码只有上述两处；未改 `materialKey.ts`（C）、未改 `youtube_service.py` 缩略图（D）、未改后端（B），与「评审结论·三」一致 |
| 相邻代码路径会不会被打穿？ | **不会** | 终审复核：`_previewProxyEligible`（同文件 `:114-148`）与 `shouldPrefetch` 是两条互不引用的判据，480p 预览通道未被触碰；并新增一条测试钉住（见 2.2） |
| 守卫会不会写宽误伤 Pexels / ARK？ | **不会** | 判据只看 `metadata.source==='youtube'` / `isYoutubeVideo` / `youtubeId` / `youtubeUrl` 与顶层 `youtubeUrl`；既有断言「Pexels 仍触发」保留 |
| 命名、注释、风格是否与仓库一致？ | **终审修正 3 处** | 见 2.1、2.3、2.4 |
| 是否留下 TODO / 死代码 / 越界文件？ | **没有** | `git status` 只有本 bug 的 5 个源文件 + 本诊断目录；无 `TODO` |

### 2. 终审直接改掉的问题（4 处，均不改变修复语义）

1. **产出代码超 80 列 → 收敛**：`needsDedicatedExtractor` 里 4 行（`meta.source` 三元、
   `youtubeId` / `youtubeUrl` / 顶层 `youtubeUrl` 三个 `typeof …length>0` 判断）超出
   `.claude-index/config.md` 的 80 列阈值，改为换行 + 局部 `hasText()` 谓词，
   判据与命中顺序完全不变。
2. **同一段「为什么」被写了两遍 → 去重**：原 JSDoc（13 行）与 `shouldPrefetch` 内的行内注释
   （5 行）重复解释同一因果链。收为「JSDoc 讲职责边界与不变量（守卫只能在 `shouldPrefetch`）、
   行内注释只讲为什么用 metadata 而不是 `downloadStatus`」，两处不再互相复述。
3. **新增 480p 预览通道回归测试**：7.5 指出「守卫位置写错会让大体积 YouTube 素材丢掉 480p
   代理」，而此前**没有任何测试**钉住这条边界。新增
   `useRemoteMaterialPrefetch.previewProxy.test.ts` 用例：`metadata.source='youtube'` +
   `bytes>50MB` + url 已是同源 storage 时，`requestPreviewProxy` **仍被调用**，同时缓存管线
   `onPatchMaterial` **不被调用**——一条用例同时钉住「预览通道还在」与「缓存通道已关」。
4. **两处工程卫生问题**：`useRemoteMaterialPrefetch.test.ts` 文件末尾多出一个空行（已删）；
   `useVideoSearch.materialize.test.ts` 被整篇写成 LF 而仓库工作区是 CRLF（已 normalize，
   提交内容不变）。另把证据日志里 6 处本机 Windows 用户名替换为 `<user>`（评审清单第 7 条：
   不把个人路径带进仓库），技术内容未改。

### 3. 本提交的验证证据

| 命令 | 结果 |
| --- | --- |
| `npx vitest run src/components/video/hooks/__tests__` | `60 passed (60)` / **`533 passed (533)`**（原 532 + 新增 1 条预览代理回归） |
| `npx vitest run --config docs/diagnoses/…/repro/vitest.repro.config.ts` | **`4 passed (4)`**（③ 为修复后期望：`adapter.keys` 为空且 `onPatch` 未被调用） |
| `npx tsc --noEmit -p tsconfig.json` | 仅剩 1 条**既有**错误 `src/components/skillrouter/__tests__/SkillRouterSettingsPanel.test.tsx:145`（本次未触碰该文件，5 个改动文件无错误） |
| 逐行审计新增行长度 | 产出代码新增行全部 ≤80 列（`python` 统计，无超标行） |
| `git status --porcelain` | 5 个源文件 + 本诊断目录，无构建产物 / 临时文件 |

### 4. 残余边界（如实记录，均按裁定不在本次范围）

* **旧项目 hydrate 不会自动清红标**：`project_data` 里已存的 `cacheStatus:'failed'` 只能由
  「一次成功下载」清掉（本节对应「实施过程发现的方案缺陷」第 2 条）。做自动清理需要另开改动。
* **后端仍会失败**（B 未做）：手工 `POST /api/material/ingest` 传 YouTube 观看页依旧会写
  `failed` 行；`repro/ffmpeg-watch-url-repro.ps1` 保留为该边界的记录。
* **未打包跑桌面端端到端**：与诊断、评审、修复三个节点相同的限制；本次以「生产代码特征化
  测试翻转为期望 + hooks 全绿 + tsc」替代。F-12「桌面手工验收」仍未做。
* **非 YouTube 的页面 URL**（vimeo / bilibili / 抖音，或没有 youtube 元数据的观看页链接）
  仍可能被通用缓存管线接手——这是 B 的纵深范围，本次守卫按评审结论只认 YouTube 元数据。
* **缩略图缺失**（D）仍是并列缺陷，尚无封面、自动解析仍被 `hasThumbnail` 挡掉，应单独提任务。
