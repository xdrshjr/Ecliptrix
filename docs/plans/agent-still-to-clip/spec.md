# Agent「静图先成片」设计文档（agent-still-to-clip）

> 状态：设计稿 **v2**（已通过设计评审，P0/P1 已在正文修复，见「评审记录」）· 作者：解决方案架构师节点 · 评审：设计评审节点 · 日期：2026-10-27
> 范围：剪辑 Agent（`src/lib/video-editing-agent/`）+ 后端图片转视频服务（`backend-services/basic-service/`）。
> 本文档只做设计，不含实现代码；下游工程师按 §4 的文件表与 §5–§8 的接口、数据、判据逐条落地即可，无需再做决策。

---

## 评审记录

> 评审人：设计评审节点 · 版本：v1 → **v2** · 方法：逐节对照仓库实际代码核实（`addToTrack.ts`、`composeStoryboard.ts`、`agent.ts` 熔断段、`promptParts.ts`/`systemPrompt.ts` 的核心清单渲染、`visionTools.ts`、`local_media_resolver.py`、`agent_vision/image_source.py`、`derived_gc_service.py`、`storage_service.py`、`AsyncTaskPoller.tsx`、`MaterialsPanel.tsx`）。
> 已核实为真、无需改动的前提：D1（结果无 materialId）、D2（`requests.get` 取相对路径）、D6（`video_router.py` 只有 `POST /image-to-video`，无 GET 轮询端点）、D9（`CORE_TOOLKIT_TOOL_NAMES` 经 `formatCoreToolkit` 把描述与参数签名渲染进 L0，故移出清单确实降低 L0 字符）、规则句落点（`systemPrompt.ts:576` 附近的规则列表）、核心清单 19→18、人工路径（`MaterialsPanel` 直接 `http.post`）不依赖 `AsyncTaskPoller`，删除死代码不影响它、Next 透传路由 `createPassthroughRoute` 会原样转发新增字段（无需改 BFF）、`derived_gc_service` 只回收缩略图与波形目录，不会碰 `video/generated/`。

| 编号 | 级别 | 维度 | 问题 | 处置 |
|---|---|---|---|---|
| RV-01 | **P1** | 完整性 | **`compose_storyboard` 是第二条"图片直接上轨"通路**：`composeStoryboard.ts` 的 `buildSceneOperation` 对任意素材（含 `image`，且同样写 `originalDuration: 0`）直接下发 `add_clip`，只拦截轨道类型不匹配。模型把分镜静帧 id 误填进 `video_materials`，就绕过 `add_to_track` 的兜底闸，用户要纠正的问题在分镜流程里照旧发生 | **已修**：兜底闸抽成共享模块 `tools/stillGuard.ts`，`add_to_track` 与 `compose_storyboard` 共用；`compose_storyboard` 对静图场景放入 `skipped[]`（带 `error_code: 'still_needs_conversion'`），全部被拒时整体 `success:false` + 同一错误码并同样豁免熔断（§4.2、§5.3、§6.3、新增 D-9 / AC-19） |
| RV-02 | **P1** | 可行性 | **后端 `storage_key` 解析方案按原文写会失败**：§6.2 要求把 `storage_key` 交给 `resolve_media_reference`，但该函数对不以 `/` 开头的相对串锚定的是 `SERVICE_ROOT`（`local_path = SERVICE_ROOT / local_path`），不是 `STORAGE_ROOT`；`uploads/images/a.jpg` 会被解析到服务目录下并被白名单拒绝。这正是 D2 要修的主场景（桌面端本地上传图），修不好等于功能整体不可用 | **已修**：后端先按与 vision 工具相同的规则校验键（非空、≤256、无盘符/前导分隔符/`..`，复用 `agent_vision.image_source.validate_storage_key`），再拼成 `/api/storage/files/<key>` 走 `resolve_media_reference` 的路由分支（该分支以存储根为锚并有包含性校验）。新增 AC-20 覆盖通过/越界两侧（§5.4、§6.2 第 1 步） |
| RV-03 | P2 | 一致性 | 设计要求"复用 `visionTools.ts` 同一套规则、不另写第二份"，但 `normalizeStorageKey` / `relativeStorageKey` 在该文件内是**未导出**的私有函数 | **已修**：抽到新模块 `tools/storageKey.ts` 并导出，`visionTools.ts` 改为引用它（行为不变，原有测试须全绿）（§4.2） |
| RV-04 | P2 | 完整性 | §6.3 "同一素材被拒 ≥3 次升级强提示"把计数放在 `context.turnState`，但 `ToolkitTurnState`（`src/types/agentToolkit.ts`）没有该字段，文件表也没列这个类型文件 | **已修**：文件表加入 `agentToolkit.ts`，新增可选字段 `stillRejections?: Record<string, number>`（§4.2、§6.3） |
| RV-05 | P2 | 完整性 | §5.1 的 `reused` 语义含糊：后端命中内容寻址缓存、但当前会话素材库里没有该 id（新会话、素材被用户删除而文件仍在）时，按原文"不再记录 add_material"会导致 `materialId` 返回了却不在素材库，下一步 `add_to_track` 报 `Material not found` | **已修**：是否记录 `add_material` 只取决于 `context.materials` 里是否已有该 id；`reused` 为"后端命中缓存或会话内已有"（§5.1） |
| RV-06 | P2 | 可行性 | `Image.MAX_IMAGE_PIXELS` 是进程级全局，直接赋值会改变整个后端其它图像处理的行为；且 PIL 对超限图默认只是 warning，到 2 倍才抛错，不是可靠的拒绝开关 | **已修**：改为 `Image.open` 后（惰性，不解码像素）先比较 `w*h`，超过 64 MP 即 `IMAGE_TOO_LARGE`，不触碰全局（§6.2 第 2 步） |
| RV-07 | P2 | 完整性 | AC-9 "并发请求延迟 < 200 ms" 是绝对时间阈值，在 CI/低配机器上必然偶发失败，违背 CLAUDE.md "测试须快速且可重复" | **已修**：改为"结构断言（模块内无 `subprocess.run` / `requests`）+ 软探针（5 次探测取中位数 < 500 ms，仅在有 FFmpeg 时运行）"（AC-9） |
| RV-08 | P2 | 完整性 | AC-12 引用的"当前最坏值 ≈18 100"是估算，评审中未实测 | **已修**：改为实现者在改动前后各实测一次并写入提交说明，判据是"改动后最坏值 ≤ 改动前最坏值"（AC-12） |
| RV-09 | P2 | 体验 | 兜底闸的拒绝是 `success:false`，前端工具卡片可能把它渲染成红色失败，用户会看到"报错"，但这是预期内的自我纠正 | **不改设计，登记为实现注意项**：实现者先看 `tool_result` 卡片是否已有"软失败"样式；有则复用，没有则保持现状（拒绝仅 1 步，模型下一步自行纠正），不为此新增 UI。已写入 §10.1 第 4 条 |
| RV-10 | P2 | 规模 | 省略 `aspect_ratio` 时输出保持原图比例，4:3 照片进 16:9 工程会是 4:3 视频（导出时按既有 canvas_fit 补模糊底，非黑边，可接受） | 无需改，D-7 已说明；技能第 3 步要求"知道画幅就传"。保留 |
| RV-11 | P2 | 完整性 | 发布与回滚未说明 | 补一句说明（文末）：前后端同包发布，无版本错位；新增字段与错误码均为可选/新增；回滚只需还原提交，无迁移 |

**评审结论摘要**：方案方向正确、规模适当（不新增依赖、不动时间线渲染管线、不改人工 UI、净减 L0 字符）。两个 P1（RV-01 分镜通路绕过、RV-02 `storage_key` 锚点错误）已在正文修复，其余 P2 已修复或登记。无遗留 P0 / P1。

---

## 1. 概述

### 1.1 要解决的问题

用户需求原话：Agent 在剪辑视频时，如果要把**图片**放进视频，应当尽量先用工具把图片转成视频再剪进去；现在是直接把图片剪辑进去，这是不对的。同时，项目里已有的图片转视频能力要以**工具**的形式提供给 Agent，并且要遵守项目的**渐进式披露**（progressive disclosure）原则——不能为此把常驻提示词和常驻工具 schema 撑大。

"直接把图片剪进去"在本项目里不只是风格问题，而是产物不对：

* 时间线上的静图 clip 在预览与导出中走的是**图片叠加层**路径（`isStillImageItem` → `ImageOverlayLayer`，默认居中 80% 大小、可拖拽，见 `src/components/video/components/VideoPlayerPanel/imageOverlays.ts` 的 `DEFAULT_OVERLAY_POSITION`），**不是**铺满画面的视频镜头。Agent 用 `add_to_track` 放进去的照片因此表现为"飘在画面中间的贴纸"，周围是黑底或下层轨道。
* 静图没有源时长（`addToTrack.ts:136` 把 `originalDuration` 置 0，时长默认 5 秒），也没有任何运动，质量自检规则 11 `static_image_too_long` 甚至明说"没有 Agent 工具可以做运镜"（`qualityLint.ts:391-400`）。
* 图片转视频的结果是普通视频素材：全屏、有真实时长、可 `trim_clip` / `resize_clip`、与其它视频镜头在同一套预览/导出管线里行为一致。

### 1.2 现状：工具其实存在，但"用不起来"

仓库里已经有 `image_to_video` 工具（`tools/imageToVideo.ts`）和后端 `/api/video/image-to-video`（`image_to_video_service.py`，FFmpeg 的 static / ken_burns / pan 三种效果），人工路径（素材面板的"图片转视频"按钮）也在用同一后端。Agent 没用上它，调研得到的根因有两层：

**A. 行为层：没有任何东西告诉 Agent"图片要先成片"，反而有三处在教它直接上轨**

1. `CATEGORY_USAGE_HINTS.search_tools` 原文："Results are automatically added … Use add_to_track to place them directly on the timeline."（`promptParts.ts:142-146`），`search_image` 的结果被明示可直接上轨。
2. 内置技能 `quick-assemble` 第 3 步、`explainer-video` 第 4 步写的是"`add_to_track` 把视频/图片放到视频轨"。
3. `add_to_track` 对 `image` 素材零阻拦（`addToTrack.ts:85-138`），还会自动建轨、默认 5 秒。

**B. 工具层：`image_to_video` 即便被调用也不可靠、无法串联（9 个缺陷）**

| # | 缺陷 | 证据 |
|---|---|---|
| D1 | 工具结果**不返回 `materialId`**，Agent 无法把转出来的视频交给 `add_to_track`。同步分支生成 `i2v-mat-<随机>` 但只放进 `context.materials`，不写进结果；异步分支更是只返回 `taskId` | `imageToVideo.ts:150-178` |
| D2 | 工具把 `material.url` 原样发给后端，而本地素材的 url 是同源相对路径 `/api/storage/files/...`；后端 `download_image` 用 `requests.get(image_url)` 取图，**相对路径直接失败**，等于本地上传/缓存的图片（桌面应用的主场景）转不了 | `imageToVideo.ts:91,104`；`image_to_video_service.py:56` |
| D3 | 后端 `requests.get` 无任何 SSRF/内网地址防护、无体积上限；`subprocess.run` 与 `requests` 都是**同步阻塞**，直接跑在 async 处理函数里，会卡住事件循环（预览 Range 请求、其它 Agent 调用一起卡） | `image_to_video_service.py:56,456` |
| D4 | 输出分辨率 = 原图分辨率（偶数化），4000×3000 的照片会编出 4K 视频，慢且大；不支持目标画幅，竖图进横屏项目要靠导出时的适配；`static` 效果用黑色 `pad` 补边 | `image_to_video_service.py:179-213` |
| D5 | Ken Burns 的 `zoompan` 在**未放大**的输入上跑，肉眼可见抖动；`x/y` 表达式用 `ow/2*zoom`，不是 zoompan 要求的"输入坐标系下的裁剪窗口左上角"，焦点偏离中心时会露出黑边/跑偏 | `image_to_video_service.py:259-278` |
| D6 | 异步分支依赖 `GET /api/video/image-to-video?task_id=` 轮询，**后端根本没有这个 GET 端点**（只有 POST），该分支永远不会成功 | `AsyncTaskPoller.tsx:276-279`；`video_router.py:1027` |
| D7 | 输出落盘用 `user_id="anonymous"` 旧身份、文件名带秒级时间戳，**非幂等**：SSE 重连重跑（项目历史上 R1-AG-01 的老问题）会重复渲染并产生重复素材 | `image_to_video_service.py:423-431,583` |
| D8 | 工具描述把它归在"AI 生成"类并写"added to the material library when complete"，与实际（同步、免费、本地）矛盾；类别用法提示又说"AI generation tools start async tasks" | `categories.ts:169`；`promptParts.ts:147-150` |
| D9 | `image_to_video` 被放在**常驻**核心工具清单（`CORE_TOOLKIT_TOOL_NAMES`），其完整 schema 每一轮都进提示词，却没有任何"何时该用"的语义——常驻成本付了，触发率为零 | `promptParts.ts:81` |

结论：不是"再造一个功能"，而是 **① 把图片转视频做成对 Agent 真正可靠、可串联的工具；② 用渐进式披露把"图片先成片"这条规则放在正确的层级；③ 在 `add_to_track` 加一道零提示词成本的兜底闸**。

### 1.3 目标与非目标

目标

1. 图片作为"画面内容"进入时间线时，默认路径是 `图片 → 视频素材 → add_to_track`，成功率高、可批量、可重试且幂等。
2. 渐进式披露：L0 常驻只增加一句规则 + 一行目录；工具 schema、用法提示、批量套路依次在 L1（`explore_tools`）、L2（`use_skill`）按需出现；净 L0 字符数**下降**。
3. 对 Agent 的错误提示是可行动的（告诉它下一步调用什么），且不会触发"连续 5 次失败熔断"。
4. 图片叠加（Logo、贴纸、水印、画中画）这类**确实要保留为图片**的用法不受影响，有显式出口。
5. 后端转换稳健：支持本地同源素材、有 SSRF 与体积防护、不阻塞事件循环、输出幂等、质量正确（无黑边、无抖动）。

非目标

* 不改人工 UI 的交互（素材面板"图片转视频"弹窗保持现状；它因后端支持同源路径而顺带受益）。
* 不引入新依赖、不新增 AI 生成（本功能是本地 FFmpeg，免费、无额度）。
* 不改时间线的静图渲染管线、不删除"静图 clip"能力（人工拖入图片、`as_still` 仍可用）。
* 不为 Agent 新增"设置运镜"工具（`cameraMotion` 仍只有 UI 通路，另立项）。

---

## 2. 设计原则与决策表

### 2.1 何时转、何时不转

| 场景 | 处理 | 理由 |
|---|---|---|
| 照片/插画/AI 生成图/网图作为**一个镜头**（幻灯片、图文解说、配图） | 先 `image_to_video`（或 `batch_image_to_video`），再 `add_to_track(videoMaterialId)` | 全屏、有运动、有真实时长 |
| Logo、水印、贴纸、角标、画中画、用户明确说"叠在画面上/保留原图/不要动" | `add_to_track({ materialId, as_still: true })` | 叠加层语义正是静图 clip 的用途 |
| 转换工具不可用（FFmpeg 缺失等）且已告知用户 | `as_still: true` 作为降级，并在回复里如实说明 | 不让 Agent 卡死，也不隐瞒降级 |
| 用户只说"找几张图/生成一张图"（仅入库） | 不转换、不上轨 | 沿用现有"仅入库 vs 上轨"配方，转换发生在**上轨意图确定之后** |

### 2.2 关键决策（均已定，实现时不再讨论）

* **D-1 硬闸而非自动转换**：`add_to_track` 收到 `image` 且未带 `as_still` 时**拒绝并指路**，而不是在内部偷偷调用转换。理由：转换需要模型决定时长/效果/焦点（这是内容决策），隐藏在 `add_to_track` 里会让该工具变慢、变不纯、难测，且模型学不到正确流程。用户原话是"使用对应的工具"，所以让它**显式**使用。
* **D-2 拒绝不计入熔断**：该拒绝返回 `success:false`，会被 `agent.ts:495-511` 当作工具失败，幻灯片场景连放 6 张图就会触发"连续 5 次失败中断"。因此给拒绝一个稳定的 `error_code: 'still_needs_conversion'`，熔断器对它**既不累加也不清零**（与现有 `expectedResearchFailure` 同构）。
* **D-3 新建独立类别 `still_tools`（静图成片）**：不放进 `ai_gen_tools`。该类别描述的是付费/异步/生成式能力，而本功能免费、本地、同步；塞进去会继续制造 D8 的语义污染，且 `ai_gen_tools` 已有 3 个工具，再加批量会顶到 `load()` 的"每次最多 4 个"上限。
* **D-4 从常驻清单移除 `image_to_video`**：`CORE_TOOLKIT_TOOL_NAMES` 从 19 个变 18 个，常驻 schema 减少约 600 字符；换成 L0 的一句规则（≈150 字符）和一行目录（≈150 字符），净省 ≈300 字符，L0 上限 `L0_PROMPT_CHAR_CEILING = 18_900` 不变。
* **D-5 保持工具名 `image_to_video` 不变**（历史会话、`turnSummary`、i18n、`AsyncTask.type` 都引用它），只升级其契约；新增 `batch_image_to_video`。
* **D-6 同步返回，不走异步任务**：单张转换（FFmpeg，1080p、≤10 秒）通常 2–8 秒，远低于工具 120 秒超时；同步返回才能让 Agent 立刻拿到 `materialId` 并在同一轮 `add_to_track`。因此删除 `start_async_task` 分支与 `AsyncTaskPoller` 的 image_to_video 轮询（D6 的死代码）。
* **D-7 目标画幅用显式参数，不新增 `ToolContext` 字段**：Agent 上下文里目前没有工程画幅（只有 `check_timeline` 的 `aspect_ratio` 参数，默认 16:9）。`aspect_ratio` 缺省 = 保持原图比例（与现状一致），技能文档提示"知道项目画幅时传入"。以后若 `ToolContext` 获得画幅，只需改默认值来源。
* **D-9 兜底闸是共享模块，覆盖所有"把素材放上视频轨"的 Agent 工具**：`add_to_track` 与 `compose_storyboard` 是仅有的两条 `add_clip` 通路（评审实测），二者共用 `tools/stillGuard.ts`；以后新增放轨工具必须调用它。
* **D-8 幂等靠内容寻址**：输出文件名由 `sha1(图片字节 + 规范化参数)` 决定；已存在则直接复用，不重渲染。SSE 重放、模型重复调用、用户重试都安全，并保证同一输入得到同一 `materialId`。

---

## 3. 渐进式披露分层

| 层 | 内容 | 位置 | 常驻成本 | 触发 |
|---|---|---|---|---|
| **L-1 兜底闸** | `add_to_track` 与 `compose_storyboard` 对 image 的拒绝 + `next_step`（共享 `stillGuard.ts`） | 工具内部 | 0 字符（只在出错时出现在工具结果里） | 模型漏看规则、直接上轨 |
| **L0 规则 + 目录** | ① `rules` 里一句规则；② 类别目录里一行 `still_tools` | `systemPrompt.ts` / `categories.ts` | ≈ +300 字符，同时 −600（移出核心清单） | 每轮常驻 |
| **L0.5 就地提示** | `search_image` / `generate_ai_image` / `fetch_web_image` 的**结果**里带 `next_step` 一句 | 工具返回值 | 0 常驻，按次出现 | 图片刚入库的那一刻——正是模型最需要知道的时点 |
| **L1 加载工具** | `explore_tools({category:'still_tools'})` 返回 2 个工具的 schema 与用法提示 | `exploreTools` / `CATEGORY_USAGE_HINTS` | 仅加载后 | 模型决定转换时 |
| **L2 技能** | `use_skill('still-to-clip')`：批量幻灯片、按旁白定时长、运镜多样化、画幅处理的完整流程，并**预加载** `still_tools` | 内置技能 | 目录里一行（≤60 字符描述） | 任务是"图片做视频/幻灯片/图文解说" |

L0 规则原文（放在 `systemPrompt.ts` 的 `## 规则` 列表，紧跟"严禁编造素材 ID"之后）：

```
- **图片先成片再上轨**：图片作为画面镜头时不要直接 add_to_track；先 explore_tools(still_tools)，用 image_to_video / batch_image_to_video 转成视频素材，再把返回的 materialId 交给 add_to_track。Logo、贴纸、水印等叠加图才用 add_to_track 的 as_still:true。
```

类别目录行（`categories.ts`，描述 ≤160 字节的既有风格约束）：

```
still_tools — name:'静图成片' — 'Turn still images into video clips (Ken Burns/pan/static): image_to_video, batch_image_to_video. Local, free. Use before add_to_track.'
```

预算断言：见 AC-12；`systemPrompt.test.ts`、`systemPrompt.toolkit.test.ts`、`agent.systemPrompt.test.ts` 里的 18 900 / 18 500 断言必须继续通过，且最坏值应**低于**当前最坏值。

---

## 4. 文件 / 模块变更计划

### 4.1 后端（`backend-services/basic-service/`）

| 文件 | 动作 | 意图 |
|---|---|---|
| `app/services/image_to_video_filters.py` | **新增** | 纯函数：把"效果+方向+焦点+画幅+时长"翻译成 FFmpeg 滤镜串与参数列表；无 IO，便于做逐字符黄金测试。控制 `image_to_video_service.py` 不超 800 行 |
| `app/services/image_to_video_service.py` | 重写主流程 | ① 取图：`storage_key` 经校验后拼成 `/api/storage/files/<key>` 再走 `local_media_resolver.resolve_media_reference`（**不能**直接把裸相对键交给它，见 §6.2），同源路径同理，远程走 `validate_external_url` 与 httpx 异步下载（超时 30s、上限 25 MB）；② 像素上限校验；③ FFmpeg 改 `asyncio.create_subprocess_exec` 并带超时与取消；④ 内容寻址输出 + 命中复用；⑤ 去掉 `user_id="anonymous"`，用 `LOCAL_OWNER_ID`；⑥ 失败返回稳定 `error_code` |
| `app/models/video_models.py`（约 681–733 行） | 修改 | `ImageToVideoRequest` 新增 `storage_key`、`aspect_ratio`、`max_long_side`；`ImageToVideoResponse` 新增 `storage_key`、`reused`；新增错误码枚举。全部可选，向后兼容 |
| `app/models/__init__.py` | 修改 | 导出新增符号 |
| `app/routers/video_router.py`（969–1090 行） | 修改 | 请求校验（来源三选一、效果与方向匹配）、错误码到 HTTP 状态的映射、保持 `with_simple_queue(max_concurrent=2)` |
| `app/services/agent_skills/builtin/still-to-clip/SKILL.md` | **新增** | L2 技能，见 §8 |
| `app/services/agent_skills/builtin/quick-assemble/SKILL.md` | 修改 | 第 3 步改为"图片先 `image_to_video` 再上轨"；`version: 2` |
| `app/services/agent_skills/builtin/explainer-video/SKILL.md` | 修改 | 第 3、4 步同上；`version: 2` |
| `app/services/agent_skills/builtin/news-digest-video/SKILL.md` | 修改 | 第 5 步配图后补一句转换；`version: 2` |
| `docs/apis/image_to_video_api.md` | 修改 | 同步新增字段、错误码、同源路径支持 |
| `tests/test_image_to_video_filters.py` | **新增** | 滤镜串黄金测试 |
| `tests/test_image_to_video_service.py` | **新增** | 真实 FFmpeg 集成测试（无 FFmpeg 时 `skip`，与 `test_camera_motion_stills.py` 同风格） |
| `tests/test_image_to_video_router.py` | **新增** | 路由校验、错误映射、幂等 |

### 4.2 前端（`src/`）

| 文件 | 动作 | 意图 |
|---|---|---|
| `lib/video-editing-agent/tools/stillClip.ts` | **新增** | 单张/批量共用：构造后端请求、解析响应、生成 `MaterialItem`、错误码→提示映射、同轮可见性（写 `context.materials` + `add_material`）。承载所有逻辑，两个工具文件保持薄 |
| `lib/video-editing-agent/tools/imageToVideo.ts` | 重写 | 新契约（§5.1）：同步、返回 `materialId`、幂等复用、删除 `autoAddToTimeline` 与异步分支 |
| `lib/video-editing-agent/tools/batchImageToVideo.ts` | **新增** | `batch_image_to_video`（§5.2），用现有 `mapWithConcurrency`（`boundedConcurrency.ts`），并发 2 |
| `lib/video-editing-agent/registry/categories.ts` | 修改 | 新增 `STILL_TOOLS = 'still_tools'` 进 `CATEGORY_IDS` 与 `ON_DEMAND_CATEGORY_IDS`；`ai_gen_tools` 描述去掉 image_to_video；更新文件头"18 个类别"注释 |
| `lib/video-editing-agent/tools/index.ts` | 修改 | 新类别注册两个工具；`ai_gen_tools` 只剩 `generate_ai_image` / `generate_ai_video` |
| `lib/video-editing-agent/promptParts.ts` | 修改 | `CORE_TOOLKIT_TOOL_NAMES` 移除 `image_to_video`；`CATEGORY_USAGE_HINTS` 新增 `still_tools`、修订 `search_tools` 与 `ai_gen_tools` 两条（去掉"直接上轨"与"异步"误导） |
| `lib/video-editing-agent/systemPrompt.ts` | 修改 | `## 规则` 增加 L0 规则句；`ALWAYS_AVAILABLE_TOOLS` 里 `add_to_track` 描述补"图片需先成片" |
| `lib/video-editing-agent/tools/stillGuard.ts` | **新增** | 共享兜底闸：`checkStillGuard(material, options)` 返回 `null`（放行）或带 `error_code:'still_needs_conversion'` / `next_step` 的拒绝对象；内含"同一素材被拒 ≥3 次升级强提示"的计数（读写 `turnState.stillRejections`） |
| `lib/video-editing-agent/tools/addToTrack.ts` | 修改 | 调用 `stillGuard` + `as_still` 参数（§5.3） |
| `lib/video-editing-agent/tools/composeStoryboard.ts` | 修改 | 对 `image` 场景调用 `stillGuard`：放入 `skipped[]` 并带 `error_code`；全部被拒时整体 `success:false`（RV-01） |
| `lib/video-editing-agent/tools/storageKey.ts` | **新增** | 从 `visionTools.ts` 抽出并导出 `normalizeStorageKey` / `relativeStorageKey` / `storageKeyForMaterial`（RV-03） |
| `lib/video-editing-agent/tools/visionTools.ts` | 修改 | 改为引用 `storageKey.ts`，行为不变 |
| `types/agentToolkit.ts` | 修改 | `ToolkitTurnState` 增加可选 `stillRejections?: Record<string, number>`（RV-04） |
| `lib/video-editing-agent/agent.ts`（约 495–511 行） | 修改 | 熔断器：`error_code === 'still_needs_conversion'`（含 `compose_storyboard` 全部被拒时的整体失败）既不累加也不清零 |
| `lib/video-editing-agent/tools/qualityLint.ts`（390–403 行） | 修改 | 规则 11 的建议改为 `suggested_tool: 'image_to_video'`，文案去掉"no agent tool does it"。**不新增规则**（16 条规则及其顺序是 `checked_rules` 契约） |
| `lib/video-editing-agent/tools/searchImage.ts`、`generateAiImage.ts`、`webTools.ts`（`fetch_web_image`） | 修改 | 成功结果追加 `next_step`（L0.5 就地提示）。仅追加字段，不改原有字段 |
| `components/video/components/AsyncTaskPoller.tsx` | 修改 | 删除 `pollImageToVideoTask` 及其 `POLL_INTERVALS` / `needsPolling` 条目（D6 死代码）；`asyncTaskSlice` 的联合类型成员保留，兼容已持久化任务 |
| `components/video/components/VideoChatWindow/turnSummary.ts`（46 行） | 修改 | `VIDEO_TOOLS` 增加 `batch_image_to_video` |
| `lib/i18n.ts` | 修改 | 镜像所有现有 `image_to_video` 键（1666、3340、5175、7157、8988、10967 行附近）新增 `batch_image_to_video`，中文 "批量图片转视频"，英文 "Batch image to video" |
| `components/video/components/MaterialsPanel/MaterialsPanel.tsx` | **不改** | 人工路径保持；因后端支持同源路径顺带修复本地图失败 |

### 4.3 前端测试（`src/lib/video-editing-agent/__tests__/` 与 `tools/__tests__/`）

| 文件 | 动作 |
|---|---|
| `tools/__tests__/imageToVideo.test.ts` | **新增**：成功返回 materialId、幂等复用、同源路径透传、错误码映射、超时、素材类型错误 |
| `tools/__tests__/batchImageToVideo.test.ts` | **新增**：顺序保持、并发 ≤2、部分失败、去重、上限 12、abort |
| `__tests__/addToTrack.stillGuard.test.ts` | **新增**：拒绝/放行/`as_still`/不建轨/错误码稳定/同素材第 3 次拒绝升级提示 |
| `__tests__/composeStoryboard.stillGuard.test.ts` | **新增**：静图场景进 `skipped[]`、视频场景照常、全部为静图时整体失败且不建轨（RV-01） |
| `tools/__tests__/storageKey.test.ts` | **新增**：抽出后的键规则与 `visionTools` 原行为一致（RV-03） |
| `__tests__/systemPrompt.toolkit.test.ts` | 修改：`toHaveLength(19)` → `18`，并新增"核心清单不含 image_to_video"断言 |
| `__tests__/toolActivation.test.ts`（133–138 行） | 修改：18/15/3 → 19/16/3 |
| `__tests__/builtinSkills.test.ts`（第 1 个 `it`） | 修改："seven" → 八个技能，加入 `still-to-clip` |
| `__tests__/agent.circuitBreaker.stillGuard.test.ts` | **新增**：连续 6 次 `still_needs_conversion` 不熔断；之后 5 次真实失败仍熔断 |
| `__tests__/qualityLint.test.ts` | 修改：规则 11 断言 `suggested_tool` |
| `__tests__/systemPrompt.test.ts`（107 行 stub） | 修改：stub 工具名与新核心清单对齐 |

---

## 5. 接口设计

### 5.1 Agent 工具 `image_to_video`（升级）

所属类别：`still_tools`（按需加载）。

```ts
parameters = Type.Object({
  material_id:  Type.String({ description: 'Image material id from list_materials / search_image / generate_ai_image' }),
  duration:     Type.Optional(Type.Number({ minimum: 1, maximum: 30, description: 'Seconds, default 5. Slideshow shots: 3-5; match narration length when known' })),
  effect:       Type.Optional(Type.Union([Type.Literal('ken_burns'), Type.Literal('pan'), Type.Literal('static')],
                  { description: 'Default ken_burns (slow push). pan = horizontal drift. static = no motion' })),
  direction:    Type.Optional(Type.Union([Type.Literal('zoom_in'), Type.Literal('zoom_out'),
                  Type.Literal('left_to_right'), Type.Literal('right_to_left')],
                  { description: 'ken_burns: zoom_in|zoom_out (default zoom_in). pan: left_to_right|right_to_left (default left_to_right)' })),
  focus_x:      Type.Optional(Type.Number({ minimum: 0, maximum: 1, description: 'Subject centre, 0=left 1=right, default 0.5' })),
  focus_y:      Type.Optional(Type.Number({ minimum: 0, maximum: 1, description: 'Subject centre, 0=top 1=bottom, default 0.5' })),
  aspect_ratio: Type.Optional(Type.Union(['16:9','9:16','1:1','4:3','21:9'].map(v => Type.Literal(v)),
                  { description: 'Output frame. Omit to keep the image own ratio. Pass the project ratio when known' })),
});
```

行为约束

1. 素材必须存在且 `type === 'image'`，否则返回结构化错误（沿用现有文案，补 `error_code`）。
2. `direction` 与 `effect` 不匹配（如 `static` + `zoom_in`）：**忽略方向并在结果 `notes` 里说明**，不报错（降低模型试错成本）。
3. 请求体：优先 `storage_key`（由 `normalizeStorageKey(material.storageKey ?? relativeStorageKey(material.cacheUrl ?? material.url))` 推出，复用 `visionTools.ts:123-159` 的同一套规则，不另写第二份），否则 `image_url = material.url`。`blob:` / `data:` URL 在服务端 Agent 里取不到，直接 `error_code:'image_not_local'` 并提示"先 workspace_import_material 或重新入库"。
4. `toolFetch` 超时 120 000 ms，`retry` 沿用默认（仅网络错误重试 1 次，后端幂等所以安全）。

成功返回（`details` 与 `content` 同一份 JSON，字段全部小写驼峰沿用现有工具风格）：

```json
{
  "success": true,
  "materialId": "i2v-3f9a1c0b2e7d4a55",
  "name": "海边日落 · 推镜 5s",
  "sourceMaterialId": "upload-8c1…",
  "duration": 5, "width": 1920, "height": 1080,
  "effect": "ken_burns", "reused": false,
  "notes": [],
  "next_step": "add_to_track({ materialId: \"i2v-3f9a1c0b2e7d4a55\" })"
}
```

* `materialId` 形如 `i2v-<后端 content hash 前 16 位>`，**确定性**：同图同参数永远得到同一个 id。
* `add_material` 是否记录**只取决于** `context.materials` 里是否已有该 id：已有则不再记录（避免重复入库）；没有（新会话、用户删过素材而文件仍在、后端命中缓存）则必须 `push` 并记录，否则返回的 `materialId` 在素材库里不存在，下一步 `add_to_track` 会报 `Material not found`。结果里 `reused` = 后端命中缓存或会话内已有。
* 新素材通过 `context.materials.push(material)` 保证同一轮 `add_to_track` 可见，并 `context.recordOperation(toolCallId, { type: 'add_material', material })` 让前端入库与撤销（沿用现有机制，见 `OperationApplier.ts:331-339`）。

失败返回：`{ success:false, error, error_code, retryable, hint }`，`error_code` ∈：

| error_code | 触发 | retryable | hint（给模型看的下一步） |
|---|---|---|---|
| `material_not_found` | id 不在素材库 | false | "先 list_materials 取真实 id" |
| `not_an_image` | 素材不是 image | false | "视频素材直接 add_to_track" |
| `image_not_local` | blob:/data: 或无 url | false | "先 workspace_import_material" |
| `image_unreadable` | 后端解码失败/损坏 | false | "换一张图，如实告诉用户" |
| `image_too_large` | 体积或像素超限 | false | "换小图或让用户压缩" |
| `ffmpeg_unavailable` | 本机无 FFmpeg | false | "告知用户；可用 add_to_track as_still:true 降级，并说明这是静图叠加" |
| `queue_timeout` | 排队/渲染超时 | true | "稍后重试一次；仍失败则降级并说明" |
| `conversion_failed` | FFmpeg 非 0 退出 | true | "重试一次；仍失败如实汇报" |
| `request_failed` | HTTP/网络错误 | true | 附 HTTP 状态 |

### 5.2 Agent 工具 `batch_image_to_video`（新增）

用途：幻灯片/图文解说一次转多张，避免 N 次往返与 80 次工具调用上限（`tools/index.ts:499`）。

```ts
parameters = Type.Object({
  items: Type.Array(Type.Object({
    material_id: Type.String(),
    duration: Type.Optional(Type.Number({ minimum: 1, maximum: 30 })),
    effect: Type.Optional(/* 同上 */), direction: Type.Optional(/* 同上 */),
    focus_x: Type.Optional(Type.Number()), focus_y: Type.Optional(Type.Number()),
  }), { minItems: 1, maxItems: 12 }),
  defaults: Type.Optional(Type.Object({
    duration: Type.Optional(Type.Number()), effect: Type.Optional(/* 同上 */),
    aspect_ratio: Type.Optional(/* 同上 */),
    variety: Type.Optional(Type.Boolean({ description: 'Default true: alternate zoom_in/zoom_out/pan across items that set no effect/direction, so shots do not all move alike' })),
  })),
});
```

规则

* 并发 2（与后端队列 `max_concurrent=2` 对齐），用 `mapWithConcurrency`；结果**严格按输入顺序**返回，便于模型按顺序上轨。
* 同一 `material_id`+同参数在一次调用内去重（只渲染一次，结果复用到各条目）。
* `variety` 默认开：未显式指定 `effect`/`direction` 的条目按下标循环 `ken_burns/zoom_in → pan/left_to_right → ken_burns/zoom_out → pan/right_to_left`；纯函数、可测、确定性（重试结果一致）。
* 单条失败不影响其余；整体 `success` 规则：`failed.length === 0` → `true`；有成功有失败 → `true` 且 `partial: true`；全部失败 → `false`（熔断器计一次）。
* 总超时 240 000 ms；每条沿用单张的错误码；`abortSignal` 触发后不再启动未开始的条目（`shouldStart`），已启动的等待其返回。

返回：

```json
{
  "success": true, "partial": false,
  "clips": [ { "index": 0, "sourceMaterialId": "…", "materialId": "i2v-…", "duration": 4, "effect": "ken_burns", "reused": false } ],
  "failed": [ { "index": 3, "sourceMaterialId": "…", "error_code": "image_unreadable", "retryable": false } ],
  "next_step": "add_to_track each clips[].materialId in order"
}
```

### 5.3 `add_to_track` 兜底闸

新增可选参数：

```ts
as_still: Type.Optional(Type.Boolean({
  description: 'Place an IMAGE as a still overlay (logo, sticker, watermark, picture-in-picture). Scene images must be converted with image_to_video first.'
})),
```

闸逻辑（放在 `findMaterial` 之后、自动建轨之前，**不会建出空轨**）：

```
if (material.type === 'image' && !params.as_still) →
{
  success: false,
  error_code: 'still_needs_conversion',
  error: `"${material.name}" is a still image. As a scene shot it must be converted to a video clip first.`,
  next_step: {
    tool: 'image_to_video', category: 'still_tools',
    call: `explore_tools({category:"still_tools"}) then image_to_video({material_id:"${material.id}"}) and add_to_track the returned materialId`,
    overlay_exception: 'For a logo/sticker/watermark overlay call add_to_track again with as_still:true'
  }
}
```

要点

* 错误文案本身给出完整下一步，使模型不需要回头读 L0 规则。
* 闸**只在 Agent 工具里**；人工拖拽图片入时间线不受影响（不改 `ItemPlacementService` / `TrackTypeUtils`）。
* **`compose_storyboard` 同样受闸**（RV-01）：逻辑在 `tools/stillGuard.ts`，两个工具共用。`compose_storyboard` 遇到 `image` 场景时不报整体错误，而是把该场景放进 `skipped[]`（`reason` 为闸的 `error`，并带 `error_code: 'still_needs_conversion'` 与 `next_step`），其余视频场景照常上轨；若所有场景都被拒，整体返回 `success:false` + `error_code:'still_needs_conversion'`，且不自动建轨（沿用该工具"首个 clip 被接受时才建轨"的既有写法）。该工具没有 `as_still` 参数——分镜场景本就是镜头，不存在叠加用法。
* 通过 `as_still:true` 的 clip 行为与今天完全一致（零回归）。
* 熔断器豁免见 §6.3。

### 5.4 后端 REST：`POST /api/video/image-to-video`（向后兼容扩展）

请求体（新增字段全部可选；旧调用——素材面板、旧 Agent——无需改动）：

```jsonc
{
  "image_url": "/api/storage/files/uploads/images/a.jpg",   // 现在支持同源路径与 http(s)
  "image_data": null,                // 旧：base64
  "storage_key": "uploads/images/a.jpg",   // 新：STORAGE_ROOT 相对键（规则同 vision 工具），优先于 image_url；后端拼成 /api/storage/files/<key> 解析
  "image_filename": null,
  "effect": "ken_burns",             // static | ken_burns | pan
  "duration": 5.0,                   // 1..30
  "ken_burns_direction": "zoom_in",  // zoom_in | zoom_out
  "pan_direction": "left_to_right",  // left_to_right | right_to_left
  "focus_x": 0.5, "focus_y": 0.5,    // 0..1
  "aspect_ratio": null,              // 新：16:9|9:16|1:1|4:3|21:9，null=保持原图比例
  "max_long_side": 1920,             // 新：输出长边上限，范围 480..3840，偶数化
  "task_id": null, "custom_filename": null
}
```

响应（成功）：

```jsonc
{
  "success": true, "message": "Image converted to video successfully",
  "video_url": "/api/storage/files/video/generated/i2v_3f9a1c0b2e7d4a55.mp4",
  "storage_key": "video/generated/i2v_3f9a1c0b2e7d4a55.mp4",   // 新
  "thumbnail_url": "/api/storage/files/video/generated/i2v_3f9a1c0b2e7d4a55_thumb.jpg",
  "file_size": 123456, "duration": 5.0, "width": 1920, "height": 1080,
  "effect_applied": "ken_burns", "processing_time": 2.4,
  "reused": false                                                // 新：命中内容寻址缓存
}
```

响应（失败）沿用 `ImageToVideoErrorResponse {success:false, message, error_code, details}`，`error_code` 取值：`MISSING_IMAGE_SOURCE`、`IMAGE_NOT_FOUND`、`IMAGE_UNREADABLE`、`IMAGE_TOO_LARGE`、`FFMPEG_UNAVAILABLE`、`FFMPEG_ERROR`、`QUEUE_TIMEOUT`、`INVALID_DURATION`、`INVALID_ARGUMENT`、`INTERNAL_ERROR`。前端 `stillClip.ts` 把它们一一映射到 §5.1 的 Agent 错误码。**错误码是对外 API，改名属破坏性变更**（CLAUDE.md §5），已有的 `MISSING_IMAGE_SOURCE` / `FFMPEG_ERROR` / `INVALID_DURATION` / `QUEUE_ERROR` / `CONVERSION_ERROR` / `UPLOAD_FAILED` / `FILE_NOT_CREATED` 保留语义，不删除；`QUEUE_ERROR`、`CONVERSION_ERROR` 仅作兜底，前端把它们都归入 `conversion_failed`。

HTTP 状态：业务失败仍返回 200 + `success:false`（与现有一致，素材面板依赖这一点）；仅请求体不合法（Pydantic 校验）返回 422。

---

## 6. 技术设计

### 6.1 端到端时序（典型：用户说"用这 6 张照片做个 30 秒的片子，放进视频里"）

```
用户 ─▶ Agent(L0 看到规则句 + still_tools 目录行)
  1. update_plan（>=3 步）
  2. list_materials                        → 6 张 image，拿到 id / storageKey
  3. （可选）use_skill('still-to-clip')    → 预加载 still_tools，得到幻灯片流程
     或  explore_tools({category:'still_tools'})
  4. batch_image_to_video({items:[6], defaults:{duration:5, aspect_ratio:'16:9'}})
        └ 前端 stillClip.ts：逐条 POST /api/video/image-to-video（并发 2）
              └ Next 透传路由 → FastAPI → ImageToVideoService
                    resolve(storage_key) → 读取本地文件 → 像素校验
                    → 内容 hash → 命中则 reused:true
                    → 未命中：create_subprocess_exec(ffmpeg) → mp4 + thumb → STORAGE_ROOT
        ← 6 个 materialId（顺序与输入一致）+ add_material 操作入库
  5. add_to_track × 6（按顺序，startTime 缺省=轨尾，首尾相连）
  6. check_timeline_overlaps / check_timeline
  7. 汇报：6 张图已转为 5 秒推拉/平移镜头
```

偏离路径：第 4 步前模型若直接 `add_to_track(image)` → 得到 `still_needs_conversion` + `next_step`，下一轮自行纠正；该拒绝不进入熔断计数（§6.3）。

### 6.2 后端转换管线（`image_to_video_service.py`）

1. **取图**（顺序固定）：`image_data` → `storage_key` → `image_url`。
   * `storage_key`：先按 vision 工具的同一套规则校验（复用 `agent_vision.image_source.validate_storage_key`：非空、≤256、无盘符、无前导分隔符、无 `..`），再拼成 `/api/storage/files/<url 编码后的 key>` 交给 `resolve_media_reference`。**不要**把裸相对键直接传入——该函数对不以 `/` 开头的相对串锚定 `SERVICE_ROOT` 而非 `STORAGE_ROOT`，会解析到错误目录并被白名单拒绝（评审 RV-02）。
   * 同源路径（`/api/storage/files/...` 等）：直接 `resolve_media_reference(ref)`，只读本地文件，路径必须落在允许根内（已有 `validate_local_path_for_ffmpeg`）。
   * 远程 http(s)：`resolve_media_reference(ref, allow_remote=True)`（内部走 `validate_external_url`，拦内网/回环/元数据地址），再用 `httpx.AsyncClient` 下载：超时 30 s、`Content-Length` 与流式累计均 ≤ 25 MB、`content-type` 必须以 `image/` 开头。
   * 解析失败 → `IMAGE_NOT_FOUND`；超限 → `IMAGE_TOO_LARGE`。
2. **解码与校验**：`PIL.Image.open` 读尺寸与 EXIF 方向（`ImageOps.exif_transpose` 先落地到临时 PNG/JPEG，避免手机照片旋转错误）；`Image.open` 是惰性的，打开后先比较 `width*height`，超过 64 000 000 → `IMAGE_TOO_LARGE`，**不要**赋值进程级的 `Image.MAX_IMAGE_PIXELS`（会改变后端其它图像处理的行为）；解码异常 → `IMAGE_UNREADABLE`。这一步放进 `asyncio.to_thread`。
3. **输出规格**：
   * `aspect_ratio` 缺省：沿用原图比例；给定：取该比例。
   * 长边 = `min(max_long_side, 1920)` 的默认；短边按比例计算；**宽高都偶数化**（向下取偶，最小 64）。
   * 帧率固定 30。
4. **内容寻址**：`key = sha1(图片字节 ‖ 规范化参数JSON)[:16]`，输出 `video/generated/i2v_<key>.mp4`、`..._thumb.jpg`，经 `storage_service.upload_file(custom_path=…, user_id=LOCAL_OWNER_ID)` 写入。目标已存在且大小 > 0 → 直接返回 `reused:true`，**跳过渲染**。写入采用"临时名 + 原子重命名"，避免半成品被当作命中。
5. **滤镜**（全部在 `image_to_video_filters.py`，纯函数）：
   * `ken_burns`：先 `scale=2W:2H:force_original_aspect_ratio=increase,crop=2W:2H`（放大到输出的 2 倍，消除 zoompan 抖动，D5），再
     `zoompan=z='<z0>+(<z1>-<z0>)*on/<N>':d=<N>:s=<W>x<H>:fps=30`，其中 `z0/z1` 为 1.00↔1.12（`zoom_out` 反向），`x='max(0,min(iw-iw/zoom, <fx>*iw-iw/zoom/2))'`，`y` 同理（crop 窗口左上角，**钳制**在输入范围内，杜绝黑边，D5）。
   * `pan`：`scale` 到输出的 1.25 倍宽（`increase`+裁高到 H），`crop=W:H:x='(iw-W)*<ease(t/T)>':y=(ih-H)/2`，`ease` 取 smoothstep，方向决定起止；`focus_x` 仅用于限制总位移不越界。
   * `static`：有 `aspect_ratio` 且与原图比例不同 → 复用 `composition/canvas_fit.py` 的 `blur` 填充片段（与导出一致的"模糊背景 + 居中"，不用黑边，D4）；比例相同则直接 `scale`。
   * 编码：`-c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -r 30 -movflags +faststart -an`；`-loop 1 -framerate 30 -i <img>`、`-t <duration>` 等**输入选项紧贴各自 `-i`**（`test_camera_motion_stills.py` 里记录过的陷阱 D27/C18）。
6. **执行**：`asyncio.create_subprocess_exec`，超时 `max(60, duration × 12)` 秒，超时则 `kill()` 并返回 `QUEUE_TIMEOUT`；取消（客户端断开）同样 `kill()` 并清理临时文件。FFmpeg 路径沿用现有解析（不引入新查找逻辑）；不可用 → `FFMPEG_UNAVAILABLE`（在服务初始化时探测一次并缓存，不再每次 `ImageToVideoService()` 重新 `-version`）。
7. **缩略图**：取 `min(1.0, duration/2)` 秒处一帧，失败不致命（返回 `thumbnail_url:null`）。
8. **清理**：`finally` 里删除全部临时文件；成品只保留存储目录里的那一份（现状是 `output_dir` 里先生成再删，改成直接写临时名再原子移动）。
9. **GC**：确认 `derived_gc_service` 不会回收 `video/generated/`（见 AC-10；若会，在其白名单里豁免——本任务内处理，不留给别人）。

### 6.3 前端：工具、素材登记与熔断器

* `stillClip.ts` 暴露三个纯函数 + 一个执行函数：`buildStillClipRequest(material, params)`、`mapStillClipError(response)`、`toVideoMaterial(source, response, params)`、`runStillClip(context, toolCallId, params)`。单张与批量只组合它们。
* 素材登记：`MaterialItem` 字段 `id=i2v-<key>`、`type:'video'`、`format:'mp4'`、`url=video_url`、`thumbnailUrl`、`storageKey=storage_key`（使 `view_image` / `review_frames` / 导出解析能直接定位，参见 `toAgentClipMaterial` 与 `visionTools.storageKeyFor`）、`metadata:{ storageKind:'local', storageKey, generatedFromImage:true, sourceMaterialId, effect, direction }`、`tags:['image-to-video','generated']`、`description:'由图片「…」生成的 5 秒推镜视频'`。
* 熔断器豁免（`agent.ts`）：在 `softFailure` 计算处新增

  ```
  const expectedGuardRejection = details?.error_code === 'still_needs_conversion';
  const failed = (isError || softFailure) && !expectedResearchFailure && !expectedGuardRejection;
  // 计数分支：if (failed) {...} else if (!expectedResearchFailure && !expectedGuardRejection) { reset }
  ```
  拒绝既不累加也不清零。防死循环：同一 `materialId` 被拒 ≥3 次后，`stillGuard` 把 `next_step` 升级为强提示"你已被拒绝 3 次，请立即调用 image_to_video，不要再重试 add_to_track"（计数存 `context.turnState.stillRejections[materialId]`，`turnState` 每个请求新建，天然随请求重置；该字段需加进 `ToolkitTurnState` 类型）。
* 操作撤销：`add_material` 已是可撤销操作，转换出的素材可被撤销；`add_to_track` 的 clip 通过 `material` 快照保持可播放（既有机制）。

### 6.4 就地提示（L0.5）

`search_image`、`generate_ai_image`、`fetch_web_image` 成功结果各追加一个字段：

```
"next_step": "These are still images. To use one as a shot: image_to_video(material_id) then add_to_track(videoMaterialId); logos/stickers: add_to_track(as_still:true). Library only if the user did not ask to place it."
```

只在结果里出现一次，不进入常驻提示词；`compactToolResult.ts` 在历史压平时会处理旧结果，此字段短（<300 字节），不需要特殊处理。

---

## 7. 数据模型

无数据库变更（本项目 SQLite 只做增量建表，且本功能不新增表；符合"启动路径无破坏性 DDL"的红线）。

内存/文件形态

| 对象 | 形态 |
|---|---|
| 输出视频 | `STORAGE_ROOT/video/generated/i2v_<key16>.mp4`，经已有挂载 `/api/storage/files/video/generated/...` 提供（无需新静态挂载） |
| 缩略图 | 同目录 `i2v_<key16>_thumb.jpg` |
| `key16` | `sha1(image_bytes + canonical_json({effect, direction, duration, focus_x, focus_y, W, H, fit, version}))[:16]`，`version` 为滤镜实现版本常量，改滤镜时自增以使旧缓存失效 |
| 前端 `MaterialItem` | 见 §6.3；`id` 确定性，所以同一会话重复转换幂等 |
| `AsyncTask` | 本功能不再创建 `image_to_video` 类型任务（联合类型成员保留以兼容旧持久化状态） |
| 技能 `still-to-clip` | `SKILL.md` 内置只读文件，随安装包发布 |

---

## 8. 内置技能 `still-to-clip`（L2）

```markdown
---
id: still-to-clip
name: 图片做成视频镜头
description: 把多张图片做成幻灯片、图文解说或带运镜的镜头
version: 1
tools: [image_to_video, batch_image_to_video]
---
目标：把图片变成可放上视频轨的镜头。图片不要直接 add_to_track——静图会变成居中的叠加贴图，不是全屏镜头。

1. 盘点：`list_materials` 找出要用的图片；只说"找图/生成图"时到入库为止，不上轨。
2. 定时长：有旁白就按每句时长（`duration` ≈ 该句时长，上限 30）；没有旁白每张 3–5 秒。
3. 定画幅：知道项目画幅就传 `aspect_ratio`（如 9:16）；不确定就省略，保持原图比例。
4. 批量转换：2 张以上用 `batch_image_to_video`（一次最多 12 张，超过分批）；默认 `variety` 会交替推拉与平移，不要给每张都指定同一效果。人物或主体偏一侧时给 `focus_x` / `focus_y`。
5. 上轨：按返回 `clips[]` 的顺序逐个 `add_to_track(materialId)`，不要自己编 id；`failed[]` 里的图如实告诉用户，不要用别的图顶替。
6. 检查：`check_timeline_overlaps`，再运行 `check_timeline`。

例外：Logo、水印、贴纸、画中画才用 `add_to_track` 的 `as_still: true`。转换不可用（`ffmpeg_unavailable`）时先告诉用户，再降级为 `as_still: true`，并说明这是静图叠加。
```

约束校验（沿用 `agent_skills/limits.py`）：`description` ≤60 码点、不以 `# - * > \`` 开头；正文 ≤3500 码点；`tools` ≤8 个；两个工具属同一非常驻类别 `still_tools`，满足 `builtinSkills.test.ts` 的"非常驻类别 ≤2、每类 ≤4"预加载上限。

---

## 9. 测试与验收标准

### 9.1 验收标准（可逐条勾验）

| 编号 | 标准 | 验证方式 |
|---|---|---|
| AC-1 | `image_to_video` 对本地同源素材（`/api/storage/files/...`）成功，结果含确定性 `materialId`，且同一轮内 `add_to_track(materialId)` 成功 | `imageToVideo.test.ts` + 后端集成测试 |
| AC-2 | 同图同参数二次调用 `reused:true`、不再产生 `add_material` 操作、`materialId` 相同；后端不重新渲染（FFmpeg 调用次数 0） | 前后端各一条 |
| AC-3 | `add_to_track` 对 image 未带 `as_still` → `success:false` + `error_code:'still_needs_conversion'` + 完整 `next_step`；**不创建任何轨道、不产生任何操作** | `addToTrack.stillGuard.test.ts` |
| AC-4 | `as_still:true` 的 clip 与改动前逐字段一致（含 `originalDuration:0`、默认 5 秒） | 快照对比 |
| AC-5 | 连续 6 次 `still_needs_conversion` 不触发熔断；其后 5 次真实失败仍触发 | `agent.circuitBreaker.stillGuard.test.ts` |
| AC-6 | `batch_image_to_video`：顺序与输入一致；并发峰值 ≤2；部分失败 `partial:true` 且其余成功；12 张上限；abort 后不启动未开始项 | `batchImageToVideo.test.ts` |
| AC-7 | 后端：远程 URL 指向 `127.0.0.1` / `169.254.169.254` / 内网段被拒；>25 MB、>64 MP、非图片 content-type 被拒，错误码正确 | `test_image_to_video_router.py` |
| AC-8 | 后端：Ken Burns 输出首帧与末帧**四边无黑边**（取边缘 4px 带的平均亮度 > 阈值，用带彩色边框的测试图验证），`focus_x=0` 与 `focus_x=1` 均成立 | `test_image_to_video_service.py`（真实 FFmpeg） |
| AC-9 | 后端事件循环不被阻塞：① 结构断言——`image_to_video_service.py` 中不再出现 `subprocess.run` 与 `requests`；② 软探针——有 FFmpeg 时转换 5 秒 1080p 期间并发发 5 次轻量 HTTP 请求，响应延迟**中位数** < 500 ms（不用绝对 200 ms 阈值，避免低配机器偶发失败） | 静态断言 + 集成测试 |
| AC-10 | 输出文件落在 `video/generated/` 且经 `/api/storage/files/...` 可 Range 播放；`derived_gc_service` 不回收它 | 路由测试 + 阅读 GC 白名单并写断言 |
| AC-11 | EXIF 旋转的竖拍照片输出方向正确；奇数尺寸输入输出为偶数宽高 | 滤镜/服务测试 |
| AC-12 | L0 提示词：实现者在改动前、后各实测一次最坏值并写入提交说明，判据为**改动后 ≤ 改动前**，且全部既有 18 900 / 18 500 断言通过；`CORE_TOOLKIT_TOOL_NAMES.length === 18` 且不含 `image_to_video` | `systemPrompt*.test.ts` |
| AC-13 | `explore_tools({category:'still_tools'})` 加载后下一响应可调用两个工具；加载前调用返回 `tool_not_loaded`；`use_skill('still-to-clip')` 自动预加载二者 | `toolActivation.test.ts` + 技能测试 |
| AC-14 | 类别总数 19 / 按需 16 / 常驻 3；`ai_gen_tools` 只含 `generate_ai_image`、`generate_ai_video` | `toolActivation.test.ts` |
| AC-15 | 8 个内置技能全部通过 `parser` 校验；`quick-assemble` / `explainer-video` / `news-digest-video` 升到 `version: 2` 且不再出现"把图片 add_to_track"的表述 | `test_agent_skills_*` + `builtinSkills.test.ts` |
| AC-16 | 质量自检规则 11 的 `suggested_tool` 为 `image_to_video`；规则总数仍为 16 且顺序不变 | `qualityLint.test.ts` |
| AC-17 | 人工路径回归：素材面板对本地图片点"图片转视频"仍成功（含 blob 图片走 `image_data`、同源图片走 `image_url`） | 手动 + 路由测试 |
| AC-19 | `compose_storyboard` 收到 `image` 场景：该场景进 `skipped[]` 且带 `error_code:'still_needs_conversion'`，视频场景照常上轨；全部为静图时整体 `success:false`、不新建轨、不产生操作，且熔断器不累加 | `composeStoryboard.stillGuard.test.ts` + `agent.circuitBreaker.stillGuard.test.ts` |
| AC-20 | 后端 `storage_key` 解析：`uploads/images/a.jpg`（存在）成功；`../x`、`/etc/passwd`、`C:/x` 返回 `INVALID_ARGUMENT`，不存在的键返回 `IMAGE_NOT_FOUND`，且不读取 STORAGE_ROOT 之外的文件 | `test_image_to_video_router.py` |
| AC-18 | 门禁：`npm run type-check` 0 错误；本次改动文件 ESLint 0 error（用 `ESLINT_USE_FLAT_CONFIG=false npx eslint <files>`）；`pytest tests/ -v` 新增用例全绿，基线失败数不增加；`desktop` 的 `node scripts/smoke-test.js` 通过 | 命令输出 |

### 9.2 端到端验收脚本（桌面应用，最终必做）

1. 上传 4 张本地图片（含一张竖拍 EXIF 旋转、一张 >4000px）。
2. 对 Agent 说"把这 4 张图做成一个 20 秒的视频，放进时间线"。预期：Agent 先 `explore_tools(still_tools)` 或 `use_skill('still-to-clip')`，再 `batch_image_to_video`，随后 4 次 `add_to_track`（每次传视频素材 id）；时间线是 4 段首尾相连的视频 clip，预览全屏、有运镜；**工具调用记录里没有对 image 素材的 `add_to_track`**。
3. 对 Agent 说"在右上角加上这个 logo"。预期：`add_to_track(as_still:true)`，行为与旧版一致。
4. 关闭 FFmpeg（改名）重试第 2 步：Agent 如实说明无法转换并在征得说明后降级，不空转、不熔断。
5. 同一会话再次要求转换同一张图：`reused:true`，无新素材。

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 硬闸让弱模型多走 2–3 个来回，或在 `add_to_track` 与 `explore_tools` 间打转 | 体验变慢、token 增加 | 错误文案自带完整下一步；L0 规则句已前置；同一素材被拒 ≥3 次升级强提示；技能一次预加载，省掉 `explore_tools` 往返 |
| 熔断豁免被滥用，掩盖真实失败 | 死循环 | 豁免只认单一固定 `error_code`；拒绝不重置计数，所以夹杂真实失败仍会熔断；有专门回归测试（AC-5） |
| L0 字符超限 | `L0_PROMPT_CHAR_CEILING` 断言失败 | 设计上净减 ≈300 字符；AC-12 实测；若超限优先裁剪规则句措辞而不是提高上限 |
| 新增类别使 `explore_tools` 的 `category` 枚举与目录行增加 | 提示词微增 | 已计入预算；目录行 ≤160 字节 |
| `as_still` 成为"逃生口"被模型滥用，回到旧行为 | 目标落空 | 参数描述写明仅限叠加图；质量自检规则 11 对 >8 秒的无运镜静图继续提示；E2E 第 2 步断言工具记录里没有无理由的 `as_still` |
| 后端内容寻址缓存与滤镜改版不一致 | 返回旧实现产物 | `key` 含 `version` 常量，改滤镜必须自增；测试固定该常量参与哈希 |
| `zoompan` 在不同 FFmpeg 版本表现不同（项目里已有 `probe_camera_filters` 先例） | 个别环境渲染失败或抖动 | 沿用 `camera_motion.dry_run_chain` 的"0.1 秒干跑"思路：服务首次使用某滤镜前干跑一次并缓存结果；干跑失败 → `FFMPEG_ERROR` 而不是产出坏视频 |
| 大图/大批量占满磁盘或 CPU | 桌面端卡顿 | 长边默认 ≤1920、批量上限 12、并发 2、25 MB/64 MP 双上限；产物内容寻址天然去重 |
| `derived_gc_service` 回收 `video/generated/` 导致素材突然失效 | 时间线 clip 变空 | AC-10 明确要求读 GC 白名单并加断言；若会回收则在本任务内豁免 |
| 远程取图的 SSRF | 安全 | 复用 `validate_external_url`；仅 http(s)；禁止重定向到内网（httpx `follow_redirects` 每跳重新校验，或关闭重定向）；上限与超时 |
| 第二条放轨通路 `compose_storyboard` 绕过兜底闸 | 分镜流程仍出现"静图当贴纸" | 共享 `stillGuard`（D-9，AC-19）；以后新增放轨工具必须接入 |
| 历史会话里旧的 `image_to_video` 调用记录（无 `materialId` 字段） | 回放兼容 | 工具名不变、新增字段只增不减；`messageConverter` 无需改动 |
| 删除异步分支后，旧持久化的 `image_to_video` 任务永远 pending | UI 残留 | `cleanupExpiredTasks` 已定期清理；`asyncTaskSlice` 联合类型保留 |
| 本文件 CLAUDE.md 的 Clean Code 阈值（文件 ≤800 行、函数 ≤50 行、参数 ≤5） | 评审不过 | 滤镜拆到独立模块；`stillClip.ts` 拆小函数；`runStillClip` 用选项对象而非位置参数 |

### 10.1 开放问题（已给默认答案，若评审有异议再改）

1. 是否让 `aspect_ratio` 默认取工程画幅？当前 Agent 上下文没有该信息，默认保持原图比例（D-7）；若后续 `ToolContext` 增加画幅，仅改默认值来源。
2. 规则 11 是否扩展为"任何无运镜静图都提示"？本次不扩展，避免改动 16 条规则的契约；闸 + 提示词已覆盖主路径。
3. 是否需要 `add_to_track` 的 `from_image` 一步到位快捷方式？不做（D-1），保持工具职责单一。
4. 兜底闸的拒绝在前端工具卡片上是否会显示为红色失败？实现者先查看 `tool_result` 卡片是否已有"软失败/预期内"样式，有则复用；没有则保持现状，不为此新增 UI（评审 RV-09）。

---

## 11. 实施顺序（给下游工程师）

1. **后端**（可独立合入）：`image_to_video_filters.py` + 服务重写 + 模型/路由 + 三组测试（AC-7～AC-11）。
2. **前端工具**：`stillClip.ts`、`imageToVideo.ts`、`batchImageToVideo.ts`、类别与注册、`promptParts`/`systemPrompt` 文案、i18n、`turnSummary`、删除 poller 死代码（AC-1、2、6、12～14）。
3. **闸与熔断**：`addToTrack.ts`、`agent.ts`、就地提示、`qualityLint` 文案（AC-3～5、16）。
4. **技能**：新增 `still-to-clip`、修改三个旧技能、更新技能测试（AC-15）。
5. **收尾**：更新 `docs/apis/image_to_video_api.md`；跑 AC-18 全部门禁；桌面端 §9.2 走查；提交时按 `[add]/[modify]/[fix]` 前缀，用 `git add <path>` 精确暂存（不要 `git add -A`）。

> 发布说明（评审补充，RV-11）：前后端随同一安装包发布，不存在版本错位；新增的后端字段与错误码均为可选/新增，旧素材面板请求体不变即可继续工作。回滚只需还原该提交，无数据迁移、无 DDL。

---

## 评审结论

**有条件通过**（版本 v2）。

评审依据：对照仓库实际代码逐节核实，设计的根因分析（D1–D9）与分层方案（L-1 / L0 / L0.5 / L1 / L2）成立，规模适当——不新增依赖、不动时间线渲染管线、不改人工 UI，L0 字符净减。v1 中两个 P1 缺陷（RV-01 `compose_storyboard` 绕过兜底闸；RV-02 `storage_key` 被锚定到 `SERVICE_ROOT`）已在 v2 正文修复，P2 项已修复或登记，**无遗留 P0 / P1**。

通过附带的条件（实现阶段必须满足，均已写入正文或验收标准）：

1. **AC-19 / AC-20 必须落地**：分镜通路的兜底闸与 `storage_key` 解析是 v2 新增的两个验收点，缺一不可。
2. **L0 预算要实测**：AC-12 改为改动前后各实测一次，且不得提高 `L0_PROMPT_CHAR_CEILING`；超出时优先裁剪规则句措辞。
3. **`visionTools.ts` 重构保持零行为变化**：抽出 `storageKey.ts` 后，既有视觉工具测试必须全绿。
4. **桌面端 §9.2 走查为必做门禁**：尤其第 2 步（工具记录里不得出现对 image 素材的无理由 `add_to_track`）与第 4 步（关闭 FFmpeg 不熔断）。
5. 实现者核对 §10.1 第 4 条（拒绝在前端的呈现），不扩大范围。

---

## 实施过程发现的方案缺陷

> 实施节点 · 基于 v2 落地；以下均已在代码中按"修正后做法"处理，不再留给下游决策。

| 编号 | 级别 | 方案原文 | 实际情况 | 实施时的做法 |
|---|---|---|---|---|
| IM-01 | P2 | §4.1 `docs/apis/image_to_video_api.md` | 该文档实际在 `backend-services/basic-service/docs/apis/image_to_video_api.md`（仓库根 `docs/` 下没有 `apis/`），且旧文档仍写着 Supabase、`MISSING_IMAGE_URL` 等已不存在的内容 | 在真实路径整篇重写：新增字段、错误码、同源路径、幂等、并发、SSRF 规则 |
| IM-02 | P2 | §6.2 第 4 步"经 `storage_service.upload_file(custom_path=…, user_id=LOCAL_OWNER_ID)` 写入" | `upload_file` 把整个文件读进内存再写，不支持"临时名 + 原子重命名"，且 `_validate_file_type` 对 `video` 夹要求 content-type 白名单；与同一步里"原子重命名"的要求自相矛盾 | 直接写 `storage_service.root/video/generated/`（文件名是自己生成的十六进制，无路径穿越面），先写 `.<名>.<pid>.part.*` 再 `os.replace`。同时旧的 `user_id="anonymous"` 随 `upload_file` 调用一并消失，无需引入 `LOCAL_OWNER_ID` |
| IM-03 | P2 | §6.2 / §10 风险表："首次使用某滤镜前干跑一次并缓存" | 渲染本身写到临时名、成功后才改名，失败不会留下坏视频；干跑只会让每种滤镜多一次进程启动，而收益（`FFMPEG_ERROR` 而不是坏文件）已由"临时名 + 退出码"保证 | 不实现干跑；`test_image_to_video_service.py` 用真实 FFmpeg 覆盖 ken_burns / pan / static 三条链路，滤镜版本漂移会在 CI 里直接红 |
| IM-04 | P2 | §4.2 i18n"镜像所有现有 `image_to_video` 键（六处）" | 六处里三处是工具名（`tools.*`），三处是异步任务类型（键集由 `AsyncTaskType` 决定，`batch_image_to_video` 永远不会成为任务类型） | 只在三处工具名分组加 `batch_image_to_video`；任务类型分组不加（加了是死键，还会与类型不一致） |
| IM-05 | P2 | §4.1 `explainer-video` / `news-digest-video` "第 3、4 步同上（转换后再上轨）" | 这两个技能已各预加载两个非常驻类别（`script_tools`+`tts_tools` / `web_tools`+`material_tools`），再加 `still_tools` 会超过 `ToolActivationState.load` 的"≤2 个非常驻类别"上限（`builtinSkills.test.ts` 会红） | 不改它们的 `tools:`；正文改为"先 `use_skill('still-to-clip')` 载入图片成片流程"，由 `still-to-clip` 预加载两个工具。`quick-assemble` 的类别空间够，直接预加载 |
| IM-06 | P2 | §4.3 未列 | 技能总数 7→8 后，`MAX_INDEX_ENTRIES=10` 的索引上限使"内置 + 用户技能"里可见的用户技能由 3 个降为 2 个 | 不改上限（它是 `invalid_skill` 契约的一部分）；更新 `test_agent_skills_{parser,router,store}.py` 的计数与顺序断言。**登记为已知后果**：用户技能超过 2 个时，较旧的不进 L0 索引（仍可经技能面板和 `use_skill(id)` 使用） |
| IM-07 | P2 | §4.2 `fetch_web_image` 追加 `next_step` 只列了 `webTools.ts` | 该工具的结果由 `webToolAdapter.executeWebTool` 统一组装并截断，`webTools.ts` 里没有可追加字段的位置 | 给 `WebCall` 增加可选 `successFields`（仅合并进成功结果），`fetch_web_image` 传入 `next_step`；其余 web 工具行为不变 |
| IM-08 | P2 | §4.2 `AsyncTaskPoller` "删除 `POLL_INTERVALS` 条目" | `POLL_INTERVALS` 是 `Record<AsyncTaskType, number>`，联合类型成员保留时删条目会编译失败 | 改为 `Partial<Record<…>>`（读取处本来就有 `?? 5_000`），联合类型成员按设计保留以兼容旧持久化任务 |
| IM-09 | P2 | §5.4 / §9.1 AC-7 "HTTP 状态：Pydantic 校验返回 422" 与"错误码 `INVALID_ARGUMENT`"并存，未说明归属 | `aspect_ratio` / `max_long_side` 越界属于请求体形状错误，`ken_burns_direction` / `pan_direction` 是历史上的自由字符串 | `aspect_ratio` 用 `Literal`、`max_long_side` 用 `ge/le` → 422；不合法的方向值与不安全的 `storage_key` → 200 + `INVALID_ARGUMENT`（素材面板依赖业务失败走 200）。已写入 API 文档 |
| IM-10 | 信息 | §4.1 `app/models/__init__.py`"导出新增符号" | 本次没有新增需要对外导出的类（新增的只是字段与一个 `Literal` 别名） | 未改该文件 |

### AC-12 实测（改动前 / 后，同一测量夹具）

测量对象：`buildSystemPrompt`（空时间线、空素材、无探索类别）的字符数；"含索引"为额外放入 10 条满长度技能索引（最坏情形）。

| | 改动前（HEAD） | 改动后 | 差 |
|---|---|---|---|
| 基础提示词 | 16 214 | 15 940 | **−274** |
| 含 10 条技能索引 | 16 861 | 16 587 | **−274** |

判据"改动后 ≤ 改动前"成立（净减 274 字符，与设计预估的 ≈300 吻合）；`L0_PROMPT_CHAR_CEILING = 18 900` 未改动，既有 18 900 / 18 500 断言全部通过。

### 门禁结果（AC-18）与未完成项

* `npx tsc --noEmit`：0 错误。
* 本次改动的 22 个前端文件 `ESLINT_USE_FLAT_CONFIG=false npx eslint`：0 error（8 条 warning 均为改动前就存在的 `any` / 未用变量 / ref 清理提示）。
* 前端 vitest（`src/lib/video-editing-agent` + `src/components/video`）：新增与修改的用例全绿。整套里有 1 条与本次无关的既有失败（`VideoEditorContainer.recoveryBackup.test.ts`，对源文件做的正则不兼容工作区 CRLF），另有 2 条在整套并发时偶发超时、单独运行均通过（`toolkitTools.test.ts`、`r1Leftovers.tokens.test.ts`）。
* 后端：新增 66 条（`test_image_to_video_{filters,service,router}.py`）全绿，其中 service 测试用真实 FFmpeg；技能三组测试 181 条全绿。
* **未执行**：§9.2 桌面端走查与 `desktop/scripts/smoke-test.js`——需要打包桌面应用与真人交互，本节点无法完成；仍是评审结论里的必做门禁，交由后续节点/人工执行。
