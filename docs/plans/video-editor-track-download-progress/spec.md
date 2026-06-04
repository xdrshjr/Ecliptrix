# 视频编辑器预览优化（第 3 轮）——「下载进度内嵌轨道横条 + 移除播放窗旁持久提示 + 点击播放时提示」落地方案

> Topic: `video-editor-track-download-progress`
> 文档版本：**v2（已评审 · 通过修复）**
> 作者：Anthropic 资深工程（方案架构师，2026-06-04，逐节对照 round-2 落地源码核验）
> 评审：Anthropic 资深工程（方案评审节点，2026-06-04，逐节对照 round-2 源码二次核验行号/符号/i18n 键/测试基建；评审记录见下方「评审记录」段，结论见文末「评审结论」段。v2 已就地修复全部 P0/P1）
> 语言：简体中文（标识符 / 路径 / 接口保留英文）
> 输出目录：`docs/plans/video-editor-track-download-progress/`
> 关联既有规划（直接前置，**全部复用、不回滚**）：
> - 第 1 轮：`docs/plans/video-editor-preview-proxy-playback/spec.md`（480p 服务端低清代理，提交 `8efe920` / `a504a09`）
> - 第 2 轮：`docs/plans/video-editor-client-preview-download/spec.md`（下载优先 + 纯客户端 blob 预览 + 就绪门控 + 轨道下载 UI，提交 `9e36223`）

---

## 评审记录（Review Notes · v2）

> 评审人：Anthropic 资深工程（方案评审节点，2026-06-04）。维度：可行性（Feasibility）/ 完备性（Completeness）/ 一致性（Consistency）/ 适度性（Right-sizing）。已逐节对照 round-2 落地源码二次核验全部行号、符号、i18n 键与测试基建。

**核验通过项（Feasibility 基线，确认无需改动）**：

- **行号 / 符号全部命中**：`VideoPlayerPanel.tsx` 按钮 `:3128-3143`（`:3131` `disabled={getTotalDuration()===0 || !allTimelineMediaReady}`）、持久提示 `:3151-3166`、守卫 `:1898-1915`、`mediaReadiness` 派生 `:658-694` + `allTimelineMediaReadyRef`/`mediaReadinessRef` `:698-701`；`TimelineItem.tsx` `renderLocalDownloadOverlay` `:463-543` / 渲染点 `:577` / 选中态手柄 `:592-602`；`TimelinePanel.tsx` `localProxyStatusMap` 派生 `:96-105`（`:102` 已携带 `progress`）；`VideoEditingInterface.tsx` retry 接线 `:2646`、空格键入口 `:393`。
- **i18n 键齐全**：`localTranscoding/localDownloading/localDownloadFailed/localWillStream`（`:702-705 / 3341-3344 / 5788-5791`）、`materialsDownloading/materialsStreamingNotice`（`:1036-1037 / 3475-3476 / 5922-5923`）。
- **`localProxyProgress` 单位经核验为 0–100 整数**（`useLocalMaterialDownload.ts:281` `Math.min(100, Math.round((received/total)*100))`，完成置 `100`），故 G2「横条按 `${pct}%` 填充」映射成立，**不存在 0–1 小数陷阱**。
- 现有 overlay / 门控 / 选源 / retry 接线均与方案一致，G4「底层零回归」前提可达。

**问题清单（按严重度）**：

| ID | 维度 | 严重度 | 问题 | 处置（v2） |
|----|------|--------|------|-----------|
| **P1-1** | 完备性 / 一致性（与本轮硬需求冲突） | **P1** | 本轮移除播放按钮 `disabled` 后，门控的唯一执行点只剩 `handlePlayPauseClick` 守卫；但**全局空格键**入口（`VideoEditingInterface.tsx:393`，暂停态直接 `void ref.seekAndPlayFromTimeline(...)`）与其汇聚的 `seekAndPlayFromTimeline`（`VideoPlayerPanel.tsx:2524`，经 ref `:2786` 暴露）**均无就绪守卫**，用户可一键空格绕过门控播放未就绪素材，直接违背本轮硬需求「没下载好不能预览」，并与本方案 §7.3 DoD 自相矛盾。原方案仅在 §3.3.2 / R1 以「推荐 P2 · 核对并按需补守卫」对待，过弱。 | **升为必做**：在 `seekAndPlayFromTimeline` 顶部补同一就绪守卫（读 `allTimelineMediaReadyRef.current`，未就绪 → `showWarning(materialsDownloading…)` + `return`，复用 `mediaReadinessRef.current` 拼文案）。该入口是空格键 / 时间轴点击播放 / `handlePlayPauseFromTimeline` 包装器的公共汇聚点，单点设防即可覆盖全部绕过路径。已落入 §〇TL;DR#3、§2.1 G3、§3.3.2、§四（变更计划新增行 2b）、§八 R1、§九。 |
| **P1-2** | 可行性 / 一致性（与仓库测试基建冲突） | **P1** | §7.1 与变更项 #5/#6 以 **React 渲染断言** 描述（「渲染灰暗层 `left==='62%'`」「点击调用 `onRetryLocalDownload`」），但本仓库 `tsconfig` 为 `jsx:"preserve"`，Vitest（esbuild 变换）**不编译组件 TSX**——同目录 `VideoPlayerPanel.localPreview.test.tsx` 与 preview-proxy 测试因此一律用 `readFileSync`+正则在**源码字符串层**断言；唯一引入 `@testing-library/react` 的 `projectPersistence.integration.test.tsx` 也只 `renderHook`（无 JSX 组件）。按 §7.1 原样落地的渲染测试会在组件模块加载即失败、根本无法运行。 | **重写 §7.1 与 #5/#6 为源码字符串匹配口径**（断言 `.tsx` 源含对应 status 分支 / `left: \`${pct}%\`` 表达式 / retry `onClick`+`onPointerDown` 接线 / 守卫文本），对齐同目录既有测试。并显式标注：`VideoPlayerPanel.localPreview.test.tsx:65-67` 的 `disabled=...` 断言须改写为新的 `disabled={getTotalDuration() === 0}` 形态。已落入 §四 #5/#6 与 §七。 |
| P2-1 | 适度性 | P2 | G2 将 `renderLocalDownloadOverlay` 重命名为 `renderLocalDownloadProgress`。核验确认**无任何测试 / 外部引用该函数名**（纯组件内部局部函数），不会破坏测试；但属非必要 churn。 | 可保留原名以最小化改动；若改名须确保纯内部、无遗留引用。**非阻塞**，§3.3.3 已加注。 |
| P2-2 | 完备性（A11y） | P2 | G1 删除的持久提示带 `role="status"`（下载进度的唯一无障碍朗读区）；新轨道进度条与点击 toast 均无 `aria-live`/`role=progressbar`，屏幕阅读器用户失去进度播报。 | 建议给横条进度层加 `role="progressbar"`+`aria-valuenow={pct}`，或在播放区保留一处 `aria-live` 摘要。**非阻塞**，§3.3.3 / §八 R9 已记录为后续增强。 |
| P2-3 | 一致性 | P2 | TimelineItem overlay 守卫读 `item.type`，而门控 `mediaReadiness` 读 `material.type`，二者口径不一。当前**无害**（`localProxyStatusMap` 已按 material 类型过滤，image-on-video-track 取不到条目 → 返回 null），但读起来易误解。 | 加一行注释说明「最终由 `localProxyStatusMap`（按 material 类型过滤）兜底」。**非阻塞**，§3.3.3 已加注。 |
| P2-4 | 一致性 | P2 | 全文行号引用会随源码漂移失效。 | 方案已声明「符号引用优先」；落地以符号锚点（函数名 / 文案键）定位、行号仅作参考。维持原则即可。 |

> **速览**：无 P0；**P1-1、P1-2 已在 v2 文档正文就地修复**；P2 项为非阻塞增强 / 澄清，已加注。最终判定见文末「评审结论」。

---

## 〇、需求与结论摘要（TL;DR）

**本轮用户原话（第 3 轮）**：

> 没修改好，现在下载是在播放窗口的旁边显示的「素材下载中，请稍候（已就绪 0/7）」，这是不对的，应该是在下方的编辑轨道面板上，对应的视频素材横条上，**横条本身有一个下载的样式（其本身可以充当进度条）**；没下载好之前，用户不能进行预览播放，在播放组合面板上，**点击播放的时候，提示用户**。

**本轮性质判定（重要）**：第 2 轮已经把「下载优先 + 纯客户端 blob 预览 + 就绪门控 + 轨道下载状态 UI」整套链路落地并跑通（状态机 `localProxyStatus`、进度 `localProxyProgress`、门控 `mediaReadiness`/`allTimelineMediaReady`、轨道状态图 `localProxyStatusMap`、音频 blob 接线、降级兜底 `degraded` 全部已存在）。**本轮不是功能新增，而是一次纯交互/呈现层（presentation-layer）的纠偏**——用户对「下载进度展示在哪里、以什么形态展示、禁播时如何提示」这三件 UI 决策不满意。因此本轮**严禁改动下载触发、状态机、门控判定、blob 选源等已绿的底层逻辑**，只调整三处呈现/交互：

1. **移除**当前显示在「播放窗口旁边」（播放控制栏 `controls-row > left-controls`，紧邻时间显示）的**持久文字提示** `素材下载中，请稍候（已就绪 N/M）` 及其降级提示（`VideoPlayerPanel.tsx:3151-3166`）。
2. **改造**下方剪辑轨道上每个视频/音频素材**横条本身**的样式：把第 2 轮的「整块暗色居中遮罩 + 文字」（`TimelineItem.tsx:463-543` 的 `renderLocalDownloadOverlay`）改为**横条自身充当进度条**——已下载部分按 `localProxyProgress` 从左向右「填充/高亮」，未下载部分「灰暗」，横条本身即进度可视化；转码态用不确定动画，失败/降级态在横条上以色彩 + 可点重试呈现。
3. **修正禁播交互**：当前播放按钮在未就绪时是 `disabled`（`VideoPlayerPanel.tsx:3131`），导致点击根本**不触发** `handlePlayPauseClick`、其中的 toast 守卫成了死代码、用户点了「没反应」。本轮把按钮改为**可点击**（仅在无内容 `getTotalDuration()===0` 时才 `disabled`），让 `handlePlayPauseClick` 既有的就绪守卫真正执行——**未就绪时点击播放 → 弹出瞬时 toast 提示用户，并 return 不进入播放**，满足「点击播放的时候，提示用户」。**（v2 评审补强 P1-1）** 由于移除 `disabled` 后门控仅剩这一处守卫，必须同时为**绕过按钮的播放入口**（全局空格键 `VideoEditingInterface.tsx:393` → `seekAndPlayFromTimeline`）补同一就绪守卫，否则用户可一键空格绕过门控播放未就绪素材，违背「没下载好不能预览」。详见 §3.3.2 / §八 R1。

**一句话**：把第 2 轮「展示在播放窗旁的持久计数 + 轨道暗色遮罩 + 禁用按钮」三件事，纠正为「**轨道横条本身当进度条 + 取消播放窗旁持久提示 + 点击播放时瞬时 toast**」，底层下载/门控逻辑零改动。

---

## 一、概述（Overview）

本方案是「视频编辑器预览优化」系列的第 3 轮，承接第 2 轮已落地的「下载优先、纯客户端 blob 预览」链路。第 2 轮在功能上已经解决了播放卡顿（素材整文件预下载到浏览器、全部就绪后以本地 `blob:` 源零网络播放），但其**就绪状态的可视化与禁播交互**没有达到用户预期：下载进度以一行持久文字「素材下载中，请稍候（已就绪 0/7）」显示在播放窗口旁的控制栏里，而下方剪辑轨道上的素材横条则被一层暗色遮罩盖住并居中显示文字。用户明确指出这两处都不对——进度应当**长在它所描述的那个素材横条上**，并且**横条本身就应该是那个进度条**（已下载多少、横条就填充/高亮多少），而播放窗旁不应再有这条持久文字。

为此，本轮做三件呈现层的事：其一，删除播放控制栏里那条持久的就绪计数文字（及随附的「N 个片段将以流式预览」降级文字），让播放区回归纯净；其二，重写 `TimelineItem` 中每个视频/音频素材横条的「下载中」可视化——不再用整块暗色遮罩盖住横条，而是让横条**自身成为进度条**：以 `localProxyProgress` 为分界，左侧「已下载」段保持素材本色（明亮），右侧「未下载」段叠加半透明灰暗层，二者交界处给一条细高亮线，配一个小而不挡操作的文字角标（如「下载中 62%」）；转码中（尚无字节进度）用不确定的脉冲/扫光动画，下载失败/终态降级则在横条上以红/琥珀色 + 可点重试呈现；横条就绪后样式完全恢复正常。其三，修正禁播交互：当前未就绪时播放按钮是 `disabled`，点击根本不触发处理函数，第 2 轮写好的 toast 守卫成了永不执行的死代码；本轮把按钮改为可点击（仅在时间轴无内容时禁用），令 `handlePlayPauseClick` 既有的就绪守卫真正生效——未就绪时点击播放即弹出一条瞬时提示并阻止播放，恰好对应用户「点击播放的时候，提示用户」。

本方案严格遵守既有不变量与项目约定：① **不触碰下载触发 / 状态机 / 门控判定 / blob 选源**等第 2 轮已绿逻辑（`useLocalMaterialDownload`、`LocalMediaCache`、`resolveSequencePlaybackUrl` 的 `preferLocalProxy` 档、`getOrCreateAudioElement` 的音频 blob 接线、`mediaReadiness` 派生全部原样保留）；② 轨道横条状态仍来自门控同一权威列表派生的 `localProxyStatusMap`（`status + progress`，第 2 轮 C4「无双数据源」约束延续），本轮**不新增数据源、不改派生口径**，只改 `TimelineItem` 的渲染；③ 仍由第 2 轮 `isLocalPreviewEnabled()`（默认 ON）单开关门控，关闭后回到第 1 轮流式预览且无任何下载 UI / 禁播；④ 导出链路完全不受影响。本轮是低风险、强收敛的纯前端改动，**不新增后端端点、不新增数据库迁移、不新增第三方依赖**。

---

## 二、目标与非目标

### 2.1 目标（In Scope）

- **G1（移除播放窗旁持久提示）**：删除 `VideoPlayerPanel` 播放控制栏中那条持久文字「素材下载中，请稍候（已就绪 N/M）」及随附的「{count} 个片段将以流式预览」（`:3151-3166`）。播放窗及其控制栏不再常驻任何下载计数文字。
- **G2（横条本身充当进度条）**：剪辑轨道上每个**视频/音频**素材横条，在其素材本地下载未就绪时，**横条自身**显示下载进度——已下载段（0→`progress%`）保持本色高亮、未下载段（`progress%`→100%）半透明灰暗、交界处细高亮线，附一个不阻挡拖拽的小文字角标（「下载中 NN%」）。转码态（无字节进度）显示不确定动画 + 「转码中」。下载失败 / 终态降级在横条上以红 / 琥珀色 + 可点「重试」呈现。横条 `ready` / `idle` / 未开启时**无任何下载样式**（回归普通横条）。
- **G3（点击播放时提示）**：未就绪时播放按钮**保持可点击**（不再 `disabled`，仅在 `getTotalDuration()===0` 时 `disabled`）；点击播放 → 复用 `handlePlayPauseClick` 既有就绪守卫弹出**瞬时 toast**「素材下载中，请稍候（已就绪 N/M）」并 `return`，不进入播放。就绪后点击正常播放。
- **G3b（绕过入口同等设防 · v2 评审新增 P1-1，必做）**：移除按钮 `disabled` 后门控仅剩 `handlePlayPauseClick` 一处守卫，因此**所有绕过该按钮的播放入口必须补同一就绪守卫**——经核验唯一这样的入口是全局空格键（`VideoEditingInterface.tsx:393` 在暂停态直接 `void ref.seekAndPlayFromTimeline(timelineCurrentTimeRef.current)`），其汇聚的命令式入口 `seekAndPlayFromTimeline`（`VideoPlayerPanel.tsx:2524`）当前**无就绪守卫**。在该函数顶部补守卫即可单点覆盖空格键 / 时间轴点击播放 / `handlePlayPauseFromTimeline` 包装器全部路径，未就绪 → 同款 toast + `return`。这是「没下载好不能预览」硬需求在本轮的闭环前提。
- **G4（底层零回归）**：第 2 轮的下载/门控**判定**/选源/音频 blob 逻辑**逐字节保留**；本轮只动 UI 呈现、一处按钮 `disabled` 条件，以及为 G3b 在 `seekAndPlayFromTimeline` 顶部**新增一处就绪守卫消费点**（读现成 `allTimelineMediaReadyRef`，不改判定本身）。所有第 2 轮既有单测继续通过（除被本轮明确改写的「持久提示渲染」「按钮 disabled」断言外）。

### 2.2 非目标（Out of Scope）

- **不**改动下载触发、`localProxyStatus` 状态机、`mediaReadiness` 门控**判定逻辑**（派生口径逐字节保留）、`resolveSequencePlaybackUrl` 选源、音频 blob 接线、`LocalMediaCache`、`useLocalMaterialDownload`。
  - 说明（v2 评审澄清）：G3b 在 `seekAndPlayFromTimeline` 顶部新增的就绪守卫**只是新增一个判定结果的消费点**（读现成的 `allTimelineMediaReadyRef.current`），**不改判定本身**——与既有 `handlePlayPauseClick` 守卫同源同语义，属「门控执行点补齐」而非「门控逻辑变更」，不破坏本条非目标。
- **不**改门控覆盖范围（仍仅 video/audio，image/subtitle 不参与；C2 延续）。
- **不**改降级（`degraded`）语义（仍为终态、不阻塞门控、走流式、可手动重试；C3 延续）。
- **不**新增后端 REST 端点、数据库表/迁移、第三方运行时依赖、新前端状态库。
- **不**新增/重命名素材数据字段（`localProxyStatus/localProxyUrl/localProxyProgress/localProxyError/localProxyBytes` 原样复用）。
- **不**默认开启 playback-v2 canvas 引擎（保留其独立灰度）。
- **不**改导出 / 合成 / 字幕 / 视频理解 / Storyboard / 工作流等其它模块。

---

## 三、技术设计（Technical Design）

### 3.1 现状盘点（改动前，已实测）

| 关注点 | 现状位置 | 现状行为 | 本轮处置 |
|--------|----------|----------|----------|
| 播放窗旁持久提示 | `VideoPlayerPanel.tsx:3151-3166`（`controls-row > left-controls`，时间显示之后） | `localPreviewEnabled && totalCount>0 && gatingCount>0` 时常驻 `materialsDownloading`；`gatingCount===0 && degradedCount>0` 时常驻 `materialsStreamingNotice` | **删除整段**（G1） |
| 播放按钮禁用 | `VideoPlayerPanel.tsx:3131` | `disabled={getTotalDuration()===0 || !allTimelineMediaReady}`——未就绪即禁用 | 改为 `disabled={getTotalDuration()===0}`（G3） |
| 点击播放守卫 | `VideoPlayerPanel.tsx:1898-1915` `handlePlayPauseClick` | 已有：`wantsToPlay && !allTimelineMediaReadyRef.current` → `showWarning(materialsDownloading…)` + `return`；但因按钮 `disabled` 而**永不触发** | **保留逻辑，使其因按钮可点击而真正生效**（G3） |
| 轨道横条下载 UI | `TimelineItem.tsx:463-543` `renderLocalDownloadOverlay` | 整块 `rgba(0,0,0,0.55)` 暗色遮罩居中显示 spinner + 文字 | **重写为「横条本身充当进度条」**（G2） |
| 轨道状态数据源 | `TimelinePanel.tsx:96-105` `localProxyStatusMap` | 从权威 `materials` 派生 `Map<materialId,{status,progress}>`（仅 video/audio） | **原样复用，零改动** |
| 门控派生 | `VideoPlayerPanel.tsx:658-694` `mediaReadiness` | 派生 `allReady/readyCount/gatingCount/degradedCount/totalCount` | **原样复用**（G1 删除其持久渲染，但派生本身保留供 G3 toast 使用） |

### 3.2 端到端数据流（本轮仅末端呈现变化）

```
[materials（权威, useState）]
   │  （第2轮派生，本轮不改）
   ├─▶ VideoPlayerPanel.mediaReadiness  ──▶ G3: handlePlayPauseClick 守卫读取 → 未就绪 toast
   │                                     └─▶ (G1: 删除 3151-3166 持久渲染)
   └─▶ TimelinePanel.localProxyStatusMap ──▶ TrackContainer ──▶ Track ──▶ TimelineItem
                                                                              │ (G2: 横条本身充当进度条)
                                                                              ▼
                                              status=downloading → 按 progress% 左填充/右灰暗 + 角标
                                              status=transcoding → 不确定脉冲动画 + 「转码中」
                                              status=error       → 红色 + 可点「重试」
                                              status=degraded    → 琥珀色 + 可点「重试」（不阻塞）
                                              status=ready/idle/未开启 → 普通横条（无样式）
```

**关键点**：`localProxyStatusMap` 已携带 `progress`（`TimelinePanel.tsx:102`：`{ status: m.localProxyStatus, progress: m.localProxyProgress }`），G2 所需的进度数据**已经在 `TimelineItem` 的 props 里**（`localProxyStatusMap?.get(item.materialId)` 即得 `{status, progress}`），**无需任何上游/接线改动**，只改 `TimelineItem` 渲染。

### 3.3 关键代码路径与改动点

#### 3.3.1 删除播放窗旁持久提示 —— `VideoPlayerPanel.tsx`

- 删除 `:3151-3166` 两个 `<span role="status">`（`materialsDownloading` 持久计数 + `materialsStreamingNotice` 降级提示）整段 JSX。
- `mediaReadiness` 派生（`:658-694`）**保留不动**——G3 的 toast 守卫仍读 `mediaReadinessRef.current.readyCount/totalCount`。删除的只是「持久渲染」，不是「派生计算」。
- `localPreviewEnabled`、`allTimelineMediaReady`、`allTimelineMediaReadyRef`、`mediaReadinessRef` 全部保留（被 G3 守卫与下游引用）。

#### 3.3.2 修正禁播交互：可点击 + 点击守卫 —— `VideoPlayerPanel.tsx`

- 播放按钮（`:3128-3143`）`disabled` 改写：
  ```tsx
  // 改前
  disabled={getTotalDuration() === 0 || !allTimelineMediaReady}
  // 改后（仅无内容时禁用；未就绪时保持可点击以便弹出提示）
  disabled={getTotalDuration() === 0}
  ```
- 可选 UX 增强（推荐、低风险）：在未就绪时给按钮一个「未就绪」视觉暗示但**保持可点击**——
  - `title`：就绪时 `t.videoPlayerPanel.playback.play`；未就绪时改用一条提示性 title（可复用 `materialsDownloading` 文案或新增简短键，见 §四 #4）。
  - 样式：未就绪时附加一个表「待命」的 class（如降低不透明度 / `cursor-not-allowed` 外观），但**不得**使用 `pointer-events:none` 或 `disabled`，否则 onClick 不触发、G3 失效。
  - `aria-disabled={!allTimelineMediaReady || undefined}`（语义可达性提示，不影响点击）。
- `handlePlayPauseClick` 守卫（`:1899-1915`）**逻辑保留**。验证点：`wantsToPlay && !allTimelineMediaReadyRef.current` 为真时执行 `showWarning(materialsDownloading.replace(...))` + `return`。本轮因按钮可点击而**首次真正生效**。
- **绕过入口同等设防（v2 评审升级为必做 · P1-1，不再是可选项）**：经核验，全局空格键在 `VideoEditingInterface.tsx:393` 暂停态直接调用 `void ref.seekAndPlayFromTimeline(timelineCurrentTimeRef.current)`，**完全绕过** `handlePlayPauseClick`；而命令式入口 `seekAndPlayFromTimeline`（`VideoPlayerPanel.tsx:2524`，经 `useImperativeHandle :2786` 暴露）目前**没有就绪守卫**。移除按钮 `disabled` 后，门控仅靠 `handlePlayPauseClick` 一处守卫，空格键即成为一键绕过门控的漏洞，违背「没下载好不能预览」。**修复（必做）**：在 `seekAndPlayFromTimeline` 函数体最顶部（`logger.info(...)` 之前）插入与 `handlePlayPauseClick` 相同的就绪守卫——
  ```tsx
  const seekAndPlayFromTimeline = useCallback(async (timelineTime: number) => {
    // v3 readiness gate (P1-1): this imperative entry is reached by the global
    // spacebar handler and timeline-click-to-play, bypassing the play button.
    // It must enforce the same gate, otherwise removing the button `disabled`
    // leaves a one-keystroke hole. Pausing never routes here, so any call is a
    // play intent → gate unconditionally.
    if (!allTimelineMediaReadyRef.current) {
      const r = mediaReadinessRef.current;
      try {
        showWarning(
          t.videoPlayerPanel.playback.materialsDownloading
            .replace('{ready}', String(r.readyCount))
            .replace('{total}', String(r.totalCount)),
        );
      } catch { /* notification provider may be unavailable in tests */ }
      return;
    }
    // …既有逻辑保持不变…
  }, [/* 既有依赖；showWarning / t 已在闭包内可用，refs 无需入依赖 */]);
  ```
  说明：该函数是空格键 / 时间轴点击播放 / `handlePlayPauseFromTimeline`（`:2669` 包装器）三条路径的**唯一公共汇聚点**，单点设防即覆盖全部绕过入口；当 flag off 时 `allTimelineMediaReadyRef.current` 恒 `true`（`mediaReadiness` 在 flag off 时返回 `allReady:true`，`:659-661`），守卫自然放行、不影响第 1 轮流式行为。`allTimelineMediaReadyRef`/`mediaReadinessRef`/`showWarning`/`t` 均已在组件作用域内，无需新增 state 或接线。

#### 3.3.3 横条本身充当进度条 —— `TimelineItem.tsx`（重写 `renderLocalDownloadOverlay`）

将 `:463-543` 的 `renderLocalDownloadOverlay`（暗色整块遮罩）替换为新的 `renderLocalDownloadProgress`，**保持函数签名上下文不变**（仍在 `return (...)` 中于 `renderItemContent()` 之后渲染，`:577`），其余守卫沿用：

> **v2 评审注（P2-1，非阻塞）**：函数重命名 `renderLocalDownloadOverlay → renderLocalDownloadProgress` 经核验**无任何测试 / 外部引用旧名**（纯组件内部局部函数 + 调用点 `:577`），改名安全；但属非必要 churn——开发节点可选择**保留原名**以最小化 diff，或改名但确保把 `:577` 的调用点一并改掉。二者皆可，不影响功能。
> **v2 评审注（P2-3，非阻塞）**：下方前置守卫读 `item.type`，而 §3.1 的门控 `mediaReadiness` 读 `material.type`，二者口径不同。当前**无害**：`localProxyStatusMap` 在 `TimelinePanel:99-103` 已按 `m.type === 'video'|'audio'` 过滤，image-on-video-track（`item.type==='video'` 但 material 为 image）在 map 中取不到条目 → `status===undefined` → 返回 null，不会误显进度条。落地时建议加一行注释点明「最终由 `localProxyStatusMap`（按 material 类型过滤）兜底」，避免后人误读。
> **v2 评审注（P2-2，A11y，非阻塞）**：G1 删除的持久提示带 `role="status"`（下载进度唯一的无障碍朗读区），新横条进度条建议给 `downloading` 覆盖层加 `role="progressbar"` + `aria-valuenow={pct}` + `aria-valuemin={0}` + `aria-valuemax={100}`，弥补屏幕阅读器播报缺失。属增强，非本轮硬性验收项（见 §八 R9）。

- 前置守卫不变：`if (!localPreviewEnabled) return null;` → `if (item.type !== 'video' && item.type !== 'audio') return null;` → `if (!item.materialId) return null;` → 取 `const local = localProxyStatusMap?.get(item.materialId); const status = local?.status;` → 仅 `transcoding/downloading/error/degraded` 渲染，`ready/idle/undefined → return null`。
- **新渲染按 status 分支**（横条 = 进度条；以下覆盖层均为 `absolute inset-0`、`borderRadius:'3px'` 贴合横条、`zIndex` 介于内容与选中态之间）：

  1. **`downloading`（核心——横条填充式进度条）**：
     - `const pct = Math.max(0, Math.min(100, Math.round(local?.progress ?? 0)));`
     - **未下载段灰暗层**：一个 `pointer-events-none` 的 div，`style={{ position:'absolute', top:0, bottom:0, left:`${pct}%`, right:0, background:'rgba(0,0,0,0.45)' }}`——只盖住 `pct%` 右侧的「未下载」区，左侧「已下载」区露出横条本色（视觉上横条从左向右被「点亮 / 填充」）。
     - **进度交界高亮线**：一条细竖线 `style={{ position:'absolute', top:0, bottom:0, left:`${pct}%`, width:'2px', background:'rgba(255,255,255,0.9)' }}`，强化「进度到这里」的读数。
     - **文字角标**：左下角或居中一个小号、半透明背景的标签「{localDownloading} {pct}%」，`pointer-events-none`、`fontSize:'9-10px'`、不撑高横条、`truncate`（窄横条只显百分比，宽横条显「下载中 NN%」）。
     - 含义：已下载越多，横条本色露出越多，灰暗区越短——**横条本身即进度条**，无需额外条形控件。

  2. **`transcoding`（不确定态——尚无字节进度）**：
     - 全横条覆盖一个**不确定动画**层：用 Tailwind 内置 `animate-pulse` 的半透明灰暗层（避免新增自定义 keyframes / 依赖），表「准备中」；或更明显的扫光可用一个 `animate-pulse` 渐变层。`pointer-events-none`。
     - 文字角标「{localTranscoding}」+ 既有 `spinner`（`animate-spin`）。

  3. **`error`（可恢复下载失败）**：
     - 横条覆盖一层半透明红 `rgba(220,38,38,0.35)`；其上一个**可点**「{localDownloadFailed}」按钮（`pointer-events-auto`，`onPointerDown` 调 `stopPropagation` 防误触发拖拽，`onClick` 调 `onRetryLocalDownload(item.materialId)`）。沿用第 2 轮 retry 接线。

  4. **`degraded`（终态降级，不阻塞）**：
     - 横条覆盖一层半透明琥珀 `rgba(245,158,11,0.30)`；其上一个**可点**「{localWillStream}」按钮（同上 retry 入口，幂等重试）。语义：该片段将走流式，不阻塞整体播放。

- **拖拽 / 交互安全**：所有进度可视化层 `pointer-events-none`；仅 `error/degraded` 的重试按钮 `pointer-events-auto` 且 `onPointerDown` 阻断冒泡（沿用第 2 轮 `stopDrag`），避免点重试被识别为拖拽起始。
- **窄横条降级**：当 `width`（`effectiveDuration * pixelsPerSecond`，`:98`）很小时，文字角标 `truncate` 并可仅留百分比 / 仅留色彩，不溢出横条。
- **不改** `getItemStyles()`（横条基础样式）/ `renderItemContent()`（名称、缩略图、时长、音频波形）——下载可视化是**叠加在其上**的覆盖层，就绪后整层消失、横条与第 2 轮前视觉完全一致。

#### 3.3.4 文案（i18n）—— `src/lib/i18n.ts`

- **复用既有键，无需新增**即可满足核心需求：
  - 横条角标：`t.timeline.track.localTranscoding`（'转码中'/'Transcoding'）、`t.timeline.track.localDownloading`（'下载中'/'Downloading'）+ 运行时拼接 ` {pct}%`、`t.timeline.track.localDownloadFailed`（'下载失败 · 点击重试'）、`t.timeline.track.localWillStream`（'将以流式预览'）——均已存在（`i18n.ts:702-705 / 3341-3344 / 5788-5791`）。
  - 点击播放 toast：`t.videoPlayerPanel.playback.materialsDownloading`（'素材下载中，请稍候（已就绪 {ready}/{total}）'）——已存在（`i18n.ts:5922`），G3 toast 直接复用。
- **可选新增**（仅当采用 §3.3.2 的按钮 `title` 未就绪文案）：在 `videoPlayerPanel.playback` 下加一个简短键，如 `playBlockedHint: '素材下载中，暂不可播放'`（中）/`'Downloading materials, playback unavailable'`（英）。属增强，非必须。
- `materialsStreamingNotice`（`:5923`）：随 §3.3.1 删除持久渲染后，该键在持久提示处不再被引用。**保留键本身**（删除 i18n 键有破坏其它引用 / 测试的风险，留作未来 toast 复用，零成本）。

#### 3.3.5 后端（无改动）

本轮纯前端 UI / 交互层调整，**不涉及任何后端**。下载源、静态挂载、代理生成全部沿用第 1/2 轮。

---

## 四、文件 / 模块变更计划（Change Plan）

> 原则：**纯呈现层收敛，零底层改动**。行号为审计实测（2026-06-04），以落地实测为准（符号引用优先）。

| # | 文件 | 类型 | 一句话意图 |
|---|------|------|------------|
| 1 | `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | 修改 | **G1** 删除 `:3151-3166` 播放窗旁持久提示（`materialsDownloading` 计数 + `materialsStreamingNotice` 降级）；保留 `mediaReadiness` 派生与 refs |
| 2 | `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | 修改 | **G3** 播放按钮 `:3131` `disabled` 改为仅 `getTotalDuration()===0`；可选加未就绪 `title`/`aria-disabled`/暗示样式（**不得** `disabled`/`pointer-events:none`）；`handlePlayPauseClick` 守卫保留（点击未就绪 → toast + return） |
| **2b** | `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | **修改（v2 新增 · P1-1，必做）** | **G3b** 在 `seekAndPlayFromTimeline`（`:2524`）函数体最顶部补与 `handlePlayPauseClick` 相同的就绪守卫（`!allTimelineMediaReadyRef.current` → `showWarning(materialsDownloading…)` + `return`），堵住空格键（`VideoEditingInterface.tsx:393`）/ 时间轴点击播放绕过门控的漏洞。复用既有 refs / `showWarning` / `t`，无新接线 |
| 3 | `src/components/video/timeline/TimelineItem.tsx` | 修改 | **G2** 将 `renderLocalDownloadOverlay`（`:463-543` 暗色整块遮罩）重写为横条进度条（可保留原名或改名 `renderLocalDownloadProgress`，见 §3.3.3 P2-1）：downloading 按 `progress%` 左填充/右灰暗 + 交界高亮线 + 小角标；transcoding 不确定脉冲；error 红+重试；degraded 琥珀+重试；ready/idle 无样式。守卫与 retry 接线沿用 |
| 4 | `src/lib/i18n.ts` | （可选）修改 | 仅当采用按钮未就绪 `title` 时新增 `videoPlayerPanel.playback.playBlockedHint`（中/英）；横条角标与 toast 复用既有键，**核心需求无需改 i18n** |
| 5 | `src/components/video/timeline/__tests__/TimelineItem.localDownload.test.ts(x)` | 新增 | **（v2 修正 P1-2：源码字符串匹配口径，对齐同目录既有测试）** `readFileSync` 读 `TimelineItem.tsx` 源并断言其含：downloading 分支的灰暗层 `left: \`${pct}%\``（或等价插值表达式）+ 角标插值 `localDownloading`/`pct`；transcoding 分支 `animate-pulse` + `localTranscoding` + `animate-spin`；error/degraded 分支的可点按钮 `onClick`→`onRetryLocalDownload(item.materialId)` 且 `onPointerDown` 阻断冒泡；`localDownloadFailed`/`localWillStream` 引用；前置守卫 `if (!localPreviewEnabled) return null` 与 `item.type !== 'video' && item.type !== 'audio'`。**不渲染组件**（`jsx:"preserve"` 下无法编译 TSX，见 P1-2） |
| 6 | `src/components/video/components/VideoPlayerPanel/__tests__/VideoPlayerPanel.localPreview.test.tsx` | 修改 | **（v2 修正 P1-2：仍走源码字符串匹配）** 把 `:65-67` 现有断言 `disabled={getTotalDuration() === 0 \|\| !allTimelineMediaReady}` 改写为 `disabled={getTotalDuration() === 0}`（按钮不再因门控禁用）；新增：源中**不再含** `:3151-3166` 持久提示 JSX 的 `role="status"` + `materialsDownloading` 控制栏渲染片段；`seekAndPlayFromTimeline` 区段含 `allTimelineMediaReadyRef.current` 就绪守卫（P1-1）；`handlePlayPauseClick` 守卫断言保留 |

> **不需要**新增 Alembic 迁移、REST 端点、后端改动、新数据字段、新依赖。第 2 轮的 `LocalMediaCache` / `useLocalMaterialDownload` / `resolveSequencePlaybackUrl` / `playbackFlags` / `useMaterialManagement` / `TimelinePanel`/`Track`/`TrackContainer` 接线 / 类型定义**全部不改**。

---

## 五、接口设计（Interfaces）

本方案**不新增任何后端接口、不新增前端模块公共签名**，仅复用既有结构。涉及的接口契约（均已存在，本轮仅消费）：

### 5.1 组件 props（不变，确认可用）
```ts
// TimelineItem 已有 props（无需改）——G2 所需数据已齐备
interface TimelineItemProps {
  item: TimelineItemData;                 // 含 type / materialId / duration / color ...
  pixelsPerSecond: number;
  trackHeight: number;
  localProxyStatusMap?: Map<string, LocalProxyMaskState>; // { status?, progress? }
  localPreviewEnabled?: boolean;
  onRetryLocalDownload?: (materialId: string) => void;
}
// LocalProxyMaskState 已含进度，G2 直接用
export interface LocalProxyMaskState { status?: LocalProxyStatus; progress?: number; }
```
- `localProxyStatusMap` 由 `TimelinePanel`（`:96-105`）从权威 `materials` 派生，经 `TrackContainer:343-345` → `Track:591-593` → `TimelineItem` 透传，**链路已通**，本轮不改。
- `onRetryLocalDownload` 由 `VideoEditingInterface:2646` 接到 `materialManagement.retryLocalDownload`，**已通**，本轮 error/degraded 重试沿用。

### 5.2 就绪派生（不变，确认可用）
```ts
// VideoPlayerPanel.mediaReadiness（:658-694，本轮保留）
{ allReady: boolean; readyCount: number; gatingCount: number; degradedCount: number; totalCount: number }
```
G3 的 toast 守卫读 `readyCount/totalCount` 拼 `materialsDownloading` 文案；G1 删除其**持久渲染**但保留**派生**。

### 5.3 选源 / 下载（不变，零消费变化）
`resolveSequencePlaybackUrl(..., { preferPreviewProxy, preferLocalProxy })`、`useLocalMaterialDownload`、`LocalMediaCache`、`getOrCreateAudioElement` 的 blob 接线**全部不动**。

---

## 六、数据模型（Data Model）

**无任何数据模型变更**（前端内存 + 后端 DB 均不变）。

- 前端：`MaterialItem` 的 `localProxyStatus / localProxyUrl / localProxyProgress / localProxyError / localProxyBytes`（第 2 轮新增的纯前端内存字段）**原样复用**；`LocalProxyStatus = 'idle'|'transcoding'|'downloading'|'ready'|'error'|'degraded'` 不变。
- 轨道呈现入参 `LocalProxyMaskState { status?, progress? }` 不变（已携带 G2 所需 `progress`）。
- 后端：`cached_materials.preview_proxy_*`（迁移 011）不读不写新列、不建表。客户端 blob 不入库。

本轮唯一「形态」变化是**像素层面的渲染映射**（`progress: number(0-100)` → 横条填充宽度 `${progress}%`），非数据结构变化。

---

## 七、测试与验收（Testing & Acceptance）

### 7.1 单元测试

> **v2 评审修正（P1-2）——测试口径必须遵循仓库既有约定**：本仓库 `tsconfig` 为 `jsx:"preserve"`，Vitest（esbuild 变换）**不编译组件 TSX**，无法直接 `render(<TimelineItem/>)` / `render(<VideoPlayerPanel/>)`（组件模块加载即失败）。同目录既有测试（`VideoPlayerPanel.localPreview.test.tsx`、preview-proxy 测试）一律采用 **`@vitest-environment node` + `readFileSync` 读 `.tsx` 源 + 正则在源码字符串层断言** 的模式；唯一引入 `@testing-library/react` 的 `projectPersistence.integration.test.tsx` 也只 `renderHook`（无 JSX 组件）。因此本轮单测**全部以源码字符串匹配实现**，断言「源中存在对应渲染分支 / style 表达式 / 事件接线」，而非运行时 DOM。下列条目即按此口径书写（「源含…」= `expect(src).toMatch(/…/)`）。

- **TimelineItem（G2）—— 源码字符串断言**（`readFileSync('TimelineItem.tsx')`）：
  - 源含 `downloading` 分支：灰暗层 `left` 绑定到进度插值（如 ``left: `${pct}%` `` 或等价 `` `${...progress...}%` ``）+ `rgba(0,0,0,0.45)`；角标插值含 `localDownloading` 与 `pct`/`progress`。
  - 源含进度 `clamp`：`Math.max(0, Math.min(100, Math.round(` …（保证 `progress` 缺省按 0、>100 截断，对应 R6）。
  - 源含 `transcoding` 分支：`animate-pulse` + `localTranscoding` + `animate-spin`（spinner 复用）。
  - 源含 `error` 分支：可点 `<button>` 的 `onClick` 调 `onRetryLocalDownload(item.materialId)`、`onPointerDown` 调 `stopPropagation`（防误拖拽）、文案 `localDownloadFailed`。
  - 源含 `degraded` 分支：同形可点重试、文案 `localWillStream`。
  - 源含前置守卫：`if (!localPreviewEnabled) return null`、`item.type !== 'video' && item.type !== 'audio'`、`!item.materialId`，且 `ready/idle/undefined` 不进入任一渲染分支（仅 `transcoding|downloading|error|degraded` 渲染）。
  - 源含窄横条降级：角标 `truncate`（覆盖层 `absolute inset-0` 贴合 item，天然不溢出）。
- **VideoPlayerPanel（G1 + G3 + G3b）—— 源码字符串断言**（`readFileSync('VideoPlayerPanel.tsx')`）：
  - **G3**：源含 `disabled={getTotalDuration() === 0}` 且**不含** `disabled={getTotalDuration() === 0 || !allTimelineMediaReady}`（按钮不再因门控禁用）。
  - **G3 守卫**：`handlePlayPauseClick` 区段含 `wantsToPlay` + `allTimelineMediaReadyRef.current` + `showWarning(` + `materialsDownloading`（保留，对应「点击未就绪 → toast + return」）。
  - **G3b（P1-1）**：`seekAndPlayFromTimeline` 区段（`src.slice(src.indexOf('const seekAndPlayFromTimeline'), … )`）含 `allTimelineMediaReadyRef.current` 就绪守卫 + `showWarning(` + 早 `return`（堵空格键绕过）。
  - **G1**：源中**不再含**控制栏持久提示——`materialsDownloading`/`materialsStreamingNotice` 不再出现在带 `role="status"` 的 `<span>` 渲染片段中（即 `:3151-3166` 整段已删；可断言 `role="status"` 计数归零或该文案不在 `controls-row` 上下文）。
  - **回退**：`mediaReadiness` 派生（`:658-694`）仍在源中（保留供 G3 toast 读取），即 `flag off → allReady:true` 分支 `if (!localPreviewEnabled)` 仍存在。
- **VideoEditingInterface（G3b 联动，可选）—— 源码字符串断言**：可在既有 `videoEditingInterface.spaceKey.test.tsx` 旁补一条：空格键 dispatcher 仍调 `ref.seekAndPlayFromTimeline(timelineCurrentTimeRef.current)`（接线不变；门控由被调函数内守卫负责，见 G3b）。

### 7.2 集成 / 手动验收

- **核心用例（横条进度条）**：上传 / 添加一段较大视频拖入轨道 → 该素材横条先显示「转码中」不确定动画，转码完成后横条**从左向右被点亮**、灰暗区随下载推进缩短、角标百分比递增（如「下载中 37% → 78% → 100%」），就绪后横条恢复普通样式。进度展示**始终在该素材自己的横条上**，播放窗旁**无任何持久文字**。
- **点击播放提示**：尚有素材未就绪时点击播放组合面板的播放按钮 → 弹出瞬时 toast「素材下载中，请稍候（已就绪 N/M）」且画面不播放；待全部就绪后再点 → 正常播放。
- **空格键不绕过门控（v2 评审新增 · P1-1 验收）**：尚有素材未就绪时**按下空格键** → 同样弹出瞬时 toast 且**不播放**（不得绕过门控）；全部就绪后按空格 → 正常播放/暂停。
- **多素材**：拖入 3 段视频 + 1 段音频，逐条横条各自显示各自进度；任一未就绪时点击播放都提示；全就绪后解锁。
- **失败 / 降级**：构造一段无法本地化的素材 → 其横条显示红「下载失败 · 点击重试」/ 琥珀「将以流式预览」，点重试可重走；降级素材不阻塞整体播放。
- **开关回退**：`localStorage['ecliptrix-local-preview']='false'` 刷新 → 轨道无下载样式、播放按钮不被门控禁用、点击直接走第 1 轮流式预览、播放窗旁无提示。
- **回归**：第 2 轮的「全就绪后纯 blob 零网络播放」（DevTools Network 播放期间无 `/api/storage/files/...` 请求）、音频 blob、`<video>.currentSrc==='blob:'`、进度条单调对应**全部不退化**。

### 7.3 验收门槛（Definition of Done，承接 board）
- `npm run type-check` 通过；相关单测全绿（含本轮新增/改写用例，**源码字符串匹配口径**）。
- 人工验收 §7.2 全部满足：进度在横条上、播放窗旁无持久提示、点击未就绪播放有 toast、**空格键未就绪同样被门控拦截（P1-1）**、就绪后正常播放、开关可回退、第 2 轮能力无回归。

---

## 八、风险与缓解（Risks & Mitigations）

| ID | 风险 | 影响 | 缓解 |
|----|------|------|------|
| **R1（v2 升级为 P1 必做）** | 移除 `disabled` 后，**绕过播放按钮**的播放入口未受就绪守卫保护。**已核实**：全局空格键在 `VideoEditingInterface.tsx:393` 暂停态直接 `void ref.seekAndPlayFromTimeline(...)`，而 `seekAndPlayFromTimeline`（`VideoPlayerPanel.tsx:2524`）**当前无就绪守卫** → 用户一键空格即可绕过门控播放未就绪素材 | **高**——直接违背本轮硬需求「没下载好不能预览」，且与本方案 §7.3 DoD 矛盾（不再是「可能」，是**确定存在**的漏洞） | **已在 v2 升级为必做修复**（§3.3.2、§四 行 2b、§〇/§2.1 G3b）：在 `seekAndPlayFromTimeline` 顶部插入与 `handlePlayPauseClick` 相同的就绪守卫（`!allTimelineMediaReadyRef.current` → `showWarning(materialsDownloading…)` + `return`）。该函数是空格键 / 时间轴点击播放 / `handlePlayPauseFromTimeline` 的唯一汇聚点，单点设防覆盖全部绕过路径 |
| **R2** | 进度覆盖层若误用 `pointer-events:auto` 或未 `stopPropagation`，会拦截 / 误触发横条拖拽、缩放手柄 | 中——破坏既有剪辑交互 | 所有进度可视化层 `pointer-events-none`；仅 retry 按钮 `pointer-events-auto` 且 `onPointerDown` 阻断冒泡（沿用第 2 轮 `stopDrag`）；覆盖层 `zIndex` 低于选中态 resize 手柄（`isSelected` 的左右把手 `:592-602`） |
| **R3** | `transcoding` 不确定动画若引入自定义 `@keyframes`，需改全局 CSS，增大改动面与样式冲突风险 | 低 | 优先用 Tailwind 内置 `animate-pulse`/`animate-spin`，**不新增自定义 keyframes**；确需扫光再评估局部 CSS module |
| **R4** | 删除持久提示后，若把 `mediaReadiness` 派生也一并删了，会导致 G3 toast 守卫拿不到 `readyCount/totalCount` | 中——编译/运行报错或 toast 文案错 | §3.3.1 明确：只删**持久渲染 JSX**，`mediaReadiness` 派生 + `mediaReadinessRef` + `allTimelineMediaReadyRef` 全部保留 |
| **R5** | 窄横条（短素材 / 低缩放）上角标文字溢出或与音频波形 / 名称重叠 | 低——观感问题 | 角标 `truncate` + 小字号 + 半透明背景；极窄时仅显百分比 / 仅显色彩；覆盖层裁剪在 item 边界内（`absolute inset-0` + `borderRadius` 贴合） |
| **R6** | 进度填充方向 / 百分比与真实下载不一致（如 `progress` 偶发回跳或 >100） | 低 | 渲染前 `clamp(0,100)`；`progress` 缺省按 0；方向固定左→右（已下载在左）。下载进度源仍是第 2 轮 `localProxyProgress`，本轮不改其来源 |
| **R7** | 改写既有单测断言（按钮 disabled / 持久提示渲染）可能漏改导致 CI 红 | 低 | §七明确列出需改写的断言；本轮属预期行为变更，更新对应断言即可，非回归 |
| **R8** | 关闭 `isLocalPreviewEnabled()` 时若 G2/G3 守卫遗漏 flag 判断，可能在回退模式下仍显示下载样式 / 拦截播放 | 低 | `TimelineItem` 渲染守卫保留 `if (!localPreviewEnabled) return null`；`mediaReadiness` 在 flag off 时恒 `allReady=true`（`:659-661`），G3/G3b 守卫自然放行；按钮 `disabled` 仅 `getTotalDuration()===0` |
| **R9（v2 评审新增 · P2，非阻塞 A11y）** | G1 删除的持久提示带 `role="status"`（下载进度唯一的无障碍朗读区）；新横条进度条 + 点击 toast 无持续可读的进度语义，屏幕阅读器用户失去下载进度播报 | 低——可达性轻度回退，不影响视觉用户 | 建议给 `downloading` 覆盖层加 `role="progressbar"` + `aria-valuenow={pct}`/`valuemin=0`/`valuemax=100`，或保留一处 `aria-live` 摘要。列为**后续增强**，非本轮硬性验收项（§3.3.3 已加注） |

---

## 九、实施顺序建议（供下游开发节点）

1. **G1**：删除 `VideoPlayerPanel.tsx:3151-3166` 持久提示（最小、独立、先做，立刻让播放区回归纯净）。
2. **G3**：改 `:3131` 按钮 `disabled` 条件为仅 `getTotalDuration()===0` + 可选 title/样式；验证 `handlePlayPauseClick` 守卫触发。
3. **G3b（必做 · P1-1，紧随 G3）**：在 `seekAndPlayFromTimeline`（`:2524`）顶部补就绪守卫，堵空格键 / 时间轴点击播放绕过门控的漏洞（R1）。**这是「没下载好不能预览」闭环的硬前提，不可跳过。**
4. **G2**：重写 `TimelineItem.tsx` 的 `renderLocalDownloadOverlay`（横条进度条，可保留原名或改 `renderLocalDownloadProgress`）。这是本轮主体工作量。
5. （可选）i18n 增补按钮未就绪 title 文案（#4）；（可选）A11y `role="progressbar"`（R9）。
6. 改写 / 新增单测（#5、#6，**源码字符串匹配口径**，见 §7.1 P1-2）：含 G3b `seekAndPlayFromTimeline` 守卫断言；跑 `npm run type-check` + 相关 suite，人工走查 §7.2（务必含「空格键未就绪不播放」一项）。

> 全程**不得**触碰 `useLocalMaterialDownload`/`LocalMediaCache`/`resolveSequencePlaybackUrl`/`playbackFlags`/`useMaterialManagement`/`TimelinePanel`/`Track`/`TrackContainer` 的下载与门控**判定**逻辑——本轮是纯呈现 + 一处门控执行点补齐（G3b）的收敛改动，底层判定零改动是验收的隐含前提（G4）。

---

## 评审结论（Review Verdict）

**判定：有条件通过（Approved with Conditions）。**

本方案性质判定准确（第 3 轮为纯呈现/交互层纠偏，复用第 2 轮已绿的下载/门控/选源/blob 底层），三件目标（G1 移除播放窗旁持久提示、G2 横条本身充当进度条、G3 点击播放时提示）与用户原话**完全对齐**。评审已逐节对照 round-2 落地源码二次核验：**全部行号、符号、i18n 键命中**，`localProxyProgress` 经实证为 0–100 整数（`useLocalMaterialDownload.ts:281/299`），G2 的横条 `${pct}%` 填充映射**可行无误**；数据流（`localProxyStatusMap` 携 `progress` 透传到 `TimelineItem`）与 retry 接线已通，G4「底层零回归」前提成立。**无 P0 问题。**

评审发现 2 个 P1 并已在 v2 正文**就地修复**：

1. **P1-1（空格键绕过门控）**：移除按钮 `disabled` 后，门控唯一执行点只剩 `handlePlayPauseClick`，而全局空格键（`VideoEditingInterface.tsx:393`）直接调用无守卫的 `seekAndPlayFromTimeline`（`VideoPlayerPanel.tsx:2524`），用户可一键绕过门控播放未就绪素材，**确定性违背**本轮硬需求「没下载好不能预览」。已升级为必做项 G3b：在 `seekAndPlayFromTimeline` 顶部补同源就绪守卫（单点覆盖空格键 / 时间轴点击播放 / `handlePlayPauseFromTimeline` 全部路径），并落入 §〇/§2.1/§3.3.2/§四 行 2b/§七/§八 R1/§九。
2. **P1-2（测试口径与仓库基建冲突）**：§7.1 原以 React 渲染断言书写，但仓库 `tsconfig jsx:"preserve"` 使 Vitest 无法编译组件 TSX（同目录测试一律 `readFileSync`+正则在源码层断言）。已将 §7.1 与变更项 #5/#6 全面改写为**源码字符串匹配口径**，并显式指明 `VideoPlayerPanel.localPreview.test.tsx:65-67` 的 `disabled=` 断言改写。

4 个 P2（函数改名 churn、A11y 朗读区缺失、`item.type` 与 `material.type` 守卫口径、行号脆弱性）均为非阻塞，已在正文加注（§3.3.3 / §八 R9）留待开发节点酌情。

**放行条件（开发节点必须满足，缺一不可）**：

- **C-1**：G3b 必做——`seekAndPlayFromTimeline` 顶部就绪守卫落地，且 §7.2「空格键未就绪不播放」人工验收通过。
- **C-2**：单测一律按 §7.1 **源码字符串匹配口径**实现（**不得** `render(<组件/>)`），并覆盖 G3b 守卫断言；`npm run type-check` + 相关 suite 全绿。
- **C-3**：严守 G4——`useLocalMaterialDownload`/`LocalMediaCache`/`resolveSequencePlaybackUrl`/`mediaReadiness` 派生口径**逐字节不动**（G3b 仅消费、不改判定）。
- **C-4**：开关回退（`isLocalPreviewEnabled()` off）下无下载样式、无门控禁播、无 toast——回归第 1 轮流式预览。

满足以上 4 项条件即视为达成本轮 Definition of Done。**文档版本已标注 v2，无 P0/P1 遗留。**
