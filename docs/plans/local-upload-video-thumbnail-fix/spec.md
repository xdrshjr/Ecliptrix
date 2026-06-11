# 本地上传视频素材缩略图「图裂」修复 — 设计方案 (spec)

- **Feature slug**: `local-upload-video-thumbnail-fix`
- **版本 / Version**: **v2**（v1 由 Subtask #0「方案设计」撰写；v2 由 Subtask #1「方案评审与修复」逐节对照源码评审、就地修复 P0/P1）
- **作者 / Author**: Subtask #0（方案设计）
- **评审 / Reviewer**: Subtask #1（方案评审与修复）
- **创建日期 / 评审日期**: 2026-06-11 / 2026-06-11
- **关联背景**: `docs/plans/local-only-material-storage/spec.md`（OSS 移除，commit `09662fc`）、`docs/plans/local-video-editing-refactor/`（本地化编辑总改造，含 spec 06 持久化与 `useProjectAutosave`）
- **状态**: Reviewed（评审通过/有条件通过，见文末「评审结论」）

---

## 0. 评审记录 / Review Notes（Subtask #1，v2 新增）

> 评审方法：逐节对照实际源码核验本方案的每一处事实声明、行号引用、接口契约与既有约定，再按 **可行性 / 完整性 / 一致性 / 规模适度** 四维度提出问题。问题按 **P0（阻断，必须修）/ P1（重要，必须修）/ P2（建议，可后续）** 定级。**所有 P0 / P1 已在本文档 v2 正文就地修复**，P2 已就地优化或登记为残留事项。
>
> **已核验为准确的声明（无需改动）**：§2 根因分析、§2.1 链路行号（`useMaterialUpload.ts:93/100/340`、`createLocalMaterialFromUpload:114-117`、`storage_service.py:628` 的 `duration is not None` 强耦合、`MaterialsPanel.tsx:2102-2144` 的 `<img onError>` 仅 `console.error`、BFF `upload-video` `timeoutMs:120_000`）、`MaterialItem.metadata` 为含 `[key:string]:any` 的开放结构、`/api/video/analyze` 接受可选 `use_thumbnail`/`thumbnail_url`（后端 `video_router.py:626` `if request.use_thumbnail and request.thumbnail_url`，故 `use_thumbnail:false` 时退化为按 `video_url` 抽帧——本方案的 analyze 兜底无需改后端，可行）、`shutil.which` 既有写法（`material_download_service.py:639`）、AI/故事板路径确实已用 `extractVideoThumbnail`。整体根因定位**成立且证据扎实**。

### 0.1 问题清单

| 编号 | 维度 | 严重级 | 问题描述 | 处置 |
|---|---|---|---|---|
| **RV-1** | 一致性 / 完整性 | **P1** | **客户端 `data:` 缩略图会被持久化，污染项目存档**。本方案为 `MaterialItem.thumbnailUrl` 注入 base64 `data:` URL，但该字段会经 **两条持久化通道**落盘：① `useProjectAutosave` → `normaliseProjectDataForSave`（`src/lib/api/videoProjects.ts:195`）**仅剥离** `pendingTimelineData/pendingMaterials/uiState` 瞬态键，`...rest` 原样保留 `materials`（含 `thumbnailUrl`），故每次自动保存（800ms–10s）都会把数 KB~数十 KB 的 base64 PUT 到后端、并计入 skip-equal 比较；② `TimelineRepository.exportToJSON`（`...:291-298`）显式序列化 `thumbnailUrl: material.thumbnailUrl`，导入侧（`...:414`）原样读回。**这同时证伪了本方案 §8 R4「dataURL 为内存态、重载后丢失」的论断**（实际会被持久化并恢复），且**违反 spec 06 §2.1 刻意确立的「不把大体积派生数据内联进项目 JSON」约定**（该 spec 已为同样的体积原因移除了内联波形数组，见 `TimelineRepository.ts:264-266` 注释）。 | **已修**：§3.2 新增 (E) 持久化剥离规则、§4 增 2 个文件 + 1 项测试、§6 改写持久化说明、§8 重写 R4。 |
| **RV-2** | 完整性 / 规模适度 | **P2** | **§8 R2 把「同步 await vs fire-and-forget」留作「实现期二选一」**，属对实现者的开放式欠定，易在下游产生分歧。 | **已就地拍板**：§3.2(A) 与 R2 统一**采用同步 `await`**（仅在后端海报缺失的少数路径才进入、卡片本就处于 uploading 态、util 自带 10s 上限），并写明理由。 |
| **RV-3** | 一致性 | **P2** | **`metadata.thumbnailSource: 'backend'` 这个取值从未被真正写入**：`createLocalMaterialFromUpload` 走后端海报时不设该键，故「后端来源」实际表现为 `undefined`，§7 端到端用例原写「缺省/'backend'」语义含混。 | **已澄清**：§3.2/§6 明确「`undefined` 即视为后端来源（default）」，`'client'` 为唯一显式写入值，作为持久化剥离的判定键。 |
| **RV-4** | 可行性 | **P2** | **§3.2(C) 解耦 `duration` 后的 `midpoint` 公式丢失了原码 `min(duration,1)` 对「已知极短（<1s）视频」的保护**：原 `midpoint = duration/2 if duration>2 else min(duration,1)`；方案给的 `... else 1.0` 会对 0.5s 的视频以 `-ss 1.0` 抽帧（越界→抽帧失败）。 | **已修**：§3.2(C) 公式改为 `duration/2 if (duration and duration>2) else (min(duration,1.0) if duration else 1.0)`，既解耦 None 又保留极短视频的保护。 |
| **RV-5** | 可行性 | **P2（残留风险）** | **§8 R1 是本方案最大的运行期可行性风险**：客户端 `extractVideoThumbnail` 需用 `<video>` 解码**鉴权同源**的 `/api/storage/files/video/...`（含 `user_<id>` 段、走 cookie 鉴权）。理论成立（同源请求自动带 cookie、catch-all 路由透传 cookie），但与 AI/故事板路径的素材来源未必同形态，**必须在 §7 端到端环节实测确认**，不能仅凭「其它路径用过」推断。 | **保留并强化**：R1 升级为「必须 e2e 验证」的首要残留风险；最终仍有占位图标兜底，不致图裂，故不阻断设计。 |
| **RV-6** | 完整性 | **非问题（澄清）** | 当后端海报与客户端兜底**双双失败**时，`thumbnailUrl` 保持 `undefined`，`useMaterialUpload.ts:340` 条件为假 → 不触发 `triggerAutoAnalysis`。经核验**与现状行为一致**（现状海报缺失即不触发），**非回归**。 | 无需改；登记备查。 |

---

## 1. 概述 / Overview

Ecliptrix 已从「网页 + 云存储」形态演进为**自包含本地桌面应用**（Electron 外壳 + 内嵌 Python 后端 + Next.js standalone 前端 + 内置 ffmpeg，全部跑在 `127.0.0.1` 本地端口）。最近的重构（移除阿里云 OSS 上传链路、素材一律落本地 `STORAGE_ROOT`，见 `local-only-material-storage`）使「素材管理面板」中用户上传的素材只保存在本地。本需求要解决的是该重构后暴露出来的一个具体回归：**当用户上传的素材是「视频」时，上传完成后在素材管理面板里，这张视频素材卡片的缩略图显示为「图裂」（broken-image glyph）或空白，没有正确渲染出视频首帧海报**。图片素材不受影响，能正常显示缩略图。

经过对前后端链路的逐文件核查，问题的本质并非某一行写错，而是一个**架构性的单点依赖缺陷**：上传视频的缩略图**唯一来源**是「后端用 ffmpeg 抽帧生成的本地海报」（`static/video/thumbnails/{stem}/poster.jpg`，经鉴权端点 `/api/storage/files/...` 回放）。这条链路上的任何一环失败——海报没生成（`thumbnail_url` 为 `None`）或海报 URL 取不到——都会让卡片无图可显，而**前端在上传链路上没有任何兜底**，面板的 `<img onError>` 也只 `console.error` 不做恢复。与此形成对照的是：**视频进入编辑器的其它所有路径**（AI 生成视频 `useMaterialGeneration.ts:178`、AI 脚本生成 `useAIVideoScriptGeneration.ts:122`、故事板 `storyboardThumbnail.ts:16`）**早就都用客户端 canvas 抽帧 `extractVideoThumbnail()` 兜底**，唯独「用户手动上传」这条路径从未获得同样的安全网。图片之所以不出问题，是因为图片卡片的缩略图 URL 直接复用上传后的图片文件本身（`thumbnailUrl = localUrl`），文件必然存在，因此永远能渲染。

因此本方案的目标是：**为上传视频补齐与其它视频路径一致的客户端缩略图兜底，并为面板补齐 `<img>` 加载失败的恢复逻辑，同时对后端海报生成做防御性加固**，使「视频素材卡片永远显示出正确的缩略图，绝不出现图裂或永久空白」，且不改动公开 REST 路径、不引入新的存储目录结构、对图片/音频路径零影响。

---

## 2. 问题定位 / Root-Cause Analysis

### 2.1 现状链路（用户上传视频）

```
用户选择/拖拽视频文件
 └─ useMaterialUpload.ts  uploadSingleFile()  (materialType==='video', L60–100)
      POST /api/storage/upload-video  (FormData: file, task_id, generate_thumbnail='true', user_id)   L62–72
 └─ Next.js BFF: src/app/api/storage/upload-video/route.ts  (createPassthroughRoute, timeoutMs=120_000)
 └─ FastAPI storage_router.upload_video → storage_service.upload_video_file()   (storage_service.py L558–685)
      1) upload_file(folder='video') 落盘到 STORAGE_ROOT/video/YYYY/MM/DD/user_<id>/[task]/<uuid>_<name>.mp4
      2) ffprobe 取 duration/width/height                                          L594–625
      3) IF (generate_thumbnail AND duration is not None):  ffmpeg 抽中点帧 → static/video/thumbnails/{stem}/poster.jpg   L627–669
            仅当 returncode==0 且文件存在时  thumbnail_url = /api/storage/files/static/video/thumbnails/{stem}/poster.jpg   L658–660
            否则 thumbnail_url 保持 None
      4) return { video_url, thumbnail_url, duration, width, height, ... }
 └─ createLocalMaterialFromUpload()  (localMaterial.ts L99–147)
      thumbnailUrl = materialType==='image' ? localUrl : (result.thumbnail_url || existingMaterial.thumbnailUrl)   L114–117
 └─ MaterialsPanel.tsx 渲染卡片：material.thumbnailUrl ? <img src=…> : <占位 SVG 图标>   L2103–2144
      <img onError> 仅 console.error，无恢复                                          L2115–2122
```

缩略图 URL 的回放走**鉴权端点**（非匿名 StaticFiles）：`storage_files_router.serve_storage_file`（`Depends(get_current_user)`）。`<img>` 标签无法发送 `Authorization` 头，靠的是后端 `dependencies/auth.py:_extract_token` 的 **`ecliptrix-session-token` cookie 兜底**（L47–51），该 cookie 由前端 `lib/auth/storage-keys.ts:setSessionToken()` 以 `path=/; SameSite=Lax` 写入，并由 catch-all 路由 `src/app/api/storage/files/[...path]/route.ts` 透传 `cookie` 头。海报路径 `static/video/thumbnails/{stem}/poster.jpg` 不含 `user_<id>` 段，`_extract_owner_from_path` 返回 `None` → 归属校验 fall-through → 任意已登录用户可读。

### 2.2 两种失败模式（同一根因）

| 模式 | 触发条件（已核实证据） | 卡片表现 |
|---|---|---|
| **A — 海报没生成** | `storage_service.py:628` 把抽帧**强耦合**到 `duration is not None`：某些容器（部分 MP4/MOV/碎片化 fMP4/WebM）ffprobe 的 `format.duration` 缺失（时长只在 stream 上），`duration` 取不到 → 整段抽帧被跳过；或 ffprobe/ffmpeg 调用失败/超时（裸字符串 `"ffmpeg"`/`"ffprobe"` 依赖进程 PATH）。结果 `thumbnail_url=None`。 | `material.thumbnailUrl` 为 `undefined` → 不渲染 `<img>`，显示占位图标（空白卡片） |
| **B — 海报生成了但取不到** | 海报 URL 非空但 `<img>` 子请求加载失败：上传响应在 Next 代理 `timeoutMs=120_000` 截断而后端仍在落盘（海报尚未刷盘的瞬时 404）、或鉴权子请求在特定运行时未带上 cookie、或返回体非图片。`<img onError>` 只打日志不恢复。 | 浏览器渲染 **broken-image glyph（图裂）** |

> 用户报告的「图裂」字面对应**模式 B**；模式 A 表现为空白占位。两者根因相同——**上传视频缩略图是单点、auth-gated 的后端海报，且前端无任何兜底**。本方案的修复同时覆盖 A、B 两种模式，保证最终结果一致：卡片永远显示真实缩略图，绝不图裂、绝不永久空白。

### 2.3 为什么是「重构引入」且「仅视频」

- **重构引入**：OSS 时代视频缩略图可能是公网 CDN URL（`<img>` 无需鉴权即可加载）；移除 OSS 后缩略图变为 auth-gated 同源海报，单点化、且失去了「公网可读」这一隐性容错。AI/搜索/故事板路径因为本来就用 `extractVideoThumbnail` 客户端兜底，所以不受影响——唯独上传路径裸奔。
- **仅视频**：图片缩略图 `thumbnailUrl = localUrl`（上传后的图片文件本身），文件必然存在且必然是图片，永远能渲染；视频缩略图是**另外生成的海报**，存在性与可达性都不保证。

### 2.4 已排除的伪命题（避免下游走弯路）

1. **路径双重 `static/` 嵌套不是问题**：海报写入与回放都走同一个 `storage_service._validate_path(thumb_relative)`（相对 `STORAGE_ROOT` 解析，`storage_service.py:_validate_path` L120–225 已核实对称），写=读，路径自洽。
2. **归属/鉴权不是「仅视频」的差异点**：图片与视频海报都经同一鉴权端点 + 同一 cookie；cookie 由 `setSessionToken` 实打实写入（`storage-keys.ts:36–47`）。若 cookie 失效，图片也会一起裂——与「仅视频」矛盾，故 cookie 整体失效不是主因（但模式 B 的瞬时不可达仍需 `onError` 兜底）。
3. **派生文件 GC 不是主因**：`derived_gc_service` 在 referenced 集合为空/异常时**整体跳过**（"when unsure, keep"，启动期仅 dry-run），不会误删刚生成的海报。

---

## 3. 技术设计 / Technical Design

### 3.1 设计原则

1. **复用既有机制，不造新轮子**：客户端兜底直接复用 `src/components/video/utils/extractVideoThumbnail.ts` 的 `extractVideoThumbnail(videoUrl)`（已被 AI/故事板路径验证可用，内部已处理跨域代理与 10s 超时，返回 JPEG dataURL 或 `null`）。
2. **后端海报仍为「主来源」，客户端为「兜底」**：后端海报是落盘、可跨会话持久的；客户端 dataURL 是内存态、刷新即失。故优先用后端海报，仅在其缺失/加载失败时才回退到客户端抽帧，保证「重载项目后仍有缩略图」的语义不退化。
3. **分层防御**：上传时兜底（治模式 A）+ 面板 `onError` 兜底（治模式 B）+ 后端加固（降低模式 A 概率）。任一层失效，下一层仍能保证不出图裂。
4. **最小改动、零接口变更**：不改公开 REST 路径、不改存储目录结构、不动图片/音频路径；前端类型仅做必要的元数据标注。

### 3.2 关键改造（按文件，供下游逐行实现）

**(A) 前端·上传链路兜底〔核心，治模式 A〕** — `src/components/video/hooks/materialManagement/useMaterialUpload.ts`
- 顶部新增 import：`import { extractVideoThumbnail } from '../../utils/extractVideoThumbnail';`
- 在 `uploadSingleFile()` 视频分支、`const videoMaterial = createLocalMaterialFromUpload(material, file, result);`（当前 L93）**之后、`return videoMaterial;`（L100）之前**插入兜底（**采用同步 `await`，见 §8 R2 决议**）：
  ```ts
  // 后端 ffmpeg 海报是首选（落盘、可持久）；若缺失（ffprobe 取不到时长、
  // ffmpeg 失败或被跳过），回退到与 AI/故事板路径一致的客户端 canvas 抽帧。
  // extractVideoThumbnail 内部自带 10s 超时与跨域代理，返回 dataURL 或 null。
  // 仅在 thumbnailSource==='client' 时显式标注；后端海报（默认来源）不写该键，
  // 「undefined === 后端来源」是约定（见 §6）。该标注是 (E) 持久化剥离的判定键。
  if (!videoMaterial.thumbnailUrl && videoMaterial.url) {
    const dataUrl = await extractVideoThumbnail(videoMaterial.url);
    if (dataUrl) {
      videoMaterial.thumbnailUrl = dataUrl;
      videoMaterial.metadata = {
        ...videoMaterial.metadata,
        thumbnailSource: 'client', // 标注为内存态客户端缩略图（不持久化，见 (E)）
      };
    }
  }
  ```
- **与自动解析的交互**（必须处理）：`processFileUpload` 的 `processNextTask` 在上传成功后，若 `uploadedMaterial.thumbnailUrl` 为真即触发 `triggerAutoAnalysis`（当前 L340–342）。`triggerAutoAnalysis`（L153–207）会把 `thumbnail_url: material.thumbnailUrl` 透传给 `POST /api/video/analyze`。**dataURL 不可被后端按 URL 拉取**，会导致解析侧拿到不可用的 `thumbnail_url`。故在 `triggerAutoAnalysis` 内对 `thumbnail_url` 加判定：仅当其为 http(s)/相对路径（即后端海报）时才传 `thumbnail_url` 并置 `use_thumbnail: true`；当其以 `data:` 开头（客户端兜底）时，改为不传 `thumbnail_url`、置 `use_thumbnail: false`，让后端从 `video_url` 自行抽帧分析。

**(B) 前端·面板 `<img>` 加载失败恢复〔治模式 B〕** — `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx`
- 现状：缩略图渲染在 L2102–2144，`<img onError>`（L2115–2122）仅 `console.error`。
- 改造为：将缩略图渲染抽成一个**小型受控子组件** `MaterialThumbnail`（同文件内或新建 `MaterialsPanel/MaterialThumbnail.tsx`，遵循单文件 ≤800 行、单函数 ≤50 行的项目阈值；MaterialsPanel 已较大，建议新建文件），职责：
  1. 以 `material.thumbnailUrl` 为初始 `src`；
  2. `onError` 时：若 `material.type==='video'` 且尚未尝试过客户端兜底 → 调 `extractVideoThumbnail(material.url)`，成功则把 `src` 切到 dataURL；
  3. 客户端兜底也失败（或非视频）→ 置内部状态 `failed=true`，渲染**与现有同款的占位 SVG 图标**（绝不渲染坏掉的 `<img>`）；
  4. 保留现有 `onLoad`/`onError` 的 `logger.debug`/`console.error` 诊断日志。
- MaterialsPanel 原 L2103–2144 的 `material.thumbnailUrl ? <img…> : <占位>` 整块替换为 `<MaterialThumbnail material={material} />`，占位图标分支逻辑搬入子组件（保持音频/图片/字幕/视频四类图标不变）。

**(C) 后端·海报生成加固〔降低模式 A 概率，可选但推荐〕** — `backend-services/basic-service/app/services/storage_service.py`
- 顶部已 `import shutil`？若无则新增 `import shutil`（文件已 `import subprocess`）。
- `upload_video_file()`（L558–685）内：
  1. **统一 ffmpeg/ffprobe 解析**：将裸 `"ffprobe"`（L597）与 `"ffmpeg"`（L648）替换为 `shutil.which("ffprobe") or "ffprobe"` / `shutil.which("ffmpeg") or "ffmpeg"`，与 `material_download_service.py:639` 既有写法一致，避免「装了但不在子进程 PATH」时静默失败。
  2. **解耦时长依赖**：将抽帧守卫 `if generate_thumbnail and duration is not None:`（L628）改为 `if generate_thumbnail:`；`midpoint` 计算改为：`midpoint = (duration / 2 if (duration and duration > 2) else (min(duration, 1.0) if duration else 1.0))`。即：时长 > 2s 取中点；已知但极短（≤2s，含 <1s）时退化为 `min(duration, 1.0)`（**保留原码对 <1s 视频的越界保护**，评审 RV-4）；时长未知（`None`/0）时退化为 1.0s。这样缺 `format.duration` 的容器也能产出海报，且不会对 0.5s 的短视频以 `-ss 1.0` 越界抽帧。
  3. 其余（`returncode==0 且文件存在才置 `thumbnail_url`、异常吞掉只 warn）保持不变。
- **不改** `_validate_path`、`_get_file_url`、目录结构、URL 形态。

**(D) 前端·类型标注（轻量）** — `src/types/index.ts`
- 在 `MaterialItem.metadata`（实际为 L565–574 的内联结构，已含 `storageKind/storageKey/localResolvedUrl/originalUrl/fileName/isLocalFile/downloadError` 与 `[key: string]: any`）中补充可选键 `thumbnailSource?: 'backend' | 'client'`（用于区分内存态客户端缩略图，供 (A) 标注、(B) 与 (E) 持久化逻辑识别）。`metadata` 现已是 `{ …; [key: string]: any }` 开放结构，新增具名键不破坏既有调用。语义见 §6：**`undefined` 即视为后端来源（default），`'client'` 为唯一显式写入值**。

**(E) 前端·持久化剥离客户端 `data:` 缩略图〔评审 RV-1，P1，治持久化污染〕**

> 背景（评审核验）：客户端兜底产出的 `data:` JPEG 会进入 `MaterialItem.thumbnailUrl`，而该字段会被**两条持久化通道**落盘：①自动保存 `useProjectAutosave` → `normaliseProjectDataForSave`（`src/lib/api/videoProjects.ts:195`）当前**只剥离瞬态键**、`...rest` 原样保留 `materials`，故每次自动保存都会把 base64 PUT 到后端；②`TimelineRepository.exportToJSON`（`src/components/video/timeline/infrastructure/TimelineRepository.ts:291-298`）显式写 `thumbnailUrl: material.thumbnailUrl`，导入侧 L414 读回。若不处理，会**违反 spec 06 §2.1「不把大体积派生数据内联进项目 JSON」的既定约定**（该 spec 已为同样原因移除内联波形，见 `TimelineRepository.ts:264-266`）。修复目标：**客户端 `data:` 缩略图绝不写入持久化载荷**；重载后由 (A)/(B) 的客户端兜底重新生成（与「派生资源按 materialId 重解析」的总约定一致）。

- **(E1) 自动保存通道** — `src/lib/api/videoProjects.ts` `normaliseProjectDataForSave()`
  - 在现有「剥离瞬态键」之后，对 `out.materials`（若为数组）做一次浅映射：当某 `material.thumbnailUrl` 以 `data:` 开头（或 `material.metadata?.thumbnailSource === 'client'`）时，**删除该 `thumbnailUrl`**（其余字段不动）。判定优先用 `data:` 前缀（最稳健，覆盖任何来源的内联图），`thumbnailSource` 仅作辅助。
  - 同理对 `out.timelineData?.tracks[].items[].thumbnailUrl`（item 快照也可能携带 `data:`）做同样剥离。
  - 抽一个内部纯函数 `stripInlineThumbnails(materials)` / 复用一个 `isDataUrl(s)` 守卫，保持单函数 ≤50 行。
- **(E2) 手动导出通道** — `src/components/video/timeline/infrastructure/TimelineRepository.ts` `exportToJSON()`
  - L296 `thumbnailUrl: material.thumbnailUrl` 改为 `thumbnailUrl: isDataUrl(material.thumbnailUrl) ? undefined : material.thumbnailUrl`；item 快照 L263 同理。`isDataUrl` 与 (E1) 共用一处定义（可放 `localMaterial.ts` 或一个小 util，避免重复）。
- **效果**：内存态 `data:` 缩略图照常用于面板即时显示，但**不进入** autosave PUT、skip-equal 比较与导出 JSON；项目存档体积不受影响，§8 R4 的「内存态、重载后丢失」论断在剥离后**重新成立**。

> **实现期收尾扫描**：`git grep -nI "extractVideoThumbnail" src/` 确认上传路径已接入；`git grep -nI "duration is not None" backend-services/basic-service/app/services/storage_service.py` 应为 0 命中；`git grep -nI "isDataUrl\|data:" src/lib/api/videoProjects.ts src/components/video/timeline/infrastructure/TimelineRepository.ts` 确认 (E) 持久化剥离已就位。

### 3.3 操作时序（修复后·上传视频）

```
上传视频 → uploadSingleFile()
  → POST /api/storage/upload-video → storage_service.upload_video_file()
       ffprobe(shutil.which) 取元数据
       ffmpeg(shutil.which) 抽帧（不再以 duration 为门槛；缺时长则 ss=1s）→ poster.jpg
       return { thumbnail_url(本地海报 或 None), … }
  → createLocalMaterialFromUpload(): thumbnailUrl = result.thumbnail_url || …
  → 〔兜底 A〕若 thumbnailUrl 仍为空 → extractVideoThumbnail(material.url) → dataURL → 置 thumbnailUrl + metadata.thumbnailSource='client'
  → setMaterials 替换为 completed
  → 自动解析：thumbnail_url 为后端 URL 才传；为 data: 则改用 video_url 抽帧
  → MaterialsPanel <MaterialThumbnail>
       优先 <img src=thumbnailUrl>
       〔兜底 B〕onError → 视频再试 extractVideoThumbnail(material.url) → 切 src；仍失败 → 占位图标（永不图裂）
```

---

## 4. 文件 / 模块变更计划 / File & Module Change Plan

| # | 文件 | 动作 | 一句话意图 |
|---|---|---|---|
| 1 | `src/components/video/hooks/materialManagement/useMaterialUpload.ts` | 修改 | 上传视频后若无后端海报，客户端 `extractVideoThumbnail` 兜底；自动解析对 `data:` 缩略图改走 video_url 抽帧（治模式 A） |
| 2 | `src/components/video/components/MaterialsPanel/MaterialThumbnail.tsx` | 新建 | 受控缩略图子组件：`onError` 时视频再抽帧、最终回退占位图标，永不渲染图裂 `<img>`（治模式 B） |
| 3 | `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` | 修改 | 用 `<MaterialThumbnail>` 替换 L2103–2144 内联缩略图/占位渲染块 |
| 4 | `backend-services/basic-service/app/services/storage_service.py` | 修改 | `upload_video_file` 用 `shutil.which` 解析 ffmpeg/ffprobe；抽帧解耦 `duration is not None`，缺时长退化 1s、极短视频 `min(duration,1.0)`（降低模式 A，评审 RV-4） |
| 5 | `src/types/index.ts` | 修改 | `MaterialItem.metadata` 增可选键 `thumbnailSource?: 'backend' \| 'client'`（`undefined`＝后端来源） |
| 6 | `src/lib/api/videoProjects.ts` | 修改 | **(E1) 评审 RV-1**：`normaliseProjectDataForSave` 剥离 `materials[*]`/`timelineData.tracks[*].items[*]` 中 `data:` 形态的 `thumbnailUrl`，使客户端兜底缩略图不进入自动保存载荷 |
| 7 | `src/components/video/timeline/infrastructure/TimelineRepository.ts` | 修改 | **(E2) 评审 RV-1**：`exportToJSON` 对 `material.thumbnailUrl` / item 快照 `thumbnailUrl` 做 `isDataUrl` 守卫，`data:` 缩略图不写入导出 JSON |
| 8 | `src/components/video/components/MaterialsPanel/__tests__/MaterialThumbnail.test.tsx` | 新建 | 覆盖：有效海报正常显示 / 海报加载失败→视频再抽帧→成功 / 再抽帧失败→占位图标（不出图裂） |
| 9 | `src/components/video/hooks/materialManagement/__tests__/useMaterialUpload.thumbnail.test.ts` | 新建 | 覆盖：后端 `thumbnail_url=null` 时上传路径调用 `extractVideoThumbnail` 并回填 dataURL；`data:` 缩略图不被当作 analyze 的 thumbnail_url |
| 10 | `src/lib/api/__tests__/videoProjects.normalise.test.ts`（或并入既有 `projectPersistence.integration.test.tsx`） | 新建/修改 | **评审 RV-1**：含 `data:` `thumbnailUrl` 的 material 经 `normaliseProjectDataForSave` 后 `thumbnailUrl` 被移除；非 `data:`（`/api/storage/files/...`）海报原样保留 |
| 11 | `backend-services/basic-service/tests/test_storage_video_thumbnail.py` | 新建/修改 | 覆盖：缺 `format.duration` 的视频仍生成海报；ffmpeg 失败时 `thumbnail_url` 为 None 且不抛异常 |

> 约束：仅改 `src/`、`backend-services/basic-service/`；**不要**手改 `desktop/build/`、`desktop/release/win-unpacked/resources/server`（被 gitignore 的构建产物，下次桌面构建自动同步）；不提交 `__pycache__`、`.next/`、`tsconfig.tsbuildinfo`。

---

## 5. 接口设计 / Interface Design

**REST 路径与签名全部不变**（保证零回归）：

| 端点 | 方法 | 变化 |
|---|---|---|
| `/api/storage/upload-video` | POST | 无路径/参数变化；`thumbnail_url` 仍为本地海报 URL 或 `None`（加固后更可能非空） |
| `/api/storage/upload-file` | POST | 完全不变（图片/音频路径零改动） |
| `/api/storage/files/{path}` | GET | 不变（鉴权回放，cookie 兜底不变） |
| `/api/video/analyze` | POST | 不变；前端调用侧在 `thumbnail_url` 为 `data:` 时改传 `use_thumbnail:false` 并省略 `thumbnail_url`（请求体既有可选字段，后端无需改） |

**前端内部函数签名**：
- `extractVideoThumbnail(videoUrl: string): Promise<string | null>` — 复用，签名不变。
- 新增 `MaterialThumbnail` 组件 props：`{ material: MaterialItem }`（其余样式 className 与现状一致：`w-full h-full object-cover`，外层 `aspect-video bg-muted`）。
- `createLocalMaterialFromUpload()` 签名不变；其返回对象可能在 (A) 中被就地补 `thumbnailUrl`/`metadata.thumbnailSource`。

---

## 6. 数据模型 / Data Model

**无数据库 schema 变更**（不新增/删除任何列，不写 alembic 迁移）。

仅前端内存态类型微调（`src/types/index.ts`）：

| 类型 | 字段 | 变化 |
|---|---|---|
| `MaterialItem.metadata` | `thumbnailSource?: 'backend' \| 'client'` | **新增可选键**（评审 RV-3 澄清语义）：**`undefined`（不写该键）＝后端落盘海报（默认，可持久、重载仍在）**；`'client'`＝客户端 canvas dataURL（内存态）。`'client'` 是唯一会被显式写入的取值，既供自动解析判别（§3.2(A)），也作为 (E) 持久化剥离的辅助判定键（主判定为 `thumbnailUrl` 的 `data:` 前缀）。 |

> 缩略图本身不入库：后端海报以文件形态存于 `STORAGE_ROOT/static/video/thumbnails/{stem}/poster.jpg`（既有，不变）；客户端兜底 dataURL 仅存于内存中的 `MaterialItem.thumbnailUrl`。**关键（评审 RV-1）**：该内存态 dataURL **必须经 §3.2(E) 在两条持久化通道（`normaliseProjectDataForSave` 自动保存、`TimelineRepository.exportToJSON` 手动导出）被剥离**，否则会随项目存档落盘，违反 spec 06 §2.1「不把大体积派生数据内联进项目 JSON」的约定。剥离后，重载时由客户端兜底重新生成（与「派生资源按 materialId 重解析」一致）。**持久化增强**（把客户端抽帧 blob 经 filmstrip 持久化通道 `extractVideoFrameBlobAt` + `/api/storage/thumbnails` 落盘，使重载后仍有持久缩略图）属可选后续增强，不在本次修复必做范围（见 §8 R4）。

---

## 7. 测试与验收 / Testing & Acceptance Criteria

**静态校验**
1. `npm run type-check` 通过；`npm run lint` 无新增错误（注意 `prefer-const`、`no-explicit-any` 阈值）。
2. `python -c "import app.services.storage_service"` 成功（验证 `shutil` 引入无误）。

**前端单测（vitest）**
3. `MaterialThumbnail.test.tsx`：(a) 传入有效 `thumbnailUrl` → 渲染 `<img>` 且 `onLoad` 后不触发兜底；(b) `<img>` 触发 `onError` 且 `type==='video'` → 调用一次 `extractVideoThumbnail(material.url)`（mock 返回 dataURL）→ `src` 切到 dataURL；(c) 再抽帧返回 `null` → 渲染占位 SVG，DOM 中**不存在** `src` 指向坏 URL 的 `<img>`（断言无图裂）。
4. `useMaterialUpload.thumbnail.test.ts`：(a) 后端响应 `thumbnail_url:null` → 上传路径 await `extractVideoThumbnail`（mock dataURL）→ 返回 material 的 `thumbnailUrl===dataURL` 且 `metadata.thumbnailSource==='client'`；(b) 后端响应含 `thumbnail_url` → **不**调用 `extractVideoThumbnail`；(c) `data:` 缩略图触发的 `triggerAutoAnalysis` 请求体不含 `thumbnail_url` 且 `use_thumbnail:false`。
5. `videoProjects.normalise.test.ts`（**评审 RV-1·持久化剥离**）：(a) material 的 `thumbnailUrl` 以 `data:` 开头 → `normaliseProjectDataForSave` 输出中该 material 的 `thumbnailUrl` 不存在（被剥离）；(b) `thumbnailUrl` 为 `/api/storage/files/...`（后端海报）→ 原样保留；(c) `timelineData.tracks[*].items[*]` 内 `data:` 形态 `thumbnailUrl` 同样被剥离；(d)（可并入 `projectPersistence.integration.test.tsx`）含 `data:` 缩略图的项目经一次自动保存往返后，PUT 载荷不含任何 `data:` 字符串。

**后端单测（pytest）**
6. `test_storage_video_thumbnail.py`：(a) 构造一段无 `format.duration`（仅 stream 时长）的小视频 fixture → `upload_video_file` 仍产出 `poster.jpg` 且 `thumbnail_url` 非空；(b) monkeypatch `subprocess.run` 让 ffmpeg 返回非 0 → `thumbnail_url is None` 且函数不抛异常；(c) `thumbnail_url` 非空时其值以 `/api/storage/files/static/video/thumbnails/` 开头；(d)（评审 RV-4）构造 0.5s 极短视频 → `midpoint==min(duration,1.0)`、仍能抽出有效帧或安全失败（不越界报错）。

**端到端（桌面 / dev）**
7. 上传一段常规 MP4 视频：卡片显示正确首帧缩略图（来源为后端海报，`metadata.thumbnailSource` 为 `undefined`，即默认后端来源）。
8. 人为让后端海报缺失（如临时把 ffmpeg 移出 PATH 或 mock 返回 None）：卡片仍显示缩略图（客户端兜底 dataURL），**不出现图裂、不永久空白**；编辑该项目并等待一次自动保存，后端 `project_data` 中**不含** base64 `data:` 缩略图（评审 RV-1）。
9. 人为让海报 URL 404（删除生成的 `poster.jpg` 后刷新面板）：`<img onError>` 触发后卡片回落到客户端再抽帧或占位图标，**不出现图裂**。
10. 图片/音频上传：行为与改动前完全一致（回归确认）。

**验收标准（Definition of Done 对齐）**
- 上传视频素材在素材管理面板**必然**显示出正确缩略图，任何失败路径下都**不出现 broken-image glyph（图裂）或永久空白**。
- 图片/音频上传、AI 生成、故事板等既有路径行为零回归。
- 公开 REST 路径、本地存储目录结构、DB schema 均未变。

---

## 8. 风险与缓解 / Risks & Mitigations

| 编号 | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1（**评审 RV-5：首要残留风险**） | 客户端 `extractVideoThumbnail` 内部需用 `<video>` 解码**鉴权同源** `/api/storage/files/video/...`（含 `user_<id>` 段、cookie 鉴权）。同源请求会自动携带 cookie、catch-all 路由透传 cookie，理论可达；但**不能仅凭「AI/故事板路径用过」推断**（其素材来源未必同形态） | 兜底也可能拿不到帧 | **必须在 §7 第 8 条端到端环节实测确认**（不可省略）；util 内置 10s 超时保证不挂起；最终仍有占位图标兜底（绝不图裂），故不阻断设计落地。 |
| R2（**评审 RV-2：已拍板**） | 上传路径内 `await extractVideoThumbnail` 会让海报缺失时的「上传完成」延迟最多 ~10s | 个别慢容器卡片短暂转圈 | **决议：采用同步 `await`**（§3.2(A)）。理由：① 仅在后端海报缺失的少数路径才进入该分支（常规视频走后端海报、零延迟）；② 进入时卡片本就处于 `uploading` 态（已有进度动画），延迟对用户可感知度低；③ 同步实现保证返回对象即携带缩略图，避免 fire-and-forget 的二次 `setMaterials` 竞态与 RV-1 持久化时序复杂度。**不**采用 fire-and-forget。 |
| R3 | 后端解耦 `duration is not None` 后，对**真实损坏/无视频流**的文件仍会尝试 ffmpeg 抽帧 | 多一次必失败的 ffmpeg 调用（30s 超时上限内） | ffmpeg 失败仅 warn 不抛、`thumbnail_url` 保持 None，行为安全；且此类文件本就不该作为视频素材，前端兜底/占位仍兜住。 |
| R4（**评审 RV-1：v1 论断已被证伪并修正**） | ~~客户端 dataURL 缩略图为内存态，项目重载后丢失~~ → **更正：在 (E) 剥离落地前，`data:` `thumbnailUrl` 实际会经 `useProjectAutosave`/`exportToJSON` 持久化**（污染项目存档、违反 spec 06「不内联大体积派生数据」约定） | 项目 JSON 膨胀、每次自动保存重传 base64 | **已在 §3.2(E) + §4(#6/#7/#10) 修复**：持久化通道剥离 `data:` 缩略图，使其严格内存态。剥离后「重载即丢、由客户端兜底重生成」的语义**才真正成立**，与「派生资源按 materialId 重解析」总约定一致。后端加固 (C) 进一步提高海报命中率使重载多数仍有持久海报。「把客户端抽帧 blob 经 `extractVideoFrameBlobAt` + filmstrip 通道落盘持久化」仍为可选后续增强，不在本次必做。 |
| R5 | `MaterialsPanel.tsx` 体量大，新增子组件抽取可能误伤相邻渲染逻辑 | 回归风险 | 严格只搬「缩略图 + 占位图标」那一块（L2102–2144），音频播放覆盖层/下载状态覆盖层等同级兄弟节点保持原位不动；以 §7-3 单测护栏。 |
| R6 | Next 代理 `upload-video` 超时 120s 与前端 600s 不一致（次要、非本 bug 主因） | 超长视频上传可能在代理层被截断 | 本次不改其值（避免范围蔓延）；仅在文档登记为已知次要风险，建议后续单独评估是否对齐到 600_000。 |
| R7 | 给 `MaterialItem.metadata` 加具名键可能与既有 `[key:string]:any` 用法冲突 | 类型噪音 | 仅新增可选键、不改既有键语义；`type-check` 作为闸门。 |

---

## 9. 实施顺序建议 / Implementation Order（供 Subtask #2）

1. 先落后端加固 (C)（`shutil.which` + 解耦 duration + RV-4 公式）并补 `test_storage_video_thumbnail.py` 跑通 —— 提高海报命中率，缩小前端兜底触发面。
2. 落前端上传兜底 (A) + 类型 (D)，补 `useMaterialUpload.thumbnail.test.ts`。
3. **落 (E) 持久化剥离**（`normaliseProjectDataForSave` + `TimelineRepository.exportToJSON`）并补 `videoProjects.normalise.test.ts` —— 与 (A) 同批落，确保新引入的 `data:` 缩略图从落地起就不进存档（评审 RV-1）。
4. 抽取 `MaterialThumbnail` 子组件 (B) 并接入 MaterialsPanel (#3)，补 `MaterialThumbnail.test.tsx`。
5. `npm run type-check` / `npm run lint` / 前端 vitest / 后端 pytest 全绿。
6. 端到端按 §7 第 7–10 条手测（重点验证模式 A/B 下都不出图裂，且自动保存载荷无 `data:` 缩略图）。
7. 收尾静态扫描（§3.2 末，含 (E) 的 `isDataUrl` 命中确认）。

---

## 10. 评审结论 / Review Verdict

**结论：有条件通过（Approved with Conditions）。**

本方案根因定位准确、证据扎实（所有关键行号、接口契约、既有约定均已对照源码逐一核验为真），三层防御（上传兜底 / 面板 `onError` 兜底 / 后端加固）设计合理且规模适度，零公开接口变更、零 DB schema 变更的约束亦得到遵守。评审发现的 **1 个 P1（RV-1：客户端 `data:` 缩略图经自动保存/导出污染项目存档，且证伪了 v1 R4 的论断）已在 v2 正文就地修复**（新增 §3.2(E) 持久化剥离 + §4 文件 #6/#7/#10 + §6/§8 R4 更正）；4 个 P2（RV-2 同步决议、RV-3 来源语义澄清、RV-4 极短视频公式、RV-5 残留风险定级）已就地优化或登记。**当前无未决 P0 / P1。**

**放行条件（移交 Subtask #2 时必须满足）**：

1. **必须实现 §3.2(E) 持久化剥离**（含 (E1) `normaliseProjectDataForSave`、(E2) `exportToJSON`），并以 §7-5 / §7-8 测试为护栏——这是 v2 相对 v1 的核心增量，**不可漏实现**，否则会把 base64 缩略图写入每次自动保存与项目存档。
2. **必须完成 §7 第 8 条端到端实测**以坐实 R1（RV-5）——客户端 `extractVideoThumbnail` 能否解码鉴权同源 `/api/storage/files/video/...`。若实测发现解码失败，则客户端兜底退化为占位图标（仍不图裂，可接受），但需在实施记录中如实登记。
3. 后端 §3.2(C) 的 `midpoint` 须采用 v2 修正后的公式（保留 `min(duration,1.0)` 极短视频保护，RV-4），不得退化为 `else 1.0`。
4. 严守 §4 约束：仅改 `src/`、`backend-services/basic-service/`；不手改 `desktop/` 构建产物；不提交 `__pycache__`/`.next/`/`tsconfig.tsbuildinfo`。

满足以上条件后，本方案可进入 Subtask #2 编码实施。

---

## 11. 实施过程发现的方案缺陷 / Issues Found During Implementation（Subtask #2）

> 以下为编码实施期对照源码发现的方案小缺陷，均已就地按「修正后的正确做法」实现，列此备查（不阻断、不改变设计意图）。

### ID-1（完整性·字段名不准确）— 持久化时间轴的真实字段是 `uiState.currentTimelineState`，非 `timelineData`

- **现象**：§3.2(E1) 与 §7-5(c) 写为「剥离 `out.timelineData?.tracks[].items[].thumbnailUrl`」，但 `VideoEditingTaskContent`（`src/types/index.ts:227`）**没有** 顶层 `timelineData` 字段；自动保存时时间轴快照实际存在 `uiState.currentTimelineState`（`VideoEditingInterface.tsx:132/253`、`hydrateTimeline.ts:59`、`projectPersistence.integration.test.tsx` 均证实）。`pendingTimelineData` 已被整体剥离，故 `currentTimelineState` 是唯一残留的时间轴 item 携带通道。
- **修正做法**：`normaliseProjectDataForSave` 改为对 `out.uiState.currentTimelineState.tracks[].items[]` 做 `data:` 缩略图剥离（沿 tracks→items 路径浅拷贝，**绝不**改写 live 对象）。`materials` 顶层数组同样剥离。测试 #10(c)/(d) 据此断言真实字段路径。
- **影响**：仅字段名修正，设计意图（item 快照中的 `data:` 缩略图不入存档）完全保留。

### ID-2（完整性·`isDataUrl` 落点未在变更表枚举）— 共享守卫放入 `localMaterial.ts` 并导出

- **现象**：§3.2(E2) 要求 `isDataUrl` 「共用一处定义（可放 `localMaterial.ts` 或一个小 util，避免重复）」，但 §4 文件变更表未把该守卫的落点列为独立条目；两个被建议的选项（改 `localMaterial.ts` 或新建 util）都隐含一处表外改动。
- **修正做法**：选择 §3.2(E2) 明确点名的 `localMaterial.ts`，在其中新增并导出纯函数 `isDataUrl(value)`（已被 `createLocalMaterialFromUpload` 同文件持有 `thumbnailUrl` 语义，是最自然的归属）。三处持久化/分析边界（`useMaterialUpload.ts`、`videoProjects.ts`、`TimelineRepository.ts`）统一 import 复用，零重复。`src/lib/api` → `@/components/video/lib` 的 import 已有先例（`src/lib/api/videoCover.ts`），且 `localMaterial.ts` 的依赖链仅为 `selectPlaybackUrl.ts`（只 import 类型），无重链/`server-only` 风险。
- **影响**：相对变更表多动一个既有文件 `localMaterial.ts`（仅 +1 导出函数），属 §3.2(E2) 已授权范围内。

*本方案 v2 由 Subtask #1（方案评审与修复）在 v1 基础上完成：§0 评审记录列明 1×P1 + 4×P2 + 1 项澄清，全部 P0/P1 已就地修复，版本标注 v2，评审结论为「有条件通过」。*
