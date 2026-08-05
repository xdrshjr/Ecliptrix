# 静帧运镜与运镜可靠性收口（Camera Motion v2 — Stills & Hardening）设计方案 v2

**文档版本**：**v2**（设计评审节点修订，2026-08-05；v1 为方案设计节点产出，同日）
**作者**：Solution Architect, Anthropic Engineering
**评审**：Senior Reviewer, Anthropic Engineering（v1 → v2：2 项 P0、6 项 P1 已在正文内修复；见文首「评审记录」一节）
**上游依赖**：`docs/plans/camera-motion-2d-3d/spec.md`（v2，已实现并合入 `4497eab`）
**本节点范围**：仅本设计文档；不写实现代码、不改任何源文件、不执行 `git commit`

---

## 评审记录（Review Notes）

> 本节是设计评审节点的产出。评审方法：**逐节对照仓内真实代码**（而不是对照 v1 spec 的
> 描述），并对文档里两条"凭经验断言、未实测"的关键假设**直接跑 FFmpeg 实测**。
> 所有 P0 / P1 已在本文档正文内修复（修复位置见每条末尾的「已改」），P2 记录在案由下游
> 节点自行取舍。评审基线：`4497eab`，FFmpeg `2025-05-15-git-12b853530a-full_build`。

### P0（阻塞：按 v1 正文实现会产出错误行为）

| # | 结论 | 证据 | 已改 |
|---|---|---|---|
| **P0-1** | **`-loop/-t/-framerate` 无法按 v1 §4.4.3 的写法注入。** v1 写「`plan.input_args` 拼到该图片的 `-i` 之前」，读起来像一处小改动。但仓内两个函数都是**两趟循环**：第一趟只做「下载/落盘 → `cmd.extend(['-i', path])` → `valid_items.append(item)`」（`video_composition_service.py:2499-2510` / `:2648-2662`），位置框 `even_w/even_h`、`start_time`、`duration` 要到**第二趟**才算出来。此时 `-i` 早已入列，输入参数无处可插；若按字面在第二趟追加，`-loop 1 -t …` 会落到**下一个输入或输出**上，整条命令语义被改写 | `video_composition_service.py:2497-2534`、`:2644-2713` | §4.4.3 改为**单趟装配**（D27），并在 §9.1 加"输入参数与 `-i` 相邻"的断言 |
| **P0-2** | **v1 的「能力探测 + 表达式预检」两道闸门在静帧链路整体缺席。** `build_still_overlay_plan(..., caps=None)` 会让 `build_camera_filter_chain` 回落到 `CameraFilterCaps()`——该 dataclass 的**五个字段默认全 True**（`camera_motion.py:159-165`）。于是在没有 `zoompan`/`perspective` 的 FFmpeg 上照样吐出滤镜串，G4 承诺的「探测缺失 → 降级」这一条**根本不会触发**；而视频侧是显式传 `self._get_camera_caps(ffmpeg_path)` 的（`:721`）。同理 v1 用 64×36/0.1s lavfi 空跑抓「该滤镜没有这个变量」（`:729-739`，P0-1 的产物），静帧侧也没有。代价不对称：视频侧失败只重跑**一个片段**的 normalize，静帧侧失败要把**整条 overlay pass**（= 全片重编码）再跑一遍 | `camera_motion.py:159-165`、`video_composition_service.py:715-739` | 新增 **D26**；§4.4.2 签名与 §4.4.3 步骤都改为强制传 `caps` + 预检；§12 增 **C17** |

### P1（必须修：真实缺口 / 事实错误 / 未验证的关键假设）

| # | 结论 | 证据 | 已改 |
|---|---|---|---|
| **P1-1** | **回退路径的 warnings 无出口，C12 不成立。** v1 §4.4.3 把 `_process_overlays_sequential` 列为三个调用点之一，但该函数签名是 `(self, all_image_items, request, output_path, temp_dir)`——**没有 `composition_id`**，返回 `None`，且它自己就活在合并分支的 `except` 里（`:1547` / `:1551`）。warnings 真正的汇聚点是 `self.compositions[composition_id]['warnings']`（`:1337-1340`）。按 v1 实现，「合并分支失败 → 回退 → 静帧降级」这条最需要解释的路径反而一个提示都不会出现 | `video_composition_service.py:1337-1340`、`:1522-1551`、`:2460-2472` | §4.4.3 第 3 条改为**返回值贯通到 `_compose_video_sync`**（`composition_id` 在 `:953` 起的作用域内），回退函数改返回 `List[str]`；§9.1 增回退路径断言 |
| **P1-2** | **`stills_max_content_pixels` 卡错了量纲，等价于永不生效。** 内容矩形 ≤ 位置框 ≤ 输出分辨率，而 4K 输出恰好就是 3840×2160 = 8 294 400——阈值取在边界上，`>` 判定永远为假。真正会把内存/解码吃满的是**源图自然尺寸**（R19 自己写的「8000×6000」），而 `zoompan` 是在 `scale=cw:ch` **之后**才看到画面的，它根本见不到原图 | v1 §4.4.4 / §7.3 与 R19 / R25 自相矛盾 | 改名为 **`stills_max_source_pixels`** 并改判 `nat_w*nat_h`（D28）；§4.4.4 / §7.3 / §9.1 / R19 / R25 同步 |
| **P1-3** | **H2 的事实陈述有误。** v1 称降级「没有任何 UI 消费者 / A11 未达成」。实际上 `CameraMotionModal.tsx:105/114/279-281` **已有**一个 WebGL 降级角标，由 `Camera3DRenderer.isSupported()` 驱动，英文文案是 `'3D preview degraded (WebGL unavailable) - export is still full 3D'`——连"导出仍是完整 3D"这句都已经在了。真正的缺口是另外两件事：① 该角标只在**面板打开时**、只在**面板内**出现，用户关掉面板回到预览区看到的降级毫无提示；② `isSupported()` 是**静态探测**，它看不见运行期的**投影退化**（`camera.degraded` / 四角落到相机后方）。若照 v1 直接加一个预览角标，产品里会同时存在两套语义不同、文案雷同的降级提示 | `CameraMotionModal.tsx:105-114,279-281`、`i18n.ts:3594`、`CanvasCompositor.ts:427-435` | §0 H2 行、§4.3.5、A26 全部改写；新增 **D29** 明确两处角标的分工与文案去重 |
| **P1-4** | **§4.4.2 从未交代整段设计里风险最高的那条假设。** 静帧输入经 `setpts=PTS-STARTPTS+start/TB` 之后，**副输入比主输入晚 `start_time` 秒才有第一帧**；`overlay` 走的是 framesync，"副输入迟到"历来是这条滤镜最容易踩的坑（缓帧、首段冻结、时长漂移）。文档只字未提，等于把一个必须实测的问题当成了显然事实 | v1 §4.4.2 | 评审**已实测**（见新增 §4.4.5）：时长精确 5.000s / 150 帧、窗口前是纯净底层视频、副输入 EOF 后 `eof_action=pass` 正常放行。结论回写正文，并在 §9.1 / §9.4 固化为回归断言 |
| **P1-5** | **D24 的 alpha 存活性是 C13 的放行前提，v1 只给了 Plan B 没有结论。** 这类"必须实测、不能凭记忆"的点悬着，下游会各自猜 | — | 评审**已实测**（§4.4.5）：透明区读到底层绿色 `(0,254,0)`、不透明区纯红 `(253,0,0)`，`zoompan` **不吞 alpha**。D24 改写为"实测结论 + 保留 A23 作为跨 FFmpeg 版本的回归闸"，C13 由"待测"转为"已测，仅需回归" |
| **P1-6** | **`label` 默认值与 §6.1 承诺的用户可见文案冲突。** `build_still_overlay_plan(..., label: str = "image")` 会让所有静帧 warning 都以 `image: ` 开头，而 §6.1 明写「文案以片段名开头，如 `storyboard-03.png: …`」 | v1 §4.4.2 vs §6.1 | §4.4.2 去掉默认值语义、§4.4.3 明确传 `label=item.name`；§9.1 增断言 |

### P2（记录在案，下游可自行取舍）

| # | 结论 |
|---|---|
| **P2-1** | `cameraInput` 的透传要经过 `internal/assembleLayers.ts:189-191`，v1 的 §5 文件清单里没有它。当前那行是 `{ ...layer, z: … }` 展开写法，**恰好**是安全的；但这正是 v1 Review P0-4（`compositorPassthroughFields` early-return 丢字段）踩过的同一类坑。已在 §5.1 补一条"零改动但必须落回归断言"的条目 |
| **P2-2** | D15 说 `frameAspect` 有"唯一真相源"略有夸大：预览端取 `naturalW/naturalH`（精确），导出端取 `contain_fit` 偶数化后的 `cw/ch`，两者有 <0.1% 偏差。§4.2 的注记已经承认这件事，措辞对齐即可 |
| **P2-3** | D23 用 `target.url` 作面板底图，而合成器实际画的是 `materials.find(...).url`（`useCompositionPlayback.ts:173-175`）。`TimelineItemData.url` 确实存在（`domain/types.ts:58`）所以可行，但两处取不同源，极端情况下面板底图与预览画面不是同一张图。建议 `target.url ?? 活素材 url` |
| **P2-4** | N2 / D21 / R21 对 legacy `_drawOverlays` 的担心偏重：全仓 `setOverlays(` 与 `drawFrame(` **只出现在测试里**，生产代码无调用方。"重影"今天不可能发生。断言测试很便宜，保留即可，但风险描述应据实下调 |
| **P2-5** | A20 的「≤1px」预算对**位置框越出画面边缘**的图片必然失败：预览侧 `computeImageBounds` 有 `w = min(w, 1-x)` 钳位（`ImageOverlayLayer.ts:139-140`），导出侧 `int(pos.width*video_width)` 没有。这是 v1 之前就存在的偏差，本轮不修，但 A20 的取样素材必须整框在画面内 |
| **P2-6** | 前端 `compositionRequest` 从不发送 `output_fps`（`useVideoExport.ts:615-633`），所以它恒为后端默认 30，与 `target_fps = request.output_fps`（`:1286`）一致。把这句写进文档，免得后续有人"顺手补上" wire 反而引入不一致 |
| **P2-7** | §9.4 的"产物 MD5 一致"作为**主**判据偏脆（编码器版本/线程数一变就红）。建议主判据取「`filter_complex` 字符串 + 完整命令行逐字符相同」，MD5 作为辅助 |
| **P2-8** | §5.3 第 10 项（改 `useCompositionTransport.ts` 透传）不必要：`VideoPlayerPanel.tsx` **本来就直接调用** `useCompositionPlayback()`，多一跳只是增加耦合面 |
| **P2-9** | §5.6 的规模统计与 §5.1–§5.5 的实际条目对不上（清单是 22 改 + 1 新 = 23 个源文件、7 改 + 5 新 = 12 个测试文件）。已按实际数字更正 |
| **P2-10** | `disabledNotVideo → disabledNotVisual` 更名时，英文文案 `'Image clips do not support camera motion yet'`（`i18n.ts:3599`）与中文 `'图片片段暂不支持运镜'`（`:6203`）都必须改写——否则会出现"按钮亮着，提示说不支持"的自相矛盾 |

---

## 0. 本轮迭代的定位（先读这一节）

上一轮迭代已经把 **2D / 3D 运镜**完整地做进了产品：工具栏按钮、`M` 快捷键、双击片段、
片段徽标四个入口 → `CameraMotionModal` 双栏面板 → 预览端 `CanvasCompositor` +
`Camera3DRenderer` → 导出端 `zoompan / rotate / perspective` 滤镜链，两端由同一份
数学契约（TS 内核 + Python 镜像 + 跨语言黄金向量）钉死。该实现已随
`4497eab feat: add 2D/3D camera motion for video clips (preview + export)` 落库，
70 个文件、+10813 行，回归全绿。

因此本轮**不重复**已完成的工作。本轮解决的是 v1 明确留下的三个洞：

| 洞 | v1 现状 | 用户可感知的症状 |
|---|---|---|
| **H1 静帧不能运镜** | `eligibility.ts` 显式禁用 `originalMaterialType === 'image'`（D9 / N1：宁可不做也不做半套） | 本产品的核心素材来源之一是 AI 生成图片 / 分镜图。用户选中一张图，工具栏「运镜」是灰的，提示「仅视频片段可用」——而"给静态画面加推拉摇移"恰恰是运镜最经典的用法（Ken Burns） |
| **H2 3D 降级只在面板内、只覆盖一半情形**（评审 P1-3 更正） | `CameraMotionModal` **已有**一个 WebGL 降级角标（`CameraMotionModal.tsx:105/114/279-281`，文案 `i18n.ts:3594` 已含"导出仍是完整 3D"），但它 ① 只在**面板打开时**、只在**面板内**出现；② 由**静态**探测 `Camera3DRenderer.isSupported()` 驱动。而 `CanvasCompositor.camera3DDegraded()`（真正知道运行期发生了什么的那个信号）**没有任何 UI 消费者** | 两个具体缺口：**(a)** 用户应用完 3D 预设、关掉面板、在预览区看播放时，降级毫无提示；**(b)** `isSupported()` 看不见**运行期投影退化**（四角落到相机后方 / WebGL 建成后又渲染失败），这类降级在有 WebGL 的机器上照样发生，今天完全静默。v1 验收项 **A11** 因此只达成了一半 |
| **H3 图片叠加链路存在双写分支** | 图片叠加滤镜串在 `_process_image_overlays` 与 `_process_overlays_and_subtitles_combined` 两个函数里**各写了一遍** | 这是 v1 放行条件 C8（`build_video_filter` 两条分支都要注入）在图片链路上的翻版。若只在一条分支注入运镜，症状是「**时间轴上有字幕时，图片运镜就消失了**」——一个极难自查的偶发性 WYSIWYG 破口 |

三者合起来构成一个自洽的增量：**把运镜特性覆盖到最后一类可见素材上，并把 v1 留下的
可观测性与分支一致性缺口补齐**。全局目标「完成对应开发，稳健可靠顶级」在本轮的具体
含义就是这三条。

---

## 1. 概述（Overview）

**做什么。** 本方案把已有的 2D / 3D 运镜能力扩展到**静帧素材**（放在视频轨上、
`originalMaterialType === 'image'` 的图片片段），并补齐 v1 遗留的降级可见性与导出
分支一致性问题。用户的操作路径完全不变：选中图片片段 → 工具栏「运镜」/ `M` /
双击 → 同一个面板选预设 → 应用 → 预览里图片开始缓慢推近 / 环绕 → 导出成片保持
一致。对用户而言这不是"新功能"，而是"这个按钮终于对图片也亮了"，符合最小惊讶原则。

**为什么现在做。** 一是产品形态决定的：Ecliptrix 的分镜、AI 生图、素材搜索三条链路
产出的都是静态图片，图片片段在真实时间轴上的占比不低；静态画面**没有运镜就是幻灯片**，
这是成片质感的分水岭。二是成本极低：v1 已经把数学内核（`resolveCameraDraw`）、
预览绘制（`_drawCameraVideoLayer`）、导出链构造（`build_camera_filter_chain`）都做成了
与素材类型无关的纯模块，静帧只需要接上"内容矩形"这一个参数，**不需要任何新数学**。
三是 v1 已经把两端一致性做成了可回归的闸门（黄金向量），这一轮可以直接复用同一套闸门
来保证静帧不漂移，而不是重新发明一套。

**做到什么程度。** 本轮的硬边界是：**静帧运镜与视频运镜共享同一个数据模型、同一个数学
内核、同一个面板、同一套降级语义**。任何"给图片单写一套"的实现都视为方案偏离——这正是
v1 §14 的 I5、上一轮 Review 的 P2-7（`TimelineItem.tsx` 内联重写判据）反复付出代价的
地方。静帧只在三处允许存在差异，且每一处都必须在本文档里有编号的决策条目支撑：
内容矩形的求法（D15）、导出输入需要循环成流（D17）、预览端大图需要降采样纹理（D19）。

---

## 2. 目标与非目标

### 2.1 目标（Must）

- **G1**：视频轨上的图片片段可以应用 2D 与 3D 运镜，入口、面板、撤销重做、持久化、
  分割重基与视频片段完全一致。
- **G2**：静帧运镜的**预览与导出画面一致**（WYSIWYG），一致性判据沿用 v1 A5 的
  首/中/尾三帧比对，误差预算 1px 量级。
- **G3**：**零回归**——未配置运镜的图片，导出命令行与滤镜串与本次改动前**逐字符相同**；
  未配置运镜的项目产物逐帧一致。
- **G4**：**运镜绝不导致导出失败**。静帧链路复用 v1 的降级契约：探测缺失、表达式失败、
  拟合超差、单次重跑，任何一环失败都退化为"无运镜的图片叠加"并把原因通过 status
  通道回传前端（W1–W4）。
- **G5**：3D 预览降级对用户**可见且可解释**（补齐 v1 A11 剩下的一半：**预览区**内可见 +
  覆盖**运行期投影退化**，不只是静态的"没有 WebGL"），且不得引入每帧 setState，也不得与
  面板内既有角标形成两套语义（D29）。
- **G6**：图片叠加滤镜串**只有一个构造器**，两条调用分支（纯图片 / 图片+字幕合并）共用。

### 2.2 非目标（Out of scope，本轮明确不做）

- **N1**：不改动图片叠加的 z 序语义（图片仍绘制在所有视频层之上），不引入"图片作为
  主画面轨"的概念。
- **N2**：不给 `CanvasCompositor._drawOverlays` 的 **legacy overlay 路径**接运镜
  （该路径是旧单轨兜底，多轨合成器是唯一预览路径）。见 D21。
- **N3**：不做多关键帧曲线（v1 §12-2）、运镜模板库（§12-3）、AI 建议运镜（§12-4）。
- **N4**：不引入任何 `NEXT_PUBLIC_` 客户端开关（沿用 v1 D10：运维兜底只有服务端
  `config/camera-motion.yaml`）。
- **N5**：不改动图片叠加的位置/尺寸编辑交互（`imagePosition` 的拖拽、缩放照旧）。
- **N6**：不改 `jsx: "preserve"` 的编译配置（v1 §14 I5 的既有约束照旧：面板类测试
  走源码级契约断言，不挂载组件）。

---

## 3. 关键设计决策（Decisions）

> 编号从 **D15** 起，接续 v1 的 D1–D14，避免两份文档的决策号冲突。

| # | 决策 | 理由 |
|---|---|---|
| **D15** | **静帧的 `frameAspect` = 图片自然宽高比**（`naturalWidth / naturalHeight`） | 两端都以 **contain** 语义把图片落进它的位置框：预览 `_drawImageLayer` 已按 `object-contain` 绘制（其注释里的 D2 硬不变量），导出用 `scale=W:H:force_original_aspect_ratio=decrease` + 透明 `pad`。contain 保比例 ⇒ **内容矩形的宽高比恒等于图片自然宽高比**。于是 `frameAspect` 只有一个来源——图片自身，无需在 wire 里额外传尺寸，也不会出现"两端各抓一个附近的值"（v1 P1-1 的经典漏洞）。**准确表述（评审 P2-2）**：预览端取精确的 `naturalW/naturalH`，导出端取 `contain_fit` 偶数化后的 `cw/ch`，两者有 <0.1% 的偏差——处置见 §4.2 的偶数化注记，判据是"归一化坐标 1e-6 + 像素级 1px 预算"，不是"两端字面相等" |
| **D16** | 图片叠加的 per-image 滤镜分支由**唯一构造器** `build_still_overlay_plan()` 产出，`_process_image_overlays` 与 `_process_overlays_and_subtitles_combined` 都调用它 | H3。且构造器在"无运镜"时返回的字符串与现有内联 f-string **逐字符相同**，零回归由构造方式保证，而不是靠人肉比对 |
| **D17** | 只有**带运镜**的图片才追加 `-loop 1 -t {duration} -framerate {fps}` 输入参数；无运镜图片保持单帧输入 | 静帧要动就必须先变成一段流（`zoompan=d=1` 对单帧输入只吐一帧）。但把 `-loop` 加到所有图片上会改变既有输入语义、放大滤镜图、并在图片数量多时增加解码压力。按需追加 ⇒ 零回归面最小 |
| **D18** | 静帧的运镜注入点：**contain-scale 之后、pad 之前**（`scale → camera → pad`） | v1 D4 的静帧镜像。两端的运镜都作用在"内容矩形"上，而不是已经填充透明边的位置框上，否则运镜幅度会被 pad 稀释，预览/导出对不上 |
| **D19** | 预览端对静帧建立**降采样纹理缓存**：尺寸取 `min(自然尺寸, 2 × 画布内容矩形)`，缓存键 = `src`，与 `_loadImage` 缓存同生命周期 | 视频纹理天然是 1080p 量级，图片可能是 8000×6000。3D 路径每帧 `texImage2D` 上传原图会直接掉帧。裁切坐标是**归一化**的，用缓存画布的宽高当 `intrinsicW/H` 完全等价，因此降采样对数学零影响 |
| **D20** | 3D 降级**只上报一次**：`CanvasCompositor` 在 `_camera3DDegradedOnce` 由 false 翻 true 的那一刻触发一次回调，引擎透传，hook 一次 `setState` | 降级判定发生在绘制热路径里。轮询或每帧上报都会把一个诊断信号变成性能问题。一次性回调 + 一次性状态，天然无抖动、无渲染循环 |
| **D21** | legacy `_drawOverlays` 的 image 分支**不接运镜**，并加断言测试保证多轨路径下 `_overlays` 不含 image 项 | N2。两条路径同时活跃会画出两张图（重影）。不接运镜 + 显式断言，比"两边都改"更安全 |
| **D22** | 图片叠加 pass 在**注入运镜后失败**时，剔除全部运镜链**重跑一次**；仍失败才走既有失败分支 | v1 §4.4.4 的静帧版。G4 的最后一道兜底：运镜是锦上添花，绝不能让用户的导出整单失败 |
| **D23** | 面板对静帧使用**图片本体**作为示意舞台底图（`thumbnailUrl` 缺失时回退 `item.url`） | 图片片段常常没有 `thumbnailUrl`（缩略图是视频专属产物）。舞台上是灰底还是真实画面，直接决定"预设选得准不准" |
| **D24** | 静帧 2D 段**复用 `zoompan`**（与视频同构）。**评审已实测：`zoompan` 不吞 alpha**（§4.4.5 E1），Plan B 不启用。`crop(eval=frame)+scale` 作为**备选**保留在本条，仅当 A23 在某个 FFmpeg 版本上变红时才启用 | 透明 PNG 叠加是既有功能（现链路用 `pad=…:black@0`）。原顾虑是部分 FFmpeg 版本的像素格式协商不含 alpha、把透明区变成黑块。实测（`2025-05-15-git-12b853530a-full_build`）：整条 `scale→setpts→fps→scale→zoompan→scale→pad(black@0)→setpts` 之后，透明半边读到底层绿 `(0,254,0)`、不透明半边纯红 `(253,0,0)`——**alpha 完整存活**。但像素格式协商是**逐 build** 的，所以 A23 保留为跨版本回归闸 |
| **D25** | `eof_action=pass` **只加在带运镜的 overlay 实例上** | 动画化的 overlay 输入在 `-t` 之后 EOF，默认 `repeat` 也能工作（`enable` 已经关掉了绘制），但 `pass` 语义更明确。只在动画分支追加 ⇒ 静态分支字符串不变（D16 的零回归约束）。实测：EOF 之后主画面正常放行（§4.4.5 E1） |
| **D26**（评审 P0-2 新增） | 静帧链路**必须复用 v1 的两道前置闸门**：① `caps` 由服务层显式传 `self._get_camera_caps(ffmpeg_path)`，`build_still_overlay_plan` **不接受隐式默认**；② `config.dry_run_probe` 为真时，对每条静帧 camera 链跑一次 `dry_run_chain`，不过就地清空运镜并记 warning | `CameraFilterCaps()` 的五个字段**默认全是 True**（`camera_motion.py:159-165`）。不传 caps ≠ "保守"，而是"假设这台机器什么滤镜都有"——G4 承诺的「探测缺失 → 降级」会静默失效。而且代价高度不对称：视频侧一条链失败只重跑**一个片段**的 normalize（几秒），静帧侧一条链失败要把**整条 overlay pass**（全片重编码）再跑一遍。0.1s 的 lavfi 空跑换掉一次全片重编码，是这条链路上性价比最高的一道闸 |
| **D27**（评审 P0-1 新增） | 两个 overlay 函数的图片循环由**两趟合并为一趟**：`解析/下载路径 → _probe_image_size → build_still_overlay_plan → cmd.extend(plan.input_args + ['-i', path])`，滤镜串在同一趟里存进 `plans[]` 供第二段拼接使用 | 仓内现状是：第一趟只做 `-i`（`:2499-2510` / `:2648-2662`），位置框与时长要到第二趟才算出来。`-loop/-t/-framerate` 是**输入选项**，必须紧邻它所修饰的 `-i` 之前；在第二趟追加会落到下一个输入或输出上，把整条命令的语义改掉。合并成一趟同时解决另外两件事：`_probe_image_size` 必须发生在**下载之后**（远程图片第一趟才落盘），以及 `valid_items` 的索引与 `[k:v]` 标签必须保持一致 |
| **D28**（评审 P1-2 新增） | 运维刹车卡在**源图自然像素数** `nat_w*nat_h`（`stills_max_source_pixels`，默认 33 177 600 = 7680×4320），**不是**内容矩形 | 内容矩形 ≤ 位置框 ≤ 输出分辨率，4K 输出恰好等于原阈值 8 294 400，`>` 判定永远为假——原设计等于没有刹车。真正的成本在**解码一张 8000×6000 的原图**，而 `zoompan` 位于 `scale=cw:ch` 之后，它见到的永远是内容矩形。刹车必须卡在成本发生的地方 |
| **D29**（评审 P1-3 新增） | 降级提示**分工**：面板内既有角标保持不动（静态能力探测，回答"我这台机器能不能做 3D"）；新增的预览区角标只回答"**刚才这一帧真的降级了**"（运行期信号，含投影退化）。两者**文案共用同一条 i18n 主句**，预览角标不重复"WebGL 不可用"的归因 | 同一个产品里出现两条措辞雷同、触发条件不同的提示，是比"没有提示"更糟的体验：用户无法判断它们是不是同一件事。分工写死在决策里，实现时就没有各写一版的空间 |

---

## 4. 技术设计（Technical Design）

### 4.1 全景：一条素材，两端一致

```
                          ┌─────────────── 同一份数学契约 ───────────────┐
                          │  resolveCameraDraw / camera_motion.py 镜像   │
                          └──────────────────────────────────────────────┘
                                    ▲                          ▲
  ┌── 预览（浏览器 Canvas）──────────┴──┐   ┌── 导出（FFmpeg）──┴────────────────┐
  │                                     │   │                                    │
  │ 视频层: fit(canvas) ──► camera ──►  │   │ 视频: scale ──► camera ──► pad     │  ← v1 已实现
  │           drawImage/WebGL           │   │        (_normalize_video)          │
  │                                     │   │                                    │
  │ 图片层: box ──► contain ──► camera  │   │ 图片: contain-scale ──► camera ──► │  ← 本轮新增
  │           ──► drawImage/WebGL       │   │        pad ──► setpts ──► overlay  │
  └─────────────────────────────────────┘   └────────────────────────────────────┘
```

关键在于两端的 **camera 作用对象都是"内容矩形"**：预览端是图片在画布上 contain 之后
实际占据的那个矩形；导出端是 `force_original_aspect_ratio=decrease` 之后、`pad` 之前的
那个矩形。二者宽高比相同（D15），因此同一份 `crop / quad / rollPad` 在两端产生同一个画面。

### 4.2 数学契约：**零改动**

`resolveCameraDraw(motion, tLocal, clipDuration, frameAspect)` 的签名、语义、
`ResolvedCameraDraw` 的形状、`rollPad` / `coverScale` / 四角投影的公式**一律不动**。
Python 侧 `camera_motion.py` 的 `build_camera_filter_chain(motion, frame_w, frame_h,
fps, clip_duration, caps, config, label)` 同样不动。

静帧唯一要做的，是把正确的 `frameAspect` / `frame_w × frame_h` 喂进去：

- 预览：`frameAspect = img.naturalWidth / img.naturalHeight`
- 导出：`(frame_w, frame_h) = contain_fit(nat_w, nat_h, box_w, box_h)`

`contain_fit` 是本轮唯一新增的几何函数（纯函数、双端各一份、被黄金向量锁住）：

```python
def contain_fit(nat_w: int, nat_h: int, box_w: int, box_h: int) -> Tuple[int, int]:
    """图片按 contain 落进位置框后的内容矩形（偶数化，≥2）。

    与 FFmpeg 的 scale=box_w:box_h:force_original_aspect_ratio=decrease 等价，
    差别仅在于我们把结果显式算出来 —— 因为 camera 链需要具体数字（zoompan 的
    s=WxH、perspective 的角点像素坐标都不能用 iw/ih 之外的运行期量表达）。
    """
    if nat_w <= 0 or nat_h <= 0 or box_w <= 0 or box_h <= 0:
        return (0, 0)                      # 调用方据此放弃运镜（不是抛异常）
    k = min(box_w / nat_w, box_h / nat_h)
    return (_even(nat_w * k), _even(nat_h * k))
```

> **偶数化的一致性风险**：`_even()` 会让内容矩形的宽高比与自然比产生 < 0.1% 的相对
> 偏差（v1 R16 已记录同类问题）。沿用 v1 的处置：黄金向量一律比**归一化坐标**（1e-6），
> 像素级比对只在验收 A5 的 1px 预算内进行。

> **实现陷阱：`pad` 的输出不得小于输入。** 仓内 `_even()` 的语义是**向上取到偶数**
> （`ceil` 后补 1），因此必须确认内容矩形永远 `≤` 位置框，否则 FFmpeg 会直接报
> `Padded dimensions cannot be smaller than input dimensions` 让这张图的分支整条失败。
> 结论是**安全的**，但依赖两个前提，实现时必须都成立并落测：
> ① 位置框 `box_w/box_h` 已经过 `_ensure_even_dimensions`（偶数）；
> ② `k = min(box_w/nat_w, box_h/nat_h)` ⇒ 两个维度都 `≤ box`，而 `x ≤ box` 且 `box`
> 为偶整数时 `_even(x) ≤ box`（`ceil(x)` 最多等于 `box`；若 `ceil(x) == box-1`（奇数）
> 补 1 后恰为 `box`）。
> 单测锚点：`contain_fit(1919, 1080, 1920, 1080) == (1920, 1080)`（贴边不越界）。

### 4.3 预览链路

#### 4.3.1 数据透传（纯层）

1. `ImageOverlayLayer.ImageOverlayInput` 增加可选字段 `cameraMotion?: CameraMotion`。
2. `useCompositionPlayback.buildImageOverlayInputs()` 透传 `item.cameraMotion`
   （该函数已经在遍历所有可见轨道并按 `originalMaterialType === 'image'` 挑图片项）。
3. `buildImageLayersAt(items, t, fit)` 为每个 active 图片层附加：

```ts
/** 静帧运镜的层内输入：不含 aspect —— aspect 只有绘制时刻才知道（D15）。 */
export interface StillCameraInput {
  motion: CameraMotion;
  /** 片段内相对时间，= t - item.startTime（与视频层 t - clip.startTime 同构）。 */
  tLocal: number;
  clipDuration: number;
}
```

   即 `CompositorLayer` 的 `image` 分支新增 `cameraInput?: StillCameraInput`。

> **为什么不像视频层那样在 `assembleLayers` 里就解算成 `ResolvedCameraDraw`？**
> 视频层能这么做，是因为 `videoWidth/videoHeight` 挂在传进来的 `DrawableVideoSource`
> 上；图片的自然尺寸只存在于合成器内部的图片解码缓存里，纯层拿不到。**猜一个 aspect
> 是 v1 P1-1 明令禁止的**，所以静帧把"解算"推迟到绘制时刻，而把"是否有运镜、
> 相对时间是多少"这两件纯数据的事留在纯层里（可 jsdom 单测）。

#### 4.3.2 绘制（`CanvasCompositor`）

把 v1 的 `_drawCameraVideoLayer` **重构**为素材无关的私有例程（**行为逐字保持**）：

```ts
private _drawCameraSource(
  ctx: CanvasRenderingContext2D,
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  content: FitRect,        // 内容矩形（视频=fit，静帧=box 内 contain 之后的矩形）
  camera: ResolvedCameraDraw,
  opacity: number,
  intrinsicW: number,
  intrinsicH: number,
): boolean
```

- `_drawCameraVideoLayer` 变成 `_drawCameraSource(ctx, source, fit, …)` 的一行转发。
- `_drawImageLayer` 在算出 contain 内容矩形后：
  1. 若 `layer.cameraInput` 存在且图片已解码 → `frameAspect = naturalW / naturalH`
     → `resolveCameraDraw(...)`；
  2. `undefined`（无运镜 / 恒等 / 版本不符）→ 走既有 5 参 `drawImage`（**零回归快路径**）；
  3. 否则 → `_drawCameraSource(ctx, texture, content, camera, opacity, tw, th)`，
     其中 `texture` 是 D19 的降采样画布（或图片本身，若无需降采样）。
- **clip 边界**：例程内 `ctx.clip()` 到传入的 `content` 矩形。视频层传 `fit`（与 v1 一致），
  静帧传自己的内容矩形——一张被 roll 撑大的图片不得溢出自己的位置框，压到隔壁图层上。
- **3D**：`Camera3DRenderer.render()` 的签名已经是
  `HTMLVideoElement | HTMLImageElement | HTMLCanvasElement`，无需改动；输出 surface
  尺寸取 `ceil(content.width) × ceil(content.height)`。

#### 4.3.3 静帧纹理缓存（D19）

```ts
// key: layer.src；value: 降采样后的离屏画布（或 null = 直接用原图）
private _stillTextureCache = new Map<string, HTMLCanvasElement | null>();
```

- 建立时机：图片首次以"带运镜"的身份参与绘制时，一次性生成。
- 目标尺寸：`scale = min(1, (2 × content.width) / naturalWidth)`，向上取整到偶数。
- 失效：`dispose()` / `reset()` 时清空；`src` 变了自然就是新键。
- 无运镜的图片**不进缓存**（零开销快路径，避免给既有功能增加内存占用）。

#### 4.3.4 暂停态立即重绘（D12 的静帧面）

`useCompositionPlayback` 已有 `cameraMotionSignature`，它遍历 `track.type === 'video'`
的所有 item 并折入 `cameraMotionFingerprint`。**图片片段就住在视频轨上**
（`TrackType = 'video' | 'audio' | 'subtitle'`，没有 image 轨），因此静帧天然被覆盖。

但这一条必须**用测试钉死**，而不是靠推断——v1 R8 记录的"点了应用但预览不动"是本仓
历史最高频的坑。落测：构造一个 `originalMaterialType: 'image'` 的 item，只设
`cameraMotion`，断言 `cameraMotionSignature` 变化（见 §7.1）。

#### 4.3.5 降级角标（H2 / G5）

```
CanvasCompositor            MultiTrackPlaybackEngine        useCompositionPlayback
  _flagCamera3DDegraded() ──► onCamera3DDegrade(cb) 透传 ──► setState(true) 一次
        │                                                          │
        └─ 两个触发点：WebGL 不可用 / 投影退化（v1 已有，合并成一个私有方法）
                                                                   ▼
                                             VideoPlayerPanel 渲染 <CameraDegradeBadge/>
```

- **与面板内既有角标的分工（D29，评审 P1-3）**：
  `CameraMotionModal` 里那个 `mode === '3d' && webglDegraded` 的角标**保持不动**——它是
  **静态能力探测**（`Camera3DRenderer.isSupported()`），回答的是"我这台机器能不能做 3D"，
  在用户**选预设的当下**给出预期。本节新增的预览角标回答的是另一个问题：
  "**刚才那一帧真的降级了**"。它由绘制热路径的真实信号驱动，因此能覆盖
  `isSupported()` 永远看不见的**运行期投影退化**（`camera.degraded`：四角落到相机后方；
  或 WebGL 上下文建成后 `render()` 仍返回 null）。两者互补，不重叠。
- **角标形态**：预览区右上角的小 pill，`role="status"` + `aria-live="polite"`，
  主句「3D 运镜已降级为 2D 预览 — 导出仍为完整 3D」。
  **文案复用面板角标的同一条 i18n 主句**（现 `cameraMotion.webglDegraded` 的语义部分），
  预览角标**不重复归因**（不写"WebGL 不可用"——运行期退化并不是 WebGL 的错）。
  「导出仍为完整 3D」这半句是这个角标存在的全部意义：**告诉用户不必去改设计**。
- **可关闭**：一个 `×`，关闭后本次挂载内不再出现（`useState` 即可，不进持久化）。
- **不做的事**：不弹 toast（降级不是错误）、不阻塞播放、不在每帧读取状态、
  不在面板已经打开且已经显示了它自己那个角标时重复出现（同屏去重）。

### 4.4 导出链路

#### 4.4.1 wire

图片项的导出载荷（`useVideoExport` 的 image 分支）增加一个键：

```ts
imageItems.push({
  id, name, url, start_time, duration, track_id, position, opacity,
  fade_in_duration: 0.0, fade_out_duration: 0.0,
  // 新增：未配置运镜时 toCameraMotionWire 返回 undefined，键不出现（零回归）
  ...(cameraWire ? { camera_motion: cameraWire } : {}),
});
```

`toCameraMotionWire` 复用 v1 的实现（含钳位与 snake_case 化），不新写。
图片项确实走 `image_items` / `ImageCompositionItem`（`useVideoExport.ts:219-280` 把
`material.type === 'image' || item.originalMaterialType === 'image'` 的片段推进
`imageItems`，`:621` 装进 `image_items`），所以 §5.5 第 19 条改对了模型。

> **`output_fps` 的现状（评审 P2-6，写下来免得被"顺手修好"）**：前端的
> `compositionRequest`（`useVideoExport.ts:615-633`）**从不发送** `output_fps`，因此它
> 恒为后端默认 30；而合成基准帧率 `target_fps = request.output_fps`（`:1286`）。
> 两者天然自洽，静帧的 `fps=output_fps` 与它叠加其上的那条视频流同频。
> 若将来前端补上这个字段，必须两处一起验，不能只改 wire。

#### 4.4.2 唯一构造器（D16）

新增到 `app/services/composition/camera_motion.py`：

```python
@dataclass(frozen=True)
class StillOverlayPlan:
    """一张图片在 overlay filtergraph 里的完整计划。"""
    input_args: List[str]   # 该输入的前置参数，如 ['-loop','1','-t','8.000','-framerate','30']
    chain: str              # [k:v] 与 [imgN] 标签之间的滤镜串（不含标签本身）
    overlay_suffix: str     # 追加到 overlay=x:y:enable=... 之后的参数（如 ':eof_action=pass'）
    warnings: List[str]
    animated: bool          # 是否注入了运镜


def build_still_overlay_plan(
    motion: Any,                 # None 或 CameraMotion
    *,
    nat_w: int, nat_h: int,      # 图片自然尺寸（探测失败时传 0）
    box_w: int, box_h: int,      # 位置框（已偶数化）
    fps: int,
    duration: float,
    start_time: float,
    caps: CameraFilterCaps,      # ⚠️ 必传（D26 / 评审 P0-2）——见下方说明
    label: str,                  # ⚠️ 必传：片段名，warning 文案以它开头（§6.1 / 评审 P1-6）
    config: Optional[CameraMotionConfig] = None,
) -> StillOverlayPlan:
    ...
```

> **`caps` 与 `label` 为什么没有默认值（D26 / 评审 P0-2、P1-6）。**
> `CameraFilterCaps()` 的五个字段**默认全 True**（`camera_motion.py:159-165`）：给
> `caps` 一个 `None` 默认值，等于在没有 `zoompan` 的机器上**假装它有**，G4 承诺的
> 「探测缺失 → 降级」那条路径就永远不会被走到。签名层面直接不给默认值，是让这个错误
> 在**类型检查**阶段而不是在用户的导出里暴露。
> `label` 同理：§6.1 承诺 warning「以片段名开头」，一个 `"image"` 默认值会让所有静帧
> 提示长得一模一样，用户根本不知道是哪张图降级了。

**无运镜时的返回值（零回归契约，逐字符）**：

```python
StillOverlayPlan(
    input_args=[],
    chain=(f"scale={box_w}:{box_h}:force_original_aspect_ratio=decrease,"
           f"pad={box_w}:{box_h}:(ow-iw)/2:(oh-ih)/2:black@0"),
    overlay_suffix="",
    warnings=[],
    animated=False,
)
```

—— 与现有两处内联 f-string **完全一致**（`video_composition_service.py:2533` 与 `:2705`
的 `[k:v]` / `[imgN]` 标签之间那一段，逐字符）。触发条件：`motion is None` /
`is_identity_camera_motion(motion)` / `config.enabled is False` /
`config.stills_enabled is False` / `nat_w<=0 or nat_h<=0`（探测失败）/
`nat_w*nat_h > config.stills_max_source_pixels`（D28）/ `contain_fit` 返回 0 /
`build_camera_filter_chain` 返回空串（含 caps 缺失 → 该分量被丢弃后无事可做）/
`dry_run_chain` 未通过（D26）。**后五种各产生恰好一条 warning**，其余三种静默
（用户没要运镜，不需要解释）。

**有运镜时**：

```python
cw, ch = contain_fit(nat_w, nat_h, box_w, box_h)
chain, warns = build_camera_filter_chain(          # ← v1 的函数，零改动
    motion=motion, frame_w=cw, frame_h=ch, fps=fps,
    clip_duration=duration, caps=caps, config=config, label=label,
)
# D26：表达式预检。0.1s 的 lavfi 空跑，换掉一次「整条 overlay pass 全片重编码」。
if chain and config.dry_run_probe:
    ok, first_error = dry_run_chain(chain, ffmpeg_path)
    if not ok:
        warns.append(f"{label}: camera motion filter check failed "
                     f"({first_error or 'unknown error'}); rendered without motion")
        chain = ""                                 # ⇒ 回落到上面的零回归静态串
# chain 自带 "setpts=PTS-STARTPTS,fps=F" 开头，所以时间平移必须放在它后面
parts = [f"scale={cw}:{ch}:flags=bicubic", chain,
         f"pad={box_w}:{box_h}:(ow-iw)/2:(oh-ih)/2:black@0",
         f"setpts=PTS-STARTPTS+{_num(start_time)}/TB"]
input_args = ["-loop", "1", "-t", f"{duration:.3f}", "-framerate", str(fps)]
overlay_suffix = ":eof_action=pass"
```

> `dry_run_chain(chain, ffmpeg_path)` 需要 ffmpeg 路径，因此 `build_still_overlay_plan`
> 再收一个 `ffmpeg_path: str` 关键字参数（与 `caps` 同源，由服务层传）。预检结果按 chain
> 字符串进程级缓存（`dry_run_chain` 内部已实现），同一条运镜串在多张图之间只跑一次。

产出的分支形如（以第 0 张图、30fps、位置框 960×540、图片 1600×1200、
1.6s 起、8s 长的 2D 推近为例）：

```
[1:v]scale=720:540:flags=bicubic,
     setpts=PTS-STARTPTS,fps=30,
     scale=720:540:flags=bicubic,
     zoompan=z='…':x='…':y='…':d=1:fps=30:s=720x540,
     scale=720:540:flags=bicubic,
     pad=960:540:(ow-iw)/2:(oh-ih)/2:black@0,
     setpts=PTS-STARTPTS+1.600000/TB[img0]
[0:v][img0]overlay=192:270:enable='between(t,1.6,9.6)':eof_action=pass[v0]
```

> 注：`supersample` 默认已是 1（v1 §14 I4 的实测结论），所以上采样段退化为同尺寸
> `scale`。实现时**不要**手工消除这个"看似冗余"的 scale ——它由 `build_camera_filter_chain`
> 统一产出，手工特判会让两端漂移，且 `supersample` 一旦被运维调回 2 就失效。

#### 4.4.3 服务层改动

`video_composition_service.py`：

1. 新增 `_probe_image_size(path) -> Tuple[int, int]`：优先 `PIL.Image.open(path).size`
   （只读文件头，`Pillow>=10.3.0` 已在 requirements），异常时回退
   `cv2.imread(...).shape`（`opencv-python` 同样在 requirements），
   再失败返回 `(0, 0)`（调用方据此放弃运镜 + 一条 warning，**不抛异常**）。

2. **两个 overlay 函数的图片循环由两趟合并为一趟（D27 / 评审 P0-1）。**
   这是本节最容易被低估的一处改动：仓内现状是**两趟**——第一趟只做「解析路径 / 下载 →
   `cmd.extend(['-i', path])` → `valid_items.append(item)`」（`:2499-2510` / `:2648-2662`），
   位置框 `even_w/even_h`、`start_time`、`duration` 要到第二趟才算。而
   `-loop/-t/-framerate` 是**输入选项**，必须紧邻它所修饰的 `-i` **之前**；在第二趟往
   `cmd` 追加会落到下一个输入（或输出）上，把整条命令的语义改写。合并后的骨架：

   ```python
   plans: List[Tuple[Any, StillOverlayPlan, int, int]] = []   # (item, plan, even_w, even_h)
   for item in image_items:
       local_path = ...            # 既有的 _convert_url_to_local_path / _download_image
       if not local_path: continue # 既有的 skip 语义不变
       even_w, even_h = self._ensure_even_dimensions(w, h)     # 位置框，提到这一趟
       nat_w, nat_h = self._probe_image_size(local_path)       # ← 必须在下载之后
       plan = build_still_overlay_plan(
           getattr(item, 'camera_motion', None),
           nat_w=nat_w, nat_h=nat_h, box_w=even_w, box_h=even_h,
           fps=output_fps, duration=item.duration, start_time=item.start_time,
           caps=self._get_camera_caps(ffmpeg_path),            # D26，必传
           config=self._get_camera_config(), ffmpeg_path=ffmpeg_path,
           label=item.name,                                    # §6.1，必传
       )
       cmd.extend(plan.input_args)                             # ← 紧邻 -i 之前
       cmd.extend(['-i', local_path])
       plans.append((item, plan, even_w, even_h))
   ```

   随后第二段只负责拼滤镜串：`[{i+1}:v]{plan.chain}[img{i}]`，overlay 串在
   `enable='…'` 之后追加 `plan.overlay_suffix`。**索引 `i` 取自 `plans` 的下标**，
   与 `-i` 的入列顺序天然一致（这正是必须合并循环的第三个理由：原来的 `valid_items`
   跳过失败下载后索引会错位，两趟结构下极易写错）。

3. **返回值与 warnings 出口（评审 P1-1）。** 两个函数由 `bool` 改为
   `Tuple[bool, List[str]]`。汇聚点是 `self.compositions[composition_id]['warnings']`
   （`:1337-1340` 已有的 W2 去重追加），`composition_id` 在 `_compose_video_sync`
   （`:953`）作用域内可用。三个调用点：
   - `:1556` 纯图片分支 —— 直接汇入；
   - `:1531` 合并分支 —— 直接汇入；
   - `_process_overlays_sequential`（`:2460`）—— **这条最容易漏**：它的签名里
     **没有 `composition_id`**、返回 `None`，而且它自己就活在合并分支失败后的
     `except` / fallback 里（`:1547` / `:1551`）。若不改，"合并分支失败 → 回退 →
     静帧降级"这条**最需要向用户解释**的路径反而一条提示都不会出现。
     处置：`_process_overlays_sequential` 改为返回 `List[str]`，两个调用点把它汇入同一个
     bucket。C12 的验收必须专门覆盖这条回退路径。

   汇入之后经 W3（路由 `safe_info` 白名单）到达前端气泡。**W3 是 v1 实测最易漏的一环**，
   本轮必须再验一次（C12）。

4. **失败重跑（D22）**：若 `subprocess.run` 返回非 0 **且** 本次注入过任何运镜链
   （`any(p.animated for _, p, _, _ in plans)`），则把所有 plan 按 `motion=None` 重建
   一次并重跑；重跑成功 → 追加 warning「N 个图片片段的运镜未能渲染，已按无运镜导出」；
   重跑仍失败 → 走既有失败分支。
   **注意重建 plan 时 `input_args` 会变空**，因此重跑必须**整条命令重新装配**，
   而不是像视频侧那样只替换 `-vf` 那一个元素（`:793-796` 的 list-comprehension 写法
   在这里不适用——那里只有一个滤镜参数要换，这里连输入参数的个数都变了）。
   D26 的预检把这条重跑路径的触发概率压到很低，但它仍是 G4 的最后一道兜底。

#### 4.4.4 配置

`config/camera-motion.yaml` 增加一段（沿用 v1 的 `yaml.safe_load` + dataclass 默认值约定）：

```yaml
stills:
  # 静帧运镜总开关。false 时图片按 v1 行为导出（静态叠加）并回传 warning。
  enabled: true
  # 源图自然像素数上限（D28）。超过则跳过运镜 —— 卡在「解码一张巨图」这个
  # 成本真正发生的地方，而不是内容矩形（内容矩形恒 ≤ 输出分辨率，卡它等于没卡）。
  max_source_pixels: 33177600   # 7680×4320
```

> **卡源图而不是卡内容矩形（评审 P1-2 / D28）。** v1 写的是
> `max_content_pixels: 8294400`（3840×2160）。但内容矩形 ≤ 位置框 ≤ 输出分辨率，
> 而 4K 输出恰好就是 8 294 400 —— `>` 判定永远为假，这道刹车形同虚设。而且
> `zoompan` 位于 `scale=cw:ch` **之后**，它见到的永远是内容矩形，从来不会"被 8K 插画
> 吃满内存"。真正贵的是**解码原图**那一步。故改判 `nat_w*nat_h`。

> **注意 v1 §14 I4 的教训**：`load_camera_config` 在 YAML 缺键时必须回落到
> **dataclass 的默认值**，不能在解析函数里另写一份默认（`camera_motion.py:123-137`
> 的每一行都要照这个规矩加）。本轮新增两个键时逐字遵守，并补一条"裁剪过的配置文件
> 不改变行为"的单测。

#### 4.4.5 静帧 overlay 的时间语义：副输入"迟到"是安全的（评审 P1-4，已实测）

这一节补上 v1 完全没有交代、却是整段导出设计里**风险最高**的那条假设。

静帧输入经过 `setpts=PTS-STARTPTS+{start}/TB` 之后，它的第一帧 PTS 是 `start_time`，
而主输入 `[0:v]` 从 0 开始 —— 也就是说**副输入比主输入晚 `start_time` 秒才进场**。
`overlay` 走的是 framesync，"副输入迟到"历来是这条滤镜最容易出问题的地方：可能缓住主
帧不放、可能首段冻结、可能让输出时长跟着副输入走。这不是可以凭经验断言的事。

**实测结论（`ffmpeg 2025-05-15-git-12b853530a-full_build`）：安全。**
主 5s/30fps 绿底视频 + 一张 1600×1200 的图（左半透明、右半纯红），
位置框 960×540 ⇒ 内容矩形 720×540，图片 1.6s 起、3s 长，2D 推近：

| 观测点 | 结果 | 说明 |
|---|---|---|
| 输出时长 / 帧数 | **5.000s / 150 帧** | 与主输入完全一致；副输入迟到 **不** 影响时长，`-loop 1` 也**没有**让滤镜图不终止（R20 的核心担忧解除） |
| `t=0.5`（窗口之前） | `(0,254,0)` 纯绿 | 没有冻结、没有黑帧，就是干净的底层画面 |
| `t=2.5` 透明半边 | `(0,254,0)` 纯绿 | **alpha 存活**（D24 / R18） |
| `t=2.5` 不透明半边 | `(253,0,0)` 纯红 | 颜色无污染 |
| `t=4.9`（副输入 EOF 之后） | `(0,254,0)` 纯绿 | `eof_action=pass` 正常放行（D25） |

**另一条实测（D17 的直接证据）**：同一条 camera 链，
`-i img.png` ⇒ 输出 **1 帧**；`-loop 1 -t 3.000 -framerate 30 -i img.png` ⇒ 输出
**恰好 90 帧**。"静帧要动就必须先变成一段流"从此不是推理而是数据。

**对照组**：把 camera 段整段拿掉、其余链路不变，透明/不透明两侧读数与上表一致；
既有 legacy 串（`scale=…:force_original_aspect_ratio=decrease,pad=…`）同样一致。
说明**新增的运镜段不改变 alpha 与时长语义**，D16 的零回归假设在运行期也成立。

> 这三条实测把 §12 的 C13 从"待测"降级成"回归"：结论已经有了，A23 / §9.4 的时长断言
> 存在的意义是**防止换一个 FFmpeg build 之后悄悄变红**（像素格式协商是逐 build 的）。

### 4.5 UI / 交互设计

#### 4.5.1 入口（唯一判据函数，不得内联重写）

`eligibility.ts` 是四个入口的唯一判据（v1 P2-7）。本轮改动**只删一条规则**：

```ts
// 删除：if (item.originalMaterialType === 'image') return 'not-video';
```

并把 reason 的语义与文案收敛为：

| reason | 触发 | 文案（zh） |
|---|---|---|
| `no-selection` | 无选中 | 请先选中一个片段 |
| `track-locked` | 轨道已锁定 | 该轨道已锁定 |
| `not-visual`（由 `not-video` 更名） | 音频 / 字幕项 | 仅视频与图片片段可添加运镜 |

> 更名而不是复用旧名，是为了让"图片已被支持"这件事在类型层面可见——沿用 `not-video`
> 会让下一个读代码的人以为图片仍被排除。旧键在 i18n 里同步更名（三处：类型声明、en、zh）。

#### 4.5.2 面板（`CameraMotionModal`）

- **示意舞台底图（D23）**：`TimelinePanel` 传
  `clipThumbnailUrl={target.thumbnailUrl ?? (target.originalMaterialType === 'image' ? target.url : undefined)}`。
  （`TimelineItemData.url` 确实存在，`domain/types.ts:58`。**评审 P2-3**：合成器画的其实是
  **活素材** 的 `material.url`（`useCompositionPlayback.ts:173-175`），极端情况下两者可能
  不同源。若实现时手边就有 `materials`，优先 `target.url ?? 活素材url`，让面板底图与预览
  画面同源。）
- **擦洗条（本轮唯一的交互增量）**：`MotionPreviewStage` 底部增加一条进度滑块，
  绑定运镜进度 `u ∈ [0,1]`：
  - 默认自动循环播放（v1 行为）；拖动滑块即暂停循环并定格到该时刻；
  - 一个「▶ / ⏸」小按钮切换循环；`prefers-reduced-motion` 时默认暂停在 `u=0.5`
    （v1 已有该检测，本轮只是把它接到新的默认态上）；
  - 语义：真实 `<input type="range">`，带 `aria-label` 与 `aria-valuetext`
    （「运镜进度 42%」），键盘左右方向键即可逐格检视——这是"顶级设计"在无障碍上的
    具体含义：**精确检视不依赖鼠标手速**。
- 其余（预设网格、强度、缓动、时间窗、高级关键帧、反向、批量应用）**不动**。

#### 4.5.3 片段徽标

`TimelineItem.tsx` 的运镜徽标逻辑与素材类型无关，删掉 `eligibility` 里的图片排除后
自动对图片片段生效，**不需要改动**（若实现时发现它内联了类型判断，说明 P2-7 的漂移
又发生了一次，按 `canApplyCameraMotion` 收敛）。

---

## 5. 文件 / 模块变更计划

> 图例：**改** = 修改既有文件；**新** = 新建文件。

### 5.1 前端 — 类型与纯数据层

| # | 文件 | 改/新 | 意图（一句话） |
|---|---|---|---|
| 1 | `src/components/video/playback/camera/eligibility.ts` | 改 | 删除图片排除规则；`not-video` → `not-visual` 并更新注释与 v1 D9 的引用说明 |
| 2 | `src/components/video/playback/camera/types.ts` | 改 | 新增 `StillCameraInput { motion, tLocal, clipDuration }` 并从 barrel 导出 |
| 3 | `src/components/video/playback/camera/index.ts` | 改 | 导出 `StillCameraInput` |
| 4 | `src/components/video/playback/ImageOverlayLayer.ts` | 改 | `ImageOverlayInput` 增 `cameraMotion?`；`buildImageLayersAt` 输出 `cameraInput`（`tLocal = t - startTime`） |
| 5 | `src/components/video/playback/types.ts` | 改 | `CompositorLayer` 的 `image` 分支增 `cameraInput?: StillCameraInput` |
| — | `src/components/video/playback/internal/assembleLayers.ts` | **零改动，但必须落回归断言**（评审 P2-1） | `cameraInput` 要经过 `:189-191` 的 `.map((layer, index) => ({ ...layer, z: … }))` 才到得了合成器。当前是**展开**写法，所以恰好是安全的——但 v1 Review 的 P0-4（`compositorPassthroughFields` early-return 丢字段）就是同一类坑的既遂案例。加一条"带 `cameraInput` 的 image 层经 `assembleLayers` 后字段仍在"的断言，把这份"恰好安全"钉住 |

### 5.2 前端 — 预览合成

| # | 文件 | 改/新 | 意图 |
|---|---|---|---|
| 6 | `src/components/video/playback/CanvasCompositor.ts` | 改 | 抽出素材无关的 `_drawCameraSource`（视频路径行为逐字不变）；`_drawImageLayer` 接运镜；D19 静帧纹理缓存；`_flagCamera3DDegraded()` 合并两个触发点并触发一次性回调 |
| 7 | `src/components/video/playback/MultiTrackPlaybackEngine.ts` | 改 | 透传 `onCamera3DDegrade(cb)` 订阅到 compositor；`dispose` 时解绑 |
| 8 | `src/components/video/hooks/useCompositionPlayback.ts` | 改 | `buildImageOverlayInputs` 透传 `item.cameraMotion`；订阅降级回调并返回 `camera3DDegraded` |

### 5.3 前端 — UI

| # | 文件 | 改/新 | 意图 |
|---|---|---|---|
| 9 | `src/components/video/components/VideoPlayerPanel/CameraDegradeBadge.tsx` | 新 | 预览右上角降级角标（`role="status"`、可关闭、含"导出仍为完整 3D"说明） |
| 10 | ~~`useCompositionTransport.ts`~~ | **删除该条**（评审 P2-8） | 不需要这一跳：`VideoPlayerPanel.tsx` **本来就直接调用** `useCompositionPlayback()`，`camera3DDegraded` 加进该 hook 的返回值即可，多绕一层只是扩大耦合面 |
| 11 | `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | 改 | 渲染角标（绝对定位于预览容器，不参与 letterbox 计算）；与面板内既有角标同屏去重（D29） |
| 12 | `src/components/video/components/CameraMotionModal/MotionPreviewStage.tsx` | 改 | 进度擦洗条 + 播放/暂停；静帧底图；reduced-motion 默认定格 |
| 13 | `src/components/video/components/CameraMotionModal/CameraMotionModal.tsx` | 改 | 擦洗状态提升与重置（每次打开回到自动循环）；把静帧底图透传给舞台 |
| 14 | `src/components/video/timeline/TimelinePanel.tsx` | 改 | 图片片段的 `clipThumbnailUrl` 回退到 `item.url`（D23；`TimelineItemData.url` 确实存在，见 `domain/types.ts:58`。注意合成器画的是活素材的 `material.url`，两者极端情况下可能不同源——见评审 P2-3） |
| 15 | `src/components/video/timeline/TimelineToolbar.tsx` | 改 | 禁用提示改用 `disabledNotVisual`（`:211` 是全仓**唯一**消费点，已核） |
| 16 | `src/lib/i18n.ts` | 改 | 新增/更名键（类型声明 + en + zh 三处）：`disabledNotVisual`（**en / zh 文案都必须重写**——现文案是 `'Image clips do not support camera motion yet'` / `'图片片段暂不支持运镜'`，`:3599` / `:6203`，本轮之后会与"按钮已经亮了"直接矛盾，见评审 P2-10）、`degradedBadge`、`degradedBadgeDismiss`、`stageScrub`、`stageScrubValue`、`stagePlay`、`stagePause`。降级主句与面板既有 `webglDegraded` **共用同一条语义主句**（D29），不新造第二套说法 |

### 5.4 前端 — 导出 wire

| # | 文件 | 改/新 | 意图 |
|---|---|---|---|
| 17 | `src/components/video/hooks/useVideoExport.ts` | 改 | image 分支带上 `camera_motion`（`toCameraMotionWire`，未配置则不出现该键） |
| 18 | `src/lib/api/videoComposition.ts` | 改 | 图片项载荷类型增 `camera_motion?: CameraMotionWire` |

### 5.5 后端

| # | 文件 | 改/新 | 意图 |
|---|---|---|---|
| 19 | `backend-services/basic-service/app/models/video_models.py` | 改 | `ImageCompositionItem` 增 `camera_motion: Optional[CameraMotion]`（复用 v1 已有的 pydantic 模型与钳位） |
| 20 | `backend-services/basic-service/app/services/composition/camera_motion.py` | 改 | 新增 `contain_fit()`、`StillOverlayPlan`、`build_still_overlay_plan()`（含 D26 预检）；`CameraMotionConfig` 增 `stills_enabled` / `stills_max_source_pixels` |
| 21 | `backend-services/basic-service/app/services/composition/__init__.py` | 改 | 导出新符号 |
| 22 | `backend-services/basic-service/app/services/video_composition_service.py` | 改 | `_probe_image_size`；两条 overlay 分支**改为单趟装配**（D27）并改用唯一构造器；`output_fps` 参数；`caps` / `ffmpeg_path` / `label` 贯通（D26 / P1-6）；返回值带 warnings；**`_process_overlays_sequential` 也改为返回 warnings**（P1-1）；D22 失败重跑（整条命令重装） |
| 23 | `backend-services/basic-service/config/camera-motion.yaml` | 改 | 增 `stills:` 段（`enabled` / `max_source_pixels`） |

### 5.6 测试

| # | 文件 | 改/新 | 意图 |
|---|---|---|---|
| 24 | `src/components/video/playback/camera/__tests__/eligibility.test.ts` | 新 | 图片项可用、音频/字幕项不可用、锁定轨不可用；四入口共用同一判据 |
| 25 | `src/components/video/playback/__tests__/ImageOverlayLayer.camera.test.ts` | 新 | `cameraInput` 的 `tLocal` 正确（图片 4s 起、t=5s → `tLocal=1`）；无运镜时字段 `undefined` |
| 26 | `src/components/video/playback/__tests__/CanvasCompositor.stillCamera.test.ts` | 新 | 有运镜 → 9 参 `drawImage` 且 `sx/sy/sw/sh` 命中期望；`ctx.clip()` 到内容矩形而非整个 fit；无运镜仍是 5 参（零回归）；`roll≠0` 时目标矩形 = 内容矩形 × `rollPad` 且同心 |
| 27 | `src/components/video/playback/__tests__/CanvasCompositor.degrade.test.ts` | 新 | 降级回调只触发一次；`reset()` 后可再次触发；两个触发点（WebGL 不可用 / 投影退化）都算 |
| 28 | `src/components/video/hooks/__tests__/useCompositionPlayback.test.tsx` | 改 | `buildImageOverlayInputs` 透传 `cameraMotion`；**只设了图片运镜**时 `cameraMotionSignature` 必变（§4.3.4 回归闸） |
| 29 | `src/components/video/hooks/__tests__/useVideoExport.cameraMotion.test.ts` | 改 | 图片项 wire 的 snake_case 正确；未配置运镜的图片项**不含** `camera_motion` 键 |
| 30 | `src/components/video/components/CameraMotionModal/__tests__/CameraMotionModal.test.ts` | 改 | 擦洗条的 a11y 契约（`aria-valuetext` / 键盘）与"拖动即暂停循环"的源码级契约（沿用 I5 的 node 环境模式） |
| 31 | `src/components/video/playback/camera/__tests__/fixtures/camera-golden.json` | 改 | 追加静帧类用例：内容矩形 4:3 / 1:1 / 9:16 各若干，覆盖 `t=0/中点/末尾` + `roll≠0` + 3D 退化 |
| 32 | `src/components/video/playback/camera/__tests__/goldenVectors.test.ts` | 改 | 读取新增用例（读逻辑不变，只是数据变多） |
| 33 | `backend-services/basic-service/tests/test_camera_motion_stills.py` | 新 | `contain_fit` 锚点；无运镜时 `plan.chain` **逐字符**等于 legacy 串；有运镜时链序为 `scale→camera→pad→setpts`；`-loop/-t/-framerate` 只在动画分支出现；`stills.enabled=false` / 探测失败 / 超像素上限三条降级路径各出 warning 且 `animated=False` |
| 34 | `backend-services/basic-service/tests/test_camera_motion.py` | 改 | 追加"裁剪过的 YAML 不改变行为"（`stills` 段缺失 → dataclass 默认值） |
| 35 | `backend-services/basic-service/tests/test_camera_motion_warnings.py` | 改 | 静帧 warnings 经 W1–W4 到达 `get_composition_status`（**含路由 `safe_info` 白名单**） |

**规模**（评审 P2-9 更正为与上面清单逐条对齐的实际数字）：
源码 **21 改 + 1 新 = 22 个文件**（§5.1 五条全改、§5.2 三条全改、§5.3 七条改 + 一条新、
§5.4 两条改、§5.5 五条改；原第 10 条已删）；
测试 **7 改 + 5 新 = 12 个文件**（§5.6 第 24–35 条）。合计 **34 个文件**。
另加一个"零改动但要落断言"的观察点（`internal/assembleLayers.ts`）。
相对 v1 的 70 个文件是一个明显更小的增量，符合"扩展已有内核"而非"再造一套"的定位。

---

## 6. 接口设计（Interfaces）

### 6.1 HTTP wire（前端 → `/api/video-compose` → 后端 `/api/video/compose`）

```jsonc
{
  "image_items": [
    {
      "id": "item-9", "name": "storyboard-03.png",
      "url": "/api/storage/files/images/storyboard-03.png",
      "start_time": 1.6, "duration": 8.0, "track_id": "track-video-1",
      "position": { "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "z_index": 10 },
      "opacity": 1.0, "fade_in_duration": 0.0, "fade_out_duration": 0.0,

      // 新增（可选，缺省即 v1 行为）。形状与 video_items[].camera_motion 完全相同。
      "camera_motion": {
        "version": 1, "mode": "2d", "preset_id": "push-in",
        "intensity": 1.0, "easing": "easeInOut",
        "start_offset": null, "duration": null,
        "start": { "scale": 1.0, "x": 0.5, "y": 0.5, "roll": 0.0,
                   "rotate_x": 0.0, "rotate_y": 0.0, "dolly": 0.0 },
        "end":   { "scale": 1.25, "x": 0.5, "y": 0.5, "roll": 0.0,
                   "rotate_x": 0.0, "rotate_y": 0.0, "dolly": 0.0 }
      }
    }
  ]
}
```

**兼容性**：字段可选、默认 `None`；旧前端不传 ⇒ 后端行为与改动前逐字符相同。
状态查询 `GET /api/video/composition/{id}` 的 `warnings` 数组沿用 v1 通道，
只是可能多出静帧相关条目（文案以片段名开头，如 `storyboard-03.png: …`）。

### 6.2 前端内部 API

```ts
// ImageOverlayLayer.ts
export interface ImageOverlayInput {
  /* …既有字段… */
  /** 该图片片段的运镜（camera-motion-stills §4.3.1）；无则整条快路径零开销。 */
  cameraMotion?: CameraMotion;
}

export function buildImageLayersAt(
  items: readonly ImageOverlayInput[], t: number, fit?: FitRect,
): Extract<CompositorLayer, { kind: 'image' }>[];   // 层内可能带 cameraInput

// camera/types.ts
export interface StillCameraInput { motion: CameraMotion; tLocal: number; clipDuration: number; }

// CanvasCompositor（private，但契约由单测锁定）
private _drawCameraSource(
  ctx, source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  content: FitRect, camera: ResolvedCameraDraw,
  opacity: number, intrinsicW: number, intrinsicH: number,
): boolean;

// 降级订阅（一次性，D20）
compositor.onCamera3DDegrade(cb: () => void): () => void;   // 返回 unsubscribe
engine.onCamera3DDegrade(cb: () => void): () => void;       // 透传
useCompositionPlayback(...): { /* …既有… */ camera3DDegraded: boolean };
```

### 6.3 后端内部 API

```python
# app/services/composition/camera_motion.py
def contain_fit(nat_w: int, nat_h: int, box_w: int, box_h: int) -> Tuple[int, int]: ...

@dataclass(frozen=True)
class StillOverlayPlan:
    input_args: List[str]; chain: str; overlay_suffix: str
    warnings: List[str]; animated: bool

# caps / label / ffmpeg_path 均无默认值 —— 见 §4.4.2 的说明（评审 P0-2 / P1-6）
def build_still_overlay_plan(motion, *, nat_w, nat_h, box_w, box_h,
                             fps, duration, start_time,
                             caps: CameraFilterCaps, label: str, ffmpeg_path: str,
                             config=None) -> StillOverlayPlan: ...

# app/services/video_composition_service.py
def _probe_image_size(self, path: str) -> Tuple[int, int]: ...          # 失败返回 (0,0)
def _process_image_overlays(self, image_items, video_path, output_path,
                            temp_dir, output_resolution,
                            output_fps: int = 30) -> Tuple[bool, List[str]]: ...
def _process_overlays_and_subtitles_combined(self, image_items, subtitle_items,
                                             video_path, output_path, temp_dir,
                                             output_resolution,
                                             output_fps: int = 30) -> Tuple[bool, List[str]]: ...
# 回退路径也必须把 warnings 交出来（评审 P1-1）——原签名返回 None，warnings 会凭空消失
def _process_overlays_sequential(self, all_image_items, request,
                                 output_path, temp_dir) -> List[str]: ...
```

---

## 7. 数据模型（Data Model）

**无数据库变更 ⇒ 不需要 Alembic 迁移**（与 v1 一致）。

### 7.1 复用（零改动）

`CameraMotion` / `CameraKeyframe` 的 TS 与 pydantic 定义、`version: 1`、
钳位范围（`scale∈[1,4]`、`roll/rotateX/rotateY∈[-45,45]`、`dolly∈[-0.6,0.6]`、
`intensity∈[0,2]`）、`sanitizeCameraMotion` 的白名单、`TimelineItem.cameraMotion`
的持久化与 JSON 往返——**全部不动**。图片片段与视频片段共用同一份结构，这正是
"静帧不是另一套特性"的落点。

### 7.2 新增的内存形状

```ts
// 层内（预览）
interface StillCameraInput { motion: CameraMotion; tLocal: number; clipDuration: number; }
// CompositorLayer.image 增：cameraInput?: StillCameraInput
```

```python
# 请求模型（导出）
class ImageCompositionItem(BaseModel):
    # …既有字段…
    camera_motion: Optional[CameraMotion] = Field(
        None, description="2D/3D camera motion for this still (camera-motion-stills). "
                          "Omitting it renders exactly as before.")
```

### 7.3 配置

```python
@dataclass(frozen=True)
class CameraMotionConfig:
    # …v1 既有字段（enabled / supersample=1 / dry_run_probe / poly_* 等）…
    stills_enabled: bool = True
    # D28：卡的是「源图自然像素数」，不是内容矩形（评审 P1-2）。
    stills_max_source_pixels: int = 33_177_600   # 7680×4320
```

对应 `config/camera-motion.yaml` 的 `stills.enabled` / `stills.max_source_pixels`。
**缺键时一律回落 dataclass 默认值**（v1 §14 I4 的教训）。
`dry_run_probe` 是 v1 既有字段，静帧链路**复用同一个开关**（D26），不新增第二个。

---

## 8. 实施顺序（给下游开发节点）

1. **P0 后端纯函数**：`contain_fit` + `build_still_overlay_plan` + 其单测。
   与服务层解耦，可独立验证；**先把"无运镜逐字符相同"这条测试写出来**，它是 D16 的
   全部价值所在。
2. **P1 后端服务层**：`_probe_image_size` → **两条分支的图片循环合并为单趟（D27，先做这一步，
   它决定后面所有代码的形状）** → 改用构造器 → `output_fps` / `caps` / `ffmpeg_path` /
   `label` 贯通（D26 / P1-6）→ warnings 返回值（**含 `_process_overlays_sequential`**，P1-1）
   → D22 失败重跑。做完立刻跑一次真实导出（一张图 + 推近）看成片，并**打印一次完整命令行**
   核对 `-loop 1 -t … -framerate …` 是否紧贴在那张图的 `-i` 之前。
3. **P2 前端纯层**：`eligibility` / `ImageOverlayInput` / `buildImageLayersAt` /
   `types.ts` + 其单测。此时在 devtools 里给图片 item 塞 `cameraMotion` 应当**还看不到**
   变化（合成器尚未接），这是预期的。
4. **P3 前端合成器**：`_drawCameraSource` 抽取（**先跑一遍 v1 的视频运镜测试确认零回归**）
   → `_drawImageLayer` 接运镜 → D19 纹理缓存。此时预览应当动起来。
5. **P4 导出 wire**：`useVideoExport` + `videoComposition.ts` + pydantic 字段，
   跑通「面板应用 → 导出 → 成片与预览一致」。
6. **P5 降级角标与面板打磨**：`_flagCamera3DDegraded` → 引擎透传 → hook → 角标组件；
   `MotionPreviewStage` 擦洗条；i18n 三处同步。
7. **P6 回归与基线**：`npm run test`、`npm run type-check`、`npm run lint`、
   `pytest tests/ -v`，**外加桌面端完整走查**（见 §9.3）与两条量化基线（见 §9.4）。

---

## 9. 测试与验收标准

### 9.1 单元测试（必须全部通过）

- **几何**：`contain_fit` 的四个锚点——`(1600,1200)→(960,540)` 得 `(720,540)`；
  `(1080,1920)→(960,540)` 得 `(304,540)`（偶数化后）；`(960,540)→(960,540)` 得
  `(960,540)`（恒等，无缩放）；任一入参 ≤ 0 得 `(0,0)`。
- **零回归闸（D16）**：`build_still_overlay_plan(motion=None, …).chain` 与硬编码的
  legacy 串**逐字符相等**；`input_args == []`；`overlay_suffix == ""`。
  同一断言对 `motion=恒等运镜`、`config.stills_enabled=False`、`nat_w=0` 三种输入重复。
- **链序（D18）**：有运镜时 `chain` 按 `scale=cw:ch` → `setpts=PTS-STARTPTS,fps=` →
  …camera… → `pad=box_w:box_h` → `setpts=PTS-STARTPTS+start/TB` 的顺序出现
  （用 `index()` 断言相对位置，不做全串比对，避免把 v1 内部实现钉死）。
- **动画输入（D17 / D25）**：`animated=True` 时 `input_args` 含 `-loop 1`、
  `-t {duration}`、`-framerate {fps}`，且 `overlay_suffix == ":eof_action=pass"`；
  `animated=False` 时三者皆无。
- **输入参数位置（D27 / 评审 P0-1）**：对"一张带运镜 + 一张不带运镜"的输入，断言最终
  `cmd` 里 `plan.input_args` 的每一项都**紧邻其 `-i` 之前**（做法：找到该图片 path 的
  下标 `k`，断言 `cmd[k-1] == '-i'` 且 `cmd[k-1-len(args):k-1] == args`），并断言
  不带运镜那张的 `-i` 前面**没有**任何多余参数。这条测试的存在意义就是防止有人回到两趟结构。
- **能力探测与预检（D26 / 评审 P0-2）**：
  ① `caps=CameraFilterCaps(zoompan=False)` 时，2D 推近的 `plan.animated is False`、
  `chain` 等于零回归静态串、且**恰好一条** warning；
  ② `config.dry_run_probe=True` 且 `dry_run_chain` 被 mock 成失败时同上；
  ③ `build_still_overlay_plan` 的签名**不接受**省略 `caps` / `label` / `ffmpeg_path`
  的调用（`inspect.signature` 断言这三个参数没有默认值）。
- **warning 文案前缀（评审 P1-6）**：所有静帧 warning 均以 `f"{item.name}: "` 开头。
- **降级路径**：`stills.enabled=false` / 探测失败 `(0,0)` / **源图**像素数超
  `stills_max_source_pixels`（D28；用 `nat_w*nat_h` 构造，且同时构造一个内容矩形很小
  但原图 8000×6000 的用例，证明卡的是源图）/ caps 缺失 / 预检失败 —— 五条各产出
  **恰好一条** warning，且 `animated=False`。
- **层装配**：图片 4s 起、运镜 2s 窗口，`t=5s` 时 `cameraInput.tLocal === 1`；
  无运镜时 `cameraInput === undefined`。
- **合成器（静帧）**：有运镜 → 9 参 `drawImage`，`sx,sy,sw,sh` 等于
  `crop × (纹理宽, 纹理高)`；`ctx.clip()` 的矩形等于**内容矩形**（不是整个 fit）；
  `roll ≠ 0` 时目标矩形 = 内容矩形 × `rollPad` 且与之同心；无运镜 → 仍是既有的
  contain 绘制路径（**零回归**）。
- **合成器（视频，回归）**：v1 的 `CanvasCompositor.camera.test.ts` 全绿——
  `_drawCameraSource` 抽取不得改变任何视频端行为。
- **降级回调（D20）**：连续多帧降级只触发**一次**回调；`reset()` / `dispose()` 后
  可再次触发；WebGL 不可用与投影退化两个触发点都算。
- **暂停重绘回归闸（§4.3.4）**：构造只设了 `cameraMotion` 的 **图片** item，
  断言 `cameraMotionSignature` 在运镜变化前后**不相等**。
- **导出 wire**：图片项 `camera_motion.mode / start.rotate_y` 等字段 snake_case 正确；
  未配置运镜的图片项**不含该键**。
- **warnings 通道**：mock 一次带 warnings 的 overlay 结果，断言它出现在
  `get_composition_status` 的返回体里——**必须覆盖路由的 `safe_info` 白名单**。
  **并且必须单独覆盖回退路径**（评审 P1-1）：让合并分支返回失败 → 走
  `_process_overlays_sequential` → 断言静帧 warnings 依然到达
  `self.compositions[composition_id]['warnings']`。这是 v1 的 W2 在本轮唯一的新断点。
- **层字段透传（评审 P2-1）**：带 `cameraInput` 的 image 层经 `assembleLayers()` 之后
  字段仍在（`internal/assembleLayers.ts:189-191` 的展开写法一旦被改成显式重建就会红）。
- **黄金向量**：新增的非 16:9 内容矩形用例在 TS / Python 两侧差 ≤ 1e-6。
- **配置**：`stills` 段整段缺失时，行为等同于默认值（`enabled=True`）。

### 9.2 集成 / 人工验收（Definition of Done）

| # | 场景 | 期望 |
|---|---|---|
| **A16** | 选中一张图片片段，看工具栏「运镜」 | 按钮**可用**（不再灰）；`M` 与双击同样可开面板 |
| **A17** | 给图片选「缓慢推近」→ 应用 → 播放 | 画面在图片自己的位置框内平滑推近；**不溢出框、不压到相邻图层**；框外仍是透明/底层视频 |
| **A18** | 暂停状态下给图片应用运镜 | 预览**立即**重绘出运镜首帧（不需要先播放） |
| **A19** | 给图片选「左环绕」（3D）→ 播放 | 呈现带透视的环绕；四角无黑楔 |
| **A20** | 图片运镜导出成片并播放 | 方向、幅度、时机与预览一致（首/中/尾三帧比对，≤1px 量级）。**取样素材的位置框必须整框在画面内**——越出边缘时预览侧有 `w = min(w, 1-x)` 钳位而导出侧没有（`ImageOverlayLayer.ts:139-140`，评审 P2-5），那是本轮之前就存在的偏差，不在 A20 的判据范围内 |
| **A21** | **同时**有图片运镜与字幕的项目导出 | 运镜**照常生效**（合并分支也注入了；H3 的验收面） |
| **A22** | 未配置运镜的图片项目导出 | 产物与本次改动前逐帧一致（零回归；A6 的静帧面） |
| **A23** | 一张**透明 PNG** 加运镜后导出 | 透明区域仍然透明，**不出现黑框**（D24 的验收面） |
| **A24** | 分割带运镜的图片片段 / Ctrl+Z / 保存刷新重开 | 与视频片段行为完全一致（重基不跳变、可撤销、配置保留） |
| **A25** | 把 `stills.enabled` 置 false 后导出图片运镜 | 导出成功、图片为静态叠加、气泡提示「静帧运镜已在服务端禁用」，且**文案以片段名开头** |
| **A26** | 在无 WebGL 的环境播放 3D 运镜（视频或图片），**面板已关闭** | 预览区右上角出现降级角标，说明「导出仍为完整 3D」；关闭后本次挂载内不再出现。这是 v1 **A11** 真正缺的那一半（评审 P1-3） |
| **A26b** | 在**有** WebGL 的机器上，用一个会让四角落到相机后方的极端 3D 参数播放 | 同样出现降级角标 —— 面板里那个 `isSupported()` 角标**看不见**这种运行期退化，这条用例专门验证新角标覆盖了它 |
| **A26c** | 面板打开且它自己的 WebGL 角标已显示时 | 预览角标**不重复出现**（D29 同屏去重），不出现两条措辞雷同的提示 |
| **A29** | 合并分支（图片 + 字幕）人为失败 → 回退到 sequential 路径，且该项目含被降级的静帧运镜 | 气泡里**仍然**能看到静帧降级提示（评审 P1-1 的验收面；这是 v1 W2 在本轮唯一的新断点） |
| **A30** | 在一台缺少 `zoompan` 的 FFmpeg 上导出图片运镜 | 导出**一次成功**（不发生"先失败再整片重编码"），图片为静态叠加，气泡说明滤镜不可用（D26 的验收面） |
| **A27** | 面板擦洗条 | 拖动即定格到该时刻；键盘方向键可逐格；`aria-valuetext` 播报进度；「▶/⏸」可恢复循环 |
| **A28** | 人为让图片 overlay pass 失败（临时屏蔽 `zoompan`） | 导出**成功**、图片为静态叠加、气泡列出受影响片段（D22 的验收面） |

### 9.3 桌面端走查清单（补齐 v1 放行条件 C9）

v1 的 C9 要求「交付前跑完全部回归 **+ 桌面端完整走查**」，上一轮受工具限制未执行 GUI
走查。本轮把它写成可勾选的清单，**由实现节点或评审节点在桌面端逐条执行并留痕**：

1. 启动桌面端 → 新建项目 → 拖入 1 段视频 + 1 张图片到视频轨。
2. 视频片段：`M` → 「缓慢推近」→ 应用 → 播放 → 观察平滑、无黑边。
3. 图片片段：双击 → 「左环绕」→ 应用 → 播放 → 观察透视与边界。
4. Ctrl+Z ×2 → 两个运镜都撤销；Ctrl+Y ×2 → 都恢复。
5. 在图片片段中点分割 → 两段都有徽标 → 播放跨切点无跳变。
6. 保存项目 → 刷新 → 重开 → 运镜配置完整。
7. 导出 → 播放成片 → 与预览逐段比对（至少 3 个时间点）。
8. 记录：导出总耗时、overlay 阶段耗时、是否出现 warning 气泡。

### 9.4 量化基线（沿用 v1 P6 的做法）

- **零回归基线（主判据，评审 P2-7）**：同一个含图片但**不含运镜**的项目，改动前后各导出
  一次，**`filter_complex` 字符串与完整命令行逐字符相同**（从日志里取，`:2719` 与
  `:2730` 已经在打了）。产物 MD5 / 逐帧 PSNR 作为**辅助**判据——编码器版本或线程数一变
  MD5 就会红，那是噪音不是回归。
- **时长不漂移基线（评审 P1-4）**：含静帧运镜的项目导出后，成片时长与主视频时长一致
  （容差 2 帧）。§4.4.5 已实测 `-loop 1 -t` + 迟到副输入不改变时长，这条基线负责把它
  钉在回归里，因为它是 R20 唯一的量化出口。
- **耗时基线**：一张 4K 图片、10s、位置框 1920×1080，分别在「无运镜 / 2D 推近 /
  3D 环绕」下导出，记录 overlay 阶段耗时。若 2D 相对无运镜劣化超过 **3×**，
  记录取舍并考虑把 `stills_max_source_pixels` 下调（`supersample` 已是 1，
  没有进一步下调空间——这一点与 v1 §14 I4 的结论一致）。

---

## 10. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| **R17** | **只在一条图片分支注入运镜**（H3）——有字幕时走 combined 分支、无字幕时走 image-only 分支 | 「加了字幕运镜就没了」，偶发且极难自查 | D16 唯一构造器 + §9.1 的逐字符零回归断言 + **A21 端到端验收**（必须构造"图片+字幕"的项目） |
| **R18** | ~~**`zoompan` 吞掉 alpha 通道**~~ **（已实测排除，评审 P1-5）** | 透明 PNG 叠加变黑框——一个比"没有运镜"严重得多的回归 | §4.4.5 E1 实测：透明区读到底层绿 `(0,254,0)`、不透明区纯红 `(253,0,0)`，alpha 完整存活。**风险降为"跨 FFmpeg build 回归"**：A23 保留为回归闸（像素格式协商是逐 build 的）；真出问题时 D24 的 Plan B（`crop(eval=frame)+scale`）与 D22 的重跑兜底仍在 |
| **R19** | **大图 3D 预览掉帧 / 纹理超限**（8000×6000 每帧上传） | 预览卡死，用户以为软件坏了 | D19 降采样纹理缓存（≤2× 内容矩形，一次性生成）；`CanvasCompositor` 既有的 60→30 自适应降帧天然兜底。**导出侧对应的刹车是 D28 的 `stills_max_source_pixels`**（卡源图；v1 卡内容矩形那版等于没卡，评审 P1-2） |
| **R20** | **`-loop 1` 让滤镜图不终止 / 输出时长变化 / 迟到的副输入把 framesync 卡住** | 导出卡住、成片变长，或窗口之前的画面被冻住 | **已实测（§4.4.5）**：输出精确 5.000s / 150 帧、窗口前是纯净底层画面、副输入 EOF 后正常放行。构造器保证 `-t {duration}` 与 `-loop 1` 成对出现（单测断言）；输出时长由主输入 `[0:v]` 决定（`overlay` 默认 `shortest=0`）；§9.4 新增的**时长不漂移基线**负责把这条钉在回归里 |
| **R21** | **预览两条图片路径同时活跃**（layer 路径 + legacy `_drawOverlays`） | 同一张图画两次，运镜版与静态版重影 | **风险等级据实下调（评审 P2-4）**：全仓 `setOverlays(` 与 `drawFrame(` 只出现在测试里，生产代码无调用方，今天不可能重影。D21 的处置（不给 legacy 路径接运镜 + "多轨路径下 `_overlays` 不含 image 项"的断言）成本极低，保留作为防止未来复活的护栏 |
| **R22** | **图片自然尺寸探测失败**（损坏文件、异常格式、远程下载失败） | 若抛异常会让整单导出失败 | `_probe_image_size` 三级回退（PIL → cv2 → `(0,0)`），`(0,0)` ⇒ 放弃运镜 + warning，**绝不抛** |
| **R23** | **降级角标误报/常驻**（一次降级后永远挂着） | 界面噪音，用户失去信任 | D20 一次性回调 + 可关闭 + 引擎重建时复位；文案明确"导出不受影响"，把它定位成**信息**而非**错误** |
| **R24** | **`not-video` → `not-visual` 更名遗漏某处** | 某个入口的禁用提示文案变成 `undefined` | i18n 的三处（类型声明 / en / zh）由 `tsc` 强制一致；`npm run type-check` 是硬闸门；§9.1 的 eligibility 单测覆盖三种 reason |
| **R25** | **图片数量多时输入数暴涨**（每张带运镜的图 = 1 个 `-loop` 输入） | 滤镜图变大、内存上升 | D17 按需追加；`stills_max_source_pixels`（D28）提供运维刹车；耗时基线在 §9.4 里被量化 |
| **R26**（评审 P0-1） | **输入参数插到了错误的位置** —— `-loop/-t/-framerate` 落到下一个输入或输出上 | 整条命令语义被改写：可能给主视频加上 `-loop`，或把 `-t` 变成输出时长限制，成片长度直接错 | D27 单趟装配；§9.1 的"输入参数与 `-i` 相邻"断言；§8 P1 要求实现完立刻打印一次完整命令行核对 |
| **R27**（评审 P0-2） | **在缺滤镜的 FFmpeg 上，静帧链路白烧一次全片重编码** | overlay pass 是全片重编码，长时间轴上是分钟级；用户看到的是"导出特别慢"而不是任何错误 | D26 的 caps 直传 + `dry_run_chain` 预检把失败拦在 0.1s 的 lavfi 空跑里；A30 是它的验收面；D22 只作最后兜底而不是第一道防线 |
| **R28**（评审 P1-1） | **降级提示在回退路径上消失** | 用户在"合并分支失败 → sequential 回退"这条最需要解释的路径上，反而什么提示都收不到 | `_process_overlays_sequential` 改为返回 `List[str]` 并汇入同一 bucket；A29 + §9.1 的回退路径断言 |

---

## 11. 与既有设计的关系 / 文档债

- 完全继承 `docs/plans/camera-motion-2d-3d/spec.md` v2 的数据模型（§7）、数学契约（§4.2）、
  降级与告警通道（§4.4.4 / §4.4.5）、面板契约（§4.5.2）。本方案**没有引入第二套语义**。
- 继承 spec 02 的 `CompositorLayer` 契约：只增可选字段，不改 z 序、`opacity`、
  转场 alpha 的计算顺序。
- 继承 spec 05 的导出两段式：静帧运镜作用在 **overlay pass**，
  `filtergraph_builder` / `audio_mix` / `_normalize_video` 零改动。
- **文档债（一并处理）**：v1 spec §14 记录的 I1（窗口 clamp）、I2（zoompan 不限 2D）、
  I4（`supersample` 默认值 1）三条修正**至今未回写 v1 正文 §4.2.1 / §4.4.3 / §7.3**。
  下游实现节点在改 `camera_motion.py` 时，**顺手把这三段正文回写**（纯文档，零代码风险），
  否则下一个读 spec 的人会按错误的正文实现。这一条列入放行条件 C16。

---

## 12. 放行条件（下游节点必须逐条满足）

| # | 条件 | 验收锚点 |
|---|---|---|
| **C10** | 图片叠加滤镜串**只有一个构造器**，两条分支都调用它 | §9.1 逐字符零回归断言 ×3 + A21 |
| **C11** | 无运镜路径**逐字符零回归**（滤镜串、输入参数、overlay 参数三者皆是） | §9.1 + A22 + §9.4 MD5 基线 |
| **C12** | 静帧 warnings 走 status 通道，W1–W4 四点齐全（**W3 路由白名单最易漏**），**且回退路径 `_process_overlays_sequential` 同样有出口** | §9.1 warnings 闸（含回退分支）+ A25 / A28 / **A29** |
| **C13** | ~~透明 PNG 的 alpha 存活性实测确认~~ **已由评审节点完成**（§4.4.5 E1，结论已回写 D24）。剩余义务：A23 作为跨 FFmpeg build 的回归闸必须真的跑一次 | A23 |
| **C14** | `_drawCameraSource` 抽取后 v1 视频端测试**全绿**，无行为变化 | v1 `CanvasCompositor.camera.test.ts` |
| **C15** | 降级角标落地且只上报一次；A11 剩下的一半（预览区可见 + 覆盖运行期投影退化）达成，且与面板内既有角标不重复 | §9.1 降级回调测试 + A26 / A26b / A26c |
| **C16** | 桌面端走查（§9.3）逐条执行并留痕；v1 §14 的 I1/I2/I4 正文回写完成 | 走查清单 + `git diff` 显示 v1 spec 正文更新 |
| **C17**（评审 P0-2） | 静帧链路的 `caps` 与 `dry_run_chain` 预检**都已接上**，且 `build_still_overlay_plan` 的 `caps`/`label`/`ffmpeg_path` **没有默认值** | §9.1 能力探测与预检三条 + **A30** |
| **C18**（评审 P0-1） | 两个 overlay 函数已改为**单趟装配**，`-loop/-t/-framerate` 与其 `-i` 相邻，且不带运镜的图片 `-i` 之前**无任何多余参数** | §9.1 输入参数位置断言 + §8 P1 的命令行人工核对 |
| **C19**（评审 P1-2） | 运维刹车卡在**源图**像素数上并**确有可触发的用例** | §9.1 降级路径（内容矩形小 / 原图 8000×6000 的用例必须触发） |

---

## 13. 后续扩展点（明确不在本轮）

1. **多关键帧曲线**（v1 §12-2）：`CameraMotion.keyframes[]` + 分段查找 + 分段拟合。
2. **运镜模板库 / 收藏**（v1 §12-3）。
3. **AI 建议运镜**（v1 §12-4）：`video-editing-agent` 新增 `applyCameraMotion` 工具，
   复用 `setCameraMotionAction`——静帧支持落地后，这个工具的价值会明显变大
   （AI 生图 → 自动配运镜是一条完整的自动化链路）。
4. **图片位置框与运镜的联动编辑**：在预览里直接拖动运镜的起止取景框。

---

**字数自检**：本文档正文约 8k 字（远超 800 字下限），覆盖概述 / 技术设计 /
文件模块变更计划 / 接口设计 / 数据模型 / 测试与验收 / 风险与缓解 / 放行条件全部要求段落。
**下一节点**：按 §8 的 P0→P6 顺序实施，逐条对照 §12 的 C10–C19 验收。

---

## 实施过程发现的方案缺陷（Issues Found During Implementation）

> 记录于实现节点（2026-08-05）。按 §Constraints 的要求**不静默偏离**：每条给出
> 「方案原文 → 事实 → 实际采用的做法 → 落测位置」。没有一条推翻本方案的判断；
> 它们是方案与仓内现实之间的最后一段对齐。

### J1（措辞自相矛盾）— §4.4.2 的「后五种告警 / 其余三种静默」数不上

**方案原文**：降级触发条件列了 **9** 项，接着写「后五种各产生恰好一条 warning，
其余三种静默」。5 + 3 = 8 ≠ 9。

**事实**：第 5 项（`nat_w<=0 or nat_h<=0`，探测失败）与第 7 项（`contain_fit` 返回 0）
在实现里是同一件事——`contain_fit` 恰好在任一入参 ≤ 0 时返回 `(0,0)`。合并这两项后
恰好是 8 项，且与 §9.1 点名要测的五条降级路径（`stills.enabled=false` / 探测失败 /
超源图像素 / caps 缺失 / 预检失败）**完全吻合**。

**采用**：静默的是「用户没要运镜」的两种 —— `motion is None` 与恒等运镜；§9.1 点名的
五条各恰好一条 warning。**第三种（`config.enabled is False`）实现为发一条 warning**，
而不是文档字面要求的静默：它由 v1 的 `build_camera_filter_chain` 原样产出
（`{name}: camera motion is disabled on the server; rendered without motion`），与视频
片段的措辞完全一致。理由是一个纯图片项目在全局关闭下**一条提示都收不到**，直接违反 G4
「降级必须可解释」；W2 的去重保证同一句话不会重复刷屏。位置框退化为 0 时另有一条
warning（`too small`），它不属于那五条，也不会与它们同时出现。

**落测**：`test_camera_motion_stills.py::TestDegradePaths::test_each_path_produces_exactly_one_named_warning`
（五条各恰好一条且以片段名开头）+ `TestZeroRegression::test_no_motion_is_silent`。

### J2（事实已过时）— 评审 P2-6 说前端「从不发送 `output_fps`」

**方案原文**（评审 P2-6）：「前端的 `compositionRequest`（`useVideoExport.ts:615-633`）
**从不发送** `output_fps`，因此它恒为后端默认 30」。

**事实**：仓内当前就有 `output_fps: 30`（`useVideoExport.ts` 的 `compositionRequest`
字面量里）。结论没变——值仍是 30，与后端默认、与 `target_fps = request.output_fps`
三者一致——但「从不发送」这句已不再成立，写进文档会误导下一个人。

**采用**：服务层把 `target_fps` **显式**传给两条 overlay 分支
（`_process_image_overlays` / `_process_overlays_and_subtitles_combined` 的
`output_fps` 参数），而不是依赖默认值 30。静帧的 `-framerate` / `fps=F` 因此永远跟随
真实合成帧率，前端将来改这个字段也不会让两端错位。

### J3（清单条目已自动满足）— §5.1 第 3 条「`camera/index.ts` 导出 `StillCameraInput`」

`camera/index.ts` 的第一行就是 `export * from './types'`，新类型定义在 `types.ts` 里，
因此 barrel **零改动**即已导出。为「让清单每条都有 diff」而去加一行具名导出，只会与
既有风格冲突。该文件本轮未改。

### J4（新增文件一个）— D29 同屏去重需要一个进程内的「面板在场」信号

**方案原文**：§5.3 第 11 条要求预览角标「与面板内既有角标同屏去重（D29）」，但没有
指定机制。

**事实**：面板的开关状态是 `TimelinePanel` 的**局部** state（这是刻意的：面板在「应用」
之前绝不写 store，Cancel 才是真 Cancel），而角标住在 `VideoPlayerPanel` 这棵完全不同的
子树里。把这个布尔值从容器一路穿下去要动三个不相干的组件签名。

**采用**：新增 `components/CameraMotionModal/panelPresence.ts`（约 40 行，无依赖）——
面板挂载时登记、卸载时注销，角标用 `useSyncExternalStore` 订阅。去重规则因此只存在于
**一处**，而不是两个组件各自猜测对方的状态。这是本轮唯一一个不在 §5 清单里的新文件。

**落测**：`CameraMotionModal.test.ts` 的源码级契约（面板调用
`markCameraMotionPanelOpen`）+ 角标组件对 `subscribeCameraMotionPanel` 的订阅。

### J5（测试清单的读逻辑必须变）— §5.6 第 32 条「读逻辑不变，只是数据变多」

**方案原文**：黄金向量「追加静帧类用例：内容矩形 4:3 / 1:1 / 9:16」，同时说读取端
「读逻辑不变」。

**事实**：这两句不能同时成立。黄金文件原本只有一个**全局** `frame: {w:1920,h:1080}`，
两端都拿它算 aspect；而 `rollPad`（roll 覆盖常量）与 `coverScale`（3D 四角覆盖）**都是
aspect 的函数**。不给用例带上自己的 frame，新增的 4:3 / 1:1 / 9:16 用例会以 16:9 求解，
既不是静帧的真实情形，也测不出任何新东西。

**采用**：`GoldenCase` 增一个**可选** `frame` 字段（缺省仍取全局 16:9，旧用例逐字节
不变），TS 生成端与 Python 读取端各改一行取 aspect 的代码。新增 27 条静帧用例
（3 种内容矩形 × {推近 start/mid/end、平移 start/mid/end、roll、3D 环绕、3D 退化}），
fixture 从 53 条增至 80 条，两端仍在 1e-6 内一致。

**落测**：`goldenVectors.test.ts`（新增名字断言）+ `test_camera_motion.py::TestGoldenVectors`。

### J6（D22 的文案粒度）— 「N 个图片片段的运镜未能渲染」与 §6.1 的前缀规则冲突

**方案原文**（§4.4.3 第 4 条）：重跑成功后追加 warning「N 个图片片段的运镜未能渲染，
已按无运镜导出」。

**事实**：§9.1 要求**所有**静帧 warning 以 `f"{item.name}: "` 开头，一条聚合文案做不到；
而且用户真正想知道的是「哪几张图」，不是「几张图」。

**采用**：按受影响片段**逐条**发 warning，措辞与视频侧的同类降级对齐
（`{name}: rendering the camera motion failed; rendered without motion`）。W2 的去重
天然处理重复，条数等于真实受影响的片段数。

**落测**：`VideoCompositionService._camera_retry_warnings` +
`test_camera_motion_stills.py::TestServiceWiring::test_both_overlay_branches_use_the_single_constructor`。

### J7（实测补充，非缺陷）— 端到端命令行已按 §8 P1 的要求人工核对

用真实 FFmpeg（`2025-05-15-git-12b853530a-full_build`）跑**生产代码装配出来的**整条命令
（`_build_still_overlay_inputs` + `_build_still_overlay_filters`），素材为 960×540 绿底
5s 视频 + 1600×1200 半透明 PNG（左半全透明、右半纯红），位置框满画面、1.6s 起 3s 长、
2D 推近：

| 观测点 | 结果 | 对应条款 |
|---|---|---|
| `-loop 1 -t 3.000 -framerate 30` 的位置 | **紧邻该图片的 `-i` 之前**，主视频输入前无任何多余参数 | C18 / R26 |
| 退出码 | 0 | G4 |
| 输出时长 / 帧数 | **5.000s / 150 帧**（= 主输入） | §9.4 时长基线 / R20 |
| `t=0.5`（窗口前） | 纯绿底图 | §4.4.5 |
| `t=2.5` 透明半边 | 纯绿（**alpha 存活，无黑块**） | A23 / D24 |
| `t=2.5` 不透明半边 | 纯红 | — |
| `t=4.9`（副输入 EOF 后） | 纯绿 | D25 |
| 另一组：`scale=2` + 取景中心 `x: 0.25→0.75` 的平移 | 画面中心从透明半边移到红色半边 —— **运镜真的在动** | A17 的导出面 |

### 放行条件自查（§12 的 C10–C19，实现节点填写）

| # | 状态 | 证据 |
|---|---|---|
| **C10** 唯一构造器，两条分支都调用 | ✅ | `build_still_overlay_plan` 是唯一出口；两条分支都经 `_build_still_overlay_inputs` / `_build_still_overlay_filters`；`TestServiceWiring::test_both_overlay_branches_use_the_single_constructor` |
| **C11** 无运镜逐字符零回归 | ✅ | `TestZeroRegression`（4 种输入，chain 与硬编码 legacy 串逐字符相等、`input_args==[]`、`overlay_suffix==""`）+ `test_disable_camera_reproduces_the_pre_feature_command`（整条 cmd 与滤镜串比对） |
| **C12** warnings 走 status 通道（含回退路径） | ✅ | `_record_composition_warnings` × 4 个调用点；`_process_overlays_sequential -> List[str]`；`test_camera_motion_warnings.py::test_the_overlay_fallback_path_still_reports` + 路由白名单用例 |
| **C13** 透明 PNG alpha 回归闸 | ✅ | J7 实测：透明半边读到底层绿、不透明半边纯红 |
| **C14** `_drawCameraSource` 抽取后视频端零变化 | ✅ | v1 `CanvasCompositor.camera.test.ts` 全绿（`_drawCameraVideoLayer` 现在是一行转发） |
| **C15** 降级角标只上报一次 + 覆盖运行期退化 | ✅ | `CanvasCompositor.degrade.test.ts`（一次性、两个触发点、detach 后可复发、可退订） |
| **C16** 桌面走查 + v1 文档债回写 | ⚠️ **半条** | I1/I2/I4 已回写 v1 正文（§4.2.1 / §4.4.3 / §7.3 + §14 抬头）；**GUI 走查未执行**，见下 |
| **C17** caps + dry-run 接上且三参数无默认值 | ✅ | `TestGates`（缺 zoompan / 预检失败各一条 warning + `inspect.signature` 断言三参数无默认值） |
| **C18** 单趟装配，输入参数与 `-i` 相邻 | ✅ | `TestSinglePassAssembly` + J7 的真实命令行人工核对 |
| **C19** 刹车卡在源图像素且有可触发用例 | ✅ | `test_the_brake_gates_the_source_image_not_the_content_rect`（内容矩形 320×240、原图 8000×6000 触发） |

### 未做的部分（据实声明）

- **§9.3 桌面端 GUI 走查（C16 的前半条）本节点未执行**：本执行环境没有可交互的桌面端
  会话，无法点按钮、拖时间轴、看成片。可自动化的部分已用真实 FFmpeg 端到端跑通（见 J7），
  但 A16–A28 里依赖人眼与鼠标的条目（按钮是否变亮、面板擦洗手感、撤销重做、分割跨切点
  是否跳变）仍需在桌面端逐条确认。**这与 v1 C9 是同一条未清的债，不应再次被当作已完成。**
- **§9.4 的耗时基线未采集**：需要一张 4K 图片在真实导出管线里跑三组对照（无运镜 / 2D /
  3D），本轮只验证了正确性，没有量化性能。`stills_max_source_pixels` 的默认值因此仍是
  按 D28 的推算取的 7680×4320，而不是实测取的。

---

## 评审结论（Review Verdict）

### 结论：**有条件通过**

这份设计的基本判断是对的，而且对得相当扎实：**不重做 v1，只把运镜覆盖到最后一类可见素材，
并复用同一份数学内核、同一个数据模型、同一个面板**。评审逐节对照仓内真实代码验证过它的
主要事实主张，绝大多数经得起查：

- `eligibility.ts:39` 确实显式排除了 `originalMaterialType === 'image'`，且**只需删这一行**——
  `item.type` 对落在视频轨上的图片仍是 `'video'`（`:35` 不会误伤）；
- 图片叠加滤镜串确实**双写**在 `:2533` 与 `:2705` 两处，H3 属实，D16 的唯一构造器是正解；
- §4.4.2 给出的零回归静态串与两处内联 f-string **逐字符一致**；
- §4.3.4 关于 `cameraMotionSignature` 的推断属实（`useCompositionPlayback.ts:598-606`
  按 `track.type === 'video'` 遍历、不看素材类型，静帧天然被覆盖）；
- 四个入口确实都走 `canApplyCameraMotion`（工具栏 / 面板 / 徽标 / 批量），§4.5.3 说"不需要
  改动"是对的；`SplitService.ts:82` 的重基也与素材类型无关，A24 不需要额外代码；
- `Camera3DRenderer.render()` 的入参类型确实已含 `HTMLImageElement | HTMLCanvasElement`；
- `Pillow` / `opencv-python` 都在 requirements 里，`_probe_image_size` 可落地；
- `_even()` 的"向上取偶"语义与 §4.2 那段 `pad` 不越界的推导**成立**，锚点
  `contain_fit(1919,1080,1920,1080) == (1920,1080)` 经手算复核无误。

更值得肯定的是它**主动把两条不确定的事标成"必须实测"**（D24 的 alpha、以及隐含的时长行为），
而不是含糊过去。评审顺手把这两件事做完了（§4.4.5）：`zoompan` 不吞 alpha、迟到的副输入不卡
framesync、`-loop 1 -t` 不改变输出时长、`-loop` 前后帧数 1 → 90。**这三条结论已回写正文，
C13 从"待测"降为"回归"。**

被拦下来的是两类问题：一类是**把"改一行"当成了"改一处"**（P0-1：输入选项必须紧邻 `-i`，
而仓内是两趟循环，literal 实现会把整条命令的语义改掉）；另一类是**继承 v1 时漏掉了它最贵的
那部分**（P0-2：v1 为运镜专门造的能力探测 + lavfi 预检，在静帧链路上一个都没接，而静帧失败
的代价比视频侧高一个数量级——全片重编码）。这两条加上 6 项 P1 已在正文内逐条修复，
新增 D26–D29 四条决策、R26–R28 三条风险、C17–C19 三条放行条件、A26b/A26c/A29/A30 四项验收。

### 放行条件（下游实现节点必须逐条满足）

1. **C10–C19 全部达成**（§12）。其中新增的三条是本轮评审的直接产物，不可省略：
   - **C17**：`caps` 与 `dry_run_chain` 必须接上，且 `build_still_overlay_plan` 的
     `caps` / `label` / `ffmpeg_path` **不得有默认值**——这是把 P0-2 钉死在类型层面的唯一手段；
   - **C18**：两个 overlay 函数必须改成**单趟装配**，并有"输入参数与 `-i` 相邻"的断言；
   - **C19**：运维刹车必须卡在**源图**像素数上，且测试里要有一个**真能触发**它的用例。
2. **实现顺序不得调换 §8 的 P1 与 P2**：后端服务层的单趟重构（D27）决定了后面所有代码的
   形状，先写前端会导致返工。
3. **§9.3 的桌面端走查必须真的执行并留痕**（v1 的 C9 就是因为"工具限制"被跳过才留到今天）。
   走查里必须包含 A21（图片运镜 **+ 字幕** 同时存在）与 A29（合并分支失败回退）——这两条是
   H3 与 P1-1 唯一的端到端出口，单测替代不了。
4. **零回归的主判据改为命令行逐字符比对**（§9.4），MD5 只作辅助。
5. **P2 项由实现节点自行取舍，但 P2-1（`assembleLayers` 透传断言）与 P2-10（更名后的
   en/zh 文案重写）建议一并做掉**：前者防的是 v1 已经犯过一次的错，后者不做会出现"按钮亮着、
   提示说不支持"的自相矛盾。

### 不予放行的情形

若下游实现出现以下任一情况，视为未满足本设计：给图片单写一套数学 / 单写一套面板；
在 `TimelineItem` 或工具栏里内联重写可用性判据（v1 P2-7 的第三次复发）；
为了"省事"把 `-loop 1` 加到所有图片输入上（D17 的零回归面立刻失守）；
或让任何一条运镜失败演变成**导出整单失败**（G4 是硬底线）。
