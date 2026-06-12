# 剪辑预览「添加到视频轨道的视频，播放/seek 仍黑屏」— 问题定位与分析

- **诊断节点**：Subtask #0（问题定位与分析）
- **日期**：2026-06-12
- **Bug slug**：`preview-blackscreen-no-http-range-seeking`
- **本轮需求（任务板「第 2 轮」）**：*"没修改好，添加到视频轨道的视频，预览播放，仍然是黑屏的"*
- **关联历史**：本问题此前已被诊断/修复 **4 次**，全部聚焦在**前端预览引擎的时序**上仍未解决：
  - `4c5ca49` feat: fix composition preview no-picture via decode/audio decoupling and readiness repaint
  - `d22d787` fix: stop timeline preview playback stutter ...
  - `fed1e02` fix: stop mid-clip preview play from black-screening via start readiness handshake
  - `09bbc0a` fix: restore mid-clip preview playback ...（本任务「第 1 轮」产出）

## 一句话结论

**黑屏的真正根因不在前端预览引擎，而在后端静态文件服务：`storage_files_router` 运行在 Starlette 0.27.0 上，其 `FileResponse` 不支持 HTTP Range（字节范围）请求 —— 所有视频一律以 `200` 整文件返回、且不带 `Accept-Ranges`。** 于是预览用的解码 `<video>` 元素**无法 seek**：任何一次「冷 seek」（点击标尺到中段、带 trim 的 clip、或自由奔跑时钟触发的去抖回拽）都会让浏览器**从字节 0 重新整文件下载**，在下载完成前元素 `readyState` 一直 < 2，而合成器只在 `readyState ≥ 2` 时才绘制视频层（`CanvasCompositor._drawVideoLayer:290`）→ **画布只剩黑底**。前 4 轮的时序修复全部建立在「元素 seek 落定后会很快变为可画」这一**错误前提**上，因此无论握手/重锚/补画做得多精巧，都无法画出一个**永远不就绪**的源。

> 运行时铁证（打包桌面端 backend.log，当前会话仍在使用）：整个会话内所有视频 `.mp4` GET **152 次返回 `200`、0 次返回 `206`**；新上传的 `huaqiang.mp4` 共 28 次 GET 全是 `200`，首次加载耗时 **5.814s**。

---

## 1. 问题描述（Problem description）

在桌面端（Electron，前端 `http://127.0.0.1:18320`，后端 `http://127.0.0.1:18321`）视频编辑器中：

1. 素材面板上传一段本地视频（例：`huaqiang.mp4`，1080×1920 H.264）。
2. 把该素材加入下方剪辑轨道，预览进入 `playbackMode==='composition'`。
3. 在预览面板点击播放 ▶，或点击时间轴标尺把光标移动到 clip 任意（非起点）位置后播放。
4. **现象**：预览 `<canvas>` 持续纯黑、不出图，无法进行播放预览。素材体积越大 / 位置越靠后，黑屏越稳定。

注：从 clip 起点（合成时间 0、且 clip 未 trim）顺序起播，**可能**在整文件下载完成后出图（但首帧延迟数秒）；只要发生一次 seek（用户点击中段、clip 有 trim 入点、或播放中元素落后被回拽），即黑。

---

## 2. 复现步骤（Reproduction steps）

### 2.1 用户路径复现（与本轮反馈一致）

1. 启动打包桌面端（或 `npm run dev` + 后端；两者后端均为 `starlette==0.27.0`，见 §3.4，故**dev 与打包同病**）。
2. 上传一段 ≥10s、1080p 本地视频，加入剪辑轨道。
3. 点击标尺把光标移到 clip 中段（如第 5–10 秒），点击播放 ▶ → 预览 `<canvas>` 黑屏。

### 2.2 一行命令客观判据（证明后端不支持 Range —— 最直接证据）

后端在运行时，用带 `Range` 头的请求打任意一个视频文件（需带登录 cookie 才能过鉴权；也可直接看 backend.log 的状态码统计）：

```bash
# 期望：HTTP/1.1 206 Partial Content + Content-Range/Accept-Ranges
# 实际（Starlette 0.27.0 FileResponse）：HTTP/1.1 200 OK，且无 Accept-Ranges / 无 Content-Range
curl -s -D - -o /dev/null \
  -H "Range: bytes=0-1023" \
  -H "Cookie: ecliptrix-session-token=<会话token>" \
  "http://127.0.0.1:18321/api/storage/files/video/<...>/huaqiang.mp4"
```

或直接统计 backend.log（无需 token，证据等价）：

```bash
grep -oE '"GET [^"]*\.mp4 HTTP/1.1" [0-9]+' backend.log \
  | grep -oE '[0-9]+$' | sort | uniq -c
# 输出：152 个 200、16 个 404、0 个 206  ← 没有任何 206 = 后端从不分片
```

### 2.3 DevTools 量化确认（现场佐证）

1. 黑屏现场打开 DevTools → Network，过滤该 `.mp4`：可见**同一文件被反复整段（200）请求**、`Status=200`、无 `Accept-Ranges` 响应头、`Content-Length`=整文件大小；每次 seek 触发一条**从头开始**的新请求。
2. Console 开启逐轨道诊断（`isPreviewDebugEnabled()`，`src/components/video/playback/internal/previewDebug.ts`）：可见 `readyState<2`、`paused=false`、`drawn=0`、`dropped` 持续增长。
3. Performance：`<video>` 的下载在每次 seek 时被中断并从 0 重启，元素长期停在 `HAVE_METADATA`(1) 以下。

---

## 3. 根因分析（Root cause analysis — 含证据）

### 3.1 直接成因：合成器只在 `readyState ≥ 2` 时绘制视频层

多轨合成器对每个视频层的绘制守卫：

`src/components/video/playback/CanvasCompositor.ts:288-290`
```ts
const source = layer.source;
if (!source || source.readyState < 2) return false;   // ← 未就绪即不画（返回 false）
```
当所有视频层都未画出，`renderFrame` 只剩 `:224-225` 的黑底（`DEFAULT_LETTERBOX_COLOR='#000'`，`:29`），`drewAny=false`（`:236`）→ **全黑**。因此「黑屏」=「所有视频源在绘制时 `readyState<2`」。问题归结为：**为什么源迟迟到不了 `readyState≥2`？**

### 3.2 真正根因：后端不支持 HTTP Range → `<video>` 不可 seek → 冷 seek 触发整文件重下载

**(a) 后端静态文件路由用裸 `FileResponse`，且 Starlette 版本不支持 Range。**

`backend-services/basic-service/app/routers/storage_files_router.py:111-226`（`serve_storage_file`）最终：
```python
return FileResponse(
    path=str(absolute_path),
    headers=headers,                    # 仅 X-Content-Type-Options: nosniff
    filename=basename,
    content_disposition_type="inline",
)
```
该 `FileResponse` 来自 **Starlette 0.27.0**（打包 site-packages 与 `requirements.txt:41` 均钉死 `starlette==0.27.0`，`fastapi==0.104.1`）。在 0.27.0 中：

- `starlette/responses.py` 的 `FileResponse.__call__`（`:332` 起）发送 `"status": self.status_code`，`status_code` 默认 **200**（`:289`），**全程没有任何 Range 分支**；
- 对整个 `starlette/` 包搜 `accept-ranges` / `content-range` / `http_range` / `bytes=` —— **零命中**。

即 **Starlette 0.27.0 的 `FileResponse` 一律返回 `200` 整文件、不带 `Accept-Ranges`，无视请求里的 `Range` 头**。（`FileResponse` 的 Range 支持是 Starlette **0.37.0**（2024）才加入的；0.27.0 的 `StaticFiles` 同样不带 Range，搜 `staticfiles.py` 亦零命中 —— 所以**回退到旧 `StaticFiles` 挂载也修不好**。）

**(b) 浏览器行为：没有 `Accept-Ranges` 的资源不可随机 seek，seek = 从 0 整文件重下载。**

Chromium 对 `<video>` 永远先发 `Range: bytes=0-`。当响应是 `200` 且**无** `Accept-Ranges` 时，浏览器把该资源标记为**不可分片/不可随机 seek**：要到达任何「尚未顺序下载到」的位置，必须**放弃当前下载、发起一条新的从字节 0 开始的请求**，顺序读到目标时间为止。在这段整文件重下载完成前，`readyState` 掉到 < 2 → §3.1 的黑屏窗口被打开。

**(c) 前端时序逻辑把「冷 seek」放大成「持续黑」。**

预览必然要 seek 解码元素：合成时间 → 源时间经 `activeClipAt`/ClipTimeMapping 映射为 `clipStart + (t - startTime)`（`VideoSourcePool.ts:187` 用 `hit.sourceTime`）。带 trim 的 clip、点击中段、播放中落后回拽都会触发 `_ensureSeeked` 赋值 `currentTime`（`VideoSourcePool.ts:377-391`）。每次赋值在「不可 seek 资源」上 = 一次新的整文件 `200` 重下载。自由奔跑的合成时钟领先解码、去抖阈值反复命中，于是**重下载被一遍遍重启**，元素**永远到不了 `readyState≥2`** → 持续黑。

### 3.3 运行时实证（打包 backend.log，当前会话）

- 视频 `.mp4` 状态码统计：**152×`200`、16×`404`、`206`=0**（§2.2 命令输出）。
- 新上传的 `huaqiang.mp4`：会话内 **28 次 GET 全 `200`**；首次 `Response: 200 - 5.814s`（整文件下载耗时），随后 1–2 秒内出现**一大批**对**同一文件**的快速 `200` 请求（每个 0.02–0.06s）—— 即「seek→从头重下载」被反复触发的指纹（filmstrip 抽帧/缓存预载亦叠加，但核心是同一不可 seek 的 200 流）。
  - 证据行：backend.log 中 `08:02:58 Response: 200 - 5.814s` 之后，`08:02:58–08:02:59` 段内 `GET .../huaqiang.mp4` 与 `Response: 200` 成簇交替（uvicorn 访问行均为 `"GET .../huaqiang.mp4 HTTP/1.1" 200 OK`）。
- 旁证（与本根因无关、但说明 §2.2 统计里的 404）：`6a99a7ee….mp4`、`thumb_….jpg` 的 404 是**早于本次修复**被 `video_analysis_service` 误删的旧文件（该删除缺陷已由 `29a908f` 的临时目录白名单护栏修复 —— backend.log `08:02:58` 可见 `Skipped delete (outside temp): …\storage\static\video\thumbnails\huaqiang`，护栏生效）。**本轮 `huaqiang.mp4` 文件存在、返回 200，黑屏与文件缺失无关。**

### 3.4 为什么 dev 也复现、为什么前 4 轮修复全部失效

- **dev 同病**：`requirements.txt` 钉死 `starlette==0.27.0`，dev 后端同样不支持 Range，故黑屏在 dev 也存在（dev 下「位置 0 顺序起播能出图」只是因为它从字节 0 顺序下载、无需 seek）。这解释了为何**纯前端**的 4 轮修复（含在 dev 验证全绿）从未真正解决问题。
- **前 4 轮修复失效的本质**：它们（握手重锚 A1、播放态空帧补画 A2、去掉 500ms 预算 A3-a、解码/音频解耦、playhead 节流）全部假设「seek 落定后元素很快 `readyState≥2`」。但在**不可 seek 资源**上，落定意味着「整文件重下载完成」（数秒），且时钟/去抖会在落定前再次发起 seek（再次重下载）→ 元素**结构性地**长期不就绪。**没有任何前端绘制时序能画出一个永远没有当前帧数据的 `<video>`**。这也是「修了 4 次仍黑」的根本原因。
- **单测全绿的盲区**：所有引擎单测用的假 `<video>`（`MultiTrackPlaybackEngine.test.ts` 等）`readyState` 由测试自行翻转为就绪，**从不模拟「seek 在不可 Range 资源上触发整文件重下载、长期停在 readyState<2」**这条真实失败路径，因此测试覆盖不到本根因。

---

## 4. 影响面（Impact surface）

- **受影响功能**：剪辑预览的**所有 seek 场景** —— 点击标尺到中段、播放带 trim 入点（`clipStart>0`）的 clip、跨 clip 边界、关键帧跳转、播放中元素落后被回拽；以及第 1 轮反馈的「卡顿/无法流畅播放」本身（顺序播放也会因元素落后触发 seek→重下载而卡死）。
- **同时受影响**：独立**音频轨**的 seek/scrub（`AudioSyncPool` 同样靠 `<audio>.currentTime` seek，同一 200 无 Range）、波形/缩略图抽帧的随机 seek 抽帧也被迫整文件下载（性能与噪音放大）。
- **受影响环境**：**dev 与打包桌面端均受影响**（同为 starlette 0.27.0）。素材越大 / 码率越高 / seek 越靠后，黑屏与卡顿越稳定。
- **严重度**：高 —— 这是「达芬奇级顺滑预览」目标的核心可用性阻断，且是跨环境、结构性的。
- **不受影响**：**导出**（后端 ffmpeg 直接读磁盘文件，不经浏览器 `<video>`/Range，故导出正常 —— backend.log `08:03` 一次导出成功可证）；从 clip 起点、未 trim、顺序播放且文件较小可在数秒后出图。

---

## 5. 候选修复方案（Candidate fixes）

> 不变量：浏览器媒体元素要能随机 seek，服务端必须支持 HTTP Range（对带 `Range` 的请求返回 `206 Partial Content` + `Content-Range` + `Accept-Ranges: bytes` + 切片 `Content-Length`）。修复集中在**后端单文件**，前端无需再动。

| 方案 | 核心做法 | 侵入性 | 风险 | 工作量 | 是否根治 |
|---|---|---|---|---|---|
| **F1. 在 `storage_files_router.serve_storage_file` 内实现 Range** | 解析 `Range: bytes=start-end`，越界返回 `416`，命中返回 `206` + `Content-Range: bytes s-e/size` + `Accept-Ranges: bytes` + `Content-Length=e-s+1`，用 `StreamingResponse`/自定义响应**只流式发送该切片**；无 `Range` 头 / `HEAD` 走现有 `200` 路径；完整保留鉴权/属主/nosniff/危险扩展逻辑 | 小（后端 1 文件，~30-50 行） | 低（Next 代理已转发 `range` 并放行 `accept-ranges/content-range`，见 `src/app/api/storage/files/[...path]/route.ts`，无需改前端/代理） | 小-中 | ✅ 完整：恢复 video+audio 全部 seek，dev/打包同解 |
| **F2. 升级 Starlette ≥0.37（连带兼容 FastAPI）让 `FileResponse` 自带 Range** | 改 `requirements.txt` 依赖版本 | 大（横跨全栈的依赖大版本跳变；FastAPI 0.104→兼容版需整体回归） | 高（整应用回归面：中间件、pydantic、路由签名等） | 中-高 | ✅ 但过重、回归风险大 |
| **F3. 回退到 `StaticFiles` 挂载** | 用 `app.mount` 取代鉴权路由 | 小 | 高（**重新打开 V01-C 的鉴权/属主越权漏洞**；且 Starlette 0.27.0 的 `StaticFiles` **同样不带 Range**，根本不解决黑屏） | 小 | ❌ 既不修黑屏又制造安全回归 |
| **F4. 前端：对 direct-local 素材也整文件下成 blob 再播** | 让 `preferLocalProxy` 对直传本地素材也生效，`<video>.src` 指向可 seek 的内存 blob | 中（前端） | 中（内存占用大、放弃流式、首帧更慢、且**不覆盖音频/抽帧等其它 `<video>` 消费者**） | 中 | ⚠️ 仅前端规避，非根治 |

---

## 6. 推荐方案（Recommended fix）

**推荐 F1：在 `storage_files_router.serve_storage_file` 中实现 HTTP Range（返回 `206` 分片）。**

理由：
1. **对症根治且最小**：黑屏的承重根因是「服务端不分片 → `<video>` 不可 seek」。F1 在唯一的承重点（后端静态文件服务）补上 Range，**一处修复同时解决** video 预览黑屏、音频 scrub、抽帧随机 seek，且 **dev 与打包同解**；前端 4 轮时序修复（握手/补画/节流）可保留为「就绪后顺滑出图」的增益，但不再是承重。
2. **不引入依赖风险**：相较 F2 的全栈大版本跳变，F1 只改后端单文件、不动 starlette/fastapi 版本，回归面极小；Next 代理（`forwardHeaders:['range']` + `responseHeaderAllowlist` 含 `accept-ranges/content-range`）**已经为 Range 就绪**，无需改前端/代理。
3. **安全姿态不变**：在现有 `_validate_path` 防遍历、`user_<id>` 属主校验、`nosniff`、危险扩展 attachment 等逻辑**之后**再做 Range 切片即可，不开任何新口子（对照 F3 会重开越权漏洞）。
4. **导出不受影响**：导出走后端 ffmpeg 读盘，不经此路径，零回归。

**落地要点（供 Subtask #2）**：
- 在 `serve_storage_file` 的「安全媒体」返回分支前，读取 `request.headers.get('range')`：
  - 无 `Range` 或 `HEAD` → 维持现有 `FileResponse(..., 200, content_disposition_type='inline')`，但**补上 `Accept-Ranges: bytes` 响应头**（告知客户端支持分片）。
  - 有 `Range: bytes=start-end`：用 `os.stat` 取 `size`，解析/clamp `start/end`（支持 `bytes=start-`、`bytes=-suffix`）；非法/越界返回 `416 Range Not Satisfiable` + `Content-Range: bytes */size`；否则返回 `StreamingResponse(iter_slice, status_code=206, headers={... 'Content-Range': f'bytes {start}-{end}/{size}', 'Accept-Ranges': 'bytes', 'Content-Length': str(end-start+1), 'Content-Type': <由扩展名推断>, 'X-Content-Type-Options':'nosniff'})`，按块（如 64KB）`seek`+`read` 该切片。
  - 危险扩展分支维持强制 `attachment` + `text/plain`（可不支持 Range，安全优先）。
- **先写可复现失败用例（修 bug 先复现）**：对 `serve_storage_file` 发带 `Range: bytes=0-1023` 的请求，断言 `status==206`、`Content-Range` 正确、`len(body)==1024`、`Accept-Ranges=='bytes'`（修复前断言 `200`/无 Content-Range → 红，修复后 → 绿）；再加 `bytes=-N`（尾部）、越界 `416`、无 Range 仍 `200` 三个用例。
- **验证**：`curl -H "Range: bytes=0-1023" .../huaqiang.mp4` 返回 `206`；backend.log 视频请求出现 `206`；预览中段 seek 后 ≤1 个 seek 周期出图、不再持续黑；dev 与重打包桌面端各验证一次。

---

## 7. 关键证据索引（file:line / log）

| 证据 | 位置 | 说明 |
|---|---|---|
| 合成器未就绪即不画（黑屏直接成因） | `src/components/video/playback/CanvasCompositor.ts:288-290`（+ `:224-225` 黑底、`:236` drewAny） | `readyState<2 → return false` |
| 后端用裸 `FileResponse` 服务静态文件 | `backend-services/basic-service/app/routers/storage_files_router.py:221-226`（+ `main.py:704-715` 挂载说明） | 无 Range 处理 |
| Starlette 0.27.0 `FileResponse` 无 Range 分支、默认 200 | 打包 `…/site-packages/starlette/responses.py:283-350`（`status_code=200@:289`、`__call__@:332`）；全包搜 `accept-ranges/content-range/bytes=` 零命中 | 一律 200 整文件、无 Accept-Ranges |
| 依赖钉死 0.27.0（dev 同病） | `backend-services/basic-service/requirements.txt:41`（`starlette==0.27.0`）、`:14`（`fastapi==0.104.1`） | dev 与打包同病 |
| 运行时 0×206 / 152×200 | 打包 backend.log（`grep '"GET *.mp4 HTTP/1.1" <code>'` → 152×200、16×404、0×206） | 后端从不分片 |
| 新上传文件 28×200、首载 5.814s、成簇重请求 | backend.log `08:02:58 Response: 200 - 5.814s` 及其后 `08:02:58–08:02:59` 的 `GET …/huaqiang.mp4` + `Response: 200` 簇 | seek→整文件重下载指纹 |
| 源时间映射触发 seek | `src/components/video/playback/VideoSourcePool.ts:187`（`hit.sourceTime`）、`:377-391`（`_ensureSeeked` 赋 `currentTime`） | clip seek 必经路径 |
| Next 代理已为 Range 就绪（无需改前端） | `src/app/api/storage/files/[...path]/route.ts:17-30`（`forwardHeaders:['range','cookie']` + `responseHeaderAllowlist` 含 `accept-ranges/content-range`） | 修复仅需后端补 206 |
| 删除护栏已修、文件存在（排除文件缺失） | backend.log `08:02:58 Skipped delete (outside temp): …\thumbnails\huaqiang`；`29a908f` 临时目录白名单 | 本轮 huaqiang.mp4 返回 200，黑屏≠文件缺失 |
| 导出不受影响（反证根因边界） | backend.log `08:03` 一次导出 `composition completed` + 下载 200 | 导出走 ffmpeg 读盘，不经 `<video>`/Range |

---

## 结语（给下游节点）

- **承重根因 = 后端不支持 HTTP Range（Starlette 0.27.0 `FileResponse` 一律 200 整文件）**，前 4 轮纯前端时序修复因「假设元素会很快就绪」而全部落空。修复应落在 **F1（后端 `storage_files_router` 实现 206 分片）**，前端无需再改。
- **Definition of Done 对照**：复现步骤可照做（§2，含一行 `curl`/`grep` 客观判据）；根因有**多重实证**（后端源码 `file:line` + 打包 backend.log `0×206/152×200` 状态码统计 + Starlette 包零 Range 命中 + 依赖钉死），非推测；给出**候选方案对比表 + 唯一承重推荐 F1 + 可照做落地要点**。

---

## 评审结论（Review Verdict）

- **评审节点**：Subtask #1（分析报告评审与修复）
- **评审人**：Anthropic 工程团队 高级评审
- **评审方式**：对报告每一条「承重证据」做**独立复核**（重新打开 `file:line`、重跑 `grep` 统计、核对依赖与挂载拓扑），而非复述原文。

### A. 根因证据复核（逐条独立验证）

| # | 报告论断 | 我的独立复核结果 | 判定 |
|---|---|---|---|
| 1 | 合成器 `readyState<2` 即不画 → 黑屏直接成因 | `CanvasCompositor.ts:290`（`_drawVideoLayer` 守卫 `source.readyState<2 → return false`）确凿；并且 `:253`（`_baseFit` 同样跳过未就绪层）、`:224-225`（`renderFrame` 先铺 `letterboxColor` 黑底）、`:236`（`drewAny=false`）共同坐实「所有视频层未就绪 ⇒ 画布纯黑」 | ✅ 成立（证据比原文更全） |
| 2 | `serve_storage_file` 用裸 `FileResponse`、无 Range 处理 | `storage_files_router.py:221-226`（安全媒体分支）与 `:210-215`（危险扩展分支）均为裸 `FileResponse`，函数体 `:111-226` 通篇无 `range` 读取；`request: Request` 已注入但 docstring 自承「unused」——**意味着 F1 读 `request.headers.get('range')` 无需改签名** | ✅ 成立 |
| 3 | Starlette 0.27.0 `FileResponse` 不支持 Range、一律 200 整文件 | `desktop/build/.../starlette/__init__.py` `__version__=="0.27.0"`；`responses.py` `FileResponse.__call__`（`:332-366`）的发送体 `:353-364` 是 `while more_body: chunk = await file.read(chunk_size)` 的**从字节 0 顺序读整文件**循环，`:346` 恒发 `status=self.status_code`（默认 `200@:289`），全程无任何 Range 分支；对 `responses.py` 与 `staticfiles.py` 搜 `range/accept-ranges/content-range/bytes=` **均零命中** | ✅ 成立（这是最承重的一环，已逐行核到读文件循环） |
| 4 | 依赖钉死 0.27.0 / 0.104.1（dev 同病） | `requirements.txt:41 starlette==0.27.0`、`:14 fastapi==0.104.1` | ✅ 成立 |
| 5 | 前端 seek 必经路径 | `VideoSourcePool.ts:187`（`desiredSourceTime=hit.sourceTime`）、`:377-391`（`_ensureSeeked` 向 `el.currentTime` 赋值）；`:370-376` 的注释正是上一轮 `09bbc0a` 的**前端时序**修复说明，反证前序修复确为时序层 | ✅ 成立 |
| 6 | Next 代理已为 Range 就绪（前端无需改） | `src/app/api/storage/files/[...path]/route.ts:21 forwardHeaders:['range','cookie']`、`:22-28 responseHeaderAllowlist` 含 `accept-ranges`/`content-range` | ✅ 成立（「前端无需改」可信） |
| 7 | F3（回退 StaticFiles）不可行 | 双重失败已证实：① `staticfiles.py`（0.27.0）搜 Range 零命中——回退**也不修黑屏**；② `storage_files_router.py:1-28` docstring 的 V01-C 属主模型证明匿名 StaticFiles 挂载**本就有越权漏洞**，回退即**重开 CVSS 7.5** | ✅ 成立 |
| 8 | 「前 4 轮修复全部落空」 | `git log -- storage_files_router.py` 显示其最近一次改动为安全提交 `5473c7a`；`4c5ca49/d22d787/fed1e02/09bbc0a` **无一触碰 `storage_files_router`**（逐一 `git show --stat` 计数=0）——**承重修复点结构性地从未被改过**，远比「都是时序」更有力 | ✅ 成立（已加固） |

### B. 运行时日志证据——需要更正/补强的一处

报告 §2.2/§3.3/§7 把「打包 backend.log」的具体数字（`152×200`、`huaqiang.mp4 28×200`、首载 `5.814s`、`08:02:58` 簇）当作铁证。复核发现：

- **该「打包 backend.log」不在工作树内**（仓内 `desktop/logs/backend.log` 是 2026-06-09→06-11 的 **dev 会话**，引用的是 `6a99a7ee….mp4` 而非 `huaqiang.mp4`，全文无 `huaqiang`；`JRAgentMesh` 打包目录下也未找到对应 backend.log）。**故上述打包会话的精确计数在本仓内不可独立复现**，应降级为「来自一次未入库的打包会话日志」的旁证，而非可复跑的硬证。
- **但根因的定性铁证仍可在仓内 dev 日志独立复现**，足以替代：`desktop/logs/backend.log` 中 mp4 访问行 `"GET …mp4 HTTP/1.1" <code>` 统计为 **`9×200 / 10×404 / 0×206`**，全文 `accept-ranges`/`content-range` **0 次命中**（注意：裸 `grep -c 206` 得 360 是 `user_c206cf92…` 这类 UUID 的**假阳性**，须用 mp4 访问行正则过滤）。即「**后端从不返回 206、从不带 Range 头**」这一承重结论**在仓内可复跑**。
- **附带澄清一个反例**：该 dev 日志里主视频 `6a99a7ee….mp4` 多为 **404**——这是**另一种**黑屏成因（文件缺失 → 元素 error → `readyState` 停在 0），报告 §3.3 已正确区分（文件缺失 ≠ 本轮 Range 黑屏，且删除缺陷已由 `29a908f` 护栏修复）。本轮 `huaqiang.mp4` 返回 200 才把 Range 隔离为唯一变量，区分成立。

### C. 反例 / 替代解释审查（报告是否遗漏）

1. **URL/blob/比较键误解析（历史 RC-B）**：被**排除**——日志里同一文件被反复成功 `200` 拉取，证明 URL 解析正确、文件确被取到，黑屏不是「源解析错」。
2. **解码失败**：被**排除**——区分指纹是「seek→从头整文件重下载」（多次完整 200），而非「一次下载后 error 事件」；机制自洽（该重下载簇本身只在未入库的打包日志可见，但代码级 Range 缺失已是充分证明）。
3. **Chromium「无 `Accept-Ranges` 即不可随机 seek、seek=从 0 重下」**：属浏览器既有行为，机制成立；本仓证据链对它的依赖是「锦上添花」而非「承重」——即便不引用重下载簇，§A#1+§A#3 两条（合成器门 + 服务端结构性无 Range）已闭合因果。

### D. 候选修复审计（边界/最小化/回归）

- **F1 是对症的最小修复**：唯一承重点（`storage_files_router` 静态文件服务）补 Range，一处即恢复 video 预览 seek；不动 starlette/fastapi 版本（回避 F2 的全栈大版本回归）；安全逻辑顺序不变（回避 F3 的越权回归）；导出走 ffmpeg 读盘、零回归。**结论：采纳 F1。**
- **F1 落地必须补齐的边界（交付给 Subtask #2，原报告 §6 未尽之处）**：
  1. **异步 I/O，勿阻塞事件循环**：分片 `seek+read` 须用 `aiofiles` 或 `run_in_threadpool`，与现有 `FileResponse`（anyio 异步）及 CLAUDE.md「async file I/O」约定一致；切忌在 `StreamingResponse` 生成器里裸用同步 `open/read`。
  2. **RFC 7233 的 416 语义要精确**：**语法非法/无法解析**的 `Range`（如 `bytes=abc`、多段 `bytes=0-9,20-29`）应当**忽略并回退 200**，而**非** 416；只有**语法合法但不可满足**（`start ≥ size`）才回 `416 Range Not Satisfiable` + `Content-Range: bytes */size`。原报告 §6 把「非法/越界」一并归为 416，需按此细化（媒体元素只发单段 `bytes=N-`，多段回退 200 即可，无需实现 multipart/byteranges）。
  3. **206 必须回带校验头**：现有 `FileResponse` 经 `set_stat_headers` 提供 `ETag`/`Last-Modified`，206 分支应同样回带（缓存正确性）；`If-Range` 可选支持。
  4. **保持 `Content-Disposition: inline` 与同一 `media_type` 猜测**：206 分支的 `Content-Type` 推断须与 200 分支一致，避免媒体类型漂移。
  5. **实现建议——移植而非手写**：直接把 Starlette 0.37 `FileResponse` 的 ~40 行 Range 逻辑**移植**为一个小 `RangeFileResponse`，比手搓 `Content-Range`/`Content-Length` 更不易出 off-by-one；危险扩展分支维持 attachment、**不**加 Range（安全优先）。
  6. **可接受的代价**：手写流式分片会**放弃内核 `sendfile`**（大文件 CPU 略升），相对「能 seek」的正确性收益可接受。
- **范围警示（不阻断本轮，但勿误判已修）**：F1 只覆盖 `/api/storage/files`（视频 + `cached_materials` + 经此路径的上传/抽取音频）。**TTS 生成音频另走 `main.py:676 /api/audio/generated`、`:685 /api/audio/subtitles` 两个 `StaticFiles` 挂载**，在 0.27.0 下**同样无 Range**，F1 不触及。故 §4/F1「一处同时解决音频 scrub」对**嵌入音轨与上传音频成立**，但**对 TTS 生成音频不成立**。本轮主诉是**视频**预览黑屏，TTS 音频 scrub 属**范围外**、不构成阻断；若日后要音频 seek 全面对齐，需对这两个挂载做同样的 Range 包装（或改走 Range-aware 处理器）。

### E. 最终推荐修复（单一）

**采纳 F1：在 `backend-services/basic-service/app/routers/storage_files_router.py` 的 `serve_storage_file` 安全媒体分支实现 HTTP Range（对带 `Range` 的请求返回 `206 Partial Content` + `Content-Range` + `Accept-Ranges: bytes` + 切片 `Content-Length`；无 `Range`/`HEAD` 维持 `200` 但补 `Accept-Ranges: bytes`；不可满足返 `416`；语法非法回退 `200`），按 §D 的 6 条边界落地，前端与 Next 代理均无需改动。**

理由（一句话）：黑屏的因果链已被独立验证闭合于「**合成器 `readyState<2` 不画**（`CanvasCompositor.ts:290`）」⇐「**源永远到不了就绪**」⇐「**服务端结构性无 Range，seek=整文件重下**（`FileResponse.__call__` 逐行读字节 0 起 + 0.27.0 零 Range + dev 日志 `0×206`）」；F1 在**唯一且从未被前 4 轮触碰**的承重点补 Range，是**对症、最小、低回归**的方案，F2/F3/F4 分别过重、双重失败、仅前端规避，均不取。

**Definition of Done 核对**：①证据链闭合——承重各环已逐条独立复核为 ✅，并已更正运行时日志可复现性（B 节）；②本节给出**单一**推荐修复 F1 + 显式理由 + 6 条边界落地约束 + 范围警示。仅修改了本 `analysis.md`，未触碰代码、未提交。

---

## 实施过程发现的方案缺陷（Issues Found During Implementation）

- **实施节点**：Subtask #2（代码修复与开发）
- **结论**：F1 的核心方案**成立且已落地**；但原 §6 落地要点中「无 Range / 回退场景**维持现有 `FileResponse(..., 200)`**」这一条在**实施时存在一处版本相关陷阱**，已按下述修正实现。

### 缺陷：本地 dev 与打包 prod 的 Starlette 版本不一致，`FileResponse` 对 Range 的行为不同

- **现象**：`requirements.txt` 钉死 `starlette==0.27.0`（打包/prod 用之，`FileResponse` 忽略 Range、恒 200）；但**本仓当前的 Python 环境装的是 `starlette==1.0.0`**（`python -c "import starlette;print(starlette.__version__)"` → `1.0.0`）。**1.0.0 的 `FileResponse.__call__` 会自行从 ASGI scope 读取 `Range` 头并处理**（满足→206、不可满足→416、语法非法→**400**）。
- **后果**：若按 §6 字面，对「语法非法 / 多段」的回退场景仍 `return FileResponse(...)`，则在 **dev(1.0.0) 上会被 `FileResponse` 二次解析 Range 而返回 400**（实测 `Range: bytes=abc` → 400），与 prod(0.27.0) 的「忽略 Range → 200」**行为不一致**，且与 RFC 7233「无法解析的 Range 应忽略并回退 200」相悖。这也使「先写可复现失败用例」在 dev 上无法稳定红/绿（因 `FileResponse` 抢先处理）。
- **修正（已实现）**：**只要请求带 `Range` 头，就完全接管响应、绝不交给 `FileResponse`**：
  - 可满足单段 → 自建 `StreamingResponse` 206 切片；
  - 语法合法但越界 → `Response` 416 + `Content-Range: bytes */size`；
  - 语法非法 / 多段 → **自建 `StreamingResponse` 整文件 200**（而非 `FileResponse`），保证跨 Starlette 版本行为一致（忽略 Range、回退整文件）。
  - **仅当请求不带 `Range` 头**时才走 `FileResponse(200)` 快路径（保留内核 sendfile），并补 `Accept-Ranges: bytes`。
- **代价说明**：浏览器 `<video>` 首请求即发 `Range: bytes=0-`，故绝大多数视频请求会走自建 206 流式分片、**放弃 sendfile**——这正是 §D.6 已接受的代价（「能 seek」的正确性收益 > 大文件 CPU 略升）。
- **6 条边界落实情况**：①异步 I/O：用 `aiofiles` 流式 `seek+read`（不阻塞事件循环）✅；②416 语义：仅 `start≥size` 回 416，语法非法回退 200 ✅；③校验头：206/整文件流式分支均回带 `ETag`/`Last-Modified`（与 `FileResponse.set_stat_headers` 同算法）✅；④`Content-Disposition: inline` + 同一 `media_type` 猜测 ✅；⑤危险扩展分支**维持 attachment、不加 Range**（安全优先）✅；⑥sendfile 取舍已接受 ✅。
- **验证**：新增 `tests/security/test_07_range_requests.py`（7 例：前缀/中段/开放/后缀 206 切片、越界 416、非法回退 200、无 Range 带 `Accept-Ranges`）**全绿**；既有 `tests/security/test_01_auth.py` 的 V01C 访问矩阵 8 例仍全绿（唯一失败 `test_V01D_admin_endpoint_blocks_anonymous` 为**与本修复无关的既存失败**，在原始代码上同样失败）。改动仅限 `app/routers/storage_files_router.py` + 上述新测试文件，未引入新依赖（`aiofiles>=23.0.0` 已在 `requirements.txt`），未提交。
