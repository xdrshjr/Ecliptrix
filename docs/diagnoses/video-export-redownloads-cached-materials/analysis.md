# 视频导出重复下载已缓存素材 — 问题定位与分析

> Bug slug: `video-export-redownloads-cached-materials`
> 关联子任务：Subtask #0（问题定位与分析）
> 作者：senior debugging engineer
> 日期：2026-06-04

---

## 1. 问题描述（Problem description）

用户反馈：视频编辑（video editing）功能的"播放/合成面板"在**导出视频**时，后端合成（composition）速度太慢。用户观察到——**即使素材在编辑器里已经在后台下载好了（卡片显示已缓存、预览能流畅播放），导出时后端仍然重新去网络上下载一遍原始素材**，导致导出耗时大幅增加。期望：导出时如果该素材已经下载好，应直接复用本地已下载文件，不再重复下载；同时不破坏正常导出功能。

核心诉求 = **导出阶段复用"后台已下载的素材"，消除重复网络下载，从而大幅提速。**

技术上，项目其实**已经存在**一套为此设计的持久化缓存（`cached_materials` 表 + `MaterialDownloadService`，引入自 commit `cc36815 perf(video-export): pre-download remote materials to a persistent cache`）。但该机制在导出链路上存在**结构性缝隙**，导致缓存命中率低、退化为重复下载。本报告定位该缝隙并给出修复方案。

---

## 2. 涉及模块（先读 CLAUDE.md / 代码索引得到的范围）

| 层 | 文件 | 角色 |
|---|---|---|
| 前端·导出入口 | `src/components/video/hooks/useVideoExport.ts` | "导出"按钮，构造合成请求 |
| 前端·URL 选择 | `src/components/video/lib/selectPlaybackUrl.ts` | 导出/预览的 URL 取值规则 |
| 前端·序列构造 | `src/components/video/timeline/infrastructure/CompositionAdapter.ts` | timeline → 合成序列 |
| 前端·后台预下载 | `src/components/video/hooks/useRemoteMaterialPrefetch.ts` + `.../infrastructure/RemoteMaterialPrefetchAdapter.ts` | 把远程素材 ingest 到服务端缓存，并轮询就绪 |
| 前端·搜索素材构造 | `src/components/video/services/videoSearchService.ts`、`src/lib/video-editing-agent/tools/searchVideo.ts` | Pexels 素材 → MaterialItem |
| 后端·导出代理路由 | `src/app/api/video-compose/route.ts` → 后端 `/api/video/compose` | 转发到合成服务 |
| 后端·合成服务 | `backend-services/basic-service/app/services/video_composition_service.py` | 真正的下载/归一化/拼接/编码 |
| 后端·素材缓存服务 | `backend-services/basic-service/app/services/material_download_service.py` | `cached_materials` 读写、查找 |
| 后端·缓存路由 | `backend-services/basic-service/app/routers/material_router.py` | `/api/material/ingest`、`/api/material/lookup` |
| 后端·数据模型 | `app/models/db_models.py`（`CachedMaterial`）、`app/models/video_models.py`（`VideoCompositionItem`） | 表结构 / 请求模型 |

---

## 3. 复现步骤（Reproduction steps）

> 前置：本地起 DB + 后端(:8000) + 前端，FFmpeg 可用（`bash start.sh` 或按 CLAUDE.md 启动）。后端日志在 `backend-services/basic-service/logs/app.log`。

### 复现 A（时序型，最易稳定复现：后台下载未完成即导出 → 重复并发下载）

1. 打开视频编辑器，搜索 Pexels，选一个较大的 HD 片段加入时间轴。
2. 在卡片缓存状态还没变成"已下载"前（或刚变成就立刻），点击"导出"。
3. 观察后端日志：

```bash
# Windows PowerShell / bash 均可，统计本次导出期间的下载
grep -nE "Downloading video:|FFmpeg download successful|Material cache:|Cache hit for" \
  backend-services/basic-service/logs/app.log | tail -40
```

4. 现象：合成服务对同一个 URL 再次执行 `_download_video`（FFmpeg 拉流），而后台 `MaterialDownloadService` 同时也在下载同一个 URL —— **同一文件被并发下载两次**，导出必须等完整下载完成后才进入归一化。

### 复现 B（身份型，结构性：编辑器显示"已下载"但导出仍重新下载）

要点：让导出时刻发送的 URL 与缓存行里存的 `source_url` **不再逐字节相等**，而 `(source, source_id)` 复合键仍然相同。最稳定的两种触发：

- **B1（CDN 查询串轮换 / 跨会话）**：加入一个 Pexels 片段，等到卡片显示"已下载"（此时缓存行 `source_url=URL_v1`）。刷新页面或重新搜索同一视频（Pexels `video_id` 不变，但 `video_url` 的签名/查询参数会变为 `URL_v2`）。编辑器侧通过 `(source=pexels, source_id=video_id)` 复合键查 `/api/material/lookup`，仍返回 `ready` → 卡片照旧显示"已下载"。点击导出。
- **B2（serverUrl≠url 取值优先级相反）**：使用任一 `serverUrl` 与 `url` 取值不同的素材（见 §4.3）。

观察：

```bash
grep -nE "Material cache:|Cache hit for|Downloading video:" \
  backend-services/basic-service/logs/app.log | tail -30
```

5. 现象：日志里 `Material cache: 0/N URLs served from cache, N require download`（命中数 < 唯一 URL 数），合成服务对"编辑器明明显示已下载"的素材再次发起 `Downloading video`。

### 验证"快慢差"的量化方法

对同一条时间轴导出两次：
- 第一次（冷缓存）记录从"发送合成请求"到完成的耗时；
- 保证后台 ingest 已 `ready` 后再导出第二次。
若两次都出现 `Downloading video:`（无 `Cache hit`），即证明缓存复用未生效，下载时间被重复支付。

> 备注：仓库现有 `logs/app.log` 中可见 25 次 `Starting video composition`、44 次 `Starting video download with retry`，但**零**条 `Material cache:` / `Cache hit for` / `Cached material ready`；且这些日志的行号指向 `_compose_video_sync:637`（当前源码该函数在 738 行），说明日志由**加入缓存功能之前**的旧版本产生，不能用于证明当前行为，但能说明历史上导出阶段确实是"逢导出必下载"。当前版本需按上面步骤现场复现验证。

---

## 4. 根因分析（Root cause analysis，含证据）

### 4.1 导出链路：导出时刻发送的是"远程原始 URL"，而非同源缓存路径

"导出"按钮在 `useVideoExport.handleExport()` 里为每个视频项取 URL：

```ts
// src/components/video/hooks/useVideoExport.ts:266
const videoUrl = material.serverUrl || material.url;
```

这与 `selectPlaybackUrl(..., {purpose:'export'})` 的约定一致——导出**故意不读** `cacheUrl`（同源 `/api/storage/files/...`），只用远程原始引用：

```ts
// src/components/video/lib/selectPlaybackUrl.ts:89-92
if (purpose === 'export') {
  // INV3 — export NEVER reads preview-proxy / media-proxy fields.
  return m.serverUrl || m.url || '';
}
```

`CompositionAdapter.extractVideoSequences` 同样如此（`finalUrl = material.serverUrl || material.url`，`CompositionAdapter.ts:105`，并显式注释 `cacheUrl` "Not used on the export composition path"）。

→ **结论**：前端把"是否复用已下载文件"的决定权完全交给了后端，后端只能凭这串远程 URL 去缓存表里反查。复用与否，取决于"这串 URL 能否在 `cached_materials` 里精确命中一条 `ready` 行"。

### 4.2 后端复用：只用"精确 URL"反查，且复合键反查在导出链路里**根本不可达**

合成服务在下载阶段做缓存查找，**仅**调用 `lookup_by_url`（精确匹配 `source_url == url`）：

```python
# backend-services/basic-service/app/services/video_composition_service.py:922-944
material_svc = get_material_download_service()
for url in unique_urls:
    cached_path = material_svc.lookup_by_url(url)   # ← 仅精确 URL
    if cached_path and os.path.exists(cached_path):
        url_to_downloaded_path[url] = cached_path   # 命中：跳过下载
    else:
        urls_to_download.append(url)                # 未命中：重新下载
```

`lookup_by_url` 的实现要求 `source_url` 逐字节相等且 `status=='ready'`：

```python
# material_download_service.py:233-250  _lookup_by_url_impl
stmt = (select(CachedMaterial)
        .where(CachedMaterial.source_url == url,
               CachedMaterial.status == "ready") ...)
```

而缓存服务其实**另有**一套抗 URL 轮换的复合键查找 `lookup_async`（优先 `(source, source_id)`，URL 仅作兜底）：

```python
# material_download_service.py:252-294  lookup_async / _lookup_impl
if source and source_id:
    stmt = select(CachedMaterial).where(
        CachedMaterial.source == source,
        CachedMaterial.source_id == str(source_id))
    ...
if row is None and url:   # 仅在复合键失败时才退回 URL
    ...
```

**关键缝隙**：`lookup_async` 被 `/api/material/lookup`、`/api/material/ingest` 使用（即**编辑器判断"已下载"走的就是这条抗轮换的复合键**，见 `material_router.py:94-103, 154`），但**导出合成链路从不使用它**。原因是合成请求模型 `VideoCompositionItem` 压根没有 `source`/`source_id` 字段：

```python
# app/models/video_models.py:103-122  —— 只有 url，没有 source / source_id
class VideoCompositionItem(BaseModel):
    id: str; name: str
    url: str                # ← 唯一的素材定位信息
    start_time: float; duration: float; track_id: str
    clip_start / clip_end / original_duration / volume / opacity ...
```

→ **结论（核心根因）**：**编辑器"已下载"状态由抗 URL 轮换的复合键查找驱动，而导出复用由脆弱的精确 URL 查找驱动，二者解耦。** 只要导出时刻的 URL 与缓存行 `source_url` 不逐字节相等，编辑器显示"已下载"、导出却判定"未缓存"，于是退化为整段网络重下 + 重编码——这正是用户看到的现象。

### 4.3 触发"URL 不相等"的若干确定性场景

1. **后台 ingest 的 key URL 与导出 URL 取值优先级相反**：
   - ingest 端 `keyFor()`：`const url = material.url || material.serverUrl || ''`（**优先 `url`**，`useRemoteMaterialPrefetch.ts:244`），ingest 据此把 `source_url` 存为 `material.url`（`RemoteMaterialPrefetchAdapter.ts:148-168` → `material_router.py:77` → `enqueue` 存 `source_url=url`，`material_download_service.py:167-177`）。
   - 导出端：`material.serverUrl || material.url`（**优先 `serverUrl`**，§4.1）。
   - 当某素材**同时**有 `serverUrl` 且与 `url` 不同 → 缓存按 `url` 存、导出按 `serverUrl` 查 → **必然 miss**。

2. **Pexels CDN 查询串/签名跨会话轮换**（复现 B1）：同一 `video_id` 的 `video_url` 在不同会话会带不同查询参数，精确 URL 失配，复合键却仍命中——导出 miss、编辑器 ready。代码注释亦明确承认这一点（`material_download_service.py:252-263`：*"Pexels (and many CDNs) rotate query params ... searching by URL alone misses the cache"*）。

3. **手动 Pexels 搜索弹窗构造的素材没有 `serverUrl`、也没有 `metadata.source/id`**：

```ts
// src/components/video/services/videoSearchService.ts:423-438
const material = { id: `pexels-${video.id}`, type:'video',
  url: video.video_url!,   // 仅 url，无 serverUrl、无 metadata.source/id
  ... };
```

   这类素材 `keyFor` 退化为 `(source='url', source_id=hashUrl(url))`，整个复合键都由 URL 派生；一旦 URL 轮换，复合键与精确 URL **同时失配**。（注意：Agent 链路 `searchVideo.ts:78` 反而设了 `source:'pexels'`，两条加素材链路行为不一致，增加了不确定性。）

4. **后台下载尚未 `ready` 即导出**（复现 A，时序型）：`lookup_by_url` 要求 `status=='ready'`；后台 ingest 还在 `downloading` 时导出 → miss → 合成服务再起一个下载，与后台下载**并发重复**。导出链路没有任何"等待/复用在途缓存"的逻辑。

### 4.4 次要放大因素：即便下载命中，导出仍做全量重编码

即使下载被复用，合成流程仍对**每个**视频无条件做一次完整归一化（缩放/补边/改帧率的 FFmpeg 重编码）：

```python
# video_composition_service.py:1085-1189  归一化（ultrafast 重编码，逐个 video）
# 之后还有：concat、音频混流 aac、字幕/图片叠加（再一次整片重编码）
```

因此"复用已下载文件"是用户明确诉求、也是远程素材为主时的**最大单项收益**，但要让导出整体"快很多"，下载复用之外还需注意这些重复编码开销（本报告作为次要项记录，主修复聚焦下载复用）。

---

## 5. 影响面（Impact surface）

- **受影响功能**：视频编辑器"导出/合成视频"（`/api/video-compose` → 后端 `/api/video/compose`）。AI 混剪、storyboard 等同样走合成服务的链路同理受影响。
- **受影响素材**：所有远程素材（Pexels、ARK 生成视频、storyboard、YouTube、去水印/静音处理后的再托管视频等），尤其是 `serverUrl≠url` 或 URL 会轮换的来源。
- **受影响用户**：所有使用在线/远程素材导出的用户；时间轴里远程片段越多、单片越大，重复下载的时间惩罚越大（线性叠加）。
- **症状**：导出耗时明显偏长、带宽被重复消耗；后台已下载/预览已流畅，但导出仍"卡在下载"。
- **正确性**：当前不影响导出结果正确性（重下的是同一资产），属于**性能/效率**缺陷；但复现 A 的并发重复下载会额外加重服务端带宽与 CPU。
- **未触发场景**：纯本地上传素材（同源路径，本就跳过下载）、`serverUrl==url` 且 URL 不轮换且后台已 `ready` 的素材——这类会命中缓存，故问题表现为"时好时坏"，更难被察觉。

---

## 6. 候选修复方案（Candidate fixes）

> 约束：本节为分析，不写修复代码；不破坏现有正常导出；改动尽量小。

| 方案 | 做法 | 侵入性 | 风险 | 工作量 | 复用稳健度 |
|---|---|---|---|---|---|
| **F1：导出请求携带 `source/source_id`，后端改用复合键查找** | 给 `VideoCompositionItem` 增加可选 `source`/`source_id`；前端 `useVideoExport`/`CompositionAdapter` 从 `material.metadata` 透传；合成服务下载前优先 `material_svc.lookup_async(url, source, source_id)`，命中即跳过下载（保留 `lookup_by_url` 作兜底） | 中（模型+前端构造+后端查找各一处） | 低（新增可选字段，未命中仍回退原下载路径，正常导出不变） | 中 | 高（与编辑器"已下载"判定对齐，抗 URL 轮换） |
| **F2：导出请求直接携带同源 `cache_url`（或 `local_path`），后端直接落盘复用** | 前端把 material 已持有的 `cacheUrl` 一并发给后端；后端将 `/api/storage/files/cached_materials/...` 安全地映射回 `STORAGE_ROOT` 下的磁盘文件，存在即直接使用、零 DB、零网络 | 中（需新增字段 + 后端路径安全校验，注意 INV3 同源约定） | 中（路径穿越/SSRF 需严格校验；前后端不同源时同源路径需正确归一） | 中 | 最高（只要编辑器已缓存即必命中） |
| **F3：对齐 URL 取值优先级 + 后端补复合键兜底（最小改动）** | 让导出与 ingest 的 URL 优先级一致（都 `url||serverUrl` 或都 `serverUrl||url`）；并在后端 `lookup_by_url` 未命中时再尝试一次"去查询参数后的规范化 URL"匹配 | 低（仅改取值顺序 + 一处规范化兜底） | 低 | 低 | 中（修掉 serverUrl≠url 与部分查询串轮换，但对 source_id 稳定型轮换仍不如复合键稳健） |
| **F4：导出前等待/复用在途后台下载** | 合成服务发现某 URL 对应缓存行处于 `pending/downloading` 时，等待其完成（带超时）再复用，而非另起并发下载；或前端导出前先确保 ingest `ready` | 中 | 中（等待逻辑需设超时与失败回退，避免拖慢） | 中 | 中（专治复现 A 的并发重复下载） |

---

## 7. 推荐方案（Recommended fix）

**推荐：以 F1 为主线，叠加 F2 的"直达命中"，并把 F4 的兜底语义合并进去。**

具体落地建议（供 Subtask #2 实现时参考）：

1. **F1（必做，主修复）**：
   - `VideoCompositionItem`（`app/models/video_models.py`）新增可选 `source: Optional[str]`、`source_id: Optional[str]`（向后兼容，缺省 `None`）。
   - 前端 `useVideoExport.ts` 构造 `videoItems` 时，从 `material.metadata.source` / `material.metadata.id`（无则 `('url', hashUrl(url))`，与 `keyFor` 保持一致）透传 `source/source_id`；`CompositionAdapter` 同步。
   - 合成服务下载前，把 §4.2 的 `material_svc.lookup_by_url(url)` 升级为：**先 `lookup_async(url=url, source=source, source_id=source_id)` 命中 `ready` 且文件存在则复用，未命中再退回 `lookup_by_url`，再不行才下载**。这样导出复用与编辑器"已下载"判定使用**同一把复合键**，从根上消除"显示已下载却重下"的缝隙。

2. **F2（建议叠加，零网络直达）**：若 material 已有 `cacheUrl`，前端可一并传 `cache_url`；后端在做任何查找前，先把同源 `/api/storage/files/cached_materials/<source>/<file>` 安全映射回 `STORAGE_ROOT/cached_materials/<source>/<file>`，存在即直接使用。务必做**路径安全校验**（限制在 `STORAGE_ROOT` 下、拒绝 `..` 穿越，复用 `app/security/url_guard.py` 的同类校验），不要破坏 INV3（导出请求 body 里不嵌入对浏览器才有意义的同源路径——这里把它当作"可选加速提示"，后端解析为磁盘路径，而非交给 FFmpeg 当 URL）。

3. **F4 语义兜底（建议）**：当复合键命中的缓存行处于 `downloading/pending` 时，合成服务**等待其完成（带超时）后复用**，避免与后台 ingest 并发重复下载（修复复现 A）。超时则回退到现有下载路径，保证正确性。

**理由**：
- F1 直接对齐"编辑器判定已下载"与"导出判定可复用"的判据，命中率从"依赖 URL 逐字节相等"提升到"依赖稳定的 `(source, source_id)`"，覆盖 §4.3 的 1/2/3 三类失配，**性价比最高、风险最低**（新增可选字段、未命中全部回退原逻辑，正常导出零行为变化）。
- F2 进一步把"已缓存素材"的导出下载耗时压到 0（连 DB 查找都省），是远程素材为主时最大提速点，但需谨慎处理路径安全与同源语义，故作为叠加项而非唯一手段。
- F3 单独使用不够稳健（对 source_id 稳定型 URL 轮换仍弱于复合键），更适合作为 F1 的"额外兜底"，可顺带把 ingest/导出的 URL 优先级统一，消除 serverUrl≠url 的确定性 miss。
- F4 解决时序型并发重复下载，是对"已下载才复用"的合理补全。

**不破坏正常导出的保证**：所有方案均为"命中则跳过下载、未命中则走原下载路径"，下载/归一化/拼接/编码主流程保持不变；新增字段全部可选，旧客户端/旧请求继续工作。

---

## 8. 证据索引（便于 Subtask #1 评审复核）

- 导出发送远程 URL，不读 cacheUrl：`src/components/video/hooks/useVideoExport.ts:266`；`src/components/video/lib/selectPlaybackUrl.ts:89-92`；`src/components/video/timeline/infrastructure/CompositionAdapter.ts:105,118-122`
- 导出复用仅精确 URL：`backend-services/basic-service/app/services/video_composition_service.py:922-944`（`lookup_by_url`），`material_download_service.py:233-250`
- 抗轮换复合键查找存在但导出不可达：`material_download_service.py:252-294`（`lookup_async`）；被 `material_router.py:94-103,154` 使用（编辑器侧）；合成请求模型无 source/source_id：`app/models/video_models.py:103-122`
- ingest 与导出 URL 优先级相反：`useRemoteMaterialPrefetch.ts:244-257`（`url||serverUrl`）vs `useVideoExport.ts:266`（`serverUrl||url`）；ingest 存 `source_url=url`：`RemoteMaterialPrefetchAdapter.ts:148-168` → `material_router.py:66-130` → `material_download_service.py:141-205`
- CDN 查询串轮换的官方注释：`material_download_service.py:252-263`
- 手动 Pexels 弹窗素材缺 serverUrl/metadata：`src/components/video/services/videoSearchService.ts:423-438`；Agent 链路设了 source：`src/lib/video-editing-agent/tools/searchVideo.ts:78`
- 后台预下载已在编辑器挂载：`src/components/video/hooks/useMaterialManagement.ts:1171`
- 缓存功能引入提交：`git show cc36815`（`perf(video-export): pre-download remote materials to a persistent cache`）
- 旧日志佐证历史上"逢导出必下载"：`backend-services/basic-service/logs/app.log` 中 `Starting video composition`×25 / `Starting video download with retry`×44 / `Material cache:`×0（且行号 `_compose_video_sync:637` 对应旧版本，当前为 738 行）

---

## 9. 评审结论段（Subtask #1 已填写）

> 评审人已逐条核对 §4 根因证据、§7 推荐方案，并独立重读全部被引用代码。完整结论见文末 **「## 评审结论（Review Verdict — Subtask #1）」**。此处给出速览：

- [x] **根因证据复核结论**：§4.1 / §4.2 的结构性根因 **成立且证据链闭合**——已实测确认导出/合成链路 **仅** 调用精确 URL 的 `lookup_by_url`（`video_composition_service.py:931`），抗轮换复合键 `lookup_async` 在导出链路 **完全不可达**（仅被编辑器 `material_router.py:94,154` 与预览 `media_proxy_service.py:489` 调用），且 `VideoCompositionItem`（`video_models.py:103-122`）确无 `source/source_id` 字段。§4.3 的四类失配触发场景均可复核。
- [x] **推荐方案确认 / 调整**：维持「F1 为主线 + F2 直达 + F4 兜底」的总方向，但 **必须修正一处会让 F1 沦为空操作的实现细节**（见下）。最终单一推荐方案见文末评审结论。
- [x] **补充的代码 / 日志引用**：评审新增三项原报告 **遗漏** 的关键证据（`keyFor` 字段名错配 `sourceId` vs `id`、手动弹窗素材零 metadata、write-through 无 `source_id`），均带可验证行号，详见文末评审结论的「§A 补充证据」。

---

## 评审结论（Review Verdict — Subtask #1）

> 评审人：senior reviewer（Anthropic engineering）。日期：2026-06-04。
> 方法：不依赖原报告结论，逐文件重读全部被引用代码并核对行号；对根因「是否真在失败路径上执行」「有无反例 / 替代解释」「证据能否解释症状」三问逐一证伪；对候选修复审查边界（并发 / 错误路径 / 边缘输入）、最小性与回归风险。

### 0. 总体裁决（TL;DR）

- **根因成立、证据链闭合**：导出复用判据（精确 URL `lookup_by_url`）与编辑器「已下载」判据（复合键 `lookup_async`）**解耦**，且复合键查找在导出链路 **物理上不可达**。这是结构性缺陷，不是偶发。
- **但原报告的修复方案存在一处致命实现盲点**：若按 §7 字面「前端从 `material.metadata.source / material.metadata.id` 透传」，对 **100% 的生产 Pexels 素材都取不到 `source_id`**（生产 producer 写的字段是 `metadata.sourceId`，而读取方只认 `metadata.id` / `video_id`）——F1 会退化为「只对同一素材、同一 URL 才命中」的弱版本，无法覆盖用户最痛的 URL 轮换场景。**此盲点必须在 Subtask #2 一并修掉，否则修复等于没改。**
- **最终单一推荐方案**：见 §D。

---

### A. 补充证据（原报告遗漏，均已实测核对行号）

#### A1. `keyFor` 字段名错配：生产链路的复合键其实是「URL 派生」，而非稳定 `video_id`（关键遗漏）

- **生产 producer 写 `sourceId`（驼峰）**：
  - `src/lib/video-editing-agent/tools/searchVideo.ts:77-80` → `metadata: { source: 'pexels', sourceId: String(video.id) }`
  - 同模式：`searchImage.ts:74`（`sourceId`）、`searchAudio.ts:65`（`sourceId`）。
- **消费方 `keyFor` 只认 `id` / `video_id`，不认 `sourceId`**：
  ```ts
  // src/components/video/hooks/useRemoteMaterialPrefetch.ts:246-251
  const metaSourceId =
    typeof meta.id === 'string' || typeof meta.id === 'number' ? String(meta.id)
      : typeof meta.video_id === 'string' || typeof meta.video_id === 'number' ? String(meta.video_id)
      : '';              // ← 读 meta.id / meta.video_id，永远读不到 producer 写入的 meta.sourceId
  // :252-257  source='pexels' 但 metaSourceId='' → if(source && metaSourceId) 为假 → 落回:
  return { source: 'url', source_id: hashUrl(url), url };
  ```
- **单测用的是 `id`，所以「绿灯但与生产不符」**：`src/components/video/hooks/__tests__/useRemoteMaterialPrefetch.test.ts:22` 注入 `metadata: { source: 'pexels', id: '12345' }`，第 146 行用例名「falls back to url-derived source_id when no metadata.id」——测试覆盖的是 `id` 字段，而真实 producer 从不写 `id`。
- **全仓核查**：`grep metadata.(id|video_id|sourceId|source)` 仅命中「3 个 Agent producer 写 `sourceId`」「`keyFor` + 测试读 `id`」，**无任何处把 `sourceId` 归一化为 `id`/`video_id`**。即生产中 **没有** 代码把真实 `video_id` 送进复合键。
- **推论（修正原报告 §4.2 / §4.3.2 的措辞）**：原报告称「编辑器'已下载'由抗 URL 轮换的复合键驱动」——这在生产中 **只半真**。编辑器 `/api/material/{ingest,lookup}` 确实走 `lookup_async(source,source_id)`（`material_router.py:94,154`），但 **前端送进去的 `(source,source_id)` 已被 `keyFor` 退化为 `('url', hashUrl(url))`**，所以 DB 里存的复合键本身就是 URL 派生的、并不抗轮换。
  - **直接影响 §4.3.2（复现 B1）的可信度**：若复合键真是 URL 派生，则 URL 轮换时 **编辑器侧也会 miss**（卡片可能不再显示「已下载」），「编辑器 ready / 导出 redownload」的强不对称在生产里未必稳定成立。**真正最稳健、最常态的根因其实是 §4.1/§4.2（导出只会精确 URL 反查）叠加 §4.3.1（serverUrl≠url）与 §4.3.4（未就绪即导出）**，这三者不依赖复合键是否稳定即成立。建议 Subtask #2 复现时以 B2/复现 A 为主、B1 为辅。
- **对修复的硬约束**：F1 的前端取数 **绝不能** 临时写 `material.metadata.id`（生产恒为 `undefined`），**必须复用同一个 `keyFor`（或抽出共享 helper）作用在同一 material 对象上**，保证 ingest 与导出产出 **逐字节相同** 的 `(source, source_id)`；并 **同时修掉字段名错配**（让 `keyFor` 读 `sourceId`，或让 producer 改写 `id`，二选一并补一条用生产字段名的回归测试），才能让真实 `video_id` 进入复合键、获得真正的抗轮换能力。

#### A2. 手动 Pexels 搜索弹窗素材：连 metadata 都没有（佐证原报告 §4.3.3，且更严重）

```ts
// src/components/video/services/videoSearchService.ts:423-438
const material = { id:`pexels-${video.id}`, type:'video', url: video.video_url!, ... };
// 整个对象无 metadata 键 → keyFor 落回 ('url', hashUrl(url))
```
两条加素材链路（手动弹窗 / Agent 工具）的复合键 **在生产中其实殊途同归地退化为 URL 派生**——一条因为没有 metadata，另一条因为字段名错配。这进一步说明：**仅靠 F1 透传 `metadata` 并不可靠，cacheUrl 直达（F2）才是不受这套 metadata 烂账影响的可靠快路径。**

#### A3. 导出 write-through 不带 `source_id`，且其去重兜底与主 Bug 同源脆弱

```python
# video_composition_service.py:966-976  下载成功后写回缓存
inferred_source = "pexels" if self._is_pexels_url(url) else ("youtube" if ... else "url")
material_svc.store_external_download(url=url, local_path=downloaded_path, source=inferred_source)  # ← 无 source_id
```
```python
# material_download_service.py:368,402  无 source_id → 用 _fallback_id(url)（URL 派生）落键
cached_path = self._target_path(source, source_id or self._fallback_id(url), url)
...
source_id=str(source_id or self._fallback_id(url)),
```
- write-through 落键为 `(inferred_source, _fallback_id(url))`，与编辑器 ingest 落键 `('url', hashUrl(url))` **连 `source` 都不同**（`'pexels'` vs `'url'`）。
- write-through 虽有一段 `source_url` 兜底去重（`material_download_service.py:386-398`：当复合键查不到时再按 `source_url` 找现有行复用），**但它依赖 URL 逐字节相等**——而需要去重的恰恰是 `serverUrl≠url` / URL 轮换的场景，此时 `source_url` 也不等 → 去重失败 → **缓存表里为同一物理资产堆积重复行 + 磁盘重复文件**。
- **结论**：write-through 的存在不影响导出 **正确性**，但它既没帮编辑器命中、也没自我去重；F1 落地时应 **把 `source/source_id` 一并透传给 `store_external_download`**，让写回键与 ingest 键对齐。

#### A4. 导出链路 lookup 调用点普查（坐实 §4.2「复合键不可达」）

| 调用点 | 用的查找 | 是否携带复合键 |
|---|---|---|
| `video_composition_service.py:931`（**导出/合成**） | `lookup_by_url`（精确 URL，同步） | ❌ 仅 url |
| `material_router.py:94`（编辑器 ingest） | `lookup_async` | ✅ source+source_id |
| `material_router.py:154`（编辑器 lookup） | `lookup_async` | ✅ source+source_id |
| `media_proxy_service.py:489`（预览代理） | `lookup_async(url=...)` | ⚠️ 仅 url |

导出链路 **唯一** 的缓存查找就是 `lookup_by_url`，`lookup_async` 在该链路确无调用——§4.2 核心论断 **实测成立**。

#### A5. 证据校正（不影响结论的行号订正）

- §3 备注称 `_compose_video_sync` 当前在「738 行」——实际 `def _compose_video_sync` 在 `video_composition_service.py:732`（其调用点在 711）。偏差 6 行，不影响「旧日志产自加缓存功能之前」的判断。
- §4.2 引用 `_lookup_by_url_impl` 在 233-250、`lookup_async/_lookup_impl` 在 252-294——**逐行核对一致**。`VideoCompositionItem` 无 `source/source_id` 在 `video_models.py:103-122`——**一致**。`useVideoExport.ts:266`、`selectPlaybackUrl.ts:89-92`、`CompositionAdapter.ts:105,118-122`、`useRemoteMaterialPrefetch.ts:244`、`RemoteMaterialPrefetchAdapter.ts:148-168`——**全部核对属实**。

---

### B. 根因审计（三问证伪）

1. **被引代码是否真在失败路径上执行？** 是。导出必经 `_download_video...` 前的缓存查找，该查找只有 `lookup_by_url`（931），对 `serverUrl≠url` / URL 轮换 / 未就绪三类输入 **确定性 miss** → 进入 `_download_video_with_retry`（947-952）真实重下。
2. **有无反例 / 替代解释？** 已排查并纳入：(a) 复合键在生产里其实是 URL 派生（A1）——这削弱的是 B1 的不对称叙事，但 **不削弱根因**，反而把根因更牢地锁定在「导出只做精确 URL 反查」本身；(b) 纯本地上传素材（同源路径）本就跳过下载，不在受影响面（§5 已述，正确）。无证据指向「FFmpeg/编码慢」是 **下载重复** 的替代解释——§4.4 的重编码是 **并列的次要开销**，非本 Bug 主因。
3. **证据能否解释症状？** 能。「卡片已下载 / 预览流畅，但导出仍卡在下载」= 预览走 `cacheUrl`/proxy 同源命中，而导出走远程 URL + 精确反查 miss → 重下。症状与代码路径一一对应。

**根因裁决：成立（confirmed），证据链闭合。** 唯一需修正的是叙述层面——把「编辑器复合键抗轮换」从「已实现」降级为「设计意图，但因 A1 字段错配在生产中未生效」。

---

### C. 候选修复审计（边界 / 最小性 / 回归）

- **F1（复合键，主线）**：方向正确且向后兼容（新增可选字段，miss 全回退原逻辑 → 正常导出零行为变化）。**但 §7 的取数写法有致命盲点（A1）**：必须复用 `keyFor` 共享 helper + 修字段名错配，否则对生产 Pexels 素材为空操作。边界：未命中、文件被清理、`source_id` 缺失均应安全回退到 `lookup_by_url` → 下载。
- **F2（cacheUrl 直达）**：**可靠度最高且不受 A1/A2 metadata 烂账影响**——卡片 `cacheStatus==='ready' && cacheUrl` 时，同源磁盘文件即权威，后端把 `/api/storage/files/cached_materials/<source>/<file>` 还原为 `STORAGE_ROOT/...` 直接用，省 DB 省网络。**必须做路径安全**：`realpath` 限定在 `STORAGE_ROOT/cached_materials` 子树内、拒绝 `..` 与软链逃逸、文件存在性校验，否则任意一项失败即回退查找/下载。**纯本地磁盘路径，无 SSRF**。跨源部署下该前缀对浏览器同源、对后端按前缀剥离映射，**与 origin 无关**。须遵守 INV3：把它作为 **可选加速 hint 字段**（如 `local_path`/`cache_url`）由后端解析为磁盘路径，**绝不写进 `url`、绝不当 URL 喂给 FFmpeg**。
- **F3（对齐 URL 优先级 + 规范化兜底）**：可作为 F1 的 **附加兜底**，单独使用对「source_id 稳定型轮换」弱于复合键，不应作主线（与原报告判断一致）。
- **F4（在途等待）**：专治复现 A 的并发重复下载。边界：**必须带超时 + 失败回退**（命中 `downloading/pending` 行时等待其转 `ready` 再复用，转 `failed` 或超时则走原下载路径），且不可在 `ThreadPoolExecutor` worker 里无限阻塞。属合理补全。
- **最小性判断**：单看「修掉确定性 miss」的最小改动是 F3；但 F3 不能稳健解决轮换 + 完全不解决时序并发。**「F1（含 A1 修正）+ F2 + F4」是『稳健修复』的最小集**——每一项都「命中则跳过、未命中回退原逻辑」，互不破坏正常导出。
- **回归风险**：(a) 新字段全可选，旧请求/旧前端继续工作；(b) 命中与否都指向同一物理资产，结果字节一致；(c) 唯一真实风险点是 F2 的路径穿越——用严格 `realpath` 限域消解；(d) F4 的等待死锁——用超时 + `failed` 回退消解。

---

### D. 最终单一推荐修复（Definition of Done 要求的「single recommended fix」）

**推荐方案：以 F1 为骨架的「复合键复用」，并将 A1 字段名修正作为其不可分割的前提；F2 作为首选零成本快路径、F4 作为并发护栏一并落地。** 一句话：**让导出链路带上与编辑器同源的复合身份并能直接复用已下载文件，后端从「精确 URL 反查」升级为「复合键 + 磁盘直达 + 在途等待」三级命中、未命中再回退原下载。**

落地清单（交 Subtask #2，按优先级）：

1. **【前提·必做】修 `keyFor` 字段名错配**：让 `keyFor`（`useRemoteMaterialPrefetch.ts:246-251`）读取 producer 实际写入的 `metadata.sourceId`（兼容保留 `id`/`video_id`），或反向统一 producer 写 `id`；并新增一条 **用生产字段名** 的回归测试。否则 F1 对生产 Pexels 素材无效。
2. **【F1·主线】** `VideoCompositionItem`（`video_models.py:103-122`）新增可选 `source`/`source_id`；前端 `useVideoExport.ts:266` 区与 `CompositionAdapter.ts:105` 区 **复用同一个 `keyFor` 共享 helper** 透传 `(source, source_id)`（不得临时读 `metadata.id`）；后端把 `video_composition_service.py:931` 的 `lookup_by_url(url)` 升级为「先 `lookup_async(url,source,source_id)` 命中 `ready` 且文件存在则复用 → 否则 `lookup_by_url` → 再否则下载」。
3. **【F2·首选快路径】** material 已有 `cacheUrl` 时随导出请求带一个可选磁盘 hint；后端在任何 DB 查找前先把同源 `cached_materials` 路径 **安全映射** 回 `STORAGE_ROOT` 下磁盘文件（`realpath` 限域、拒 `..`/软链、存在性校验），存在即直接用（零 DB 零网络）。守 INV3。
4. **【F4·并发护栏】** 命中行处于 `downloading/pending` 时，带超时等待其 `ready` 后复用；超时/`failed` 回退原下载。
5. **【收尾】** 导出 write-through `store_external_download`（`video_composition_service.py:970`）**透传 `source/source_id`**，与 ingest 键对齐，消除重复缓存行（A3）。
6. **【范围外】** §4.4 的「逐片重编码」属并列的次要性能项，**本次不动**，以「不破坏正常导出」为先；如需另立任务优化（如可流式拼接/避免无谓 re-encode）。

**为何是这一套而非别的**：
- F1 在「导出只有 url、后端只做精确反查」的确切缝隙处闭环，改动小、向后兼容、失败安全；但 **A1 不修则 F1 名存实亡**，故二者绑定为同一修复。
- F2 是 **唯一不依赖 metadata/source_id 推导即可保证命中** 的路径——卡片已 ready 即权威，且把「DB+网络」压成一次 `stat()`，是远程素材为主时 **最大单项提速点**。
- F4 收掉「未就绪即导出」的并发重下（复现 A 最稳定可复现），是「已下载才复用」的语义补全。
- 三者皆「命中跳过 / 未命中回退」，对正常导出 **零行为变化**，满足「不破坏正常导出」硬约束。

**验收标准（供 Subtask #2 / #3 核对）**：
1. 跨会话重搜同一 Pexels 视频（URL 轮换）后导出 → 日志出现 `Material cache: N/N ... 0 require download`，无 `Downloading video`。
2. `serverUrl≠url` 素材导出 → 命中缓存、不重下。
3. 后台仍在下载时点导出 → 全程 **单次** 下载，导出复用之，无并发重复。
4. 新增回归测试：用 **真实 producer 字段名** 构造的 Pexels material，`keyFor` 返回 `(pexels, <video_id>)` 而非 `('url', hash)`。
5. 向后兼容：不带 `source/source_id` 的合成请求仍能正常导出。
6. 正常导出正确性不变：固定时间轴导出产物长度/校验一致。

---

## 实施过程发现的方案缺陷（Issues Found During Implementation — Subtask #2）

> 实施人：senior fix-implementation engineer。日期：2026-06-04。
> 结论：根因与三级命中主体方案成立并已落地；仅对 §D 落地清单第 2 条里「同时改 `CompositionAdapter.ts:105`」做了一处**范围收缩**，理由如下，属「方案细节多余/会引入回归」而非根因错误。

### I1. `CompositionAdapter` 不在后端导出链路上，§D「改 CompositionAdapter.ts:105 透传 source/source_id」应剔除

- **实测**：真正发往后端 `/api/video/compose` 的导出请求 **唯一** 由 `useVideoExport.handleExport()` 构造（`video_items` 形状，`useVideoExport.ts:290+`）。`CompositionAdapter.extractVideoSequences/buildCompositionRequest` 产出的是 **`video_sequences`** 形状，仅被：
  - `useTimelineComposition.ts:34,60,67` 用于 **浏览器内合成预览播放**（`compositionPlayback` 状态，不发后端）；
  - 三个 **测试文件** 调用 `buildCompositionRequest`（`CompositionAdapter.exportPath.test.ts` / `CompositionAdapter.cacheUrl.test.ts` / `cachePlayback.integration.test.ts`），生产代码无任何调用。
- **若按字面改它的风险**：`CompositionAdapter.exportPath.test.ts` 明确断言 `video_sequences[0].url` **不得含** `cached_materials` / `/api/storage/files`（守 INV3）。往该路径塞 `cache_url`/同源字段会与既有 INV3 守护测试冲突，且对真实导出毫无收益。
- **决策（最小化 + 不破坏正常导出）**：F1/F2 的前端透传 **只落在真实导出路径 `useVideoExport.ts`**；`CompositionAdapter.ts` **不改**。`keyFor` 字段名修正改为「抽出共享 helper `src/components/video/lib/materialKey.ts`，由 `useRemoteMaterialPrefetch`(ingest) 与 `useVideoExport`(export) 共用」，确保 ingest 键与 export 键逐字节一致——这正是 §D 第 1/2 条「复用同一 keyFor 共享 helper」的本意，只是共享点落在 ingest↔export 两端而非 CompositionAdapter。

### 实际落地清单（与验收标准映射）

1. **新增** `src/components/video/lib/materialKey.ts`：共享 `materialCompositeKey()`（读 `metadata.sourceId`→`id`→`video_id`，修 §A1 字段名错配）+ `hashUrl()`。
2. `useRemoteMaterialPrefetch.ts`：`keyFor` 改为复用共享 helper（ingest 键现含真实 `(pexels,<video_id>)`）。
3. `useVideoExport.ts`：每个视频项透传 `source/source_id`(共享 helper) + `cache_url`(material.cacheUrl)；`url` 仍为 `serverUrl||url`（守 INV3）。
4. `src/lib/api/videoComposition.ts`：`VideoCompositionItem` 增可选 `source/source_id/cache_url`。
5. 后端 `video_models.py`：`VideoCompositionItem` 增可选 `source/source_id/cache_url`（向后兼容）。
6. 后端 `material_download_service.py`：新增 `resolve_cached_path()`（F2 `cache_url`→磁盘，限域校验；F1 复合键 `lookup_async`；F4 在途 `downloading/pending` 带超时等待）+ `_resolve_cache_url_to_disk()` + `_resolve_cached_path_impl()`；超时可经 `MATERIAL_REUSE_WAIT_TIMEOUT_SECONDS` 配置（默认 120s）。
7. 后端 `video_composition_service.py`：构建 `url_to_meta` 映射；缓存查找改用 `resolve_cached_path()`（未命中再退回 `lookup_by_url()` 兜底，再下载）；write-through 透传 `source/source_id` 对齐 ingest 键（修 §A3）。
8. `useRemoteMaterialPrefetch.test.ts`：新增「真实 producer 字段名 `sourceId`」回归测试（验收标准 #4）。

`§4.4` 逐片重编码按 §D 第 6 条保持 **范围外**，未改。
