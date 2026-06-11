# 视频导出失败：`host 'localhost' is on the SSRF block-list`

> Bug slug: `video-export-localhost-ssrf-block`
> 诊断节点：Subtask #0（问题定位与分析）
> 日期：2026-06-11
> 本节点不写修复代码、不提交 git，仅产出含证据的根因分析与候选方案。

---

## 1. 问题描述（Problem description）

用户在视频编辑器的下方剪辑面板中，将**本地上传的视频素材**与**音频**拖到轨道上后，点击预览播放面板的「导出视频」，导出立即失败，前端报错：

```
[useVideoExport] 导出失败 {
  taskId: 'task-1780980464716-video-iw60lvx6k',
  error: "Composition request rejected: host 'localhost' is on the SSRF block-list",
  stack: "Error: Composition request rejected: host 'localho…nts/VideoPlayerPanel/VideoPlayerPanel.tsx:297:13)",
  timestamp: '2026-06-11T14:15:10.939Z'
}
```

导出未产出任何文件，合成请求在后端的「请求时 URL 守卫」阶段就被直接拒绝，连合成线程都没有启动。

---

## 2. 复现步骤（Reproduction steps）

前置条件：以**本地/桌面模式**运行（前端跑在 loopback origin 上，例如开发态 `npm run dev` → `http://localhost:3000`，或桌面 dev 模式）。后端正常运行。

1. 启动后端：`cd backend-services/basic-service`，激活 venv 后 `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`。
2. 启动前端：仓库根目录 `npm run dev`（监听 `http://localhost:3000`），在浏览器打开视频编辑器。
3. 在素材区**上传一个本地视频文件**（落盘到 `static/uploads/video/<yyyy>/<mm>/...`，对应同源 URL `/api/storage/files/video/<yyyy>/<mm>/<file>.mp4`）。
4. 上传/选择一个**音频素材**。
5. 把视频素材拖到视频轨道、音频素材拖到音频轨道。
6. 点击预览播放面板右上角的「导出视频」。
7. **预期**：开始合成并最终下载 mp4；**实际**：立即弹出失败提示，控制台打印上述 `host 'localhost' is on the SSRF block-list`。

### 最小复现（不走 UI，直接打后端）

模拟前端绝对化后发出的请求体即可稳定复现（host 为 loopback）：

```bash
curl -X POST http://localhost:8000/api/video-compose \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "repro",
    "video_items": [{
      "id": "v1", "name": "local.mp4",
      "url": "http://localhost:3000/api/storage/files/video/2026/06/local.mp4",
      "start_time": 0, "duration": 5, "clip_start": 0, "clip_end": 5
    }],
    "audio_items": [], "subtitle_items": [], "image_items": [],
    "total_duration": 5, "output_fps": 30, "output_format": "mp4"
  }'
```

返回 `success=false, message="Composition request rejected: host 'localhost' is on the SSRF block-list"`。
把 `url` 改成**相对路径** `/api/storage/files/video/2026/06/local.mp4` 则不会被该守卫拦截（守卫只校验 `http(s)://` 开头的 URL）——这正是根因的反向验证。

---

## 3. 根因分析（Root cause analysis）

### 3.1 现象链路

这是一次 **前端 URL 绝对化** 与 **后端请求时 SSRF 守卫** 两个独立「安全/正确性」改动正面冲突导致的自伤。

**(a) 前端把同源本地引用绝对化成 loopback URL。**
导出请求构造发生在 `useVideoExport`，视频项 URL 取自 `selectPlaybackUrl(material, { purpose: 'export' })`：

`src/components/video/hooks/useVideoExport.ts:278`
```ts
const videoUrl = selectPlaybackUrl(material, { purpose: 'export' });
```

对本地上传素材，`material` 带有同源直传引用（`/api/storage/files/video/...`，命中 `DIRECT_UPLOAD_PREFIXES`）。导出分支会走 `directLocal` 并经 `toAbsolutePlaybackUrl` 绝对化：

`src/components/video/lib/selectPlaybackUrl.ts:193-195`
```ts
if (purpose === 'export') {
  if (directLocal) {
    return toAbsolutePlaybackUrl(directLocal) ?? directLocal;   // ← 绝对化
  }
```

`src/components/video/lib/selectPlaybackUrl.ts:99-110`
```ts
const path = u.startsWith('/') ? u : '/' + u;
...
return window.location.origin + path;   // ← 注入浏览器 origin
```

当编辑器运行在 loopback origin（dev `http://localhost:3000`，或真实桌面 `http://127.0.0.1:PORT`）时，`window.location.origin` 就是 `http://localhost:3000`，于是：

`/api/storage/files/video/2026/06/local.mp4`
→ `http://localhost:3000/api/storage/files/video/2026/06/local.mp4`

该绝对 URL 被原样塞进合成请求的 `video_items[].url`（`useVideoExport.ts:313-339`）。

**(b) 后端「请求时守卫」把任何 `http(s)://` URL 当外网 URL 校验。**
合成入口先跑 `_guard_request_urls`：

`backend-services/basic-service/app/services/video_composition_service.py:723-733`
```python
try:
    self._guard_request_urls(request)
except URLGuardError as guard_exc:
    logger.warning(f"Composition request rejected by url_guard: {guard_exc}")
    return VideoCompositionResponse(
        success=False,
        message=f"Composition request rejected: {guard_exc}",
        ...
    )
```

`backend-services/basic-service/app/services/video_composition_service.py:1565-1568`
```python
if lower.startswith("http://") or lower.startswith("https://"):
    validate_external_url(url)      # ← 对 loopback 同源 URL 也照样校验
    continue
```

`validate_external_url` 的黑名单包含 `localhost`，且该检查**无条件**先于私网 IP 检查执行：

`backend-services/basic-service/app/security/url_guard.py:60-73`（`_BLOCKED_HOSTS` 含 `"localhost"`）
`backend-services/basic-service/app/security/url_guard.py:213-215`
```python
normalized_host = host.rstrip(".")
if normalized_host in _BLOCKED_HOSTS:
    raise URLGuardError(f"host '{normalized_host}' is on the SSRF block-list")
```

于是 `http://localhost:3000/...` 命中黑名单，`URLGuardError` 被抛出 → 合成请求在启动前即被拒绝。

### 3.2 关键证据：后端自身前后不一致（这是真正的「根因」）

后端**逐片解析**素材时用的是 `_convert_url_to_local_path` → `resolve_media_reference` → `_normalize_reference`，它**已经**会把 loopback 同源 URL 识别为「本地引用」并剥掉 origin：

`backend-services/basic-service/app/services/local_media_resolver.py:43`
```python
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
```
`backend-services/basic-service/app/services/local_media_resolver.py:91-95`
```python
if scheme in {"http", "https"}:
    host = (parsed.hostname or "").lower()
    if host in LOCAL_HOSTS:
        return unquote(parsed.path), False   # ← 视为本地路径，剥掉 host/port，不当远程
    return raw, True
```

也就是说：**如果请求能越过 `_guard_request_urls`，后续逐片解析完全可以正确把 `http://localhost:3000/api/storage/files/video/...` 还原成本地文件**（`_resolve_route_path` 再做 `validate_local_path_for_ffmpeg` 容器化校验）。

因此真正的缺陷是：**「请求时守卫 `_guard_request_urls`」比「逐片解析器 `_normalize_reference`」更严格**——前者把 loopback 同源本地引用一刀切当成外网 SSRF 目标拒绝，后者却把它当合法本地引用接受。两者对同一个 URL 给出相反结论，前门把后门本可放行的东西拦死了。

### 3.3 后端日志佐证（与 bug 报告同一事件）

`backend-services/basic-service/logs/app.log:208295-208297`
```
2026-06-11 10:15:10 - app.services.video_composition_service - WARNING - start_video_composition:726 - Composition request rejected by url_guard: host 'localhost' is on the SSRF block-list
2026-06-11 10:15:10 - app.routers.video_router      - WARNING - compose_video:179 - Video composition failed: Composition request rejected: host 'localhost' is on the SSRF block-list
```

后端本地时间 `10:15:10` 与 bug 报告的 `2026-06-11T14:15:10.939Z`（UTC）为同一时刻（差 4 小时时区），可确认是同一次失败事件；同日 `10:12:55`（208009-208011）还有一次同样的拒绝，说明可稳定复现。

### 3.4 前端两套「导出引用选择」实现不一致（佐证）

`CompositionAdapter.selectCanonicalExportReference` 与 `useVideoExport` 走的是**两套**实现，且前者**故意保留相对路径**、后者却绝对化，docstring 本身已点明此分叉：

`src/components/video/timeline/infrastructure/CompositionAdapter.ts:80-99`
> “It deliberately returns the reference AS-IS (relative same-origin paths kept relative) rather than absolutising against `window.location.origin` … The actual export REQUEST builder (`useVideoExport`) calls `selectPlaybackUrl(export)` directly, which absolutises for desktop-shell safety …”

`CompositionAdapter` 产出的相对 URL 不会触发本 bug；只有真正构造请求的 `useVideoExport`（用绝对化的 `selectPlaybackUrl(export)`）会触发。这进一步说明「绝对化」对一个**由后端消费的数据字段**而言是多余且有害的——后端会用自己的文件系统根来解析相对同源路径，浏览器 origin 根本不该出现在这个请求体里。

---

## 4. 影响面（Impact surface）

- **受影响功能**：本地/桌面模式下的**视频导出（合成）**。
- **受影响素材**：任何会被解析为同源本地引用（`/api/storage/files/...`、`/api/audio/...` 等）的素材——本地上传视频、已缓存的远程素材（`cached_materials`）、ARK/Storyboard 回写素材等，只要导出时被 `selectPlaybackUrl(export)` 绝对化为 loopback URL。
- **触发范围 = 几乎全部本地桌面用户**：
  - origin 为 `localhost` → 命中 `_BLOCKED_HOSTS`，报 “host 'localhost' is on the SSRF block-list”（本 bug 原文）。
  - origin 为 `127.0.0.1`（CLAUDE.md/`selectPlaybackUrl.ts:76` 注明真实桌面构建跑在 `http://127.0.0.1:PORT`）→ 不在黑名单，但被 `_is_unsafe_ip` 的 loopback 判定拦下，报 “host '127.0.0.1' resolves to disallowed address 127.0.0.1”。
  - 二者皆失败，故**只要前端跑在 loopback 上，本地素材导出基本全军覆没**。
- **不受影响**：纯远程素材（仅有 `serverUrl`/`url` 为公网 CDN，导出分支回退到该远程 URL，能正常通过 SSRF 校验）；预览/播放链路（用 `purpose:'preview'`，不经此请求守卫）。

---

## 5. 候选修复方案（Candidate fixes）

| 方案 | 改动位置 | 思路 | 侵入性 | 风险 | 工作量 | 是否真正解决本症状 |
|---|---|---|---|---|---|---|
| **A. 前端：导出引用不再绝对化（保持相对同源路径）** | `src/components/video/lib/selectPlaybackUrl.ts`（`purpose==='export'` 分支不调用 `toAbsolutePlaybackUrl`），同步更新单测 | 让导出请求体携带相对 `/api/storage/files/...`，与 `CompositionAdapter.selectCanonicalExportReference` 对齐；后端 `_guard_request_urls` 因非 `http(s)://` 而直接跳过，逐片解析正常落地 | 小（1 文件 + 3 处单测断言） | 低：请求体 URL 是后端消费的数据，相对路径正是后端期望；波形取数 `TimelineItem.tsx:201` 在 http origin 下相对路径仍可加载（仅非 http shell 是理论边界，真实桌面为 `http://127.0.0.1`） | 小 | ✅ 同时解决 localhost 与 127.0.0.1 |
| **B. 后端：`_guard_request_urls` 放行 loopback 同源本地引用** | `backend-services/basic-service/app/services/video_composition_service.py:1560-1576` | 校验前先判断：`http(s)://` 且 host ∈ {localhost,127.0.0.1,::1} 且 path 命中本地媒体前缀 → 跳过 `validate_external_url`，交由 `_convert_url_to_local_path`/`resolve_media_reference` 处理（其已剥 origin）；仅真正外网 URL 才校验 | 中（触及 SSRF 安全代码，但仅新增一段窄范围豁免） | 低-中：必须严格限定「loopback host + 已知本地前缀」，且不发起网络请求、仍走 `validate_local_path_for_ffmpeg` 容器化；该逻辑与 `_normalize_reference:91-95` 已信任的判定**完全一致**，不降低相对既有解析器的安全姿态 | 小-中 | ✅ 同时解决两者，并消除后端自相矛盾 |
| **C. 配置：`URL_GUARD_ALLOW_PRIVATE=1`** | 本地/桌面 `.env` | 打开私网 IP 旁路 | 极小 | —— | 极小 | ❌ **不解决本症状**：`_BLOCKED_HOSTS`（含 `localhost`）在 `url_guard.py:214` **无条件**先于 `:219` 的 `_allow_private_override()` 检查，故 `localhost` 仍被拒；仅能放行 `127.0.0.1` 变体。误导性「快修」，不可单独采用 |

---

## 6. 推荐方案（Recommended fix）

**推荐：方案 A（前端导出引用保持相对同源路径）为主修复；并建议附带方案 B 作为后端防御性加固。C 明确排除。**

理由：

1. **A 命中真正根因，且改动最小、最安全。** 导出请求体中的 URL 是**后端消费的数据**，不是浏览器 `<video>.src`；后端用自身文件系统根解析相对同源路径。把浏览器 `window.location.origin`（loopback host）塞进这个字段，对导出而言**本就是多余且错误的**——它正是把同源本地引用变成「看起来像 SSRF 目标」的元凶。A 直接去掉这步绝对化，让请求体回到相对 `/api/storage/files/...`，`_guard_request_urls` 因非 `http(s)://` 自然跳过，逐片解析照常落地。

2. **A 消除既有分叉，对齐单一事实源。** `CompositionAdapter.selectCanonicalExportReference` 早已「保持相对」，A 让真正构造请求的 `useVideoExport` 与之一致（见 §3.4），同时解决 `localhost` 与 `127.0.0.1` 两种 loopback origin（§4）。

3. **A 不触碰 SSRF 安全代码**，对预览/波形等 50+ `selectPlaybackUrl` 调用者的 `preview` 行为零影响（仅改 `export` 分支）。需同步更新 `selectPlaybackUrl.test.ts:38/49/125` 三处断言（由「绝对 URL」改为相对路径），属预期内的小幅测试调整。

4. **建议附带 B 作为纵深防御。** B 让后端「请求时守卫」与其「逐片解析器」（`_normalize_reference` 已信任 loopback 同源引用，§3.2）保持一致，从而：即便将来任何调用方再次发出 loopback 同源 URL，也不会在前门被一刀切拒绝。B 的豁免范围严格限定为「loopback host + 已知本地前缀」并仍走本地路径容器化校验，**不降低**相对于现有解析器的安全姿态。

5. **明确排除 C：** `URL_GUARD_ALLOW_PRIVATE=1` 对 `localhost`（本 bug 原文症状）**无效**，因为黑名单检查先于私网旁路（`url_guard.py:214` vs `:219`）。它最多解决 `127.0.0.1` 变体，单独使用会留下「换个 origin 又复现」的隐患，故不采用。

> 最小落地建议给下游修复节点（Subtask #2）：先实施 A（前端导出分支返回相对同源引用 + 更新 3 处单测），即可让复现步骤通过；若希望后端前门与解析器彻底自洽，再叠加 B（窄范围 loopback 同源豁免）。波形取数 `TimelineItem.tsx:201` 若担心非 http shell，可在该调用点单独保留绝对化或依赖相对解析（真实桌面为 `http://127.0.0.1`，相对路径可正常加载）。

---

## 7. 评审补充证据与缺口闭合（Reviewer: evidence audit & gaps closed）

> 本节由 Subtask #1（分析报告评审）补写，逐条复核 §3 证据是否「确在失败路径上执行」、是否有「反例 / 漏掉的解释」，并补全 §5/§6 未覆盖的**音频项完整性**与**后端相对路径可解析性**两处关键缺口。所有引用均经本节点逐行核对。

### 7.1 强化「同一事件」证据：日志中的 taskId 精确匹配（比时区相关更硬）

§3.3 仅用「本地 10:15:10 == 报告 14:15:10Z（差 4 小时时区）」做时间相关，但同一份日志里其实有**直接的主键级证据**：

`backend-services/basic-service/logs/app.log:208293-208294`
```
208293  app.routers.video_router - INFO - compose_video:153 - Video composition request received for task export_task-1780980464716-video-iw60lvx6k_1781187310805
208294  app.routers.video_router - INFO - compose_video:154 - Video items: 3, Audio items: 1, Subtitle items: 0
```

日志里的任务标识 `export_task-1780980464716-video-iw60lvx6k_…` 内嵌的正是 bug 报告中的 `taskId: 'task-1780980464716-video-iw60lvx6k'`（前缀 `export_` + 尾部时间戳为导出包装），**逐字符匹配**，可确定性地认定为同一次失败，无需依赖时区推断。

此外 `208294` 透露失败请求含 **3 个 video items + 1 个 audio item**，而守卫 `_guard_request_urls`（`video_composition_service.py:1560`）按 `(video_items, audio_items, image_items)` 顺序遍历、**遇到首个非法 URL 即抛出**，故日志里命中的 `localhost` 来自**第一个 video item**；audio item 是否也会触发，无法从该日志推断——这正是 §7.2 必须补的完整性证据。

### 7.2 关键缺口闭合：音频项不会独立触发守卫，故方案 A（仅改 video/image）足以覆盖复现

复现与真实事件都**同时含音频**，但 §5/§6 只论证了 video 路径（`selectPlaybackUrl(export)` 绝对化）。评审必须回答：**A 把 video/image 改成相对后，那个 audio item 会不会接着把守卫顶在 `localhost` 上？** 经核对，不会，原因有二，构成完整证据链：

**(1) 音频导出路径根本不绝对化。** 音频项 URL 不走 `selectPlaybackUrl`，而走 `selectAudioPlaybackUrl`（`useVideoExport.ts:354`），后者**从不调用 `toAbsolutePlaybackUrl`**，按序返回本地 blob → `serverUrl` → `metadata.originalUrl` → 非 blob 的 `url`：

`src/lib/utils/audioUrl.ts:19-38`
```ts
export function selectAudioPlaybackUrl(material: MaterialItem): string | null {
  // ... 本地 blob 优先（useVideoExport.ts:355 会因 blob: 前缀回退到 serverUrl）
  if (material.serverUrl) return material.serverUrl;            // ← 原样返回，不注入 origin
  const originalUrl = material.metadata?.originalUrl as string | undefined;
  if (originalUrl) return originalUrl;
  if (!isBlobUrl(material.url)) return material.url ?? null;
  return null;
}
```

**(2) 本地上传素材的 `serverUrl` 后端就发相对路径。** 上传素材的 `url/serverUrl/cacheUrl` 全部取自后端上传响应（`localMaterial.ts:91-93,130-132`：`localUrl = result.video_url || result.file_url`，并三处同赋值），而后端构造该 URL 的唯一出口是：

`backend-services/basic-service/app/services/storage_service.py:68-70`
```python
def _get_file_url(self, relative_path: str) -> str:
    return f"/api/storage/files/{relative_path}"           # ← 永远是相对路径，无 scheme/host
```

故本地上传音频的 `serverUrl` 形如 `/api/storage/files/audio/…`（相对）。它进入 `_guard_request_urls` 时不以 `http://`/`https://` 开头，于是 `video_composition_service.py:1566` 的 `if lower.startswith("http://") …` 判定为假，**直接跳过 `validate_external_url`**，永不命中黑名单。

**结论：audio item 不是本 bug 的并发触发源**；真正且唯一被绝对化成 loopback 的是 video/image 路径（皆经 `selectPlaybackUrl(export)`，`useVideoExport.ts:278`/`:230`）。因此 **A 仅需改 `selectPlaybackUrl` 的 export 分支即可让复现步骤整体通过**，无需触碰音频路径——§6「A 同时解决复现」的结论成立，缺口已闭合。

> 反向佐证（asymmetry = 烟枪）：音频导出路径**早已**返回相对同源引用且工作正常，video/image 却多做一步绝对化——这步绝对化本身就是异常项。A 的本质是「让 video/image 对齐 audio 既有的正确行为」，而非引入新行为。

### 7.3 校验：方案 A 改完后，相对路径在后端逐片解析仍可正确落地（A 正确性闭环）

A 让请求体回到相对 `/api/storage/files/...`，必须确认后端逐片解析能接住它（否则只是把「前门拒绝」换成「后端 FileNotFound」）。核对解析链：

`backend-services/basic-service/app/services/local_media_resolver.py:135,151-152`
```python
normalized, is_remote = _normalize_reference(reference)   # 相对路径 scheme=="" → 返回 (raw, False)
# ...
if normalized.startswith("/"):
    return _resolve_route_path(normalized, reference)     # → 命中 "/api/storage/files/" 前缀
```

`_resolve_route_path`（`:100-122`）按 `ROUTE_PREFIXES` 把 `/api/storage/files/` 映射到 `settings.storage.root` 并最终走 `validate_local_path_for_ffmpeg` 容器化校验（`url_guard.py:246`）。即**相对路径与 loopback 绝对 URL 在逐片解析层解析结果完全一致**（后者经 `_normalize_reference:91-95` 剥 origin 后也变成同一条相对路径）——这恰好量化证明了 §3.2 的「前门比解析器更严」自相矛盾，也证明 A 不会把问题平移到下游。

### 7.4 校正方案 A 的改动面与测试影响（供下游精确落地）

1. **必须改两个 export 子分支，而非一个。** §5 表述为「export 分支不调用 `toAbsolutePlaybackUrl`」是对的，但下游需注意 export 内有**两处**绝对化：
   - `selectPlaybackUrl.ts:194-195`（`directLocal` 分支，命中本地直传前缀 `/api/storage/files/{video,audio,images,image}/`）；
   - `selectPlaybackUrl.ts:201-203`（`isLocalMediaReference` 分支，**`cacheUrl` = `/api/storage/files/cached_materials/…` 走的是这一支**，因 `_isDirectUploadStorageReference` 对 `cached_materials` 显式返回 false，见 `selectPlaybackUrl.ts:158`）。
   两支都要改成返回相对引用，否则缓存远程素材（cached_materials）导出仍会被绝对化。

2. **单测影响精确为 3 处 `toBe` 断言**，位于 `src/components/video/lib/__tests__/selectPlaybackUrl.test.ts`（§5 写的路径漏了 `__tests__/` 子目录，行号 38/49/125 正确）：
   - `:38` export 选 `cacheUrl`（走 isLocalMediaReference 支）；
   - `:49` export 选相对 `url`（走 directLocal 支）；
   - `:125` export 选 `metadata.localResolvedUrl`（走 directLocal 支）。
   三处都断言 `${window.location.origin}/api/storage/files/…`，A 落地后改为相对路径断言即可。

3. **请求构造集成测试不受影响**（无需改）：`useVideoExport.localExport.test.ts:164` 用的是 `expect(url).toContain('/api/storage/files/video/local.mp4')`（`toContain` 而非 `toBe`），对「绝对/相对」均通过，A 改完仍绿。

### 7.5 复核方案 C 的排除理由（确认黑名单先于私网旁路，C 对 localhost 无效）

逐行确认 §5/§6 对 C 的判断无误：`validate_external_url` 中 `_BLOCKED_HOSTS`（含 `localhost`）检查在 `url_guard.py:214` **无条件执行**，而 `URL_GUARD_ALLOW_PRIVATE` 旁路在 `:219` 的 `_allow_private_override()` 才生效——前者先于后者且不受其影响。故 `URL_GUARD_ALLOW_PRIVATE=1` 对本 bug 原文症状 `localhost` **完全无效**，仅能放行 `127.0.0.1` 变体（§4 所述真实桌面 origin）。**C 确认排除**，不可单独采用。

---

## 附：关键证据索引

- 错误抛出点（后端）：`backend-services/basic-service/app/security/url_guard.py:213-215`
- 请求时守卫（包装报错）：`backend-services/basic-service/app/services/video_composition_service.py:723-733`、`:1565-1568`
- 前端绝对化注入 loopback host：`src/components/video/hooks/useVideoExport.ts:278`、`src/components/video/lib/selectPlaybackUrl.ts:193-195`、`:99-110`
- 后端逐片解析已剥 loopback origin（自相矛盾佐证）：`backend-services/basic-service/app/services/local_media_resolver.py:43`、`:91-95`
- 前端两套实现分叉佐证：`src/components/video/timeline/infrastructure/CompositionAdapter.ts:80-99`
- 同事件后端日志（拒绝点）：`backend-services/basic-service/logs/app.log:208295-208297`（本地 10:15:10 == 报告 14:15:10Z）
- 同事件后端日志（taskId 精确匹配 + 3 video/1 audio）：`backend-services/basic-service/logs/app.log:208293-208294`
- 音频导出路径不绝对化（缺口闭合）：`src/lib/utils/audioUrl.ts:19-38`、`src/components/video/hooks/useVideoExport.ts:354`
- 后端上传 URL 恒为相对路径：`backend-services/basic-service/app/services/storage_service.py:68-70`；上传素材 url/serverUrl/cacheUrl 取值：`src/components/video/lib/localMaterial.ts:91-93,130-132`
- 相对路径后端可解析（A 正确性闭环）：`backend-services/basic-service/app/services/local_media_resolver.py:135,151-152`、`:100-122`
- 黑名单先于私网旁路（C 无效）：`backend-services/basic-service/app/security/url_guard.py:214` vs `:219`
- 单测断言（A 需改 3 处 toBe）：`src/components/video/lib/__tests__/selectPlaybackUrl.test.ts:38,49,125`；请求构造集成测试不受影响（toContain）：`src/components/video/hooks/__tests__/useVideoExport.localExport.test.ts:164`

---

## 评审结论（Review Verdict）

> 评审节点：Subtask #1（分析报告评审与修复）。已对 §3 全部证据逐行复核、补全音频项完整性与后端相对路径可解析性两处关键缺口（见 §7）。证据链现已自洽闭合。

### 根因认定：成立

「前端 `selectPlaybackUrl(export)` 经 `toAbsolutePlaybackUrl` 把同源本地引用绝对化为 `http://localhost:PORT/...`，后端 `_guard_request_urls` 对任意 `http(s)` URL 调 `validate_external_url`，`localhost` 命中 `_BLOCKED_HOSTS` 黑名单而被拒」这一根因链**确在失败路径上执行**：
- 前端注入点 `useVideoExport.ts:278` → `selectPlaybackUrl.ts:193-195/198-203` → `:99-110` 已逐行核实；
- 后端拒绝点 `video_composition_service.py:723-733/1565-1568` → `url_guard.py:213-215` 已逐行核实；
- 「自相矛盾」佐证 `local_media_resolver.py:91-95` 与逐片解析链 `:135/151-152` 证明同一 URL 在解析层可正确还原为本地路径，前门却拒绝——根因定性准确；
- 日志 `app.log:208293-208294` 的 taskId **逐字符匹配** bug 报告，确定为同一事件（强于原报告的时区相关）。

未发现反例或更优替代解释。唯一原报告未覆盖、可能动摇「A 即可修复」的反例假说——「同时在场的 audio item 会不会独立触发守卫」——经 §7.2 证伪：音频路径不绝对化（`audioUrl.ts:19-38`）且后端发相对 URL（`storage_service.py:68-70`），audio 永不命中黑名单。缺口已闭合。

### 最终推荐修复（单一方案）：方案 A —— 前端导出引用保持相对同源路径

**A 是解决本 bug 的最小且充分改动，定为唯一必做修复。**

落地点（务必两处都改）：将 `src/components/video/lib/selectPlaybackUrl.ts` 中 `purpose==='export'` 的**两个**返回分支——`:194-195`（`directLocal`）与 `:201-203`（`isLocalMediaReference`，承载 `cacheUrl`/cached_materials）——改为直接返回该相对引用，不再经 `toAbsolutePlaybackUrl` 绝对化；同步把 `__tests__/selectPlaybackUrl.test.ts:38/49/125` 三处 `toBe` 断言从 `${window.location.origin}/api/...` 改为相对 `/api/...`。

理由（为何是 A、为何最小、为何不引入回归）：

1. **命中真正根因，零安全代码改动。** 导出请求体的 URL 是**后端消费的数据字段**（非浏览器 `<video>.src`），后端用自身文件系统根解析相对同源路径（§7.3 已证 `/api/storage/files/...` 经 `_resolve_route_path` 正常落地并仍走 `validate_local_path_for_ffmpeg` 容器化）。把浏览器 `window.location.origin` 注入此字段对导出本就是多余且有害的——它正是把同源本地引用伪装成「SSRF 目标」的元凶。A 精确移除这一步，不触碰 SSRF 守卫代码。

2. **同时解决 `localhost` 与 `127.0.0.1` 两种 loopback origin**（§4），并消除前端 `useVideoExport` 与 `CompositionAdapter.selectCanonicalExportReference`（早已保持相对，§3.4）的实现分叉，对齐单一事实源。

3. **回归面极小且已量化。** 唯一行为变化是 export 分支 URL 由绝对变相对；后端解析两者等价（§7.3）；50+ 个 `preview` 调用者零影响（仅改 export 支）；请求构造集成测试用 `toContain` 不受影响（§7.4.3）；仅 3 处单元断言需随改（§7.4.2）。非 http shell（`file:`/`app:`）也不受影响——导出请求始终经 HTTP 发往后端，前端 shell 的 origin 与请求体内的媒体引用解析无关。

### 方案 B（后端 loopback 同源豁免）：**降级为可选纵深防御，本次不作为必做项**

B 让后端「请求时守卫」与「逐片解析器」自洽，是合理的硬化，但**它不是修复本 bug 所必需的额外工作**：A 落地后已无任何调用方发出 loopback 绝对 URL，前门/解析器的不一致变为休眠的潜在项而非活跃缺陷。鉴于 B 触及 SSRF 安全敏感代码、需独立的安全回归评审，**按「最小改动解决症状」原则不纳入本次必做**。若团队确需前门与解析器彻底自洽，可作为独立硬化项后续单独提交，且必须严格限定豁免范围为「loopback host ∈ {localhost,127.0.0.1,::1} + 已知本地媒体前缀」、不发起网络请求、仍走 `validate_local_path_for_ffmpeg` 容器化校验（与 `_normalize_reference:91-95` 既有信任判定完全一致，不降低安全姿态）。

### 方案 C（`URL_GUARD_ALLOW_PRIVATE=1`）：**确认排除**

黑名单检查 `url_guard.py:214` 无条件先于私网旁路 `:219`（§7.5 已逐行复核），故 C 对本 bug 原文症状 `localhost` 完全无效，仅能放行 `127.0.0.1` 变体，属误导性「快修」，不可采用。

### 给下游修复节点（Subtask #2）的交付清单

- [ ] 改 `selectPlaybackUrl.ts` export 两支（`:194-195`、`:201-203`）返回相对引用，不调用 `toAbsolutePlaybackUrl`。
- [ ] 更新 `__tests__/selectPlaybackUrl.test.ts:38/49/125` 三处断言为相对路径。
- [ ] 验证：`npm run type-check` 通过；`selectPlaybackUrl.test.ts` 与 `useVideoExport.localExport.test.ts` 绿；按 §2 复现步骤手动导出一次确认不再报 SSRF。
- [ ] B、C 不在本次改动范围内（B 为可选后续硬化，C 排除）。
