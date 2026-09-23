# 以「视频段落」为核心的 AI 创作工作台：编辑页 UI/UX 重构（Segment-Centric Editor Workbench）

> Feature slug: `segment-centric-editor-workbench`
> Status: **v2（已评审；P0/P1 已在正文修复，见「评审记录」与文末「评审结论」）**
> Author: 方案设计节点（Subtask #0 / solution architect）· Iteration 1/2 · 评审：设计评审节点（Subtask #1）2026-09-23
> Scope: **仅前端表现层与交互层**（Next.js 15 / React 19 / TS / Tailwind 3 / Zustand）。不改后端、不改数据库、不改 REST 契约、不改播放引擎 / 合成 / 导出算法。
> 设计依据：用户提供的《AI 给出的建议》全文 + 设计图 `.agentmesh/attachments/paste-1790170761034.png`（下称「设计图」）+ 本体约束 `n_BmWWbXBkyq`（PyCharm 式软件风格：工具窗口、克制、稳健）。
> 关联代码：`src/components/video/VideoEditingInterface.tsx`（2380 行）、`src/components/video/ScriptPanel.tsx`（2837 行）、`src/components/video/components/{MaterialsPanel,VideoPlayerPanel,AgentChatDock}/`、`src/components/video/timeline/`、`src/components/video/projects/VideoEditorContainer.tsx`、`src/styles/video-editing.css`、`src/lib/i18n.ts`。

---

## 评审记录（Review Notes，v1 → v2）

评审方法：逐节对照四个维度（可行性 / 完整性 / 一致性 / 规模），并在当前 HEAD（`b4f6a4a`，分支 `feat/remove-user-system`）上逐条核对 v1 引用的代码事实。「证据」列是评审时实际读到的代码或实测数值。**P0 = 按原文实现会破坏功能或无法落地；P1 = 会造成功能偏差、违反仓库约定或自身验收门，必须在进入开发前修正；P2 = 建议项或实现时注意，不阻塞。** 所有 P0 / P1 已在正文修复，「修复位置」指向 v2 正文。

结论速览：**P0 0 条，P1 9 条（全部已修），P2 12 条（6 条已顺手写进正文，6 条留给实现者）。** v1 的整体方向、分期（Iteration 1 只重组、Iteration 2 才加新数据）和「功能保全对照表」都站得住，评审没有推翻任何结构性决定。

### P1（必须修，已在正文修复）

| # | 维度 | 问题 | 证据 | 修复位置 |
|---|---|---|---|---|
| RV-01 | 一致性 / 可行性 | v1 让 `useSegmentLinks` 订阅 `useVideoEditingStore` 取 `materials` 和 `segments`。但 ScriptPanel 实际吃的段落是 `content?.scriptSegments \|\| getMockScriptSegments(locale)`，素材是 `materialManagement.allMaterials`，store 里的是另一种类型的 `scriptSegmentsData: ScriptSegmentData[]`。按 v1 实现，左栏卡片、时间轴标签和素材「已用于第 N 段」会从**两套不同的数据**派生，正是建议里点名要避免的「互相猜测着同步」 | `VideoEditingInterface.tsx:2102`、`:2113`；`stores/slices/scriptSlice.ts:34` | §3.4.2 末段改为「由 `VideoEditingInterface` 用与 ScriptPanel 相同的两个值计算一次，经 `SegmentLinksContext` 下发」；§4 文件表 |
| RV-02 | 完整性 / 功能正确 | 「配音已生成」只看素材库。`handleConvertToSpeech` 成功后只是 `onAddMaterial` 把新配音**加进素材库**，不会替换时间轴上的旧配音。v1 下改完文案、重新生成后芯片变绿，但时间轴和导出仍是旧配音，验收主任务会导出旧声音，而界面告诉用户「已同步」 | `ScriptPanel.tsx:1413` 起只调用 `onAddMaterial`，无时间轴替换 | §3.4.2 新增 `voiceOnTimeline` 派生与规则；§3.5.2 芯片表；§3.12 A 步骤 3；§7.1 / §7.3 |
| RV-03 | 完整性 | 任务中心只数 `asyncTaskSlice`，但全仓只有 `AgentEventRouter.ts:333` 往里 `addTask`。ScriptPanel 的逐段 TTS（`convertingSegments`）不在其中，用户手动点「更新本段配音」时顶栏显示「任务 0」 | `grep addTask` 只有 1 处非测试调用 | §3.2「任务中心」改为聚合三个只读来源；§3.4.1 焦点仓库新增 `convertingSegmentIds` 镜像；§7.1 |
| RV-04 | 一致性 / 功能保全 | v1 把默认轨道名的改动写在 `trackDisplayName(track,t)`（真实函数名是 `deriveTrackDisplayName`），但漏掉它的另外两个调用方：`useTimelineExport.ts:98`（导出 JSON 的轨道名）和 `useAIMixedEditing.ts:299`（AI 混剪确认里「将保留的轨道」列表）。`Track.tsx:120` 的注释明确要求「导出 JSON 与 UI 显示同名」。新增的第三个参数 `hasNarration` 也会让三处调用各算一次、容易分叉 | 上述三处 | §3.8「轨道默认名」重写：保持单一函数，旁白判据从 `track.items` 内部推导，三个调用方一起更新；§4、§7.1 |
| RV-05 | 完整性 | 三栏宽度只各自 clamp，没有总宽约束：左 480 + 右 440 + 中栏最小 420 + 分隔条 > 1180~1356 区间的 `.ws-main`，中栏会被挤到 420 以下或出现横向滚动。上下方向也没给上半区最小高度，800px 高窗口选「剪辑布局」时播放器可能只剩一条缝。另外 Electron 已设 `minWidth: 1024`，v1 的 R11「未设 minWidth」前提不成立 | `desktop/main/window.js:102` | §3.1 新增「空间分配求解」规则与上半区最小高度；§8 R11 |
| RV-06 | 可行性 / 功能保全 | 「播放时间单一来源」只写了绑定 `currentTimelineTime ?? compositionCurrentTime`。现有 `getCurrentTime()` 还有两条语义：非合成模式返回 `currentTime`；合成模式按总时长 clamp。而且它是命令式句柄 `VideoPlayerPanelRef` 的一部分。v1 没说清只改显示层、不改句柄，实现者可能直接改 `getCurrentTime`，把回声抑制和 seek 链路一并带偏 | `useCompositionTransport.ts:256-260` | §3.6 改为新增纯函数 `resolveConsoleTime` 只供播放条使用，句柄不动；§7.1 补测试 |
| RV-07 | 一致性（可访问性） | 段落卡用 `role="option"`，放在 `role="listbox"` 里，但卡内有按钮、textarea、菜单。ARIA 规定 option 不能包含可交互子元素，读屏器会把整卡读成一个选项，里面的按钮不可达。这和 §3.10 / §7.3 的可访问性承诺自相矛盾 | WAI-ARIA 1.2 `option` 子元素限制 | §3.5.2「点击选中与编辑隔离」改为 `list` / `listitem` + 卡头 toggle 按钮（`aria-expanded` / `aria-current`）与 roving tabindex |
| RV-08 | 一致性（可访问性） | 用 WCAG 公式实测 §3.10 的色值：主色实心按钮上的白字（导出按钮、段落编号徽标）为 **2.99:1**；危险色 `#F24822` 在菜单底 `--ws-raised` 上为 **3.97:1**、浅色主题白底上为 **3.67:1**；浅色 `--ws-text-tertiary #6A727C` 在 `--ws-raised #F3F4F6` 上为 **4.43:1**。四者都低于 4.5:1。v1 又禁止改全局 `:root`，按原文实现必然违反自己的 §7.2 第 5 门 | 评审时用 WCAG 相对亮度公式计算 | §3.10 新增 `--ws-primary-solid` / `--ws-on-primary` 并重定 `--ws-danger`、浅色 tertiary；实心主色按钮与编号徽标改用这组 token |
| RV-09 | 完整性 | 保存失败的「点击重试」只写了「调用 flush」。`useProjectAutosave` 返回 `void`，并已有自己的 3s 退避重试（`retryWaitRef` / `endRetryWait`）。在退避中直接再 `flush()` 会和在途的重试并发，产生两次 PUT | `useProjectAutosave.ts:70-72`、`:83-87` | §3.2「保存状态」写明 `retryNow()` 的精确语义；§4 |

### P2（建议项；标 ✅ 的已写进正文，其余留给实现者）

| # | 问题 | 处理 |
|---|---|---|
| RV-10 ✅ | R8（改名与自动保存并发覆盖）已核实不成立：后端 `update_project` 逐字段 `is not None` 才写，自动保存只发 `{project_data}`，改名只发 `{name}` | §8 R8 改为「已核实关闭」 |
| RV-11 ✅ | `ScriptSegment.duration` 注释为「预留给未来的时长信息」，多数段落没有值，卡片时长会大面积空白 | §3.5.2 时长改为按 `segment.duration → 时间范围 → 配音 total_duration` 回退 |
| RV-12 ✅ | `useEditorFocusStore.reset()` 在切项目时会把 `followPlayback` / `rightPanelTab` 这两个持久化偏好一起重置，与 §6.2 冲突；两处都写 localStorage 也有归属歧义 | §3.4.1、§6.2：偏好只由 `useWorkbenchLayout` 持久化，`reset()` 只清选择 |
| RV-13 ✅ | 现有 `playerConsole.layout.test.tsx` 断言两行控制台结构，单行播放条会让它失败，v1 的测试清单没点名 | §7.1 补一行 |
| RV-14 ✅ | 导出 hook 的函数名是 `handleExport` 不是 `exportVideo`；上移后必须删除 `VideoPlayerPanel` 内的实例，否则两个 `useVideoExport` 会同时轮询同一导出会话 | §2.3、§3.2「状态上移」 |
| RV-15 ✅ | `VideoEditingInterface` 净增行数 ≤ 0 的规模门偏乐观（它已有 2380 行，上移导出、焦点同步和快捷键都要加代码） | §4：导出接线和快捷键抽成 `useEditorExportWiring` / `useWorkbenchShortcuts` 两个 hook，规模门保留 |
| RV-16 | Agent 生成的段落 id 是位置式的（`agent-segment-0`），重新生成脚本后，旧素材的 `metadata.segment_id` 会挂到新段落上。画面「已配置」和「已用于第 N 段」可能误判 | 实现时对画面关联同样优先看 `segment_text_hash`（有则比对），无则沿用 id；列入 R5 |
| RV-17 | 编辑器左侧已有应用级 `VerticalTaskbar`，再加 44px `ToolWindowRail` 会出现两条竖向导航条并排 | 实现时两者之间用 `--ws-bg` 缝隙和不同底色区分；若视觉走查觉得冗余，Iteration 2 再评估合并，本轮不改 `VerticalTaskbar` |
| RV-18 | `Alt+1/2/A`：Electron 下 Alt 键可能唤出菜单栏或触发菜单加速键 | 实现时先核对 `desktop/main` 的菜单配置；有冲突就改用 `Ctrl+Alt+1/2/A`，并同步 i18n 提示 |
| RV-19 | Esc 在多处有含义（抽屉、浮层栏、素材搜索、段落卡收起、项目名编辑），v1 没有定义优先级 | 实现时按「最内层焦点所在组件先消费并 `stopPropagation`」处理；浮层栏与抽屉只在焦点在自身内部时响应 |
| RV-20 | 抽屉高度 = 上半区高度。剪辑布局 + 800px 窗口时抽屉可能不足 320px，聊天区很挤 | 由 RV-05 的上半区最小高度（≥ 320px）兜底；实现时再做走查 |
| RV-21 | `getMockScriptSegments(locale)` 在无脚本时充当占位段落，派生层会给它们算出「画面未配置 / 未生成配音」芯片 | 实现时 mock 段落不渲染状态芯片与试听按钮（沿用现有 mock 判定），空态文案引导「生成初稿」 |

### 一致性核对（无问题项，记录备查）

- CLAUDE.md「`Container` 空状态和任务栏『新建任务』是唯一建任务入口，不得删除」：本方案不改 `VerticalTaskbar` / `Container`，✔。
- 「预览只走多轨 canvas 合成器」：方案只改 `computeContainBox` 的触发源（实测已由 `videoContainerRef` 上的 ResizeObserver 驱动，`VideoPlayerPanel.tsx:340-356`，无需补），✔。
- 「无鉴权」：改名复用 `updateVideoProject`，`http-client` 不带凭证，✔。
- 「颜色走 CSS 变量、class 暗色模式」：`<html>` 默认带 `dark`，切换时 `replace('dark','light')`（`src/app/layout.tsx:21-25`），因此 `.light .editor-workbench` 选择器可行，✔。
- `color-mix()`：Electron 33（Chromium 130）支持，✔。
- `useTimelineStore` 确有 `canUndo` / `canRedo` / `canTravelHistory`（`historySlice.ts`）；`asyncTaskSlice` 的状态枚举与 v1 一致；`pauseFromTimeline`、`dragSlice.dragPreview`、`shouldTimelineHandleKeyEvent`、`resolveGlobalSpaceAction` 均存在，✔。

---

## 0. 一页结论（给赶时间的实现者）

1. **布局**：编辑页改为「顶栏（全局操作）＋ 工具窗口条 ＋ 左 320 / 中自适应 / 右 300 三栏 ＋ 可拖高时间轴」。三栏和时间轴高度都可拖动、可折叠、可一键切换「脚本布局 / 剪辑布局」两个预设，偏好存 localStorage。
2. **顶栏**：项目名（可就地改名）、最后修改时间、带图标的三态保存状态、撤销/重做、任务中心、AI 助手、**导出视频（固定右上角）**。原 `VideoEditorContainer` 的 36px 条和播放器头部的导出按钮都并入顶栏。
3. **段落是一级对象**：新增一个不持久化的 UI 焦点仓库 `useEditorFocusStore`（当前段落、跟随播放、右栏页签），以及一组**只读派生**纯函数 `segmentLinks.ts`，用现有字段（`sentenceSegments.segment_id`、素材 `metadata.segment_id`、`segment_text_hash`）把「段落 ↔ 时间轴片段 ↔ 素材」连起来。**不新增任何持久化字段。**
4. **左栏**：解说脚本 tab 的段落卡重做成设计图样式：编号、标题、时长、缩略图、解说文字、状态芯片（画面 / 配音 / 字幕，含「待更新」）、常驻「试听 / 更换画面 / ⋯」。删除移进 ⋯ 菜单。未选中紧凑，选中展开。
5. **中栏**：只留画面 ＋ 一行紧凑播放条；比例与封面收进「画布」下拉；标注「成片预览」；播放条的时间与时间轴播放头**同源**。
6. **右栏**：固定「素材 | 属性」双页签。素材页：一级分类收成「全部 / 视频 / 音频 / 图片 / 素材包」，新增本地搜索，视频和图片用 2 列大缩略图卡，音频用紧凑列表，技术参数移到属性页。属性页是**只读为主的检查器**，按钮直接调用现有编辑入口。
7. **时间轴**：片段主标签改为「01 丝滑亮相」（文件名移到悬停提示），轨道默认名改为「主画面 / 旁白 / 音频 / 字幕」，拖动和裁切时实时显示时间标签，撤销/重做按钮上移到顶栏（快捷键不变）。
8. **AI 助手**：删掉右下角可拖动悬浮球，改为顶栏「AI 助手」按钮打开的右侧抽屉。抽屉只覆盖上半区，**不遮挡时间轴**，并显示当前上下文「正在协助：第 2 段 · 活泼天性」。
9. **不影响功能**：§2.3 列出每个既有入口的新位置，作为实现和验收的逐条对照表。
10. **v2 评审修订要点**：段落派生只在 `VideoEditingInterface` 算一次、经 `SegmentLinksContext` 下发（RV-01）；新增「新配音未上时间轴」状态，不再在时间轴仍是旧配音时显示「配音已生成」（RV-02）；任务中心同时统计手动逐段配音（RV-03）；轨道默认名保持单一函数，三个调用方同步（RV-04）；三栏空间求解（RV-05）；播放条时间用独立纯函数，不动播放句柄（RV-06）；段落卡改用 list + 卡头按钮（RV-07）；工作台作用域新增实心主色与危险色 token 以满足 4.5:1（RV-08）；保存失败重试不会并发 PUT（RV-09）。

---

## 1. 概述 Overview

Ecliptrix 的视频编辑页已经具备脚本、素材、预览、时间轴、AI 生成、Agent 对话等完整能力，但界面没有清楚回答四个问题：**我正在编辑哪一段？这些素材属于哪一段？这个按钮会影响什么？下一步该做什么？** 代码勘察确认了建议中的大多数判断：

- 左栏 `ScriptPanel` 有「解说脚本 / AI视频脚本 / AI分镜」三个 tab，解说段落内部还有一个同样叫「AI视频脚本」的折叠项（`ScriptPanel.tsx:2288-2301` 复用了 `t.scriptPanel.tabs.aiVideoScript`），概念重名。
- 段落卡头部排着 4 个图标按钮（转语音 / 在线搜视频 / AI 匹配 / 删除），删除按钮常驻红色描边（`ScriptPanel.tsx:2205`），视觉权重高于创作操作。
- 右栏 `MaterialsPanel` 有 8 个横向滚动分类（`MaterialsPanel.tsx:1905-1935`），三列小卡上挤满状态角标、类型徽标、分析按钮、剪切 / 去水印 / 下载 / 预览条、文件名、分辨率、格式；单击视频或图片卡没有反应（`:882-884`），也没有本地搜索框。
- 导出按钮在播放器头部（`VideoPlayerPanel.tsx:461-516`），看上去属于播放器；撤销 / 重做在时间轴工具栏（`TimelineToolbar.tsx:196-231`）；项目名和保存状态在编辑器外层一条 36px 的 `text-xs` 条里（`VideoEditorContainer.tsx:302-350`）。全局操作分散在三处。
- 右下角 56px 的 Agent 悬浮球（`.agent-chat-fab`，`video-editing.css:1404`）压在时间轴区域上。
- 三栏固定为 25/50/25、上下固定为 70/30（`video-editing.css:11-42`），没有分隔条，窗口变窄只能挤压内容。
- 播放器控制台时间取自组件内的 `compositionCurrentTime`（`VideoPlayerPanel.tsx:127-136`），时间轴取 `timelineCurrentTime`，两者经回声抑制同步。恢复工程时出现过「播放器 0:00、播放头 0:03」的不一致，需要统一显示源。
- 目前没有属性面板（全仓无 Inspector / Properties 组件），参数编辑分散在双击、弹窗和轨道头弹层中。

本方案把编辑页重组为**以「视频段落」为核心的 AI 创作工作台**：顶栏只放全局操作；左栏回答「这条视频准备怎么讲」；中栏回答「最终会看到什么」；右栏的「素材 | 属性」回答「用什么、改什么」；时间轴回答「什么时候出现」。四个区域用**同一套段落编号、标题、选中高亮**串起来。按建议中「第一轮不要继续加功能，先理顺已有功能的关系」的原则，本轮（Iteration 1）**只重排、重命名、重组和派生展示已有能力**：所有新增视觉状态都从现有数据只读派生，所有按钮都调用现有处理函数。需要新增数据字段或新业务流程的内容（本段音色覆盖、配音时长变化决策、画布填充模式、拖放替换段落画面、段落整体撤销）列为 Iteration 2，见 §10。

视觉上延续现有深色 ＋ 蓝色强调（`--primary #0D99FF`）的品牌方向，按本体约束采用 PyCharm 式「工具窗口」语言：面板有统一的 36px 标题栏、可折叠可拖宽、少框套框、用底色层级和间距组织信息、控件热区不小于 32px、状态不只靠颜色表达。

---

## 2. 范围、非目标与功能保全

### 2.1 本轮范围（Iteration 1，全部为前端）

| 编号 | 内容 | 优先级 |
|---|---|---|
| W1 | 工作台布局：顶栏、工具窗口条、可拖宽三栏、可拖高时间轴、折叠、布局预设、响应式自动收起、localStorage 偏好 | P0 |
| W2 | 编辑器顶栏 `EditorTopBar`：项目名就地改名、保存三态、撤销重做、任务中心、AI 助手、导出 | P0 |
| W3 | 段落焦点模型 `useEditorFocusStore` ＋ 派生函数 `segmentLinks.ts`；四区联动高亮 | P0 |
| W4 | 左栏段落卡重做（抽出 `SegmentCard.tsx`）、状态芯片、试听、⋯ 菜单、全片默认音色条、跟随播放 | P1 |
| W5 | 中栏：紧凑播放条、「画布」下拉（比例＋封面）、「成片预览」标注、播放时间单一来源 | P0 |
| W6 | 右栏：「素材 | 属性」页签；素材页分类收敛、本地搜索、卡片重做（抽出 `MaterialCard.tsx` / `AudioMaterialRow.tsx`）；属性页 `InspectorPanel` | P1 |
| W7 | 时间轴：段落标签、轨道默认名、拖动 / 裁切实时时间标签、撤销重做上移 | P1 |
| W8 | AI 助手：悬浮球改为顶栏按钮 ＋ 右侧抽屉，显示上下文段落 | P0 |
| W9 | 视觉 token（`--ws-*`）、字号、热区、焦点环、状态样式统一 | P0 |

### 2.2 非目标（本轮明确不做）

- 不新增持久化字段（`ScriptSegment` / `TimelineItem` / `MaterialItem` 结构不变），不改 `project_data` 形状，不写迁移。
- 不做「保持完整 / 填满画布 / 背景填充」画布适配模式。它必须和后端导出保持一致（预览与导出一致是 round 3 的硬约束），因此属于功能变更，放到 Iteration 2。「画布」下拉里只放已有的比例和封面。
- 不做「本段音色覆盖」「配音时长变化三选一」「拖放到段落卡替换画面」「段落整体撤销」「批量补齐缺失内容」「导出前检查」「轨道重命名」「空轨折叠」。
- 不新增「模板」入口（设计图左侧导航有「模板」「AI工具」，但产品里没有对应功能；新增空入口违反「不加功能」原则）。
- 不改 `VerticalTaskbar`、`AppTitleBar`（应用级外壳）和设置页。

### 2.3 功能保全对照表（实现与验收逐条勾选）

| 既有入口（现位置） | 新位置 | 调用的处理函数（不变） |
|---|---|---|
| 返回项目列表（`VideoEditorContainer:303`） | 顶栏左侧「‹ 返回项目列表」 | `onCloseProject` |
| 项目名、最后修改时间（`:313-323`） | 顶栏面包屑（项目名可就地改名） | 改名：`updateVideoProject(projectId,{name})`（项目列表已使用的同一 API） |
| 恢复 / 丢弃备份（`:324-344`） | 顶栏保存状态左侧的琥珀色「发现备份」芯片 → 弹出两个按钮 | 同一 `setBackupDialog` + `ConfirmationDialog` |
| 保存状态文字（`:345-349`） | 顶栏保存状态（图标＋文字，`aria-live`） | `saveStatus` |
| 导出视频（`VideoPlayerPanel:461-516`）＋ `VideoExportProgressModal` | 顶栏最右主按钮；进度弹窗随之上移 | `useVideoExport(...).handleExport`（上移到 `VideoEditingInterface` 调用；原 `VideoPlayerPanel` 内的实例删除，全页只保留一个） |
| 撤销 / 重做按钮（`TimelineToolbar:196-205`） | 顶栏 | `useTimelineStore` 的 `undo` / `redo` / `canUndo` / `canRedo` |
| Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z（`TimelinePanel:608-627`） | 不变 | 不变 |
| 整理素材（`TimelineToolbar:~220`） | 保留在时间轴工具栏 | 不变 |
| Agent 悬浮球 + 浮窗（`AgentChatDock`） | 顶栏「AI 助手」按钮 + 右侧抽屉 | `isAgentDockOpen` / `VideoChatWindow` props 不变 |
| Agent 撤销全部 / 撤销单步 | 抽屉内的消息气泡（不变） | `onUndoAll` / `onUndoSingle` |
| AI 生成下拉（解说直接生成 / 视频理解生成 / 统一转换所有语音） | 左栏标题栏右侧（不变，改为「生成初稿 ▾」外观） | `AiGenerateMenu` props 不变 |
| 段落「转换语音」图标（`ScriptPanel:2114`） | 段落卡 ⋯ 菜单「生成本段配音 / 重新生成本段配音」；配音待更新时在卡片上显示「更新本段配音」提示按钮 | `handleConvertToSpeech(segment)` |
| 段落「在线搜索视频」（`:2133`） | 段落卡常驻「更换画面」 | `handleOpenVideoSearch(segment.id)`（禁用条件 `completedSegments` 不变，禁用时显示原因提示） |
| 段落「AI 匹配视频」（`:2156`） | ⋯ 菜单「为本段找画面（AI 匹配）」 | `handleAIMatchVideos(segment.id)` |
| 段落删除（`:2205`，含确认框） | ⋯ 菜单最后一项「删除段落」（危险色只出现在菜单项上），确认框不变 | `handleDeleteSegment` |
| 解说就地编辑（`:2235-2285`） | 选中展开态中的解说区（不变） | `handleSaveNarrationEdit` |
| 段内「AI视频脚本 (n)」折叠（`:2288`） | 改名「画面描述 (n)」，只在选中展开态显示 | 同一 `expandedScriptSegments` |
| 句子行（编辑 / 删除 / AI视频 / 重新生成 / 添加句子） | 选中展开态中，原样保留 | 不变 |
| 绑定视频轮播（`:2517-2751`） | 选中展开态；未选中时卡片显示第一帧缩略图 | 不变 |
| 音色选择（`:2761-2769`） | 左栏底部「全片默认音色：{名称}　更换」，点击「更换」打开原 `VoiceSelector`（Popover） | `selectedVoiceId` / `onVoiceChange` 不变 |
| AI视频脚本 tab / AI分镜 tab | 标题栏下的分段控件（名称不变） | 组件不变 |
| 素材卡：+添加到时间轴 / 删除 / 预览 / 剪切 / 去水印 / 下载 / AI分析 / 转视频 / 重试下载 / 音频播放 / 字幕下载 | 卡片悬停「+ 添加」＋ ⋯ 菜单（其余全部）；音频播放移到行首播放键；各种状态遮罩原样保留 | 原处理函数不变 |
| 分类：分镜包 / 人物包 / 场景包 / 帧包 | 「素材包」一级分类下的二级芯片 | 原过滤值不变 |
| AI 创建分镜包 | 「素材包 › 分镜包」视图顶部 | 不变 |
| 素材库下拉（搜索视频 / 音频 / 图片、上传、我的素材） | 素材页搜索框右侧「⊕ 添加素材 ▾」 | `onSearchVideos` / `onSearchAudios` / `onSearchImages` 等 |
| 拖拽素材到时间轴 / 拖文件上传 | 不变 | 不变 |
| 比例 5 项 + 封面（`VideoPlayerPanel:722-754`） | 播放器标题栏「画布 16:9 ▾」下拉 | `handleAspectRatioChange`（状态上移为受控） / `CoverButton` |
| 空格播放、逐帧等时间轴快捷键 | 不变（新增输入框同样受 `resolveGlobalSpaceAction` 保护） | 不变 |
| 运镜（双击视频片段 / 工具栏 Motion） | 不变；属性页多一个「运镜…」按钮 | 同一打开函数 |
| 字幕编辑（双击字幕 / 轨道头 / SubtitleEditModal） | 不变；属性页多一个文本框 ＋「字幕样式…」 | `updateItemFields`（`UPDATE_ITEM`，可撤销） / 同一弹窗 |
| 轨道音量 / 静音 / 锁定 / 隐藏 / 删除轨 / 添加轨 | 不变；选中音频片段时属性页嵌入同一 `VolumeSlider` | 不变 |

**硬约束**：实现结束时，以上每一行都必须能在新界面找到并成功触发（§7.3 手工验收逐条勾）。

---

## 3. 技术设计 Technical Design

### 3.1 工作台布局架构

新增纯布局组件 `EditorWorkbench.tsx`，通过 slot props 接收各区内容，不持有业务状态。`VideoEditingInterface` 把现有 `:2092-2204` 的 JSX 布局替换成 `<EditorWorkbench … />`，hooks 和弹窗一律不动。

```
.editor-workbench                         flex col; h-full; bg var(--ws-bg)
├─ EditorTopBar                           h 48px; flex-shrink 0
└─ .ws-body                               flex row; flex 1; min-h 0
   ├─ ToolWindowRail                      w 44px（PyCharm 工具窗口条）
   └─ .ws-main                            flex col; flex 1; min-w 0; position relative
      ├─ .ws-upper                        flex row; flex 1; min-h 0; gap 1px（缝隙显出 --ws-bg，代替边框）
      │  ├─ .ws-left   width: var(--ws-left-w)   [280..480]  → ScriptPanel
      │  ├─ PanelSplitter orientation="vertical"  id="left"
      │  ├─ .ws-center flex 1; min-w 420px       → VideoPlayerPanel
      │  ├─ PanelSplitter orientation="vertical"  id="right"
      │  └─ .ws-right  width: var(--ws-right-w)  [280..440]  → RightPanel(素材|属性)
      ├─ PanelSplitter orientation="horizontal" id="timeline"
      ├─ .ws-timeline height: var(--ws-timeline-h) [160 .. 0.6×ws-main 高度] → TimelinePanel（inert/遮罩逻辑原样）
      └─ AssistantDrawer（absolute; top 0; right 0; bottom = var(--ws-timeline-h)+4px; width 400px）
```

**尺寸默认值**（设计图约 1600px 宽）：左 320、右 300、时间轴 260。

**布局预设**（工具窗口条底部「布局」按钮 → 菜单，另有快捷键 `Alt+1` / `Alt+2`，仅在焦点不在可编辑元素时生效）：

| 预设 | 左 | 右 | 时间轴 | 说明 |
|---|---|---|---|---|
| `script`「脚本布局」 | 400 | 300 | 200 | 给文案更多空间 |
| `edit`「剪辑布局」 | 300 | 300 | 360 | 给时间轴更多空间 |

切换预设只写这三个尺寸和两个折叠标记，**不切换任何编辑状态和组件实例**（两者共用同一工程）。用户手动拖动后，`preset` 变成 `custom`。

**响应式自动收起**（`ResizeObserver` 观察 `.ws-main` 宽度 `W`）：
- `W < 1180`：右栏 `autoCollapsed=true`。
- `W < 960`：左栏也 `autoCollapsed=true`。
- 实际折叠状态 `effectiveCollapsed = userCollapsed || autoCollapsed`，自动收起**不覆盖**用户偏好。
- 自动收起期间点击工具窗口条对应按钮，会让该栏以**浮层**方式（`position:absolute`、`box-shadow: var(--shadow-lg)`、宽度取偏好值）盖在中栏上。点击浮层外或按 Esc 关闭。
- 文字和按钮尺寸不随窗口缩放。
- 桌面端 BrowserWindow 已设 `minWidth: 1024`（`desktop/main/window.js:102`），`.ws-main` 实际最小约 980px，所以桌面端只会触发右栏自动收起；左栏阈值 960 只在浏览器调试路径下生效。

**空间分配求解（v2 新增，RV-05）**：用户偏好宽度只是「期望值」，实际宽度由纯函数 `resolvePanelSizes(prefs, W, H)`（放在 `layoutPrefs.ts`，单测覆盖）每次按容器尺寸求出：
1. 常量：`CENTER_MIN = 420`，分隔条每条 8px，`UPPER_MIN = 320`（上半区最小高度，保证播放器和抽屉可用）。
2. 可给侧栏的宽度 `avail = W − CENTER_MIN − 已展开侧栏数 × 8`。
3. 如果 `left + right ≤ avail`，就按偏好值。否则两侧按各自「超出最小值的部分」等比收缩，但不低于各自最小值 280。
4. 如果两侧都已到 280 仍放不下，就把右栏标记为 `autoCollapsed`（与上面的阈值规则取并集），再按 1–3 重算。
5. 时间轴实际高度 `min(pref, H − UPPER_MIN − 8, 0.6 × H)`，下限 160。窗口过矮、连 160 都放不下时，保 `UPPER_MIN`，时间轴取剩余高度，不出现页面级滚动条。
6. 求解结果只写 CSS 变量（`--ws-left-w` / `--ws-right-w` / `--ws-timeline-h`），**不回写偏好**：窗口放大后会恢复用户原来的宽度。

**`PanelSplitter` 行为**：
- 4px 可视线、8px 热区，`role="separator"`，带 `aria-orientation` / `aria-valuenow` / `aria-valuemin` / `aria-valuemax` / `aria-controls`，可 Tab 聚焦，焦点环 `--ring`。
- 键盘：方向键 ±16px，Shift+方向键 ±64px，Home/End 到最小/最大，Enter 或双击恢复当前预设值。
- 拖动：`setPointerCapture`；拖动过程中用 rAF 节流**直接写 `.editor-workbench` 上的 CSS 变量**（不触发 React 重渲染，避免 2380 行编排组件和合成器重渲）；`pointerup` 时提交到 `useWorkbenchLayout` 状态并持久化。拖动期间给 body 加 `ws-resizing` 类（`cursor` + `user-select:none`）。
- 播放器画布已由 `computeContainBox` 按容器尺寸计算（`VideoPlayerPanel.tsx:171-174`），容器尺寸来自 `videoContainerRef` 上的 `ResizeObserver`（`:340-356`，评审已核实），分隔条改变尺寸时会自动重算。**本方案不碰任何播放器几何代码。**

**持久化**：`localStorage['ecliptrix-editor-layout-v1']`（结构见 §6.2）。所有读写都放在 try/catch 里，读取时校验并 clamp，解析失败就用默认值。这属于每位用户自己的便利设置，不写入 `project_data`。

### 3.2 编辑器顶栏 `EditorTopBar`

从左到右（高 48px，`bg var(--ws-panel)`，底部 1px `--ws-border-subtle`）：

```
[‹ 返回项目列表] › [项目名(可编辑)]  最近修改 09:13:53  [● 已保存]   ……flex……   [↶ 撤销][↷ 重做] | [⟳ 任务 2] [✦ AI 助手] [⇪ 导出视频]
```

- **面包屑**：「‹ 返回项目列表」是 32px 高的幽灵按钮。项目名用 14px semibold。
- **项目名就地改名**：点击或按 Enter/F2 进入 `<input>`（最长 100 字符）。Enter 或失焦提交，Esc 取消。空值或纯空格回滚为原值，不提交。提交时调用 `onRenameProject(name)`，由 `VideoEditorContainer` 实现（`updateVideoProject` → 更新 `projectMeta.name`）。提交中显示内联 spinner；失败时回滚并 `showError`。输入框聚焦期间，空格和字母快捷键不能触发时间轴（`shortcutOwnership` 对 `input` 已让路，§7 用回归测试钉住）。
- **保存状态**：固定宽度 96px，避免文字切换导致布局跳动。
  - `saving`：旋转图标 + 「保存中…」
  - `saved`：绿色勾 + 「已保存」，`title` 为保存时刻
  - `error`：红色警示图标 + 「保存失败」，可点击，点击后立即重试一次。`useProjectAutosave` 目前返回 `void`，并且自带 3s 退避重试（`retryWaitRef` / `endRetryWait`）。v2 规定只新增一个返回值 `{ retryNow(): void }`，语义为：**如果正处于重试退避中，就调用 `endRetryWait` 让排队的那次重试立刻执行；否则如果没有在途保存，就调用 `flush.current()`；如果已有在途保存，就只置 `dirtyRef`，等它结束后自动再保存。** 这样同一时刻最多只有一个 PUT（RV-09）。新增测试 `retry_now_during_backoff_does_not_double_put`。
  - `idle`：「未修改」（灰色）
  - 保存状态**只反映工程持久化**。AI 生成完成的通知不写进这里（对应建议中「不要把工程保存成功和 AI 生成完成混为一谈」）。
- **备份芯片**：`recoveryBackup` 存在时，在保存状态左侧显示琥珀色芯片「发现未恢复的备份」，点击弹出 Popover，里面是「恢复」「丢弃」两个按钮，沿用原 `ConfirmationDialog`。
- **撤销 / 重做**：两个带文字的 32px 按钮（窄于 1280px 时只留图标，`title`/`aria-label` 带快捷键「撤销 (Ctrl+Z)」）。订阅 `useTimelineStore(s => s.canUndo)` / `canRedo`。时间轴编辑锁（`externalEditLock==='agent'`）或拖拽中时禁用，与 `canTravelHistory` 条件一致，禁用提示「AI 助手执行中，暂不能撤销」。
- **任务中心**：`TaskCenterButton`。v1 只数 `asyncTaskSlice`，但全仓只有 Agent（`AgentEventRouter.ts:333`）往里登记任务，用户手动发起的逐段配音不在其中（RV-03）。v2 聚合**三个只读来源**，由纯函数 `collectActiveTasks(...)` 合并（单测覆盖）：
  1. `asyncTaskSlice.tasks` 中 `status ∈ {pending, processing}` 的任务（Agent 发起的 AI 视频、图片、TTS 等）；
  2. `useEditorFocusStore.convertingSegmentIds`，即 ScriptPanel 正在转换的段落。ScriptPanel 在 `convertingSegments` 变化时用一个 `useEffect` 把它**镜像**过去（只读镜像，不改原 state 的归属）；每段显示为「第 2 段配音 · 生成中」和原 `ttsProgress`；
  3. 导出进行中（1 或 0）。

  数量为 0 时显示「任务」，不显示数字。点击打开 Popover，按来源列出任务：类型中文名（`ai_video`「AI 视频」、`tts`「配音」…）、进度条、失败原因（`error` 原文，经 `sanitizeError`），以及最近 30 分钟已完成或失败的 Agent 任务（slice 自带过期清理）。ScriptPanel 里的 AI 视频脚本、分镜视频等面板内任务，本轮仍只在原面板显示，Iteration 2 统一登记（见 §10）。**本轮只展示，不新增取消能力**；已有取消入口（AI 视频脚本的取消、导出取消）保留在原位置。
- **AI 助手**：切换 `isAgentDockOpen`。按钮 `aria-pressed`；Agent 执行中在图标右上角显示脉动点，并把 `title` 改为「AI 助手执行中…」。
- **导出视频**：实心主按钮（`--ws-primary-solid` 底，见 §3.10），固定在最右。禁用条件与原来一致（时间轴无 track 时隐藏改为**禁用＋提示「时间轴为空，先添加素材」**。这只是展示差异，不改导出逻辑）。导出中显示「导出中 42%」和进度环，点击打开 `VideoExportProgressModal`。按钮文字不再带比例，比例显示在中栏「画布」入口。

**状态上移**：`useVideoExport` 需要 `timelineState`、`materials`、`projectId`、`aspectRatio`。前三者在 `VideoEditingInterface` 已有。把 `selectedAspectRatioId` 状态从 `VideoPlayerPanel.tsx:139` 上移到 `VideoEditingInterface`，改为 `VideoPlayerPanel` 的受控 props（`aspectRatioId` / `onAspectRatioChange`）。`useVideoExport` 和 `VideoExportProgressModal` 随之上移到 `VideoEditingInterface`。比例仍然**不持久化**（保持现状）。**同一时刻全页只允许一个 `useVideoExport` 实例**：上移时必须删除 `VideoPlayerPanel.tsx:~370-395` 的调用，否则两个实例会同时恢复和轮询同一导出会话（RV-14）。导出按钮调用的是 `handleExport`（v1 误写为 `exportVideo`），外面包一层原 `handleVideoExport` 的日志。`VideoPlayerPanel` 里的 `CoverModal` 仍然读受控的 `aspectRatioId`。新增测试 `export_uses_selected_aspect_ratio`（见 R2）。导出接线放进新 hook `useEditorExportWiring`，不堆在 `VideoEditingInterface` 里（RV-15）。

**项目元信息下传**：`VideoEditorContainer` 删除 36px 顶条，改为给 `VideoEditingInterface` 传新 prop `projectChrome: EditorProjectChrome`（§5.1），由 `VideoEditingInterface` 渲染 `EditorTopBar`。备份相关的 `ConfirmationDialog` 仍留在 `VideoEditorContainer`，通过 `projectChrome.onRequestRestoreBackup / onRequestDiscardBackup` 回调打开。

### 3.3 工具窗口条 `ToolWindowRail`

44px 宽的竖条，放在编辑区最左侧，对应设计图左侧导航和 PyCharm 工具窗口条。只放**已有能力**：

| 按钮 | 行为 |
|---|---|
| 脚本 | 切换左栏折叠（自动收起时以浮层打开） |
| 素材 | 打开右栏并切到「素材」页签；如果已在素材页且右栏展开，再点一次折叠右栏 |
| 属性 | 同上，对应「属性」页签 |
| AI 助手 | 同顶栏按钮（两处状态一致） |
| （底部）布局 | 菜单：脚本布局 / 剪辑布局 / 重置布局 |

- 按钮 44×44，图标 20px（lucide-react，线宽 1.75），下面是 11px 标签。设计图中标签字号偏小；此处 11px 标签只作辅助识别，每个按钮还带 `aria-label` 和 `title`。
- 当前展开的工具窗口：左侧 2px 主色竖条，背景 `--ws-selected-bg`。

### 3.4 段落焦点模型（四区联动的核心）

**原则**：段落是**视图概念**，不引入新的数据源。所有「属于哪一段」都从现有字段只读派生，因此不存在「三套数据互相猜测着同步」。

#### 3.4.1 UI 焦点仓库 `useEditorFocusStore`（新增，zustand，不持久化进工程）

```ts
interface EditorFocusState {
  selectedSegmentId: string | null;
  selectionSource: 'script' | 'timeline' | 'material' | null;
  followPlayback: boolean;            // 默认 false；初值由 useWorkbenchLayout 从 localStorage 注入
  rightPanelTab: 'materials' | 'properties'; // 只由用户点击页签或工具窗口条改变；初值同上
  selectedMaterialId: string | null;  // 素材页单击选中
  convertingSegmentIds: ReadonlySet<string>; // v2：ScriptPanel convertingSegments 的只读镜像（RV-03）
  selectSegment(id: string | null, source: EditorFocusState['selectionSource']): void;
  selectMaterial(id: string | null): void;
  setFollowPlayback(on: boolean): void;
  setRightPanelTab(tab: 'materials' | 'properties'): void;
  setConvertingSegmentIds(ids: ReadonlySet<string>): void;
  /** 切换项目时调用：只清 selectedSegmentId / selectionSource / selectedMaterialId /
   *  convertingSegmentIds；followPlayback 与 rightPanelTab 是用户偏好，不重置（RV-12） */
  reset(): void;
}
```

**铁律**：任何「选中」动作都**不能**调用 `setRightPanelTab`。「选中了某段就强制把素材列表切走」是建议中点名禁止的行为。

**偏好持久化归属（v2）**：`followPlayback` 和 `rightPanelTab` 的 localStorage 读写**只由 `useWorkbenchLayout` 负责**。它挂载时把值注入焦点仓库，并订阅这两个字段的变化后写回。焦点仓库本身不碰 localStorage，避免两处写同一个键。

#### 3.4.2 派生函数 `segmentLinks.ts`（新增，纯函数，全部可单测）

放在 `src/components/video/lib/segments/segmentLinks.ts`：

```ts
export interface SegmentIndexEntry { segmentId: string; ordinal: number; title: string; label: string } // label = "01 丝滑亮相"
export function buildSegmentIndex(segments: ScriptSegment[]): Map<string, SegmentIndexEntry>;

/** 片段 → 段落。优先级：item.sentenceSegments?.segment_id
 *  → materialsById.get(item.materialId)?.metadata?.segment_id
 *  → metadata.linkedSegmentId → null。只读，不写回。 */
export function resolveItemSegmentId(item: TimelineItem, materialsById: Map<string, MaterialItem>): string | null;

export function collectSegmentItemIds(tracks: Track[], materialsById: Map<string, MaterialItem>, segmentId: string): string[];

/** 段落在时间轴上的时间范围：优先取关联音频（旁白）片段的 min(start)/max(end)，
 *  其次取关联视频片段；都没有时返回 null。 */
export function computeSegmentTimeRange(tracks: Track[], materialsById: Map<string, MaterialItem>, segmentId: string): { start: number; end: number } | null;

export type VisualStatus = 'configured' | 'missing';
export type VoiceStatus = 'none' | 'generating' | 'ready' | 'stale';
export type SubtitleStatus = 'none' | 'ready';
/** v2（RV-02）：时间轴上本段旁白是否就是最新配音 */
export type VoiceOnTimeline = 'current' | 'outdated' | 'absent';
export interface SegmentStatus {
  visual: VisualStatus; voice: VoiceStatus; voiceOnTimeline: VoiceOnTimeline; subtitle: SubtitleStatus;
}

export function deriveSegmentStatus(input: {
  segment: ScriptSegment;
  materials: MaterialItem[];
  tracks: Track[];
  isConverting: boolean;          // ScriptPanel 现有 convertingSegments.has(segment.id)
}): SegmentStatus;

export function findPlayingSegmentId(ranges: Map<string, { start: number; end: number }>, currentTime: number): string | null;
```

`deriveSegmentStatus` 的规则（单测逐条覆盖）：

- `visual`：`segment.videos?.length > 0`，或者时间轴上存在 `resolveItemSegmentId === segment.id` 的视频/图片片段，则为 `configured`；否则为 `missing`。
- `voice`：
  - `isConverting` 时为 `generating`。
  - 否则找 `type==='audio'` 且 `metadata.segment_id === segment.id` 的素材（多个时取 `metadata.segment_assigned_at` 最新的一个）。没有找到时为 `none`。
  - 找到时，`metadata.segment_text_hash === segmentTextHash(segment)`（复用 `src/components/video/lib/aiMix/segmentTextHash.ts`）为 `ready`，否则为 `stale`。旧素材没有 hash 字段时按 `ready` 处理，与 `planScriptAutoMix.isStaleVoiceOver` 的既有语义保持一致，实现时以该函数为准。
- `voiceOnTimeline`（v2 新增，RV-02）：重新生成配音只会把新素材**加进素材库**（`ScriptPanel.tsx:1413` 起 `onAddMaterial`），不会替换时间轴上的旧旁白。所以「素材库里有新配音」和「时间轴上播的是新配音」必须分开表达：
  - 时间轴上没有 `resolveItemSegmentId === segment.id` 的音频片段 → `absent`；
  - 有这样的片段，且其中任一片段的源素材就是上面选出的最新配音素材（`item.materialId === latest.id`）→ `current`；
  - 否则（时间轴上是旧配音）→ `outdated`。
  - `voice` 为 `none` / `generating` 时，`voiceOnTimeline` 按实际计算，但卡片不单独展示它。
- `subtitle`：`computeSegmentTimeRange` 非空，且任一 `type==='subtitle'` 轨上的片段与该范围重叠（`start < range.end && end > range.start`），则为 `ready`；否则为 `none`。

「失败」状态本轮不派生（数据模型里没有持久化的配音失败状态）。`handleConvertToSpeech` 失败时现有的 toast 保持不变；段落内保留失败原因属于 Iteration 2（需要新增状态）。

**数据来源（v2 修订，RV-01）**：ScriptPanel 吃的段落是 `content?.scriptSegments || getMockScriptSegments(locale)`（`VideoEditingInterface.tsx:2102`），素材是 `materialManagement.allMaterials`（`:2113`）。`useVideoEditingStore.scriptSegmentsData` 是**另一种类型**（`ScriptSegmentData[]`），不能拿来派生。因此：

- `useSegmentLinks({ segments, materials })` **只在 `VideoEditingInterface` 调用一次**，入参就是传给 ScriptPanel / MaterialsPanel 的**同一对值**（先提成局部常量 `editorSegments` / `editorMaterials`，再同时传给面板和 hook，避免两处表达式分叉）。`tracks` 从 `useTimelineStore` 订阅。
- 结果经新增的 `SegmentLinksContext`（`src/components/video/lib/segments/SegmentLinksContext.ts`）下发给 ScriptPanel（卡片）、TimelinePanel（标签和高亮）、RightPanel（「已用于第 N 段」、属性页）和 AI 抽屉（上下文行）。四个区域读的是同一个对象，不存在第二条派生路径。时间轴 v1 的 `SegmentLabelContext` 合并进这个 context。
- mock 段落（无脚本时的占位）不产生状态芯片和试听按钮（RV-21）。

该 hook（`src/components/video/hooks/useSegmentLinks.ts`）用 `useMemo` 缓存 `segmentIndex`、`itemSegmentMap: Map<itemId, segmentId>`、`segmentRanges`、`highlightedItemIds`（当前选中段落关联的片段）。**性能约束**：依赖只包含 `tracks` 引用、`materials` 引用和 `segments` 引用，不能依赖 `currentTime`。`playingSegmentId` 单独用 `findPlayingSegmentId` 计算，只有结果变化时才触发订阅组件重渲。

#### 3.4.3 联动规则（落实建议第三节的交互表）

| 用户操作 | 响应 | 禁止 |
|---|---|---|
| 点击段落卡标题或空白处 | `selectSegment(id,'script')`；卡片展开；时间轴对关联片段画 2px 主色外框 `ws-item-linked`（纯样式，**不改** `selectedItems`）；如果关联片段不在可视范围，时间轴横向滚动到 `range.start`（不移动播放头） | 点击文本、输入框、按钮时触发选中或跳转。判定：`event.target.closest('button,a,input,textarea,select,[contenteditable="true"],[role="menu"]')` 命中时不处理 |
| 段落卡 ⋯ →「定位到时间轴」 | 播放头移到 `range.start`（调用现有 `handleTimelineTimeChange`） | 选中卡片时自动移动播放头 |
| 单选时间轴片段（`selectedItems.length===1`） | 如果能解析出段落，就 `selectSegment(segId,'timeline')`；左栏把该卡 `scrollIntoView({block:'nearest'})`；如果属性页已打开，属性页更新 | 展开多个面板；切换右栏页签；左栏里有正在编辑的输入框时滚动左栏（检测 `document.activeElement` 在左栏且是可编辑元素时跳过滚动） |
| 播放成片 | 包含播放头的段落卡显示「▶ 正在播放」徽标（图标＋文字）；左栏标题栏有「跟随播放」开关，默认关；开启且左栏无编辑焦点时 `scrollIntoView({block:'nearest'})` | 用户编辑文案时自动滚动 |
| 修改某段解说并保存 | 派生规则自动得到 `voice: 'stale'`，芯片显示「配音待更新」（琥珀色＋刷新图标），并出现「更新本段配音」按钮（调用 `handleConvertToSpeech(segment)`，只生成这一段） | 文字已改但仍显示「配音已生成」 |
| 本段新配音已生成，但时间轴仍是旧配音（v2，RV-02） | 芯片显示「新配音未上时间轴」（琥珀色＋图标），悬停说明「素材库已有新配音；时间轴和导出仍使用旧配音。可在时间轴删除旧旁白片段，再从素材页把新配音拖到旁白轨」；卡片 ⋯ 菜单「在素材页中显示新配音」会切到素材页（这是用户显式点击，不违反页签铁律）并选中该素材 | 素材库有了新配音就显示「配音已生成」，让用户误以为导出会用新声音 |
| 素材页单击素材 | `selectMaterial(id)`；卡片选中态；属性页（如已打开）显示素材详情 | 改变工程 |
| 素材页双击素材 / 按 Enter | 打开 `MediaPreviewModal`（标题前缀「素材预览」）；**打开前先暂停成片**（`videoPlayerRef.current?.pauseFromTimeline()`），关闭后不自动恢复播放；素材预览不移动成片播放头 | 素材和成片同时发声 |
| 点击素材卡「+ 添加」或拖到时间轴 | 走现有 `handleAddMaterialToTimeline` / 拖放流程 | — |

### 3.5 左栏：段落与脚本

#### 3.5.1 面板结构

```
┌ 标题栏 36px：「文案 / 脚本」 3 个片段 · 3 句        [跟随播放 ⏵] [生成初稿 ▾]
├ 分段控件：解说脚本 | AI视频脚本 | AI分镜          （原三 tab，名称与键盘导航不变）
├ 段落列表（滚动区，padding 12px，卡片间距 8px）
│   SegmentCard × N
└ 底栏 44px：🎙 全片默认音色：少年梓辛 / Brayan 2.0        [更换]
```

- 「生成初稿 ▾」就是原 `AiGenerateMenu`，只改触发按钮文案和外观（原「AI 生成」→「生成初稿」，带 ✦ 小图标），菜单项不变。按建议统一操作语言：按钮先说做什么，再用小图标表示 AI。
- 「跟随播放」是 `role="switch"` 的小开关，写 `useEditorFocusStore.followPlayback`。
- 全片默认音色底栏：名称来自 `VoiceSelector` 当前选中项的显示名。需要从 `VoiceSelector` 暴露一个 `onVoiceMetaChange?(meta:{id,name})` 回调，或在 ScriptPanel 内按 `getVoiceTypes` 结果查表，实现者二选一，推荐前者：新增一个可选 prop，行为零改动。点击「更换」以 Popover（宽 360px）打开原 `VoiceSelector`。底栏仍然在 TTS 转换中置灰（保持原行为）。文案明确写「全片默认」，对应建议中「全片默认 vs 本段覆盖」的区分；本段覆盖放到 Iteration 2。

#### 3.5.2 `SegmentCard`（从 ScriptPanel 抽出，新文件）

**未选中（紧凑）**，对应设计图卡 2、卡 3：

```
[01] 丝滑亮相                                   ⏱ 8.5s   (▶ 正在播放)
┌缩略图 96×54┐ 看这身如丝般顺滑的毛发，小巧精致，这就是
│           │ 迷你的约克夏梗犬，天生的公寓伴侣。   (line-clamp 3，14px/1.6)
└───────────┘
[✓ 画面已配置] [✓ 配音已生成] [⟳ 字幕待生成]
[▶ 试听]  [⇄ 更换画面]  [⋯]
```

**选中（展开）**：卡片获得 `--ws-selected-bg` 背景和 1px 主色边框，然后依次追加：
1. 解说编辑区（原就地编辑组件）
2. TTS 进度条（原样）
3. 「画面描述 (n)」折叠区，内含句子行（原样）
4. 「+ 添加句子」
5. 绑定视频轮播（原样）

展开和收起只改变该卡高度。展开动画 `grid-template-rows 0fr→1fr` 150ms，并尊重 `prefers-reduced-motion`。

**元素规格**：
- 编号徽标：20×20，圆角 4px，`--ws-primary-solid` 底、`--ws-on-primary` 字（v2，RV-08），12px 粗体，两位数补零（`01`）。与时间轴标签「01 丝滑亮相」完全一致。
- 时长（v2，RV-11）：`ScriptSegment.duration` 在类型里标注为「预留」，多数段落没有值。按以下顺序取第一个有效值：`segment.duration` → `computeSegmentTimeRange` 的 `end − start` → 最新配音素材的 `sentenceSegments.total_duration`。一位小数加「s」；都没有时不显示。
- 缩略图：取 `segment.videos[0]` 的缩略图（复用 `MaterialThumbnail` 组件）。没有画面时显示虚线占位框、图片图标和「未配置画面」，点击占位等同「更换画面」。
- 状态芯片（高 20px，12px 文字，**图标＋文字**，不只靠颜色）：

| 状态 | 文案 | 图标 | 色 token |
|---|---|---|---|
| visual configured / missing | 画面已配置 / 画面未配置 | ✓ / ○ | `--ws-ok` / `--ws-text-tertiary` |
| voice ready 且 voiceOnTimeline ∈ {current, absent} | 配音已生成 | ✓ | `--ws-ok` |
| voice ready 且 voiceOnTimeline = outdated（v2） | 新配音未上时间轴 | ⚠ | `--ws-warn` |
| voice stale | 配音待更新 | ⟳ | `--ws-warn` |
| voice generating | 配音生成中 | spinner | `--primary` |
| voice none | 未生成配音 | ○ | `--ws-text-tertiary` |
| subtitle ready / none | 字幕已生成 / 字幕未生成 | ✓ / ○ | `--ws-ok` / `--ws-text-tertiary` |

- 常驻操作（32px 高、12px 左右内边距、13px 文字，次级按钮样式 `bg --ws-raised`）：
  - 「▶ 试听」：本段有配音素材时可用。播放和暂停在同一个按钮上切换（「❚❚ 停止」）。
  - 「⇄ 更换画面」：调用 `handleOpenVideoSearch(segment.id)`。沿用原禁用条件（尚未完成 TTS），禁用时 `title` 为「先生成本段配音，才能按时长匹配画面」。
  - 「⋯」：`SegmentMoreMenu`，`role="menu"`，菜单项依次为：
    1. 生成本段配音 / 重新生成本段配音
    2. 为本段找画面（AI 匹配）
    3. 定位到时间轴
    4. 在素材页中显示新配音（仅 `voiceOnTimeline = outdated` 时出现，v2）
    5. 分隔线
    6. 删除段落（`--ws-danger` 文字色，见 §3.10）
  - 「配音待更新」时，在常驻操作前额外插入一个主色描边按钮「⟳ 更新本段配音」。
- **删除按钮不再常驻**。原来的红色图标按钮删除。

**试听实现 `useSegmentAudition`**（新 hook，`src/components/video/hooks/useSegmentAudition.ts`）：
- 模块内维护**单例** `HTMLAudioElement`，同一时刻只有一段在试听。
- `play(segment)`：
  1. 按 §3.4.2 的规则找到该段配音素材，用 `selectPlaybackUrl(material,{purpose:'preview'})` 取地址。
  2. 先调用 `videoPlayerRef.current?.pauseFromTimeline()`。
  3. 播放。
- 监听 `useTimelineStore` 的 `isPlaying`：成片开始播放时立即停止试听。组件卸载或项目切换时停止并释放。
- 暴露 `{ auditioningSegmentId, play, stop }`。
- 试听**不移动**成片播放头（这是素材级试听）。
- 播放失败时 `showError(t.segmentCard.auditionFailed)` 并记录日志（带 segmentId，不带 URL 以外的敏感信息）。

**点击选中与编辑隔离**：卡片根元素 `onClick` 按 §3.4.3 判定。

**可访问性结构（v2 修订，RV-07）**：卡片里有按钮、文本框和菜单，不能用 `listbox` / `option`，因为 option 不允许包含可交互子元素，读屏器会把整卡当成一个选项，里面的按钮不可达。改为：
- 列表容器 `role="list"` + `aria-label="段落列表"`，每张卡 `role="listitem"`。
- 卡头「[01] 丝滑亮相」是一个真正的 `<button>`（`aria-expanded` 表示展开，选中卡加 `aria-current="true"`），它是卡片的键盘入口。点击卡头等同点击卡片空白处。
- 卡头按钮用 roving tabindex：列表里只有当前卡的卡头 `tabIndex=0`，其它为 `-1`。焦点在某个卡头上时，↑/↓ 把焦点和选中移到上一张 / 下一张卡头；Enter 展开并把焦点移到解说编辑区；Esc 收起并把焦点还给卡头。
- 这些键盘处理只挂在卡头按钮上，焦点在输入框、菜单等内部控件时不处理。
- 测试：`card_header_is_button_with_aria_expanded`、`arrow_keys_move_between_card_headers`。

### 3.6 中栏：成片预览

```
┌ 标题栏 36px：[▣ 成片预览]  [画布 16:9 ▾]                    [⛶]
├ 预览区（flex 1，画布按 contain-box 居中，信箱底色 #000）
└ 播放条 44px：[▶] 00:03 / 00:25  ━━━━●━━━━━━━━━━━━━━━  [🔊 ━━●━]
```

- 删除原头部的「合成播放 / 预览播放」标题、视频/音频计数芯片和导出按钮（导出已上移）。计数芯片的信息改为画布下拉里的只读行「视频 3 · 音频 2」，信息不丢失。
- **「画布 16:9 ▾」下拉**（`CanvasMenu`）：
  - 比例单选组 16:9 / 9:16 / 4:3 / 1:1 / 21:9，沿用 `buildAspectRatios` 的描述文案。
  - 下方一段说明：「比例决定成片与导出尺寸；画面比例不同时会留边。」如实描述当前唯一的「适应」行为；适配模式在 Iteration 2 加入。
  - 分隔线后是原 `CoverButton`（「封面…」）。
- 播放条合并为一行：播放/暂停 36px 圆钮、`tabular-nums` 时间、进度条（`flex:1`）、音量按钮和音量滑条（宽 80px）。全屏按钮放在标题栏右侧。原 `.player-console` 的两行结构合并为这一行，现有 ARIA（静音 `aria-pressed` 等）原样保留。
- **播放时间单一来源（P0 修复点；v2 精确化，RV-06）**：
  - 新增纯函数 `resolveConsoleTime({ playbackMode, currentTimelineTime, compositionCurrentTime, currentTime, totalDuration })`，放在 `VideoPlayerPanel/consoleTime.ts`，**只供播放条的时间文字和进度条使用**。
  - 规则：非合成模式返回 `currentTime`（与现有 `getCurrentTime` 一致）；合成模式取 `currentTimelineTime ?? compositionCurrentTime`，也就是喂给引擎的同一个值（`VideoPlayerPanel.tsx:181`），并按 `totalDuration > 0` 时 clamp 到 `[0, total]`（与现有 clamp 一致）。
  - **不改** `useCompositionTransport.getCurrentTime` 及命令式句柄 `VideoPlayerPanelRef` 的任何语义，也不改回声抑制、seek 链路和 `onTimeUpdate`。它们被 Agent、时间轴和导出路径依赖。
  - 实施第一步先复现「播放器 0:00、播放头 0:03」（打开一个暂停在 3s 并已保存的工程）。能复现就用上面的函数修；不能复现也照样换成 `resolveConsoleTime`（行为等价且只有一个来源），并在运行日志记录复现结论。
  - 测试：`player_time_matches_restored_playhead`（传入 `currentTimelineTime=3.34`，播放条显示 00:03）、`console_time_clamps_to_total`、`console_time_uses_current_time_outside_composition`。
- 空状态（时间轴无内容）：画布区居中显示「从左侧脚本生成初稿，或从右侧素材拖到时间轴」，并提供一个「打开素材」按钮（切到右栏素材页）。

### 3.7 右栏：「素材 | 属性」

`RightPanel.tsx`（新）：36px 页签栏，两个页签「素材」「属性」，`role="tablist"`，下面是对应面板。两个面板都**保持挂载**，只切换 `hidden`，确保切换页签不丢失素材页的滚动位置、搜索词和展开中的素材包。

#### 3.7.1 素材页（MaterialsPanel 重构）

```
[🔍 搜索素材（名称）                ] [⊕ 添加 ▾]
[全部][视频][音频][图片][素材包]                   ← 5 个一级分类，不再横向滚动
（素材包时）[分镜包][人物包][场景包][帧包] + [✦ AI 创建分镜包]
┌ 视频/图片：2 列网格，卡片宽 ≈ (300-12*2-8)/2 ─┐
│ 缩略图 16:9（大）右下角时长 00:15              │
│ 名称（13px，单行省略）              [⋯]       │
│ [已用于第1段]（主色浅底芯片，可无）              │
└──────────────────────────────────────────────┘
音频：紧凑行 [▶] 名称 / 02:36 ▁▃▅▃▁ 迷你波形  [⋯]
```

- **分类映射**：新增 `primaryFilter: 'all'|'video'|'audio'|'image'|'packs'` 和 `packFilter: 'storyboard_pack'|'character_pack'|'scene_pack'|'frame_pack'`（默认 `storyboard_pack`）。内部仍按原过滤值计算：`packs` 对应原四个 pack 值之一。「全部」下是否显示 pack 卡保持现状（`MaterialsPanel.tsx:2043-2087`）。原 `subtitle` 类型素材在「全部」下显示，与现状一致。
- **本地搜索**：按 `material.name`（以及 `metadata.original_filename`，若存在）大小写不敏感的子串匹配，200ms 防抖。在当前分类内过滤。无结果时显示「没有匹配“xxx”的素材」和「清除搜索」按钮。Esc 清空。输入框受空格快捷键保护。
- **「⊕ 添加 ▾」**：就是原底部「素材库」下拉，菜单项和回调不变（上传、搜索视频/音频/图片、我的素材…），只是移到顶部。
- **视频/图片卡 `MaterialCard`**（新文件）：
  - 保留所有状态遮罩：下载中及进度、等待上传、上传中、AI 生成中、FLUX 生成中、下载失败及重试、等待分析。它们是功能，原样迁移。
  - 常驻：缩略图、时长徽标（右下）、名称、「已用于第 N 段」芯片。N 取 `buildSegmentIndex` 中该素材 `metadata.segment_id` 的 ordinal；取不到时回退到 `metadata.segment_number`。
  - 悬停或键盘聚焦时：右上角「+ 添加」（原 add to timeline）和 ⋯。
  - ⋯ 菜单：预览、AI 分析（显示原四种状态文案）、转视频（图片）、剪切（视频）、去除水印（视频）、下载、分隔线、删除（危险色）。
  - 移到属性页：格式、分辨率、完整文件名、来源、缓存徽标。卡片不再显示这些。
  - 类型徽标只在「全部」分类下以 12px 小图标形式显示在缩略图左上角。
  - 单击 `selectMaterial`（主色 2px 外框）；双击或 Enter 打开预览；拖拽行为不变（`draggable` 条件、`dataTransfer` 负载、拖拽图像全部不变）。
- **音频行 `AudioMaterialRow`**（新文件）：
  - 行高 48px，行首 32px 播放键（原单击卡片的播放/暂停行为改为由此键触发）。
  - 名称、时长、迷你波形：已有波形缓存时复用 `lib/waveform/`，否则显示静态占位。本轮不新增波形计算，避免性能回退。
  - 「已用于第 N 段」、⋯（预览、下载、删除；字幕素材额外有「下载字幕」）。
  - 整行单击 = 选中，双击 = 预览。
- 拖文件到面板上传的虚线遮罩保持不变。

#### 3.7.2 属性页 `InspectorPanel`（新文件，只读为主）

按对象类型渲染，**所有可编辑控件都调用现有 action 或现有打开函数**：

| 选中对象 | 显示 | 可操作（均为现有能力） |
|---|---|---|
| 无 | 空状态：「在时间轴选中一个片段，或在素材页选中一个素材，即可在这里查看和修改属性。」 | — |
| 仅段落（左栏选中，时间轴未选中片段） | 段落编号标题、时间范围、状态芯片、关联片段数 | 「定位到时间轴」 |
| 时间轴视频片段 | 所属段落（「01 丝滑亮相」，可点击选中该段）、轨道名、开始/结束/时长（`formatTimelineTime`）、源素材名、分辨率、格式 | 「运镜…」（打开 CameraMotionModal）；视频片段已有的分离音频能力若在 UI 中有入口，则放同一按钮 |
| 时间轴图片片段 | 同上，加位置信息（`imagePosition` 只读数值） | 「适配画面」（`fitImagePositionAction`）、「运镜…」 |
| 时间轴音频片段 | 所属段落、时长、句子数（`sentenceSegments.sentences.length`）、音色（`metadata.voice_type`，只读） | 嵌入所在轨道的 `VolumeSlider`（轨道级音量，标注「轨道音量」，避免误以为是片段音量）、静音 |
| 时间轴字幕片段 | 时间、文本 | 文本 `<textarea>`：失焦或 Ctrl+Enter 提交 `updateItemFields({text})`（现有、可撤销）；「字幕样式…」（打开 SubtitleEditModal） |
| 多选片段 | 「已选中 N 个片段」、总时长 | — |
| 素材（素材页选中） | 缩略图（大）、完整文件名、类型、时长、分辨率、格式、来源、缓存状态（原 `MaterialCacheBadge`）、「已用于第 N 段」 | 「添加到时间轴」「预览」 |

- 选择优先级：时间轴选中片段 > 素材页选中素材 > 左栏选中段落。最近一次的选择来源（`selectionSource`）决定显示哪一个。
- 编辑锁生效（Agent 执行中）时，所有可编辑控件 `disabled`，并显示「AI 助手执行中，属性暂不可修改」。

### 3.8 时间轴

- **片段主标签**：`TimelineItem` 的标签，在 `itemSegmentMap` 能解析出段落时，显示为「[01] 丝滑亮相」（编号徽标＋标题，与左栏同款）。`title` 和 `aria-label` 改为「01 丝滑亮相 · {原文件名} · {开始}–{结束}」。解析不到时保持现状（`item.name`）。字幕片段仍显示 `item.text || item.name`。
  - 做法（v2 定案）：`TimelineItem` 直接读 §3.4.2 的 `SegmentLinksContext`（`itemSegmentMap`、`segmentIndex`、`highlightedItemIds`），不逐层透传 prop，也不再单独建 `SegmentLabelContext`。
- **关联高亮**：`highlightedItemIds` 中的片段加类 `ws-item-linked`（2px 主色外描边、`z-index` 提升 1），与选中态 `selected`（白色内描边）区分，二者可叠加。
- **轨道默认名**（v2 修订，RV-04）。真实函数是 `trackDisplayName.ts` 的 `deriveTrackDisplayName(track, t)`，它有**三个调用方**：`Track.tsx:122`（显示）、`useTimelineExport.ts:98`（导出 JSON 的轨道名）、`useAIMixedEditing.ts:299`（AI 混剪确认里「将保留的轨道」列表）。`Track.tsx:120` 的注释要求导出 JSON 与 UI 同名。所以 v2 **保持单一函数**，三个调用方同时得到新名字，不另起一个「只给 UI 用」的函数，否则 UI、导出和确认框会出现三种叫法。
  - 仍然只在 `track.name` 为空或纯空白时生效，已有自定义名的轨道不受影响。
  - `TrackLike` 增加可选字段 `items?: ReadonlyArray<{ sentenceSegments?: unknown }>`。旁白判据在函数**内部**从 `items` 推导，不加第三个参数，三处调用各自传入 track 即可，不会各算各的。
  - `video-track-1` → 「主画面」；`video-track-N`（N>1）→「画面 N」
  - `image-track-N` → 「图片 N」
  - `audio-track-N`：轨道上存在 `sentenceSegments` 非空的片段 → 「旁白 N」，否则 →「音频 N」。N 沿用 id 里的数字，与现状编号规则一致，不按「第几条旁白」重新编号，避免增删轨时名字跳动。不猜测「背景音乐」，因为没有可靠判据；设计图里的「背景音乐」由 Iteration 2 的轨道重命名实现。
  - `subtitle-track-N` → 「字幕 N」
  - i18n：`TrackI18n` 新增 `mainVisual` / `narrationTrack` 两个键，并补齐 interface、en、zh-CN 三处。
  - 这会改变导出 JSON 里默认轨道的 `name` 文本，属于展示文本变化。已核实导入路径（`TimelineRepository.ts:35`）对非空名称原样保留，不依赖旧文案，结构和字段不变。更新 `useTimelineExport` 与 `useAIMixedEditing` 中断言旧名称的既有测试。
- **拖动 / 裁切实时标签 `DragTimeBadge`**（新组件）：订阅 `dragSlice` 的 `dragPreview`。拖动中在被拖片段上方 6px 处显示「00:03.34 – 00:11.84 · 8.50s」（`formatTimelineTime`），裁切左边缘时起点加粗，裁切右边缘时终点加粗。交换目标命中时沿用原 swap 提示，不重复显示。纯展示，不改拖拽算法。
- **撤销 / 重做按钮**从 `TimelineToolbar` 移除（上移到顶栏），快捷键保留。工具栏按「编辑（剪切工具、复制、删除）｜整理｜运镜、字幕、导出 JSON｜（即将推出：特效、转场）」分组，组间 1px 分隔。图标按钮热区从 `h-8` 内约 24px 提升到 28px（工具栏高度调为 36px），`PortalTooltip` 文案带快捷键。
- 时间轴区域不再有悬浮按钮遮挡（AI 悬浮球已移除）。

### 3.9 AI 助手抽屉

- `AgentChatDock` 改为 `AssistantDrawer` 呈现：
  - 删除 `AgentChatFloatingButton.tsx`、`useDraggableFab.ts` 及对应 CSS（`.agent-chat-fab*`）。
  - `AgentChatFloatingPanel` 重命名并改造为 `AgentChatDrawer.tsx`：`position:absolute; top:0; right:0; bottom: calc(var(--ws-timeline-h) + 4px); width: min(400px, 90%)`，`z-dock-panel`，左侧 1px 分隔和 `--shadow-lg`。它覆盖右栏和部分中栏，**不覆盖时间轴与缩放控件**。
- 抽屉标题栏：「✦ AI 助手」＋ 上下文行「正在协助：第 2 段 · 活泼天性」（取 `selectedSegmentId` 的 `label`；没有选中段落时显示「正在协助：整个项目」）＋ 关闭按钮。上下文行**只做展示**，本轮不注入到 Agent 提示词（注入属于行为变更，列入 Iteration 2）。
- 打开和关闭：顶栏按钮、工具窗口条按钮、Esc（焦点在抽屉内时）。打开时焦点移到输入框，关闭时焦点回到触发按钮（沿用 `useDockPresence` 的焦点恢复逻辑）。
- Agent 执行中：抽屉保持可开可关；时间轴区域照旧 `inert` 并显示遮罩（`VideoEditingInterface.tsx:2176-2182` 不变）。顶栏按钮显示脉动点。`AgentBusyBar` 照旧显示在抽屉内。
- `VideoChatWindow` 的全部 props、消息、撤销能力不变。
- `AIAssistantPanel` 是已确认的死代码（`VideoEditingInterface.tsx:65` 只 import 不渲染），本次**只删除这行 import**；组件目录的删除留给独立清理。

### 3.10 视觉系统

在 `src/styles/editor-workbench.css`（新文件，在 `globals.css` 之后引入，或由 `video-editing.css` `@import`）中定义工作台作用域的 token，**不修改全局 `:root`**，避免影响设置页等其它界面：

```css
.editor-workbench {
  --ws-bg:            #141619;  /* 工作区底色 / 面板缝隙 */
  --ws-panel:         #1C1F24;  /* 面板底色 */
  --ws-raised:        #252932;  /* 次级按钮、卡片悬停、输入框 */
  --ws-hover:         #2C313B;
  --ws-selected-bg:   color-mix(in srgb, var(--primary) 12%, var(--ws-panel));
  --ws-border-subtle: #2A2E36;
  --ws-text:          #E8EAED;  /* on --ws-panel ≈ 14:1 */
  --ws-text-secondary:#AEB4BE;  /* ≈ 8:1 */
  --ws-text-tertiary: #8C929D;  /* ≈ 5.2:1，仍 ≥ 4.5:1 */
  --ws-ok:   #3FB97A;  --ws-ok-bg:   color-mix(in srgb, #3FB97A 14%, transparent);
  --ws-warn: #E3A33B;  --ws-warn-bg: color-mix(in srgb, #E3A33B 14%, transparent);
  /* v2（RV-08）：全局 --primary #0D99FF 上的白字只有 2.99:1，--destructive #F24822
     在 --ws-raised 上只有 3.97:1。不改全局 :root，只在工作台作用域给「实心主色
     底＋白字」和「危险色文字」另设 token。 */
  --ws-primary-solid: #0A6FC2;   /* 白字 5.17:1；用于导出主按钮、编号徽标等实心底 */
  --ws-primary-solid-hover: #0B64AE;
  --ws-on-primary: #FFFFFF;
  --ws-danger: #FF6B4A;          /* 在 --ws-panel 5.87:1、--ws-raised 5.17:1 */
  --ws-radius-control: 6px;   /* = var(--radius) */
  --ws-radius-card: 8px;
  --ws-hit: 32px;
}
.light .editor-workbench { --ws-bg:#ECEEF1; --ws-panel:#FFFFFF; --ws-raised:#F3F4F6; --ws-hover:#E9EBEF;
  --ws-border-subtle:#E1E4E8; --ws-text:#1F2328; --ws-text-secondary:#4B535D;
  --ws-text-tertiary:#5F6670;   /* v2：#6A727C 在 --ws-raised 上只有 4.43:1 → 5.27:1 */
  --ws-ok:#1F883D; --ws-warn:#9A6700;
  --ws-primary-solid:#0A6FC2; --ws-primary-solid-hover:#0B64AE; --ws-danger:#C4361A; /* 白底 5.4:1 */ }
```

上面标注的对比度是设计目标。实现后必须用 §7.2 的脚本逐对实测，所有文字对达到 4.5:1，图形 UI 部件对达到 3:1；不达标就调 token，不能豁免。

**主色的两种用法（v2，RV-08）**：`--primary`（#0D99FF）继续用于**描边、选中外框、链接色文字、图标和进度条**。它在 `--ws-panel` 上作为文字是 5.52:1，作为图形部件也超过 3:1，可以用。凡是「实心主色底＋白字」的地方（顶栏「导出视频」、段落编号徽标、主按钮），一律改用 `--ws-primary-solid` 底和 `--ws-on-primary` 字。危险色文字一律用 `--ws-danger`，不直接用全局 `--destructive`。评审时实测的数值见「评审记录」RV-08，§7.2 脚本须覆盖这些新 token。

- **字号**：
  - 控件与标签：13px
  - 解说正文：14px / 1.6
  - 面板标题：14px semibold
  - 项目名：14px semibold
  - 辅助信息：12px（仅限时长、计数），不得低于 12px
  - 时间显示一律 `tabular-nums`
- **边框**：面板之间用 1px 缝隙显出 `--ws-bg`，代替边框。卡片默认无边框，用 `--ws-raised` 与 `--ws-panel` 的底色差区分，选中时才加 1px 主色边框。输入框只有底色，聚焦时加 `--ring` 外环。原则是去掉「面板套卡片、卡片套输入框」的三层边框。
- **圆角**：控件 6px，卡片和菜单 8px，芯片 4px，抽屉 0（贴边）。
- **图标**：统一 lucide-react，16px（工具窗口条 20px），`strokeWidth 1.75`。纯图标按钮必须有 `aria-label` 和 `title`。
- **状态**：按钮有 default / hover（`--ws-hover`）/ active / focus-visible（2px `--ring` 外环，偏移 1px）/ disabled（不透明度 0.45，`cursor:not-allowed`，并提供 `title` 说明原因）。生成中用 spinner 加文字。失败用图标、文字加 `--ws-danger`。
- **热区**：所有可点击控件的最小命中区为 32×32（`min-height/min-width: var(--ws-hit)`，图标本身可以更小）。时间轴轨道头的小图标按钮用伪元素扩大到 28×28，受轨道高度限制；满足 WCAG 2.2 的 24×24 最低要求。
- **轨道配色**：沿用 `--timeline-video/audio/image/subtitle`，片段填充改为 `color-mix(in srgb, var(--timeline-x) 70%, var(--ws-panel))`，降低大面积饱和填充的刺激感。
- 旧 CSS 清理：`.video-editing-upper-panels` / `.video-editing-script-panel` / `.video-editing-player-panel` / `.video-editing-materials-panel` / `.video-editing-timeline-section` 的固定百分比规则，以及 `.agent-chat-fab*`、`.agent-chat-floating-panel`。删除前必须 `grep -rn` 全仓确认无其它引用，以 grep 结果为准。`@media (max-width:768px)` 的三栏竖排规则也一并删除（桌面应用最小窗口宽度由 Electron `minWidth` 保证；若 `desktop/main` 未设置 `minWidth`，改为保留一个「窗口过窄」提示态，而不是竖排）。

### 3.11 键盘与焦点

- 继续由 `shortcutOwnership.resolveGlobalSpaceAction` 和 `resolveTimelineShortcut` 管理快捷键。所有新增输入框（项目名、素材搜索、属性页文本框）都是原生 `input` / `textarea`，自动获得让路。
- 新增的 `Alt+1` / `Alt+2`（布局预设）和 `Alt+A`（AI 助手）由新 hook `useWorkbenchShortcuts`（在 `VideoEditingInterface` 挂载）注册的 document keydown 监听处理（v2，RV-15；Electron 菜单冲突见 RV-18）。焦点在可编辑元素或 `[aria-modal="true"]` 内时不处理（复用 `shouldTimelineHandleKeyEvent` 的判定函数）。
- Tab 顺序：顶栏 → 工具窗口条 → 左栏 → 中栏 → 右栏 → 时间轴。每个区域是一个 `role="region"` + `aria-label`，方便读屏器跳转。

### 3.12 关键时序

**A. 修改「活泼天性」文案 → 更新本段配音 → 替换本段画面 → 导出**（验收主任务）

1. 用户点击卡 02 空白处 → `selectSegment('seg-2','script')` → 卡片展开；`useSegmentLinks` 算出 `highlightedItemIds`；时间轴描边关联片段，并在必要时横向滚动。
2. 用户编辑解说并保存 → `handleSaveNarrationEdit` 更新 `segments` → `deriveSegmentStatus` 得到 `voice:'stale'` → 芯片变为「配音待更新」，出现「⟳ 更新本段配音」按钮。
3. 用户点击「更新本段配音」→ `handleConvertToSpeech(segment)`（只处理本段）→ `convertingSegments` 含 seg-2 → 芯片显示「配音生成中」，顶栏任务中心 +1（经 `convertingSegmentIds` 镜像）。其它卡片仍可编辑（现有实现本就按段落并发）。完成后新素材带新 `segment_text_hash` 进入素材库。此时时间轴上仍是旧旁白，所以芯片变为「新配音未上时间轴」，**而不是「配音已生成」**（v2，RV-02）。
3′. 用户按提示在时间轴删除旧旁白片段，再从素材页把新配音拖到旁白轨（均为现有能力，均可 Ctrl+Z 撤销）→ `voiceOnTimeline = current` → 芯片变为「配音已生成」。一键「应用到时间轴」是新动作，放到 Iteration 2（§10「配音时长变化三选一」一并设计）。
4. 用户点击「⇄ 更换画面」→ `handleOpenVideoSearch('seg-2')` → 现有搜索弹窗流程。
5. 用户按 Ctrl+Z → 时间轴历史撤销（现有能力；段落整体撤销属于 Iteration 2）。
6. 用户点击顶栏「导出视频」→ `handleExport()`（与原按钮是同一函数，v2 更正函数名），顶栏按钮显示进度，任务中心计数 +1。

**B. 时间轴点选 → 左栏定位**：`selectedItems` 变为单个 → `useSegmentSelectionSync`（新 hook，订阅 `useTimelineStore.selectedItems`）解析段落 → `selectSegment(id,'timeline')` → `SegmentCard` 在 `useEffect` 中检测「我被选中且 source==='timeline'」→ 左栏没有编辑焦点时执行 `scrollIntoView({block:'nearest'})`。右栏页签不变。

---

## 4. 文件 / 模块变更计划

| 文件 | 类型 | 一句话意图 |
|---|---|---|
| `src/components/video/workbench/EditorWorkbench.tsx` | 新增 | 纯布局壳：顶栏、工具窗口条、三栏、分隔条、时间轴、抽屉槽位 |
| `src/components/video/workbench/PanelSplitter.tsx` | 新增 | 可访问的拖动 / 键盘分隔条，拖动中直写 CSS 变量 |
| `src/components/video/workbench/useWorkbenchLayout.ts` | 新增 | 布局尺寸、折叠、预设、响应式自动收起、localStorage 读写 |
| `src/components/video/workbench/layoutPrefs.ts` | 新增 | 纯函数：`parseLayoutPrefs` / `clampLayout` / `applyPreset` / 常量 |
| `src/components/video/workbench/ToolWindowRail.tsx` | 新增 | 左侧工具窗口条（脚本 / 素材 / 属性 / AI 助手 / 布局） |
| `src/components/video/workbench/EditorTopBar.tsx` | 新增 | 顶栏：面包屑、改名、保存状态、备份芯片、撤销重做、任务、AI、导出 |
| `src/components/video/workbench/ProjectNameEditor.tsx` | 新增 | 项目名就地编辑子组件 |
| `src/components/video/workbench/SaveStatusIndicator.tsx` | 新增 | 保存四态展示（固定宽） |
| `src/components/video/workbench/TaskCenterButton.tsx` | 新增 | 读取 asyncTaskSlice 的任务计数与 Popover 列表 |
| `src/components/video/workbench/RightPanel.tsx` | 新增 | 「素材 | 属性」页签容器（双面板常挂载） |
| `src/components/video/workbench/InspectorPanel.tsx` | 新增 | 属性检查器（按对象类型渲染，调用现有 action） |
| `src/components/video/workbench/index.ts` | 新增 | barrel |
| `src/stores/editorFocusStore.ts` | 新增 | `useEditorFocusStore`（UI 焦点，不进工程） |
| `src/components/video/lib/segments/segmentLinks.ts` | 新增 | 段落 ↔ 片段 ↔ 素材的只读派生纯函数 |
| `src/components/video/hooks/useSegmentLinks.ts` | 新增 | 订阅 store 并 memo 派生结果、`playingSegmentId` |
| `src/components/video/hooks/useSegmentSelectionSync.ts` | 新增 | 时间轴单选 → 段落选中 |
| `src/components/video/hooks/useSegmentAudition.ts` | 新增 | 段落配音试听（单例 audio，播放前暂停成片） |
| `src/components/video/components/SegmentCard/SegmentCard.tsx` | 新增 | 从 ScriptPanel 抽出的段落卡（紧凑 / 展开） |
| `src/components/video/components/SegmentCard/SegmentStatusChips.tsx` | 新增 | 画面 / 配音 / 字幕状态芯片 |
| `src/components/video/components/SegmentCard/SegmentMoreMenu.tsx` | 新增 | ⋯ 菜单（配音 / AI 匹配 / 定位 / 删除） |
| `src/components/video/components/SegmentCard/index.ts` | 新增 | barrel |
| `src/components/video/components/MaterialsPanel/MaterialCard.tsx` | 新增 | 视频 / 图片卡（大缩略图、⋯ 菜单、状态遮罩迁移） |
| `src/components/video/components/MaterialsPanel/AudioMaterialRow.tsx` | 新增 | 音频紧凑行 |
| `src/components/video/components/MaterialsPanel/MaterialFilterBar.tsx` | 新增 | 搜索框 + 5 个一级分类 + 素材包二级芯片 + 「添加」下拉 |
| `src/components/video/components/MaterialsPanel/materialFilter.ts` | 新增 | 纯函数：`filterMaterials(list,{primary,pack,query})` |
| `src/components/video/components/VideoPlayerPanel/CanvasMenu.tsx` | 新增 | 「画布」下拉（比例、说明、封面、计数） |
| `src/components/video/timeline/DragTimeBadge.tsx` | 新增 | 拖动 / 裁切实时时间标签 |
| `src/components/video/lib/segments/SegmentLinksContext.ts` | 新增（v2，替代 v1 的 `SegmentLabelContext`） | 由 `VideoEditingInterface` 提供的唯一段落派生结果，供四区读取 |
| `src/components/video/components/VideoPlayerPanel/consoleTime.ts` | 新增（v2） | `resolveConsoleTime` 纯函数（播放条时间单一来源） |
| `src/components/video/workbench/collectActiveTasks.ts` | 新增（v2） | 任务中心三来源聚合纯函数 |
| `src/components/video/workbench/useEditorExportWiring.ts` | 新增（v2） | 上移后的 `useVideoExport` 接线与导出按钮状态，避免堆进 `VideoEditingInterface` |
| `src/components/video/workbench/useWorkbenchShortcuts.ts` | 新增（v2） | 布局预设 / AI 助手快捷键（复用 `shouldTimelineHandleKeyEvent` 的判定） |
| `src/components/video/components/AgentChatDock/AgentChatDrawer.tsx` | 新增（由 FloatingPanel 改造） | 右侧抽屉呈现 + 上下文行 |
| `src/styles/editor-workbench.css` | 新增 | `--ws-*` token 与工作台样式 |
| `src/components/video/VideoEditingInterface.tsx` | 修改 | JSX 布局换为 `EditorWorkbench`；上移 aspectRatio 与 `useVideoExport`；接收 `projectChrome`；挂 `useSegmentSelectionSync`；调用 `useSegmentLinks` 并提供 `SegmentLinksContext`；删 `AIAssistantPanel` import。导出接线和快捷键分别放在 `useEditorExportWiring` / `useWorkbenchShortcuts`。**净增行数必须 ≤ 0**（布局 JSX 移出后抵消） |
| `src/components/video/projects/VideoEditorContainer.tsx` | 修改 | 删 36px 顶条；构造 `projectChrome`（含 `onRenameProject`）下传 |
| `src/components/video/projects/hooks/useProjectAutosave.ts` | 修改 | 返回值由 `void` 改为 `{ retryNow }`，语义见 §3.2（退避中结束等待 / 无在途则 flush / 在途则置 dirty） |
| `src/components/video/ScriptPanel.tsx` | 修改 | 标题栏 / 分段控件 / 音色底栏重排；段落卡 JSX（2099-2757）替换为 `<SegmentCard>`，处理函数原样作为 props 传入；`convertingSegments` 镜像到焦点仓库（v2）。**目标：文件行数下降 ≥ 500** |
| `src/components/video/components/VoiceSelector.tsx` | 修改 | 新增可选 `onVoiceMetaChange` 回调（无行为变化） |
| `src/components/video/components/AiGenerateMenu/AiGenerateMenu.tsx` | 修改 | 触发按钮文案「生成初稿」+ 外观；菜单项不变 |
| `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` | 修改 | 分类 / 搜索 / 网格改用新子组件；卡片 JSX（2092-2493）迁出；底部「素材库」下拉迁到顶部 |
| `src/components/video/components/MediaPreviewModal/MediaPreviewModal.tsx` | 修改 | 标题加「素材预览」前缀；新增可选 `onBeforeOpen` 或由调用方在打开前暂停成片 |
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | 修改 | 删头部导出和计数；比例改受控；播放条合并为一行；时间绑定 `effectiveTime`；标题栏「成片预览 + 画布」 |
| `src/components/video/components/AgentChatDock/AgentChatDock.tsx` | 修改 | 去 FAB，只渲染抽屉；新增 `contextLabel` prop |
| `src/components/video/components/AgentChatDock/AgentChatFloatingButton.tsx` | 删除 | 悬浮球移除 |
| `src/components/video/components/AgentChatDock/useDraggableFab.ts` | 删除 | 拖动逻辑随悬浮球移除 |
| `src/components/video/components/AgentChatDock/AgentChatFloatingPanel.tsx` | 删除 | 被 `AgentChatDrawer` 取代 |
| `src/components/video/timeline/TimelinePanel.tsx` | 修改 | 渲染 `DragTimeBadge`（段落标签改由 `TimelineItem` 读 `SegmentLinksContext`，v2） |
| `src/components/video/timeline/TimelineItem.tsx` | 修改 | 读 context 渲染段落标签和 `ws-item-linked` 高亮；title / aria-label 文案 |
| `src/components/video/timeline/TimelineToolbar.tsx` | 修改 | 移除撤销 / 重做按钮；分组与热区 |
| `src/components/video/timeline/Track.tsx` | 不改（v2） | 旁白判据已移进 `deriveTrackDisplayName` 内部，调用方式不变 |
| `src/components/video/timeline/trackDisplayName.ts` | 修改 | 新的默认命名规则；`TrackLike` 增加可选 `items`，旁白判据在函数内部推导 |
| `src/components/video/hooks/useTimelineExport.ts`、`src/components/video/hooks/useAIMixedEditing.ts` | 仅测试更新（v2） | 这两处调用 `deriveTrackDisplayName`，代码不改；更新断言旧默认名的测试 |
| `src/styles/video-editing.css` | 修改 | 删除固定百分比布局、FAB、浮窗、窄屏竖排规则（以 grep 为准） |
| `src/stores/videoEditingStore.ts` | 修改 | `resetVideoEditingStore()` 同时调用 `useEditorFocusStore.getState().reset()` |
| `src/lib/i18n.ts` | 修改 | 新增 `workbench` / `segmentCard` / `inspector` / `materialsPanel.filter` 等键（interface + en + zh-CN 三处） |
| 测试文件 | 新增 / 修改 | 见 §7.1 |

---

## 5. 接口设计

本功能**无 REST / WebSocket / CLI 变更**。唯一用到的后端接口是既有的 `PUT /api/video-projects/{id}`（`updateVideoProject`，body `{name}`），项目列表页的改名早已在使用。以下是组件和 hook 接口，均为 `interface`，遵循仓库约定。

### 5.1 顶栏与项目外壳

```ts
// VideoEditorContainer → VideoEditingInterface 新增 prop
export interface EditorProjectChrome {
  projectName: string;                 // 空串时显示 t.videoProjects.untitled
  updatedAt: string | null;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: number | null;
  hasRecoveryBackup: boolean;
  onBack(): void;
  onRenameProject(name: string): Promise<void>;   // 失败时 reject，由顶栏回滚
  onRetrySave(): void;                 // = useProjectAutosave().retryNow（v2 语义见 §3.2）
  onRequestRestoreBackup(): void;
  onRequestDiscardBackup(): void;
}

export interface EditorTopBarProps {
  project: EditorProjectChrome;
  canUndo: boolean; canRedo: boolean; isHistoryLocked: boolean;
  onUndo(): void; onRedo(): void;
  isAssistantOpen: boolean; isAgentBusy: boolean; onToggleAssistant(): void;
  exportState: { canExport: boolean; isExporting: boolean; progress: number; disabledReason?: string };
  onExport(): void; onOpenExportProgress(): void;
}
```

### 5.2 布局

```ts
export type LayoutPresetId = 'script' | 'edit' | 'custom';
export interface WorkbenchLayout {
  leftWidth: number; rightWidth: number; timelineHeight: number;
  leftCollapsed: boolean; rightCollapsed: boolean;
  preset: LayoutPresetId;
}
export interface UseWorkbenchLayoutReturn {
  layout: WorkbenchLayout;
  autoCollapsed: { left: boolean; right: boolean };
  /** v2（RV-05）：resolvePanelSizes 求解后的实际尺寸；不回写 layout */
  resolved: { leftWidth: number; rightWidth: number; timelineHeight: number };
  overlayOpen: { left: boolean; right: boolean };
  setSize(key: 'left' | 'right' | 'timeline', px: number): void;   // 自动 clamp，preset→custom
  toggle(panel: 'left' | 'right'): void;
  applyPreset(id: Exclude<LayoutPresetId, 'custom'>): void;
  reset(): void;
  rootRef: React.RefObject<HTMLDivElement>;   // 挂在 .editor-workbench，写 CSS 变量
}
export interface PanelSplitterProps {
  id: 'left' | 'right' | 'timeline';
  orientation: 'vertical' | 'horizontal';
  value: number; min: number; max: number;
  /** 拖动中：仅写 CSS 变量；结束：提交 */
  onPreview(px: number): void;
  onCommit(px: number): void;
  onReset(): void;
  ariaLabel: string; controlsId: string;
}
export interface EditorWorkbenchProps {
  topBar: React.ReactNode; rail: React.ReactNode;
  left: React.ReactNode; center: React.ReactNode; right: React.ReactNode;
  timeline: React.ReactNode; drawer: React.ReactNode;
  layout: UseWorkbenchLayoutReturn;
}
```

### 5.3 段落卡

```ts
export interface SegmentCardProps {
  segment: ScriptSegment;
  index: SegmentIndexEntry;             // ordinal / label
  status: SegmentStatus;
  isSelected: boolean;
  isPlaying: boolean;
  isAuditioning: boolean;
  canSearchVideos: boolean;             // = completedSegments.has(id)（原禁用条件）
  onSelect(): void;
  onAudition(): void;                   // 播放 / 停止切换
  onReplaceVisual(): void;              // handleOpenVideoSearch(id)
  onAiMatchVisual(): void;              // handleAIMatchVideos(id)
  onGenerateVoice(): void;              // handleConvertToSpeech(segment)
  onLocate(): void;
  onRevealNewVoice(): void;             // v2：切到素材页并选中最新配音（仅 voiceOnTimeline=outdated）
  onDelete(): void;                     // handleDeleteSegment(id)（含原确认框）
  /** 展开态主体：由 ScriptPanel 传入原解说编辑 / 句子行 / 轮播 JSX，保证逻辑零改动 */
  renderExpanded(): React.ReactNode;
}
```

`renderExpanded` 是一个有意的取舍：句子行、轮播等 JSX 与 ScriptPanel 内大量局部 state 强耦合，本轮只把它们**整块**移进 `ScriptPanel` 内的一个 `renderSegmentDetails(segment)` 函数，以 render-prop 形式传给卡片，避免改动这些状态的归属。

### 5.4 其它

```ts
export interface InspectorPanelProps {
  selection:
    | { kind: 'none' }
    | { kind: 'segment'; segmentId: string }
    | { kind: 'items'; itemIds: string[] }
    | { kind: 'material'; materialId: string };
  onOpenCameraMotion(itemId: string): void;
  onOpenSubtitleStyle(trackId: string): void;
  onAddMaterialToTimeline(material: MaterialItem): void;
  onPreviewMaterial(material: MaterialItem): void;
  onLocateSegment(segmentId: string): void;
  isEditLocked: boolean;
}
export interface MaterialFilterState {
  primary: 'all' | 'video' | 'audio' | 'image' | 'packs';
  pack: 'storyboard_pack' | 'character_pack' | 'scene_pack' | 'frame_pack';
  query: string;
}
export function filterMaterials(list: MaterialItem[], f: MaterialFilterState): MaterialItem[];
export interface CanvasMenuProps {
  aspectRatios: AspectRatio[]; selectedId: string; onSelect(r: AspectRatio): void;
  videoCount: number; audioCount: number; coverSlot?: React.ReactNode;
}
export interface UseSegmentAuditionReturn {
  auditioningSegmentId: string | null;
  play(segment: ScriptSegment): Promise<void>;
  stop(): void;
}
// AgentChatDock 新增
interface AgentChatDockProps { /* …原有… */ contextLabel: string | null }
// VideoPlayerPanel 新增受控 props
interface VideoPlayerPanelProps { /* …原有… */ aspectRatioId: string; onAspectRatioChange(id: string): void }
```

---

## 6. 数据模型

### 6.1 持久化数据：**无变化**

`ScriptSegment`、`ScriptSentence`、`TimelineItem`、`Track`、`MaterialItem`、`VideoEditingTaskContent`、`project_data` 的结构全部不变。所有新展示都从以下**现有字段**只读派生：

| 派生量 | 来源字段 |
|---|---|
| 段落编号 / 标题 | `ScriptSegment` 在数组中的顺序、`title` |
| 片段所属段落 | `TimelineItem.sentenceSegments.segment_id`、`MaterialItem.metadata.segment_id` / `linkedSegmentId` |
| 配音是否过期 | `MaterialItem.metadata.segment_text_hash` vs `segmentTextHash(segment)` |
| 「已用于第 N 段」 | `metadata.segment_id` → 编号；回退 `metadata.segment_number` |
| 段落时间范围 | 关联片段的 `startTime` / `endTime` |
| 字幕状态 | 字幕轨片段与段落时间范围是否重叠 |
| 任务计数 | `asyncTaskSlice.tasks[*].status` |

### 6.2 内存与本地偏好

```ts
// localStorage['ecliptrix-editor-layout-v1']
interface StoredLayoutPrefsV1 {
  v: 1;
  leftWidth: number;        // clamp [280, 480]，默认 320
  rightWidth: number;       // clamp [280, 440]，默认 300
  timelineHeight: number;   // clamp [160, 0.6*视口高]，默认 260
  leftCollapsed: boolean;   // 默认 false
  rightCollapsed: boolean;  // 默认 false
  preset: 'script' | 'edit' | 'custom';  // 默认 'custom'（默认尺寸不等于任一预设）
  followPlayback: boolean;  // 默认 false
  rightPanelTab: 'materials' | 'properties'; // 默认 'materials'
}
```

- `v !== 1`、字段类型不符或 JSON 解析失败时，整体回落到默认值，并 `logger.warn('[workbench] invalid layout prefs', { reason })`（不吞异常；不记录值本身之外的信息）。
- 写入节流：只在 `onCommit`、折叠切换、预设切换、页签切换、跟随播放切换时写入，不在拖动过程中写。
- 归属（v2，RV-12）：整个键只由 `useWorkbenchLayout` 读写；`followPlayback` / `rightPanelTab` 由它注入焦点仓库并回写，焦点仓库 `reset()` 不重置这两项。
- `useEditorFocusStore` 中的 `selectedSegmentId` / `selectedMaterialId` 只存在于内存，切换项目时 `reset()`。

---

## 7. 测试与验收

测试遵循仓库现有模式：组件测试用 `?raw` 导入加 `test-utils/compileComponent.ts` 编译并显式映射依赖；store 和纯逻辑测试直接驱动 `getState()`。每个测试只断言一个主题，名字描述被钉住的行为，不用 sleep 同步（用 fake timers 或 `waitFor`）。

### 7.1 自动化测试清单

| 测试文件 | 用例（名字即行为） |
|---|---|
| `lib/segments/__tests__/segmentLinks.test.ts` | `voice_on_timeline_outdated_when_newer_voice_only_in_library`；`voice_on_timeline_current_when_latest_voice_is_on_track`；`voice_on_timeline_absent_without_narration_item`；（以上 v2 新增）`resolves_segment_from_sentence_segments_first`；`falls_back_to_material_metadata_segment_id`；`returns_null_for_unlinked_item`；`time_range_prefers_narration_audio_items`；`voice_stale_when_text_hash_differs`；`voice_ready_when_hash_matches`；`voice_ready_when_legacy_material_has_no_hash`（与 `isStaleVoiceOver` 语义对齐）；`voice_generating_while_converting`；`subtitle_ready_only_when_overlapping_segment_range`；`label_pads_ordinal_to_two_digits`；`playing_segment_is_null_between_ranges` |
| `workbench/__tests__/layoutPrefs.test.ts` | `sides_shrink_proportionally_to_keep_center_min`；`right_auto_collapses_when_sides_at_min_still_overflow`；`timeline_height_keeps_upper_min`；`resolved_sizes_do_not_overwrite_prefs`（以上 v2）；`clamps_widths_into_bounds`；`invalid_json_falls_back_to_defaults`；`unknown_version_falls_back_to_defaults`；`applying_preset_sets_sizes_and_preset_id`；`manual_resize_switches_preset_to_custom` |
| `workbench/__tests__/useWorkbenchLayout.test.ts` | `auto_collapses_right_below_1180`；`auto_collapse_does_not_overwrite_user_pref`；`storage_throwing_does_not_break_render` |
| `workbench/__tests__/PanelSplitter.test.tsx` | `arrow_keys_step_16px`；`shift_arrow_steps_64px`；`double_click_resets`；`exposes_separator_aria_values` |
| `workbench/__tests__/EditorTopBar.test.tsx` | `shows_saving_saved_error_states_with_text`；`error_state_click_retries_save`；`export_disabled_with_reason_when_timeline_empty`；`undo_disabled_while_agent_lock`；`rename_empty_name_reverts_without_request`；`rename_failure_reverts_and_reports` |
| `workbench/__tests__/InspectorPanel.test.tsx` | `empty_state_when_nothing_selected`；`subtitle_text_commit_dispatches_update_item`；`controls_disabled_under_edit_lock` |
| `workbench/__tests__/TaskCenterButton.test.tsx` | `counts_only_pending_and_processing_tasks`；`counts_converting_segments_from_script_panel`（v2）；`counts_export_in_progress`（v2） |
| `projects/hooks/__tests__/useProjectAutosave.retryNow.test.ts`（v2） | `retry_now_during_backoff_does_not_double_put`；`retry_now_while_in_flight_marks_dirty` |
| `VideoPlayerPanel/__tests__/consoleTime.test.ts`（v2） | `console_time_clamps_to_total`；`console_time_uses_current_time_outside_composition`；`console_time_prefers_timeline_time_in_composition` |
| `VideoPlayerPanel/__tests__/playerConsole.layout.test.tsx`（v2，更新） | 两行控制台结构的断言改为单行播放条：播放键、时间、进度条、音量在同一行，ARIA 不变 |
| `hooks/__tests__/useTimelineExport.*`、`hooks/__tests__/useAIMixedEditing.*`（v2，更新） | 默认轨道名断言更新为新规则 |
| `stores/__tests__/editorFocusStore.test.ts` | `selecting_segment_never_changes_right_panel_tab`；`reset_clears_selection`；`reset_keeps_follow_playback_and_tab_prefs`（v2） |
| `hooks/__tests__/useSegmentAudition.test.ts` | `pauses_composition_before_audition`；`stops_when_composition_starts_playing`；`only_one_segment_auditions_at_a_time` |
| `hooks/__tests__/useSegmentSelectionSync.test.ts` | `single_timeline_selection_selects_owning_segment`；`multi_selection_does_not_change_segment` |
| `components/SegmentCard/__tests__/SegmentCard.test.tsx` | `card_header_is_button_with_aria_expanded`；`arrow_keys_move_between_card_headers`；`outdated_timeline_voice_shows_warning_chip`（以上 v2）；`click_on_blank_area_selects_segment`；`click_inside_textarea_does_not_select`；`delete_is_only_in_more_menu`；`stale_voice_shows_update_voice_action`；`replace_visual_disabled_with_reason_before_tts`；`status_chips_render_text_not_only_color` |
| `MaterialsPanel/__tests__/materialFilter.test.ts` | `packs_primary_filters_by_pack_subtype`；`query_matches_name_case_insensitively`；`query_is_scoped_to_current_category` |
| `MaterialsPanel/__tests__/MaterialCard.test.tsx` | `single_click_selects_without_side_effects`；`double_click_opens_preview`；`drag_payload_unchanged`（断言 `application/json` 负载和 MIME 前缀与原实现一致）；`status_overlays_preserved`（下载中 / 失败重试可见） |
| `VideoPlayerPanel/__tests__/VideoPlayerPanel.time.test.tsx` | `player_time_matches_restored_playhead`（传入 `currentTimelineTime=3.34`，播放条显示 00:03） |
| `VideoPlayerPanel/__tests__/CanvasMenu.test.tsx` | `selecting_ratio_calls_controlled_handler`；`cover_slot_rendered` |
| `timeline/__tests__/trackDisplayName.test.ts`（更新） | `first_video_track_named_main_visual`；`audio_track_with_sentence_segments_named_narration`；`custom_name_wins`；`narration_detected_from_items_without_extra_param`（v2） |
| `timeline/__tests__/TimelineItem.segmentLabel.test.tsx` | `renders_ordinal_label_when_linked`；`falls_back_to_file_name_when_unlinked`；`linked_highlight_class_independent_of_selection` |
| `timeline/__tests__/DragTimeBadge.test.tsx` | `shows_start_end_duration_during_drag`；`hidden_when_not_dragging` |
| `timeline/__tests__/shortcutOwnership.*`（新增用例） | `space_in_project_name_input_does_not_toggle_playback`；`space_in_material_search_does_not_toggle_playback` |
| `AgentChatDock/__tests__/AgentChatDock.test.tsx`（更新） | 删除 FAB 相关断言（`if (!isOpen)`、`onClick={onOpen}`、拖动）；新增 `drawer_does_not_cover_timeline`（断言 bottom 使用 `--ws-timeline-h`）、`shows_context_label`、`escape_closes_and_restores_focus` |
| `timeline/__tests__/TimelineToolbar.*`（更新） | 删除 undo / redo 按钮的断言，新增 `toolbar_has_no_undo_redo_buttons` |

### 7.2 静态与质量门

1. `npm run type-check` 必须 exit 0。
2. `npm test` 的失败数**不高于**基线：实施前先在当前 HEAD 跑一次并记录，之后只允许差分为 0 或下降。
3. `ESLINT_USE_FLAT_CONFIG=false npx eslint <本次改动文件>` 必须 0 error。项目级 lint 的 error 数不高于基线。
4. `npm run build` 必须 exit 0。
5. 对比度脚本：写一个一次性 Node 脚本，放在 scratch，不入库。对 §3.10 所有文字 / 背景 token 对计算 WCAG 相对亮度对比度，深色和浅色主题都要算。输出表格并附到运行日志。所有文字对 ≥ 4.5:1，图形部件对 ≥ 3:1。
6. 规模门：
   - `VideoEditingInterface.tsx` 行数不增加。
   - `ScriptPanel.tsx` 行数下降 ≥ 500，`MaterialsPanel.tsx` 行数下降 ≥ 400。
   - 新文件每个 ≤ 1000 行，每个函数 ≤ 60 行。超出时加注释说明原因。
7. 删除类名前 `grep -rn` 确认零引用（记录命令输出）。

### 7.3 手工验收（桌面端 `desktop/ npm run dev`，1600×900 与 1100×800 两个窗口尺寸）

**主任务**（来自建议第七节）：打开项目 → 修改「活泼天性」段文案 → 重新生成本段配音 → 替换本段画面 → 导出。逐项确认：
- [ ] 全程能从左栏选中态、时间轴描边和抽屉上下文行看出当前段落是 02。
- [ ] 改完文案，芯片**立即**变为「配音待更新」。
- [ ] 「更新本段配音」只生成 02 段，其它段芯片不变，其它卡片生成期间可编辑；生成期间顶栏任务数 +1。
- [ ] 生成完成后 02 段芯片显示「新配音未上时间轴」（不是「配音已生成」）；删除旧旁白片段并拖入新配音后变为「配音已生成」，导出成片里是新配音。
- [ ] 更换画面走原搜索流程，结束后 02 卡缩略图更新。
- [ ] Ctrl+Z 能撤销时间轴上的替换。
- [ ] 顶栏导出成功，任务中心计数先加一，完成后回落。

**逐项检查**：
- [ ] §2.3 功能保全表**每一行**都能在新界面找到并成功触发。
- [ ] 暂停后刷新项目，播放条时间与时间轴播放头一致。
- [ ] 素材页双击预览时成片暂停，且成片播放头不动；试听时点击播放成片会停止试听。
- [ ] 选中段落或时间轴片段都**不会**切换右栏页签。
- [ ] 项目名、素材搜索框、属性文本框中按空格或字母，不会触发播放或剪辑快捷键。
- [ ] 1100px 宽时右栏自动收起，工具窗口条可以浮层打开，文字不缩小。
- [ ] 把左、右栏都拖到最宽后缩小窗口到 1300px：中栏不小于 420px、无横向滚动；再放大窗口，两栏恢复原宽度（v2）。
- [ ] 1024×768 下切「剪辑布局」：播放器区域不低于 320px 高（v2）。
- [ ] 拖动三个分隔条、切换两个预设、重启应用后布局保持；删除 localStorage 键后回到默认。
- [ ] AI 助手抽屉打开时，时间轴和缩放控件完全可见、可操作（Agent 空闲时）。
- [ ] 浅色主题下所有新组件可读，没有写死的深色。
- [ ] 键盘可以走完整条主任务（Tab 或方向键选段、Enter 编辑、⋯ 菜单可用方向键操作）。

---

## 8. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | ScriptPanel / MaterialsPanel 大块 JSX 迁移时丢失局部 state 或回调 | 功能回归（违反「不能影响功能」） | 展开态用 `renderExpanded` render-prop 整块迁移，不改 state 归属；逐项对照 §2.3；迁移分两步提交（先抽组件、零视觉改动并跑测试，再换样式） |
| R2 | 上移 `aspectRatio` 与 `useVideoExport` 后，导出参数与预览比例不一致 | 导出尺寸错误 | 两处都读同一 `aspectRatioId` state；加测试 `export_uses_selected_aspect_ratio`（断言 `useVideoExport` 收到的 `aspectRatio` 与受控值一致）；`exportSessionKey(taskId, projectId)` 不变，导出会话恢复不受影响 |
| R3 | 拖动分隔条引起 2380 行编排组件和合成器高频重渲 | 卡顿、掉帧 | 拖动中只写 CSS 变量，结束时才 setState；`PreviewCanvas` 靠 `ResizeObserver` 自适应；手工验收在播放中拖动，观察丢帧指标（`PlaybackTelemetry`） |
| R4 | `useSegmentLinks` 依赖 `currentTime` 导致每帧重算 | 播放卡顿 | 明确禁止依赖 `currentTime`；`playingSegmentId` 单独计算，只在值变化时通知；单测 + React Profiler 手工核对 |
| R5 | 旧素材缺少 `segment_text_hash` 或 `segment_id`；Agent 段落 id 是位置式的（`agent-segment-0`），重生成脚本后旧素材会挂到新段落 | 状态误判为「待更新」、误关联或无法关联 | 与 `isStaleVoiceOver` 同语义（无 hash 按 ready 处理）；画面关联在素材带 hash 时同样比对 hash（RV-16）；关联不到就不显示标签或高亮（静默降级是展示层行为，不隐藏错误；无需日志） |
| R13（v2） | 素材库有新配音但时间轴仍是旧配音，用户误以为导出已更新 | 导出内容与预期不符 | `voiceOnTimeline` 派生与「新配音未上时间轴」芯片（RV-02）；一键应用放在 Iteration 2 |
| R6 | 删除 FAB 后，依赖其结构的既有测试断言失败 | CI 红 | §7.1 已逐条点名需要更新的断言 |
| R7 | 自动收起与用户偏好冲突，用户找不到面板 | 可用性 | 工具窗口条始终可见且显示状态；自动收起不覆盖偏好；浮层打开 |
| R8 | 改名接口失败，或和自动保存并发写同一项目记录 | 名称丢失或覆盖 | **评审已核实关闭（RV-10）**：`video_project_service.update_project` 对每个字段 `is not None` 才写，自动保存只发 `{project_data}`（`useProjectAutosave.ts:132/144`），改名只发 `{name}`，二者互不覆盖。改名失败时仍回滚并报错 |
| R9 | 新 token 在浅色主题或对比度上不达标 | 可读性 | §7.2 第 5 项脚本实测，不达标就调 token |
| R10 | 移除时间轴工具栏的撤销重做按钮后，用户习惯改变 | 学习成本 | 顶栏按钮带文字和快捷键提示，快捷键不变；工具栏 tooltip 不再列撤销 |
| R11 | 窗口极窄时布局崩坏 | 显示错乱 | 评审已核实桌面端 `minWidth: 1024`（`desktop/main/window.js:102`）；空间求解见 §3.1。仅浏览器调试路径可能更窄：`.ws-main < 720px` 时显示「窗口过窄，请放大窗口」提示态，不做竖排 |
| R12 | 桌面端必须重新打包 standalone 才能看到改动（历史上出现过「改了但桌面仍旧」） | 验收误判 | 手工验收用 `desktop/ npm run dev`；如果用打包版验收，必须先重跑 `prepare-frontend` |

---

## 9. 实施顺序（供下游开发节点逐步执行，每步都保持可运行、可测试）

1. **基线**：在当前 HEAD 跑 `npm test`、`type-check`、项目级 lint，记录失败数和 error 数到运行日志。
2. **纯函数先行**：`segmentLinks.ts`、`layoutPrefs.ts`、`materialFilter.ts`、`editorFocusStore.ts` 及其测试。
3. **工作台骨架**：`EditorWorkbench` / `PanelSplitter` / `useWorkbenchLayout` / `ToolWindowRail` / `editor-workbench.css`；`VideoEditingInterface` 换布局，内容组件暂不改。验证四区渲染、拖动、折叠、持久化。
4. **顶栏**：上移比例和导出，`VideoEditorContainer` 下传 `projectChrome`，接入撤销重做、任务中心和 AI 按钮；删除旧顶条和播放器导出按钮。
5. **AI 抽屉**：`AgentChatDrawer` 替换 FAB 和浮窗，更新测试。
6. **中栏**：`CanvasMenu`、单行播放条、`effectiveTime` 绑定及回归测试。
7. **左栏**：先把段落卡 JSX 原样抽成 `SegmentCard` + `renderExpanded`（零视觉改动，跑测试），再做新外观、芯片、⋯ 菜单、试听、音色底栏、跟随播放。
8. **联动**：`useSegmentLinks` + `SegmentLinksContext`（v2）、`useSegmentSelectionSync`、`ws-item-linked`、轨道默认名、`DragTimeBadge`、工具栏调整。
9. **右栏**：`RightPanel` 页签；素材页先原样抽出 `MaterialCard` / `AudioMaterialRow`（零视觉改动），再做分类、搜索和新卡片；最后做 `InspectorPanel`。
10. **清理与质量门**：删除旧 CSS（grep 确认）、i18n 三处补齐、§7.2 全部门禁、§7.3 手工验收。

---

## 10. 延后到 Iteration 2 的事项（本轮明确不做，但设计已预留）

| 事项 | 需要的新能力 | 预留点 |
|---|---|---|
| 画布适配「保持完整 / 填满 / 背景填充」 | 预览合成器与后端导出同步新增 fit 模式（保持预览与导出一致） | `CanvasMenu` 说明段位置 |
| 本段音色覆盖（「本段音色：使用全片默认 / 已单独设置」） | `ScriptSegment.voiceId?` 字段 + TTS 请求按段取音色；修改默认音色时询问「仅后续 / 重生成已有」 | 音色底栏、属性页「段落」视图 |
| 配音时长变化三选一（调整本段时长 / 修改文案或语速 / 暂不应用） | 新配音先作为候选、试听后应用、保留旧版；锁定片段不被挪动 | `SegmentCard` 芯片区；`voice` 状态可扩展 `candidate` |
| 段落内保留失败原因与「只重试本段」 | 持久化段落级配音失败状态 | `VoiceStatus` 可扩展 `failed` |
| 拖放素材到段落卡「替换第 N 段画面」、时间轴插入 / 替换 / 覆盖三种落点提示 | 新的替换动作（保留时长、配音、字幕） | `SegmentCard` 作为 drop target 的样式钩子 |
| 段落整体删除和撤销（一次撤销恢复文字＋片段） | 跨 store（脚本 + 时间轴）的复合历史项 | ⋯ 菜单删除项 |
| AI 上下文注入（抽屉上下文行真正作为 Agent 提示词上下文） | Agent system prompt 变更 | `AgentChatDock.contextLabel` |
| 润色本段文案 | `ContentPolishModal` 以 `narrationText` 为输入的段级模式 | ⋯ 菜单占位 |
| 生成期间继续编辑的「此结果基于上一版文案」保护 | 请求时记录 `segmentTextHash`，回包时比对 | `deriveSegmentStatus` 已具备 hash 比对 |
| 轨道重命名、空轨折叠、导出前检查（分级：阻断 / 提示） | 新 store action 与检查器 | `trackDisplayName` 规则、顶栏导出按钮 |
| 任务中心的取消入口 | 各任务类型的取消能力统一 | `TaskCenterButton` Popover 行尾 |
| 面板内任务统一登记（AI 视频脚本、分镜视频等）（v2） | 这些流程向 `asyncTaskSlice` 登记任务 | `collectActiveTasks` 已按来源聚合，新增来源即可 |
| 「新配音一键应用到时间轴」（v2） | 用新配音替换本段旁白片段的 store action（可撤销，处理时长变化） | 「新配音未上时间轴」芯片与 ⋯ 菜单 |

---

## 评审结论（Review Verdict）

**有条件通过（Approved with conditions）。**

v1 的方向、分期和功能保全方法都成立：Iteration 1 只重排、重命名、只读派生，Iteration 2 才引入新数据和新动作；§2.3 逐条对照表是「不影响功能」的有效抓手。评审发现 **0 个 P0、9 个 P1**，已全部在 v2 正文中修复（见「评审记录」RV-01 ~ RV-09 的「修复位置」）。**当前没有未解决的 P0 / P1。** 12 个 P2 中有 6 个已写进正文，其余 6 个（RV-16 ~ RV-21）交由实现者按记录处理。

进入开发的前提条件（下游开发与验收节点必须遵守）：

1. **先跑基线**（§9 第 1 步）：记录当前 HEAD 的 `npm test` 失败数、`type-check` 结果和项目级 lint error 数，之后按差分判定。没有基线就不能宣称「不影响功能」。
2. **两步迁移**：`SegmentCard` / `MaterialCard` / `AudioMaterialRow` 必须先「原样抽出、零视觉改动、测试全绿」，再换外观（R1）。两步分开验证，便于定位回归。
3. **段落派生唯一来源**：全仓只允许一处调用 `useSegmentLinks`（`VideoEditingInterface`），其余区域一律读 `SegmentLinksContext`。代码评审用 `grep -rn "useSegmentLinks(" src` 的结果等于 1 来核验（RV-01）。
4. **配音状态必须如实**：验收主任务（§7.3）必须实测「新配音未上时间轴」状态出现，且导出成片使用的是时间轴上的配音（RV-02）。
5. **对比度实测**：§7.2 第 5 项脚本必须覆盖 v2 新增的 `--ws-primary-solid` / `--ws-on-primary` / `--ws-danger`，深浅两套主题都要算，结果附到运行日志（RV-08）。
6. **桌面端走查**：§7.3 用 `desktop/ npm run dev` 完成，包括 1024×768 最小窗口；若用打包版验收，必须先重跑 `prepare-frontend`（R12）。历史上多轮「桌面走查未执行」，本轮不能再省略。
7. **范围守门**：§2.2 非目标和 §10 延后项在 Iteration 1 不得提前实现。尤其是「一键应用新配音到时间轴」「画布适配模式」「段落整体撤销」，它们会改变数据或导出行为，必须先有各自的设计。


---

## 实施过程发现的方案缺陷（Issues Found During Implementation，Iteration 1 开发节点）

以下是开发中发现的方案偏差或缺陷，以及实际采用的修正做法。基线为 HEAD `b4f6a4a`：vitest 365 个文件、2761 条用例、0 失败；tsc 0 错误。实施后：vitest 391 个文件、2911 条用例、0 失败；tsc 0 错误；本次改动文件 eslint 0 问题；`npm run build` exit 0；§7.2 第 5 项对比度脚本深浅两套主题 0 失败。

| # | 发现 | 修正做法 |
|---|---|---|
| IF-01 | 方案（及开发简报）假定 `lucide-react` 已安装，实际不在 `package.json` / `node_modules` 中；本轮不得新增依赖 | 全部改用内联 SVG 图标（lucide 几何，16px，stroke 1.75，`aria-hidden`）：`workbench/icons.tsx`、`workbench/inspector/icons.tsx`、`SegmentCard/icons.tsx`、`MaterialsPanel/materialIcons.tsx`。全仓已无 `lucide-react` import |
| IF-02 | §4 规模门「`VideoEditingInterface` 净增行数 ≤ 0」只靠 `useEditorExportWiring` / `useWorkbenchShortcuts` 两个 hook 做不到：首版接线后为 2476 行（+96） | 新增 `workbench/useWorkbenchWiring.ts`，承接布局、受控比例、页签打开、定位 / 显示素材、抽屉上下文行和快捷键。`useSegmentLinks` 仍只在 VEI 调用一次（grep 结果为 1）。VEI 最终 2373 行（≤ 基线 2380） |
| IF-03 | RV-18 已核实：`desktop/main/window.js` 设置了 `autoHideMenuBar: true`，单按 Alt 会唤出菜单栏 | 快捷键改为 `Ctrl+Alt+1` / `Ctrl+Alt+2` / `Ctrl+Alt+A`，按 `event.code` 匹配（与键盘布局无关）；i18n 提示同步 |
| IF-04 | RV-21 的「沿用现有 mock 判定」不存在：ScriptPanel 没有任何 mock 判定 | VEI 以 `!content?.scriptSegments` 作为 `isPlaceholderScript` 写入 `SegmentLinksContext`；占位段落不派生状态、不显示芯片和试听 |
| IF-05 | §8 对比度实测：浅色 `--ws-ok` 在其浅底上 3.88、`--ws-warn` 4.17、主色芯片文字 3.07、`--ws-danger` 在危险浅底上 4.24；深色危险浅底 4.38 | 浅色 ok 改为 `#146C34`（浅底 10%），warn 改为 `#8A5C00`（10%），danger 改为 `#B3301A`；danger-bg 两套主题都降到 8%；新增 `--ws-primary-text`（深色 `#0D99FF` / 浅色 `#0A5FA8`），专用于有色底上的主色文字（`.ws-chip--primary`、属性页链接）。复测 0 失败 |
| IF-06 | §5.4 `InspectorPanel` 接收 `selection` 并外挂 `onPreviewMaterial`，会让 VEI 增加选择推导和预览弹窗状态 | 选择由 `workbench/inspector/inspectorSelection.ts` 自行推导（规则：仍存在的候选中「最近一次用户操作」优先，否则按片段 > 素材 > 段落；时间轴同步引起的段落选中不算用户操作）。InspectorPanel 自带 `MediaPreviewModal`，props 改为 `onBeforePreview()` + `taskId` |
| IF-07 | §5.1 `EditorTopBarProps` 通过 props 传入撤销 / 重做状态 | 顶栏直接订阅 `useTimelineStore` 的 `canUndo` / `canRedo` / `externalEditLock` / `isInteracting`，与 `canTravelHistory` 一致；`EditorProjectChrome` 新增 `onRenameFailed(error)`，改名失败由 Container 统一报错 |
| IF-08 | 「适配画面」指定的 `fitImagePositionAction` 专供首帧自动适配：不记撤销，且需要图片原始尺寸 | 属性页用可撤销的 `updateImagePositionAction` 写满帧框（画布本身按 contain 绘制），保证用户点击可以 Ctrl+Z |
| IF-09 | 「属性页嵌入同一 `VolumeSlider`」不可行：它是 `Track.tsx` 为发起轨道渲染的 portal 弹层 | 属性页「轨道音量 N%」按钮调用 `showVolumeSliderForTrack` 打开同一弹层（撤销语义不变），静音走 `toggleTrackMuteAction`。时间轴折叠、轨道未挂载时弹层不出现（已知限制） |
| IF-10 | §3.8 轨道短名：`imageTrack` / `audioTrack` / `subtitleTrack` 同时还是轨道类型标签（添加轨道菜单等），不能直接改文案 | `TrackI18n` 新增 `imageShort` / `audioShort` / `subtitleShort`（图片 / 音频 / 字幕）。默认名为：主画面 / 画面 N / 旁白 N / 音频 N / 图片 N / 字幕 N；类型标签保持原样 |
| IF-11 | `DragTimeBadge` 按 §3.8 应渲染在时间轴滚动内容中，但 `TrackContainer` 不在改动计划内；裁切边缘也不在 store 中 | 由 `TimelinePanel` 在面板根（relative）渲染，layout effect 测量 `[data-clip-id]` 定位；裁切边缘读取 drag actor snapshot 的 `interactionType`。已知：顶层轨道的标签会压在标尺上；时间格式沿用 `formatTimelineTime`（`0:03.34`，不是 `00:03.34`） |
| IF-12 | 片段的 inline `box-shadow` 会覆盖 `.ws-item-linked` 的 box-shadow | 片段上的段落关联高亮改用 2px `--primary` outline（1px 偏移），与选中态内描边可叠加 |
| IF-13 | 既有测试 `TimelineToolbar.tooltip` 禁止同时存在原生 `title` 与 `PortalTooltip` | 工具栏按钮不加 `title`，快捷键文案放在 `PortalTooltip` 和 `aria-label` 中 |
| IF-14 | 「时间轴选中段落 → 横向滚动」放进 `TimelinePanel` 会让已超 1000 行的文件继续膨胀 | 新增 `timeline/hooks/useRevealSelectedSegment.ts`，以空叶子组件挂载，复用 `computeFollowScrollLeft`，不移动播放头 |
| IF-15 | RV-16（画面关联同时比对 `segment_text_hash`）在派生层没有实现：视频素材不带 hash 戳，只有 TTS 配音带 | 画面关联按 id 派生；Agent 重新生成脚本造成的 id 复用误关联仍是 R5 已知风险，留给 Iteration 2 与「段落持久 id」一并处理 |
| IF-16 | 任务中心「逐段配音显示原 `ttsProgress`」：`ttsProgress` 是 ScriptPanel 的局部 state，没有镜像 | 本轮逐段配音只显示「第 N 段配音 · 生成中」，不显示百分比；进度镜像随 §10「面板内任务统一登记」一并做 |
| IF-17 | 规模门需拆出比 §4 更多的文件 | 左栏另拆 `SegmentCardList` / `useSegmentListFocus` / `SegmentNarrationEditor` / `SegmentSentenceList` / `SegmentVideoCarousel` / `DefaultVoiceBar` / `FollowPlaybackSwitch`（纯展示，state 仍归 ScriptPanel）；素材页另拆 `MaterialMoreMenu` / `MaterialStatusOverlays`（状态遮罩原样迁移）。ScriptPanel 2837→2334（−503），MaterialsPanel 3072→2421（−651），两处规模门均达标 |
| IF-18 | 超过 1000 行上限的历史文件：`TimelinePanel.tsx` 由 1485 行增至 1524 行（imperative handle 和徽标挂载） | 记录在案；拆分留给独立重构。`editor-workbench.css` 1314 行（CSS，不在 TS/Python 行数门范围内） |

**未执行（必须由下游验收节点完成）**：§7.3 桌面端手工验收（`desktop/ npm run dev`，1600×900 / 1100×800 / 1024×768），以及「播放器 0:00 / 播放头 0:03」的真机复现。本节点只做了代码层修复：`resolveConsoleTime` 使播放条时间与喂给引擎的 `currentTimelineTime` 同源，并有单测 `player_time_matches_restored_playhead`。

## 最终代码审查记录（Final Code Review，Iteration 1 提交节点）

按 §2.3 功能保全表与 §4 变更计划分四个区域逐项审查 diff，确认入口全部仍在、处理函数与禁用条件不变。修复的缺陷：

| # | 位置 | 严重度 | 问题与修正 |
|---|---|---|---|
| CR-01 | `MaterialsPanel/MaterialMoreMenu.tsx` | 中 | ⋯ 菜单渲染在卡片 `z-index:20` 的操作层内，下一张卡的「+ 添加」会盖住菜单并吞点击 → 菜单 portal 到 `.editor-workbench` 根（保留 `--ws-*` token） |
| CR-02 | `workbench/PanelSplitter.tsx` | 中 | 拖动中面板被自动收起时 `ws-resizing` 残留；单击不拖动也会把求解后的宽度写回偏好并切到 custom → 卸载清理 + 仅在实际移动后提交 |
| CR-03 | `workbench/inspector/SubtitleTextField.tsx` | 中 | 输入字幕后直接点别的片段，检查器重挂载导致 blur 前卸载、编辑丢失 → 卸载时经同一可撤销 action 提交草稿 |
| CR-04 | `SegmentCard/SegmentVideoCarousel.tsx` | 中 | 收起卡片卸载正在播放的视频不会触发 `pause`，`playingVideos` 残留，再展开要点两次 → 卸载时回报停止 |
| CR-05 | `AgentChatDock/AgentChatDrawer.tsx` | 中 | 同时挂 `ws-drawer`(40) 与 `z-dock-panel`(860)，层级取决于样式表顺序，可能压住任务弹层 / 菜单 → 只保留工作台层级 |
| CR-06 | `VideoPlayerPanel/CanvasMenu.tsx` | 低 | 菜单关闭时也吞 Escape → 仅在打开时处理 |
| CR-07 | `workbench/useWorkbenchWiring.ts` | 低 | `pauseComposition` 未播放时也调用 `pauseFromTimeline` → 先判断 `isPlaying()` |
| CR-08 | `projects/VideoEditorContainer.tsx` | 低 | 改名请求晚于切换项目返回时把旧名写到新项目 → 校验项目仍是同一个 |
| CR-09 | `SegmentCard/DefaultVoiceBar.tsx` | 低 | 音色 id 变为列表外值时仍显示上一个音色名 → 名称按 id 绑定 |
| CR-10 | `workbench/SaveStatusIndicator.tsx` | 低 | 失败态卸载了 `aria-live` 区域，读屏不播报失败 → 失败按钮包在 `role="alert"` 内 |
| CR-11 | `MaterialFilterBar.tsx` / i18n / css / `AgentChatDock` | 低 | 分类页签误用搜索框标签（新增 `workbench.materials.categories`）；删除悬浮球与工具栏撤销后遗留的 i18n 死键；`.ws-item-linked` 重复规则合并；`AgentChatDock` 未使用的 `agentIsExecuting` prop 删除；测试 icon stub 补 displayName（eslint error） |

门禁（审查修复后）：tsc 0；vitest 392 个文件 / 2918 条全部通过；改动文件 eslint 0 error；`npm run build` exit 0。

已知遗留（低，留给 Iteration 2）：试听停止只 pause 不释放 src；`DefaultVoiceBar` 弹层的 Esc 与内层 VoiceSelector 下拉同时关闭、弹层位置不随窗口缩放更新；`retryNow` 在内容回到已保存版本时不改变「保存失败」状态；检查器再次点击同一素材不切回素材；`tailwind.config.js` 的 `dock` / `dock-panel` 层级 token 已无代码使用。§7.3 桌面端手工验收仍未执行。
