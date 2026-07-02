# YouTube 搜索结果左侧预览「请登录」问题修复 — 设计方案

- **Feature slug**: `youtube-preview-stream-proxy`
- **文档版本**: v2（方案评审与修复）
- **作者**: Subtask #0 方案设计（Anthropic 工程团队 · 解决方案架构师）
- **评审**: Subtask #1 方案评审与修复（Anthropic 工程团队 · 资深评审）
- **状态**: 已评审（有条件通过，交付给 Subtask #2 代码开发）
- **关联需求**: 用户在「YouTube 视频库」搜索视频后，点击某个搜索结果想在左侧预览面板预览时，面板中显示 YouTube 的反机器人拦截页「请登录，以便我们确定你不是聊天机器人」（英文原文 *Sign in to confirm you're not a bot*），导致无法预览。需要让用户搜索之后能在左侧正确预览其选中的视频。

---

## 评审记录（Review Notes · Subtask #1）

> 评审维度：可行性 / 完整性 / 一致性 / 合理规模。已逐一核对方案引用的全部代码坐标——`createPassthroughRoute` 的 `streaming/forwardHeaders/responseHeaderAllowlist`（与 `src/app/api/storage/files/[...path]/route.ts` 同款）、`youtube_service` 的 `self.proxy`/`_get_robust_ydl_options`/`search_videos`、`media_proxy_service` 的 `httpx` + Range 转发范式、`youtube_router` 于 `app/main.py:509` 以 `prefix="/api"` 注册（故 `/preview/stream` → `/api/youtube/preview/stream`）、`requirements.txt` 的 `httpx==0.28.1` 与 `yt-dlp>=2024.9.27`、`config.youtube_proxy`（@557/@1030）、`VideoSearchModal` 的 YouTube `<iframe>` 分支（约 464-488 行）与可复用的缩略图 fallback 块（约 528-541 行）、`i18n.ts` 的 `videoSearchModal` 结构——**均属实，方案整体可行**。根因定位（iframe 内嵌播放器触发反机器人，与 yt-dlp 链路无关；搜索/下载走 yt-dlp+代理已工作）**成立**。逐节问题清单如下：

| 编号 | 维度 | 严重级 | 问题 | 处理 |
|------|------|--------|------|------|
| P1-1 | 可行性 | **P1** | 回代 googlevideo 直链时必须使用「所选 format 的 `http_headers`」（`fmt['http_headers']`），而非 `_get_robust_ydl_options` 顶层硬编码的桌面 Chrome UA。`player_client=['android',...]` 抽出的直链常要求匹配的 UA/头，用错头会在**字节回代阶段 403**——extract 成功、预览仍黑屏/失败，happy path 静默失效。附带坑：`_get_robust_ydl_options` 用 `robust_opts.update(base_opts)` **浅合并**，preview 若想覆盖 `extractor_args` 会整体替换、丢掉 `skip=['hls','dash']`。 | **已修复**：§2.2 / §2.4 步骤3 / §8 均补充：回代用 format 级 `http_headers`；progressive 优先 web/ios 客户端；覆盖 `extractor_args` 须深合并或另建 opts。 |
| P1-2 | 完整性 | **P1** | 文件清单 #6 仅写「新增中英文案键」，但 `src/lib/i18n.ts` 实为 **1 个 `Translations` 类型接口**（`videoSearchModal` @762）**+ 2 个语言值对象**（en @3089 / zh @5419）。只改值对象不改类型接口，`t.videoSearchModal.previewUnavailable` 会 `type-check` 报错，直接违反 §6.2 验收门槛。 | **已修复**：§3 文件清单 #6 明确「三处同改：接口 762 + en 3089 + zh 5419」。 |
| P2-1 | 完整性 | P2 | progressive 合流可用性比「个别视频」更常见地缺失：大量视频不再提供 itag 22（720p 合流），仅 itag 18（360p）稳定；直播/年龄限制/部分音乐视频可能**无任何 progressive**。核心价值主张对长尾会退化为 360p 或降级。 | **已澄清（可接受）**：§7 R3 明确「多数视频预览为 360p、长尾降级为缩略图」为满足需求的验收口径，非缺陷；DASH remux 列未来增强。 |
| P2-2 | 完整性 | P2 | 快速切换预览 / 关闭弹窗会中断 `<video>` 请求，后端流式生成器需在 GeneratorExit / 断连时关闭 httpx client。§8 的 `async with ... finally aclose` 已覆盖，但未点名「断连清理」；叠加 R6 并发信号量被降为可选，而快速切换恰是主交互路径。 | §8 已补断连清理提示；**建议本期落地 R6 信号量**（见评审结论条件 3）。 |
| P2-3 | 一致性 | P2 | CLAUDE.md 约定：preview-proxy / media-proxy 等「仅预览」URL 不得写入合成/导出请求。新 `/api/youtube/preview-stream` 属仅预览 URL。 | 方案 §9 已将「加入合成」（走 `download-and-upload`）与预览解耦，一致；§9 已补一句显式约束。 |
| P2-4 | 可行性 | P2 | §8 landmine `follow_redirects=True` 较 `media_proxy_service`（`False`，SSRF 加固）宽松。googlevideo 边缘节点确有 302 需 True，但应记录理由。 | §8 已记录取舍：直链源自 yt-dlp 解析（非用户输入）且经受信代理，接受 `follow_redirects=True`。 |

**结论摘要**：无 P0；2 个 P1 已在正文就地修复，文档升至 **v2**；4 个 P2 转为落地条件/开发注意（见文末评审结论）。

---

## 1. Overview（概述）

Ecliptrix 是一个 Next.js 15 前端 + FastAPI 后端的本地桌面（Electron 打包）AI 内容创作平台。视频编辑器里有一个「视频搜索」弹窗（`VideoSearchModal`），支持「官方视频库」和「YouTube 视频库」两个页签。用户在 YouTube 页签搜索关键词、点击某条搜索结果时，弹窗左栏的「视频预览」区域会尝试播放该视频。

**问题根因**：当前 YouTube 预览是通过一个 `<iframe>` 直接嵌入 YouTube 官方内嵌播放器实现的：

```tsx
// src/components/video/components/VideoSearchModal/VideoSearchModal.tsx  (约 461-488 行)
<iframe
  src={`https://www.youtube.com/embed/${currentPreviewVideo.id}?autoplay=0&controls=1&modestbranding=1&rel=0`}
  ... />
```

YouTube 的内嵌播放器是一个黑盒：它在服务端做反自动化/反机器人判定，当请求来自数据中心 IP、被标记的 IP、或某些地区网络（本项目是运行在中国大陆网络下的桌面应用，且常经代理/机场出网）时，会用「请登录，以便我们确定你不是聊天机器人」的验证页替换视频内容。我们无法在 iframe 内注入 YouTube 登录态/consent cookie，也无法绕过该服务端挑战，因此**基于 iframe 内嵌播放器的预览方式对本应用天然不可靠**，这正是用户看到该提示的原因。

**关键洞察**：本应用后端「其实已经能可靠地访问 YouTube」——搜索（`youtube_service.search_videos`）、下载并入库（`download_and_upload_video`）都走 `yt-dlp` + 可配置的 `YOUTUBE_PROXY` 代理 + 多客户端（android/web/ios）抽取，这条链路是工作的。所以本方案的核心思路是：**把预览也改走后端 yt-dlp 链路，而不是让浏览器去请求 YouTube 的内嵌播放器**。

**方案一句话**：新增一个后端「渐进式流」端点，用 `yt-dlp` 解析出该视频的直连渐进式（音视频合流）MP4 地址，再由后端把字节流经代理回代给前端（支持 HTTP Range 206，可拖动进度、秒开），前端把 YouTube 预览从 `<iframe>` 换成原生 `<video>` 指向该同源端点。浏览器全程只与本地后端通信，YouTube 只面对已经能工作的 `yt-dlp`，从而彻底规避内嵌播放器的反机器人挑战。当后端解析仍失败（例如未配代理且直连不通）时，前端优雅降级：显示缩略图 + 「预览不可用」提示 + 「在浏览器中打开」原始链接。

本方案完全复用仓库既有基建与约定：`youtube_service` 的 robust yt-dlp 选项与 `youtube_proxy`；`media_proxy_router` 已实现的 Range 206 流式代理范式；`createPassthroughRoute({ streaming, forwardHeaders, responseHeaderAllowlist })` 已被 `storage/files/[...path]` 用于视频 Range 透传的同源代理范式。不引入新的第三方依赖。

---

## 2. Technical design（技术设计）

### 2.1 为什么必须「后端回代字节」而不是「重定向到 googlevideo 直链」

`yt-dlp` 抽取得到的真实媒体地址是 `*.googlevideo.com` 的签名 URL，具有三个限制：

1. **IP 锁定**：该直链绑定「抽取时的出网 IP」。当配置了 `YOUTUBE_PROXY` 时，抽取出网 IP 是代理出口 IP，而**不是**浏览器所在网络。浏览器直接去拉会 403。
2. **短时效**：签名 URL 约 6 小时过期。
3. **CORS/跨域**：浏览器 `<video>` 跨域拉取会受限。

因此后端必须自己发起对 googlevideo 的请求（经同一个 `YOUTUBE_PROXY`），把字节流回代给前端；前端 `<video>` 只面对本地同源地址。这与 `media_proxy_service` 已采用的「同源流式代理」思路一致（`media_proxy_service.py` 已用 `httpx.AsyncClient` + Range 转发实现，只是它的 host 白名单不含动态 googlevideo host，故此处新开一条 YouTube 专用链路）。

### 2.2 预览用的格式选择（progressive / 合流 MP4）

浏览器原生 `<video>` 需要「单文件、音视频合流」的可直接播放格式。YouTube 高清多为 DASH（音视频分离，需 MSE/ffmpeg 合成，太重，不适合预览）。因此预览端明确**只选渐进式合流 MP4**：

- yt-dlp `format` 选择器（按优先级回退）：
  `best[ext=mp4][acodec!=none][vcodec!=none][height<=720]/22/18/best[acodec!=none][vcodec!=none]/best`
  - `itag 18` = 360p mp4 合流（几乎所有视频都有、体积小、秒开），作为最稳的兜底；
  - `itag 22` = 720p mp4 合流。
- 复用 `_get_robust_ydl_options` 里已有的 `extractor_args.youtube.skip=['hls','dash']` 与 `player_client=['android','web','ios']`，天然避开 nsig/DASH 问题。
- 预览默认走「适中画质」（≤720p，优先 360p 秒开），不追求原画；「加入合成」时仍走原有 `download-and-upload` 高质量下载路径，两者互不影响。

> **【v2 评审修复 · P1-1，可行性关键】播放器客户端与直链可用性**
> - `_get_robust_ydl_options` 顶层 `player_client=['android','web','ios']` 主要为**搜索/元数据**的鲁棒性而设。但 **android 客户端解析出的 googlevideo 直链**在字节回代播放时对 UA/头更敏感、且日益需要 PO Token，直接回代常 403。**预览解析（`resolve_preview_stream`）应优先取 `web`/`ios` 客户端产出的 progressive 合流格式**（itag 18/22），它们的直链用配套 `http_headers` 即可稳定回代。
> - progressive 合流可用性现实：**itag 18（360p mp4 合流）对绝大多数普通视频稳定存在**，是本方案「秒开兜底」的立足点；itag 22（720p）对大量视频已不再提供，故 720p 视为「有则用、无则退 360p」。直播/年龄限制/个别音乐视频可能无任何 progressive → 走 502 + 前端降级（见 §7 R3）。
> - **不要盲目复用 `_get_robust_ydl_options` 来覆盖 `extractor_args`**：该函数用 `robust_opts.update(base_opts)` **浅合并**，传入 `base_opts={'extractor_args': {...}}` 会**整体替换** `extractor_args`、丢掉 `skip=['hls','dash']`。preview 若要调整客户端，应对 `extractor_args.youtube` 做**深合并**，或为 preview 单独构造一份 opts（保留 `skip`、`proxy`、`socket_timeout`）。

### 2.3 解析结果的 TTL 缓存

`yt-dlp` 解析一次约 1–5s，且同一 `<video>` 在 Range 播放/拖动时会发起多个顺序请求。若每个 Range 请求都重新解析，不仅慢，还会因每次签名 URL 不同导致 `Content-Length`/字节对齐在多段之间漂移。故：**按 `video_id` 缓存解析结果 `(stream_url, http_headers, content_type, filesize, expire_at)`**，TTL 取保守值（如 3600s，短于真实 6h 过期），进程内内存字典即可（本项目单用户本地应用，无需分布式缓存）。同一视频的所有 Range 请求复用同一签名 URL，保证 `Content-Range: bytes X-Y/total` 一致。

### 2.4 端到端时序（sequence of operations）

```
用户在 YouTube 页签点击某搜索结果
  → 前端 setYoutubePreviewVideo(video)（既有逻辑，不变）
  → VideoSearchModal 渲染 <video src="/api/youtube/preview-stream?video_id={id}" controls>
  → 浏览器发 GET /api/youtube/preview-stream?video_id=... (带 Range: bytes=0-)
  → Next.js BFF (createPassthroughRoute, streaming) 透传到
       GET {BACKEND_URL}/api/youtube/preview/stream?video_id=...  (透传 Range 请求头)
  → 后端 youtube_router.preview_stream:
       1) 校验 video_id 形如 ^[A-Za-z0-9_-]{11}$（拒绝任意 URL / 路径穿越）
       2) resolve_preview_stream(video_id)：命中 TTL 缓存则直接用；
          否则线程池跑 yt-dlp extract_info(watch_url, download=False) + 超时，
          选出渐进式 mp4 直链，写入缓存
       3) httpx.AsyncClient(proxy=YOUTUBE_PROXY).stream("GET", 直链,
             headers = 所选 format 的 http_headers（fmt['http_headers']，
                       非 _get_robust_ydl_options 顶层 UA）+ 转发的 Range)
       4) StreamingResponse 回代：状态 200/206、Content-Type、Content-Length、
             Content-Range、Accept-Ranges，Cache-Control: no-store
  → 浏览器 <video> 直接播放、可拖动
  失败路径：解析或上游失败 → 后端返回 4xx/5xx（JSON 错误体）→ <video> onError →
           前端置 previewError=true → 左栏显示缩略图 + 「预览不可用/在浏览器中打开」
```

### 2.5 安全设计

- 前端到后端**只传 11 位 `video_id`**，后端在服务端自行拼 `https://www.youtube.com/watch?v={id}`，**绝不接受来自客户端的任意 URL 去拉流**，从源头消除 SSRF（比对 URL 做 `validate_external_url` 更强）。
- `video_id` 用正则 `^[A-Za-z0-9_-]{11}$` 严格校验，非法直接 400。
- 后端回代的 googlevideo 直链来自 `yt-dlp` 解析（非用户输入），且经受信代理出网。

---

## 3. File / module change plan（文件 / 模块变更计划）

> 约定：后端 `app/routers/youtube_router.py` 已挂 `prefix="/youtube"` 且在 `main.py` 以 `prefix="/api"` 注册，故新端点最终路径为 `/api/youtube/preview/stream`。前端 BFF 路由文件夹名用 `preview-stream`（连字符），对外同源地址 `/api/youtube/preview-stream`。

| # | 文件 | 新建/修改 | 一句话意图 |
|---|------|-----------|------------|
| 1 | `backend-services/basic-service/app/models/youtube_models.py` | 修改 | 新增 `YoutubePreviewStream`（内部 dataclass/BaseModel：`url, http_headers, content_type, ext, filesize`）承载解析结果；可选新增 `YoutubePreviewResolveResponse` 供未来 JSON 元数据端点 |
| 2 | `backend-services/basic-service/app/services/youtube_service.py` | 修改 | 新增 `resolve_preview_stream(video_id)`（yt-dlp 选渐进式 mp4 + TTL 缓存 + `_pick_progressive_format` 辅助）与 `_preview_stream_cache` 内存字典；复用 `_get_robust_ydl_options` 与 `self.proxy` |
| 3 | `backend-services/basic-service/app/routers/youtube_router.py` | 修改 | 新增 `GET /youtube/preview/stream`：校验 `video_id` → 解析（线程池+超时）→ `httpx` 经 `YOUTUBE_PROXY` 拉流、转发 Range → `StreamingResponse` 回代 206/200；上游 403/过期则失效缓存重解析一次 |
| 4 | `src/app/api/youtube/preview-stream/route.ts` | **新建** | Next.js BFF：`createPassthroughRoute('/api/youtube/preview/stream', { streaming:true, forwardHeaders:['range'], responseHeaderAllowlist:[...], timeoutMs:300000 })`，`?video_id=` 自动透传 |
| 5 | `src/components/video/components/VideoSearchModal/VideoSearchModal.tsx` | 修改 | 将 YouTube 预览分支从 `<iframe youtube.com/embed>` 改为 `<video src="/api/youtube/preview-stream?video_id=${id}" controls preload="metadata">`；新增 `youtubePreviewError` 状态与 `onError` 降级 UI（缩略图 + 提示 + 打开原链） |
| 6 | `src/lib/i18n.ts` | 修改 | 在 `videoSearchModal` 下新增 `previewUnavailable`、`previewUnavailableHint`、`openInBrowser` 三个文案键。**【P1-2】三处同改**：① `Translations` 类型接口 `videoSearchModal`（约 @762，否则 `t.videoSearchModal.previewUnavailable` type-check 报错）；② `en` 值对象（约 @3089）；③ `zh` 值对象（约 @5419）。三处键集合必须一致 |
| 7 | `backend-services/basic-service/tests/test_youtube_preview_stream.py` | **新建** | 后端单测：`video_id` 校验、渐进式格式选择、Range→206、解析失败→502、TTL 缓存命中不重解析（均 mock `yt_dlp` 与 `httpx`） |
| 8 | `docs/plans/youtube-preview-stream-proxy/spec.md` | 本文件 | 设计方案（本节点产出） |

> 说明：第 1 项的 `YoutubePreviewResolveResponse` 为可选；MVP 只需 `<video>` 直接指向流端点即可，不需要单独的 JSON 解析端点。列出是为后续「加载前先探测/展示错误」预留。

---

## 4. Interface design（接口设计）

### 4.1 后端新端点

**`GET /api/youtube/preview/stream`**

- Query 参数：
  - `video_id`（string，必填）：YouTube 11 位视频 ID，正则 `^[A-Za-z0-9_-]{11}$`。
  - `quality`（string，可选，默认 `preview`）：`preview`=优先 360p 秒开；预留 `hd`=≤720p。MVP 可先只实现 `preview`。
- 请求头：透传 `Range`（可选，`bytes=start-` / `bytes=start-end`）。
- 成功响应：
  - `206 Partial Content`（有 Range）或 `200 OK`（无 Range），body 为视频字节流（`StreamingResponse`）。
  - 响应头：`Content-Type`（如 `video/mp4`）、`Content-Length`、`Content-Range`（206 时）、`Accept-Ranges: bytes`、`Cache-Control: no-store`。
- 失败响应（JSON，沿用项目 `ErrorResponse`/`detail` 风格）：
  - `400`：`video_id` 缺失或格式非法。
  - `502`：yt-dlp 解析失败或无可用渐进式格式或上游拉流失败（含被 YouTube 反机器人拦截到 yt-dlp 层的情况）。
  - `504`：解析或上游超时。

**（可选）`GET /api/youtube/preview/resolve?video_id=...`** → `200 {success, content_type, width, height, duration, has_stream}`：仅返回元数据与「是否可流式预览」，供前端在挂载 `<video>` 前展示 loading/错误。非 MVP 必需。

### 4.2 前端 BFF（同源）

**`GET /api/youtube/preview-stream?video_id=...`** —— `createPassthroughRoute` streaming 透传到后端 `/api/youtube/preview/stream`。`forwardHeaders: ['range']` 保证 Range 请求头到达后端；`responseHeaderAllowlist` 放行 `content-type, content-length, accept-ranges, content-range, cache-control` 以支持拖动 seek。

### 4.3 前端组件契约

`VideoSearchModal` 的 YouTube 预览 `<video>`：
- `src = /api/youtube/preview-stream?video_id=${encodeURIComponent(currentPreviewVideo.id)}`
- `key={currentPreviewVideo.id}`（切换视频时强制重建元素，重置错误态与缓冲）
- `controls`、`preload="metadata"`、`className` 复用现有官方视频分支样式（`object-contain`、`max-h-[320px]`）。
- `onError` → `setYoutubePreviewError(true)`；`onLoadedData` → `setYoutubePreviewError(false)`。

---

## 5. Data model（数据模型）

- **无数据库变更**（不新增表/列，无 Alembic 迁移）。
- 后端内存结构 `_preview_stream_cache: dict[str, YoutubePreviewStream]`，其中 `YoutubePreviewStream`：

```python
@dataclass
class YoutubePreviewStream:
    url: str                      # googlevideo 直链
    http_headers: dict[str, str]  # 【P1-1】取自所选 format 的 fmt['http_headers']（含匹配该客户端的 UA 等），回代时原样透传；不要用顶层 UA
    content_type: str             # 如 "video/mp4"
    ext: str                      # "mp4"
    filesize: int | None          # 可能为 None（approx）
    expire_at: float              # time.time() + TTL，过期即重解析
```

- 前端新增本地 UI 状态：`youtubePreviewError: boolean`（不进全局 store）。
- `YoutubeVideoSearchResult`（`src/components/video/types`）已含 `id / videoUrl / width / height / thumbnailUrl`，**无需改类型**。

---

## 6. Testing & acceptance criteria（测试与验收标准）

### 6.1 后端单元测试（`tests/test_youtube_preview_stream.py`，pytest + mock）

- `rejects_invalid_video_id`：`video_id="../etc"`、空、非 11 位 → 400。
- `picks_progressive_mp4_format`：mock `yt_dlp.YoutubeDL.extract_info` 返回含 DASH+progressive 的 `formats`，断言选出的是合流 mp4（itag 18/22，`acodec!=none && vcodec!=none`）。
- `range_request_returns_206`：mock `httpx` 上游返回 206 + `Content-Range`，断言端点回传 206 且 `Content-Range`/`Accept-Ranges` 正确透传。
- `resolve_failure_returns_502`：mock `extract_info` 抛异常（模拟 *Sign in to confirm you're not a bot*）→ 502，错误信息含定位线索。
- `ttl_cache_reuses_resolution`：TTL 内第二次请求不再调用 `extract_info`（断言 mock 调用次数=1）；过期后重解析。
- `expired_upstream_reresolves_once`：上游首拉 403 → 失效缓存、重解析、二拉成功。

> 遵循项目约定：不 mock 迁移/鉴权等高风险路径；此处 mock 的是外部 YouTube 网络边界（yt-dlp/httpx），符合「外部依赖用桩隔离」。

### 6.2 前端 / 集成验证

- （若有 Vitest 覆盖 BFF）断言 `/api/youtube/preview-stream` 路由确实以 `streaming:true` + `forwardHeaders:['range']` 透传、且 query `video_id` 被转发。
- **桌面走查（强制门槛，本项目惯例）**：打开视频编辑器 → 视频搜索弹窗 → 切到 YouTube 页签 → 搜索关键词 → 点击一条结果 → 左栏应出现可播放的 `<video>`，可点播放、可拖动进度，**不再出现「请登录，以便我们确定你不是聊天机器人」**。
- `type-check`（`npm run type-check`）与后端 `pytest tests/ -v` 通过。

### 6.3 验收标准（Definition of Done for 需求）

1. YouTube 搜索结果点击后，左侧预览面板能正确播放选中视频（原生 `<video>`，可 seek）。
2. 反机器人「请登录…」提示不再出现在预览面板。
3. 当解析/网络失败时，预览面板优雅降级为缩略图 + 「预览不可用」+ 「在浏览器中打开」链接，而非白屏或误导性提示。
4. 「加入合成」的既有下载入库链路不受影响。

---

## 7. Risks & mitigations（风险与缓解）

| # | 风险 | 缓解措施 |
|---|------|----------|
| R1 | 未配置 `YOUTUBE_PROXY` 且本机直连不通 → yt-dlp 解析仍失败 | 返回明确 502；前端降级 UI 提示「请检查网络/代理」并给「在浏览器中打开」；文档提示配置 `YOUTUBE_PROXY`（与搜索/下载共用同一代理，既有链路已依赖它） |
| R2 | googlevideo 直链播放中途过期（>TTL） | TTL(1h) < 真实过期(6h)；上游 403 时失效缓存并重解析一次；`Cache-Control: no-store` |
| R3 | progressive 合流可用性（**评审修正 P2-1**：比「个别视频」更常见）：itag 22（720p 合流）对大量视频已不再提供、itag 18（360p）稳定存在；直播/年龄限制/部分音乐视频可能**无任何 progressive** | **明确验收口径**：多数视频以 **itag 18 = 360p 秒开**预览即算满足需求（预览非原画）；有 itag 22 则升 720p；完全无 progressive 时 502 + 前端降级为缩略图 + 「在浏览器打开」——**不因个别视频无法内联预览判定需求失败**。选择器已含 `best[acodec!=none][vcodec!=none]` 兜底。后续可选：后端 ffmpeg 实时 remux DASH（未来增强，不在本期） |
| R4 | 多段 Range 请求跨不同签名 URL 导致字节错位 | 同一 `video_id` 复用同一缓存直链，`Content-Length` 稳定，`Content-Range` 一致 |
| R5 | 720p 预览体积大、拉流慢 | 预览默认优先 360p（itag 18）秒开；`quality=hd` 预留但非默认 |
| R6 | 多个预览并发拉流打爆代理 | 可加小信号量（如 `asyncio.Semaphore(4)`）限制并发 preview 上游流；复用 `youtube.yaml` 并发配置理念（MVP 可选） |
| R7 | Next.js `streaming` 透传大文件的内存/背压 | 复用 `createPassthroughRoute({streaming:true})` 已验证的 `ReadableStream` 直通（`storage/files` 同款），不缓冲整包 |
| R8 | 桌面打包端缺 yt-dlp/代理环境 | 现状搜索/下载已工作 → 说明打包端已具备 yt-dlp+代理，预览复用同一链路，无额外打包变更 |
| R9 | Range 请求头未被 BFF 透传导致无法 seek | BFF 显式 `forwardHeaders:['range']`；单测覆盖 |

---

## 8. Implementation notes / landmines（实现要点与坑位，供下游逐行落地）

- **httpx 版本**：仓库 `requirements.txt` 固定 `httpx==0.28.1`，支持 `httpx.AsyncClient(proxy=<url or None>, ...)`（`proxies=` 在 0.28 已弃用）。构造：`httpx.AsyncClient(timeout=httpx.Timeout(connect=15, read=30, write=30, pool=15), follow_redirects=True, proxy=(self.proxy or None))`。
- **代理取值**：`self.proxy = _youtube_proxy or None`，其中 `_youtube_proxy = get_settings().youtube_proxy`（来自 `YOUTUBE_PROXY` env，默认 `""`）。yt-dlp 侧已在 `_get_robust_ydl_options`/`search_videos` 里以 `ydl_opts['proxy']` 使用，保持一致。
- **yt-dlp 在线程池执行**：`extract_info` 是阻塞调用，务必 `await asyncio.wait_for(asyncio.to_thread(...), timeout=30)`，与既有 `search`/`info` 端点一致，避免阻塞事件循环。
- **【P1-1】回代请求头必须用 format 级 `http_headers`**：`extract_info(..., download=False)` 后从 `info['formats']` 里 `_pick_progressive_format` 选出目标 format，**回代 googlevideo 时用 `fmt.get('http_headers')`**（缺省再退 `info.get('http_headers')`），**绝不要**用 `_get_robust_ydl_options` 顶层那份桌面 Chrome UA——android 客户端直链配错 UA 会 403。若 403，先怀疑「用错头」或「用了 android 直链」，改用 web/ios 客户端的 progressive 重解析。
- **【P1-1】preview 专用 ydl opts**：因 `_get_robust_ydl_options` 对 `base_opts` 是**浅 `update`**，覆盖 `extractor_args` 会连带丢掉 `skip=['hls','dash']`。preview 解析建议：拿到 `_get_robust_ydl_options()` 结果后，对 `opts['extractor_args']['youtube']['player_client']` **原地改写**为 `['web','ios']`（保留 `skip`/其余键），或单独构造 opts 时手动带上 `skip=['hls','dash']`、`proxy`、`socket_timeout`。
- **StreamingResponse 生成器**：在 async 生成器里 `async with client.stream("GET", url, headers=upstream_headers) as resp: async for chunk in resp.aiter_bytes(chunk_size): yield chunk`；`AsyncClient` 生命周期需覆盖整个流（在生成器内创建并 `aclose`，或用 `resp` 上下文），不要在函数返回前提前关闭。
- **【P2-2】断连清理**：用户快速切换预览 / 关闭弹窗时浏览器会中断请求，Starlette 会 `aclose()` 该生成器并抛 `GeneratorExit`。务必把 `client.aclose()` / `resp.aclose()` 放在生成器的 `finally`（`async with` 天然满足），确保断连时不泄漏到 googlevideo 的连接；配合 R6 信号量避免快速切换造成连接堆积。
- **【P2-4】`follow_redirects=True` 取舍**：与 `media_proxy_service`（`False`，SSRF 加固）不同，此处需 `True`——googlevideo 边缘节点存在 302 跳转。可接受的理由：回代直链**源自 yt-dlp 解析结果、非客户端输入**，且经受信任的 `YOUTUBE_PROXY` 出网，SSRF 面已在「前端只传 11 位 id」处收敛（§2.5）。
- **响应头拷贝**：从上游 `resp` 拷 `Content-Type`（缺省 `video/mp4`）、`Content-Length`、`Content-Range`；固定加 `Accept-Ranges: bytes`、`Cache-Control: no-store`。状态码直接用上游 `resp.status_code`（200/206）。
- **路由路径**：`youtube_router` 内用 `@router.get("/preview/stream")`，最终对外 `/api/youtube/preview/stream`（因 `prefix="/youtube"` + `main.py` `prefix="/api"`）。前端 BFF 目录 `src/app/api/youtube/preview-stream/route.ts` 对外 `/api/youtube/preview-stream`，两者路径不同是刻意的（后端用 `/preview/stream`，前端同源用 `/preview-stream`），在 `createPassthroughRoute` 第一个参数里显式写死后端路径即可。
- **前端 `<video>` 的 `key`**：务必设 `key={currentPreviewVideo.id}`，否则切换不同 YouTube 视频时元素不重建、`src` 变更后仍复用旧缓冲/错误态。
- **降级 UI**：`onError` 置 `youtubePreviewError=true` 后，渲染现有「缩略图 fallback 块」（组件里已有 `thumbnail || thumbnailUrl` 分支可复用）并追加一行 `t.videoSearchModal.previewUnavailable` + 一个 `<a href={currentPreviewVideo.videoUrl} target="_blank" rel="noreferrer">{t.videoSearchModal.openInBrowser}</a>`。
- **不要动**：官方视频库预览分支（`<video src={video_url}>`）保持不变；YouTube「加入合成」的 `download-and-upload` 链路保持不变。
- **清理**：删除 iframe 后，其 `allow=...`、`allowFullScreen`、`onLoad` 日志随之移除；保留/迁移预览加载成功/失败的 `logger.info/error` 到 `<video>` 的 `onLoadedData/onError`。

---

## 9. Out of scope（本期不做）

- YouTube 登录/cookie 注入方案（`--cookies-from-browser`）——本方案以代理+多客户端抽取即可满足，不引入登录态管理。
- DASH 实时 ffmpeg remux 预览（仅在无渐进式格式时才需要，列为未来增强）。
- 预览文件落盘缓存（`store_external_download_async`）——预览走内存 Range 流式，秒开且只拉观看到的字节；「加入合成」才真正落盘。
- 官方视频库预览逻辑改动。
- **【P2-3 一致性约束】** 新增的 `/api/youtube/preview-stream` 属「仅预览」同源 URL，**严禁写入合成/导出请求**（遵循 CLAUDE.md：preview-only / media-proxy / preview-proxy URL 不得进 composition）。「加入合成」始终走独立的 `download-and-upload` 落盘链路，与预览流互不交叉。

---

## 10. 附：涉及的既有代码坐标（便于评审/开发定位）

- 前端预览（问题点）：`src/components/video/components/VideoSearchModal/VideoSearchModal.tsx`（YouTube iframe 约 461-488 行；官方 `<video>` 约 489-525 行）。
- 前端预览态：`src/components/video/hooks/useVideoSearch.ts`（`handleYoutubeVideoPreview` / `youtubePreviewVideo`）。
- 前端搜索服务：`src/components/video/services/youtubeVideoSearchService.ts`。
- 后端服务：`backend-services/basic-service/app/services/youtube_service.py`（`_get_robust_ydl_options`、`self.proxy`、`search_videos`）。
- 后端路由：`backend-services/basic-service/app/routers/youtube_router.py`（`prefix="/youtube"`；线程池+超时范式）。
- 复用范式：`app/routers/media_proxy_router.py`（Range 206 流式代理）、`app/services/media_proxy_service.py`（`httpx.AsyncClient` + Range 转发）。
- BFF 范式：`src/lib/api/server/backend-proxy.ts`（`createPassthroughRoute` 的 `streaming/forwardHeaders/responseHeaderAllowlist`），样例 `src/app/api/storage/files/[...path]/route.ts`。
- 配置：`backend-services/basic-service/app/config.py`（`youtube_proxy` @557、`YOUTUBE_PROXY` @1030）；`requirements.txt`（`httpx==0.28.1`、`yt-dlp>=2024.9.27`）。

---

## 评审结论（Review Verdict · Subtask #1）

**结论：有条件通过（Approved with conditions）。**

方案根因定位准确——「请登录，以便我们确定你不是聊天机器人」来自 `<iframe>` 直嵌 `youtube.com/embed` 时浏览器侧触发的反机器人挑战，与后端 yt-dlp 链路无关；而本应用后端搜索/下载走 `yt-dlp + YOUTUBE_PROXY` 已可靠工作。改为「后端 progressive 直链回代 + 前端同源 `<video>`」的思路正确，且**完全复用仓库既有基建**（`createPassthroughRoute` streaming + `responseHeaderAllowlist`、`youtube_service` 代理链路、`media_proxy_service` 的 Range 回代范式），不引入新依赖、无数据库变更，规模适中、降级路径清晰。经逐节核对，方案所引用的代码坐标全部属实、技术可行。

**评审共发现 0 个 P0、2 个 P1、4 个 P2**。两个 P1 已在正文就地修复、文档升至 **v2**：

1. **P1-1（可行性）** — 回代直链使用 format 级 `http_headers`、progressive 优先 web/ios 客户端、避免 `extractor_args` 浅合并丢 `skip`：已写入 §2.2 / §2.4 步骤3 / §5 / §8。
2. **P1-2（完整性）** — i18n 三处同改（类型接口 @762 + en @3089 + zh @5419）：已写入 §3 文件清单 #6。

**进入 Subtask #2 代码开发需满足以下条件（对应 P2 及 P1 落地校验）：**

1. **【必须】** upstream 回代请求使用**所选 format 的 `http_headers`**（非顶层 UA），progressive 解析**优先 `web`/`ios` 客户端**；覆盖 `extractor_args` 时**深合并**、勿丢 `skip=['hls','dash']`。开发须在**桌面走查**中验证真机可播放、可拖动（不只是 HTTP 200），而非仅跑通单测。（P1-1）
2. **【必须】** i18n 三处（接口 762 + en 3089 + zh 5419）键集合一致，确保 `npm run type-check` 通过。（P1-2）
3. **【建议】** 本期落地 §7 R6 的并发信号量（如 `asyncio.Semaphore(4)`），并确保流式生成器在断连（`GeneratorExit`）时 `aclose()` httpx client，避免快速切换预览导致连接/代理堆积。（P2-2）
4. **【验收口径】** 接受「多数视频以 360p 内联预览、长尾无 progressive 时降级为缩略图 + 在浏览器打开」为满足需求；不因个别视频无法内联预览判定失败。（P2-1）
5. **【一致性】** `/api/youtube/preview-stream` 为仅预览 URL，严禁进入合成/导出请求；「加入合成」保持独立 `download-and-upload` 链路。（P2-3）

满足以上条件即可进入 Subtask #2 代码开发。无遗留 P0 / P1。

---

## 实施过程发现的方案缺陷（Issues Found During Implementation · Subtask #2）

> 仅记录与方案文字有出入、但不影响整体方向的细节；均已在实现中就地按更正后的做法落地，无功能性偏差。

1. **i18n `previewUnavailable` 键已存在（非全新增）** — §3 文件清单 #6 与 §8 均称「新增 `previewUnavailable`、`previewUnavailableHint`、`openInBrowser` 三个文案键」，但 `src/lib/i18n.ts` 中 `previewUnavailable` 三处（接口 @780 / en @3108 / zh @5439）**已存在且未被任何组件引用**（旧值 en `'No preview video'` / zh `'无预览视频'`）。
   - **更正做法**：仅真正新增 `previewUnavailableHint`、`openInBrowser` 两个键（三处同改）；对既有 `previewUnavailable` **复用并重写其值**为更贴合降级语义的 en `'Preview unavailable'` / zh `'预览不可用'`（因其原先无任何引用，改值无视觉回归）。三处键集合仍保持一致，`npm run type-check` 通过。

2. **依赖版本实测值与方案标注略有出入（不影响）** — 开发机实测 `httpx==0.28.1`（与方案一致，`AsyncClient(proxy=...)` 可用），但 `fastapi` 为 `0.136.1`、`yt-dlp` 为 `2025.06.09`，均高于/不同于 `requirements.txt` 的历史标注。新端点仅用到 `StreamingResponse` + `Request.headers` + `AsyncClient(proxy=, follow_redirects=, timeout=)` 等稳定 API，跨这些版本行为一致，无需改动。

3. **验证结果** — 新增后端单测 `tests/test_youtube_preview_stream.py` 14 项全部通过（含 video_id 校验、渐进式选择、Range→206、解析失败→502、TTL 缓存复用、上游 403 重解析一次、持续 403→502）；前端 `npm run type-check` 全绿。P1-1（format 级 http_headers、web/ios 客户端、深合并保留 skip）、R6 信号量、P2-2 断连清理（生成器 finally）均已按评审落地条件实现。
