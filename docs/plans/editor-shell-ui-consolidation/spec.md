# 应用壳层与剪辑工作台 UI 收敛（Editor Shell UI Consolidation）

> 状态：设计稿 **v2**（v1 架构节点产出 → v2 设计评审修订；P0/P1 已全部改入正文，改动处标注「〔v2〕」）
> 分支基线：`feat/remove-user-system` @ `9191fa5`
> 前置文档：`docs/plans/segment-centric-editor-workbench/spec.md`（下称「R1 工作台 spec」）、`docs/plans/segment-centric-editor-workbench-r2/spec.md`
> 范围：前端（`src/`）为主；〔v2〕**另含 1 处加法式后端补丁**：`waveform_service` 识别 `/api/audio/generated/...`（见 §3.6.4，否则 TTS 片段的「默认波形」只能画成一条平线）。不改持久化工程数据格式、不改数据库。

---

## 评审记录（Review Notes，v2）

评审人：设计评审节点。评审方式：逐节对照当前代码（`9191fa5` 工作区）核实 v1 的每条事实陈述与可行性。维度：可行性 / 完整性 / 一致性（CLAUDE.md 与现有代码约定）/ 规模适当性。

| ID | 级别 | 位置 | 问题（含实证） | v2 处置 |
|---|---|---|---|---|
| RV-01 | **P0** | §3.3.2 | 新建菜单被裁切，功能不可见。v1 要求把 `NewTaskMenu` 放在任务栏 DOM 内、`left: calc(100% + 8px)`；但 `globals.css:299-312` 的 `.vertical-taskbar` 是 `width:48px; overflow:hidden`，任何伸出任务栏右边的绝对定位子元素都会被裁掉，菜单根本看不见。 | 已改：菜单用 `createPortal` 渲染到 `document.body`，`position:fixed`，坐标取自 `+` 按钮的 `getBoundingClientRect()`。并补上三处 Portal 带来的连带处理：外部 `mousedown` 收起判断、React 合成事件穿过 Portal 冒泡到任务栏 `onClick`（会误切换展开状态）、mouseleave 定时器（§3.3.2） |
| RV-02 | **P0** | §3.6 / R-7 | TTS 片段的「默认波形」画不出来。TTS 配音的 URL 是 `/api/audio/generated/<file>.mp3`（`sentence_tts_service.py:417`）；而 `waveform_service._resolve_source_path`（`waveform_service.py:445-486`）只认 `/api/storage/files/`，其它路径都拼到 `STORAGE_ROOT` 下，结果不是文件，返回 `None` 并报 `failed`。前端 `drawWaveform` 于是只画平直基线。用户点名要修的就是 TTS 片段，v1 把这件事降为风险 R-7、推到「后续」，等于 U6 在主场景上没有实现。 | 已改：新增 §3.6.4 后端加法补丁，storage 解析失败时回退到已有的 `local_media_resolver.resolve_media_reference`（它已在 `ROUTE_PREFIXES` 里支持 `/api/audio/generated/`）；补 pytest 回归；更新范围声明、§4、§7、R-7 |
| RV-03 | P1 | §3.2.2 | `openTask` 仍有并发重复创建的风险。现在的 `createTask`（`useTasks.ts:204-287`）从闭包里的 `appState` 判断，`page.tsx:44-49` 的自动打开 effect、StrictMode 双调用或快速连点都可能用到过期快照，造成同类型建出两个，破坏 I-1。v1 没有规定实现形式。另外 `Tab.isActive` 字段（`types/index.ts:50`）在 v1 算法里没有维护。 | 已改：规定 `openTask` 的「查找 + 创建 / 重开」必须在同一个 `setAppState(prev => …)` 函数式更新里完成；所有 Tab 的 `isActive` 与 `activeTabId` 同步；补回归测试 `open_task_called_twice_in_same_tick_creates_one` |
| RV-04 | P1 | §3.2.4 | 「导入素材到视频编辑」这条路径会断。`Container.tsx:48-53` 找不到视频任务时直接 `console.error` 返回。v1 取消了「首次同时建 chat+video」，用户只开过 AI 对话（或旧状态里只剩 chat）时，从聊天导出素材就会静默失败。v1 只处理了 “No tab found” 分支，而且 `openTask` 是异步 setState，没法在调用后马上拿到新任务 id 再 `updateTask`。 | 已改：`openTask(type, options?)` 增加 `options.updateContent`，在同一次函数式更新里原子地写入内容；Container 两个分支合并为一次调用 `onOpenTask('video', { updateContent })` |
| RV-05 | P1 | §3.2.2 / §3.2.3 | 标题键不一致，纯函数也拿不到 locale。v1 写的是 `t.tasks.aiChat / t.tasks.videoEditing`，`useTasks` 实际用的是 `t.tasks.types.*`（`useTasks.ts:71-76`）。`collapseToSingletonTasks` 作为纯函数，无法取到 i18n。 | 已改：签名加 `labelFor: (type) => string`，由 `useTasks` 传入 `buildTaskTypeLabel`，继续沿用 `t.tasks.types.*` |
| RV-06 | P1 | §3.1.3 `video-editing.css` 一行 | 指令自相矛盾，而且没有必要。v1 要求「以 `feab883~1` 为准逐条还原」，同时又要求「仅播放按钮保留 primary」。但 `feab883~1` 里 `.console-ratio-seg[aria-pressed]` 本来就是 `var(--primary)`；而当前控制台规则都写成 `var(--ws-*, fallback)`，token 改成引用全局后会自动回到全局中性色，整文件还原只会引入回归。 | 已改：不还原文件。只有 `.console-ratio-seg[aria-pressed="true"]`（若为蓝底）改为 `var(--accent)` + `var(--foreground)`；播放按钮经 token 自动回到 `var(--primary)` |
| RV-07 | P1 | §3.4.2 | 布局菜单向上弹出时会被遮挡或裁切。底部栏在 `.ws-timeline { overflow:hidden }` 里（`editor-workbench.css:128-135`），向上弹出的绝对定位菜单要压在轨道区之上：层叠顺序不确定（播放头、片段都有 z 值），时间轴缩到 `TIMELINE_MIN=160` 时还可能被裁。 | 已改：布局菜单同样用 Portal + `position:fixed`，锚在「布局」按钮上方，`z-index:1100`；外部点击判断同时认按钮和菜单 |
| RV-08 | P2 | §3.6.2 要点 5 | `.ws-audio-wave` 是素材面板音频行（`AudioMaterialRow.tsx:67`）的 SVG 波形，不是时间轴波形。时间轴用的是 canvas `drawWaveform`，靠 `color` prop 上色。 | 已在正文澄清：两处各自改色 |
| RV-09 | P2 | §3.5.4 | `EditorTopBar.tsx:177-182` 的 AI 助手按钮现在没有 `aria-controls`（`AGENT_DRAWER_ID` 只在 Dock 内部用到），所以不是「改为」，而是「新增」。 | 已改措辞 |
| RV-10 | P2 | §3.5.5 | i18n 里没有 `shell` 命名空间（`i18n.ts` 顶层键中不存在）。新建命名空间要同时改类型、en、zh 三处，违背「一个概念一个名字」。 | 已改：放到现有的 `tasks.newTaskMenu` |
| RV-11 | P2 | R-2 | 「返回同一引用可避免写 localStorage」不成立：水合时 scrub 步骤（`useTasks.ts:113-117`）总会生成新对象，并且 `setAppState` 后持久化 effect 必定执行。好在写入内容是幂等的，没有害处。 | 已改 R-2 表述；§3.2.3 第 6 步保留（便于单测），但不再宣称能省一次写入 |
| RV-12 | P2 | §3.4.4 / R-4 | Agent 执行期间，底部栏的「AI 助手」按钮随时间轴一起变成 `inert`，而这恰好是用户最常想打开助手的时刻。好在悬浮球、顶栏按钮和 `Ctrl+Alt+A` 都还能用。 | 接受，保持 v1 取舍；§7.3 增加一条走查项 |
| RV-13 | P2 | §7.1 | 会被本轮打破的旧测试需要逐一点名：`AgentChatDock.test.tsx:46-55`（断言悬浮文件**不存在**、`<AgentChatDrawer`），`VerticalTaskbar.a11y.test.ts:39-40`（`onCreateTask`），`useTasks.persistence.test.ts:47/132/251`（`createTask`）。 | v1 已大体覆盖；v2 在 §7.1 补齐行号 |
| RV-14 | P2 | §3.5.2 | 旧 `useDraggableFab`（`b4f6a4a`）只监听 `window.resize`、钳制下限为 0；v1 写的是 `ResizeObserver` + 下限 8。二者差异需要明确。 | 以 v1 为准（改用 `ResizeObserver` 监听 `offsetParent`、下限 8），并在 §3.5.2 注明这是对旧实现的**有意修改** |

**规模评估**：六项诉求一一对应，没有额外扩张。「任务折叠」是唯一新增的数据迁移，已写成可单测的幂等纯函数，规模合适。v1 选择「恢复」而非「重写」悬浮球，大幅降低了风险，保留。

---

## 0. 一页结论（给赶时间的实现者）

| # | 用户诉求 | 本设计的落点 | 优先级 |
|---|---|---|---|
| U1 | 界面颜色不统一：新改的部分偏蓝，原界面是黑灰色 → 全部统一回原来的颜色 | `.editor-workbench` 作用域的 `--ws-*` 灰阶 token 改为**引用全局 `:root` token**（`#1E1E1E/#252525/#2C2C2C/#383838/#3A3A3A`），去掉自带的蓝调灰；蓝色（`--primary`）只保留为「强调色」，不再用作大面积底色 / 选中底色 / 序号徽标底色 | P0 |
| U2 | 最左侧任务栏底部两个「+」合并为一个，点击后弹出浮层让用户选「AI 对话 / 视频编辑」 | `VerticalTaskbar` 底部只留一个 `+`，点击弹出 `NewTaskMenu`（两项菜单） | P0 |
| U3 | 任务栏不再显示多个对话 / 视频编辑，一次只允许一个 AI 对话 + 一个视频编辑 | `useTasks` 改为「每类型单例」：`openTask(type)` 已存在则切换 / 重开，不存在才创建；加载时把历史多实例折叠为每类型一个（聊天会话合并，不丢数据） | P0 |
| U4 | 视频编辑内部左侧工具条（脚本 / 素材 / 属性 / AI 助手 / 布局）移到底部 Footer，放在「轨道 / 素材」文字的左边 | 删除 `ToolWindowRail` 竖条；新增 `FooterToolbar`，通过 `TimelinePanel → TrackContainer` 的 `footerLeading` 插槽渲染在底部轨道管理栏最左侧 | P0 |
| U5 | AI 助手恢复为右下角可拖拽的圆形悬浮按钮，点击弹出 AI 交互浮窗 | 从 git 历史（`b4f6a4a`）恢复 `AgentChatFloatingButton` / `useDraggableFab` / `AgentChatFloatingPanel`，替换 R1 的右侧抽屉 `AgentChatDrawer`；位置按用户拖拽结果持久化 | P0 |
| U6 | 音频轨上 TTS 片段的文案 / 标签和波形重叠，默认只显示波形 | 音频片段默认「波形模式」：波形铺满片段，**不在波形上叠任何文字**；片段名放进片段顶部独立 14px 标题条（仅轨道足够高时）；原「句段色块」视图保留为可选模式，由时间轴工具栏开关切换，默认关闭；〔v2〕后端 `waveform_service` 补识别 `/api/audio/generated/`，使 TTS 片段能真正生成波形 | P1 |

**不做**：除 §3.6.4 那一处加法式解析补丁外的后端改动；工程 JSON 结构变更；R1 其余布局（三栏、顶栏、分隔条）改动；Agent 行为变更。

---

## 1. 概述 Overview

上一轮（R1/R2）按「以视频段落为核心」重组了视频编辑工作台，引入了 `src/styles/editor-workbench.css` 这套作用域 token（`--ws-bg: #141619`、`--ws-panel: #1C1F24`、`--ws-raised: #252932` 等）。这些灰阶的蓝通道明显高于红绿通道，是**带蓝调的冷灰**；同时 R1 还把全局蓝色主色 `--primary`（`#0D99FF`）大量用于选中底色（`--ws-selected-bg = color-mix(primary 12%)`）、实心序号徽标（`.ws-badge-ordinal` 用 `--ws-primary-solid #0A6FC2`）、工具条激活条、Tab 下划线等大面积表面。结果是：工作台内部整体发蓝，而工作台之外的应用外壳（`AppTitleBar` 用 `bg-card`/`bg-accent`，任务栏、聊天页、设置页）仍是原有的中性黑灰（`globals.css` 中 `--background #1E1E1E`、`--card #252525`）。用户看到的就是「一半蓝、一半黑」。本设计把工作台 token 重新挂回全局 token，让全应用只有一套中性灰阶，蓝色只作点缀。

第二组问题在应用外壳：最左侧 `VerticalTaskbar` 底部有两个外观完全一样的 `+`（仅 `title` 不同），用户分不清；且任务模型允许无限新建「视频编辑 2 / 3 …」「AI 对话 2 / 3 …」，关闭 Tab 后任务仍堆积在 localStorage。产品定位是单用户桌面应用，一个 AI 对话入口和一个视频编辑入口已经足够（视频编辑内部本来就有「项目列表」来管理多个工程，聊天内部本来就有多会话）。本设计把任务改为「每类型单例」，任务栏最多两个图标，底部合并为一个 `+` 并用菜单选择类型。

第三组问题在剪辑工作台内部：R1 新增的左侧竖向工具条占了一列宽度，与应用最左侧任务栏形成「两条竖栏」；R1 把 AI 助手从悬浮球改成了右侧抽屉，用户更习惯原来的右下角悬浮球 + 浮窗；TTS 配音片段在音频轨上把片段名、句数、时长叠在波形 / 句段色块之上，信息互相遮挡。本设计把工具条按钮下沉到时间轴底部栏最左侧、恢复可拖拽悬浮球、并让音频片段默认只显示干净的波形。

---

## 2. 范围与功能保全

### 2.1 本轮范围

| ID | 条目 | 涉及区域 |
|---|---|---|
| W1 | 工作台配色回归全局中性灰阶 | `src/styles/editor-workbench.css`、少量组件 className |
| W2 | 任务栏单一 `+` + 类型选择浮层 | `src/components/VerticalTaskbar.tsx`、新 `src/components/shell/NewTaskMenu.tsx`、`globals.css` |
| W3 | 任务单例化 + 历史数据折叠 | `src/hooks/useTasks.ts`、新 `src/hooks/taskSingleton.ts`、`src/app/page.tsx`、`src/components/Container.tsx` |
| W4 | 工具条移入底部栏 | 删 `ToolWindowRail.tsx`，新 `FooterToolbar.tsx`；`EditorWorkbench`、`TimelinePanel`、`TrackContainer`、`useWorkbenchWiring` |
| W5 | AI 助手悬浮球 + 浮窗回归 | `AgentChatDock/*`、`video-editing.css` 或 `editor-workbench.css`、i18n |
| W6 | 音频片段默认波形 | `timeline/TimelineItem.tsx`、`TimelineToolbar.tsx`、新 `timeline/audioClipDisplayPref.ts`；〔v2〕后端 `app/services/waveform_service.py`（§3.6.4） |

### 2.2 功能保全对照（实现与验收逐条勾选）

| 现有能力 | 调整后入口 | 必须保持不变 |
|---|---|---|
| 新建 AI 对话 / 视频编辑（任务栏） | 单个 `+` → 菜单两项 | CLAUDE.md 规定「Container 空状态和任务栏新建按钮是唯一建任务入口，不得删除」——两处都保留，只是语义变成「打开或新建」 |
| Container 空状态两张卡片 | 不变（调用 `onOpenTask`） | 卡片文案、布局不变 |
| 聊天多会话 | 聊天页内部会话列表 | 历史多个聊天任务的会话在折叠时**合并**进唯一聊天任务，不丢 |
| 视频多工程 | 视频编辑内的项目列表 `VideoProjectListView` | 工程数据在后端，不受任务折叠影响 |
| 脚本面板开合 | 底部栏「脚本」 | `layout.toggle('left')` |
| 素材 / 属性 Tab | 底部栏「素材」「属性」 | `toggleSideTab` 语义不变（再次点击收起） |
| 布局预设 / 重置 | 底部栏「布局」菜单（向上弹出） | `applyPreset('script'|'edit')`、`reset()` |
| AI 助手开合 | 右下角悬浮球；顶栏「AI 助手」按钮；底部栏「AI 助手」；`Ctrl+Alt+A` | 四个入口共享同一 `isAgentDockOpen` |
| Agent 执行中可取消 / 撤销 | 浮窗内 `VideoChatWindow` | `chatProps` 原样透传 |
| 助手上下文行「正在协助：第 2 段 · …」 | 浮窗标题下方 | `assistantContextLabel` 不变 |
| 句段悬停提示（句子全文 + 起止时间） | 波形模式下由透明命中层提供同样的原生 `title` | 不能因为改波形而丢掉句子提示 |

### 2.3 非目标

- 不改 `--primary` 的色值，不改亮色主题配色（亮色主题随 token 引用自动跟随全局）。
- 不做任务栏拖拽排序、不做多窗口。
- 不改 `VideoChatWindow` 内部 UI。
- 不改时间轴轨道颜色（`--timeline-video/audio/...`）与 `SentenceSegmentBar` 的六色调色板（它只在「句段模式」出现，且是数据可视化用途，不属于「界面底色」）。

---

## 3. 技术设计 Technical Design

### 3.1 W1 配色统一

#### 3.1.1 根因

- 全局 token（`src/styles/globals.css:6-78` `:root`、`:80-` `.dark`、`:124-` `.light`）是中性灰：`--background #1E1E1E`、`--card #252525`、`--popover #2C2C2C`、`--muted #2A2A2A`、`--accent #383838`、`--border #3A3A3A`、`--foreground #E0E0E0`、`--secondary-foreground #B3B3B3`、`--muted-foreground #8C8C8C`。
- 工作台 token（`src/styles/editor-workbench.css:8-29`）自带一套冷灰：`#141619 / #1C1F24 / #252932 / #2C313B / #2A2E36`，并用 `--primary` 做选中底色、实心徽标。
- 工作台作用域由 `EditorWorkbench.tsx:87` 的 `.editor-workbench` 根节点生效，所以工作台内部整体偏蓝，外壳不偏蓝。

#### 3.1.2 方案：token 改为「引用」全局，不再自带色值

把 `editor-workbench.css` 顶部 `.editor-workbench { ... }` 的灰阶与文字 token 改为引用全局变量，**并删除 `.light .editor-workbench` 中对应的灰阶 / 文字行**（引用后亮色主题自动跟随 `globals.css` 的 `.light` 值）：

```css
.editor-workbench {
  /* 与应用外壳共用同一套中性灰阶（editor-shell-ui-consolidation W1）。
     不再自带色值：外壳改色时工作台自动跟随。 */
  --ws-bg:            var(--background);        /* #1E1E1E */
  --ws-panel:         var(--card);              /* #252525 */
  --ws-raised:        var(--popover);           /* #2C2C2C */
  --ws-hover:         var(--accent);            /* #383838 */
  --ws-selected-bg:   var(--accent);            /* 选中底色改为中性灰，不再混蓝 */
  --ws-border-subtle: var(--border);            /* #3A3A3A */
  --ws-text:          var(--foreground);        /* #E0E0E0 */
  --ws-text-secondary:var(--secondary-foreground); /* #B3B3B3 */
  --ws-text-tertiary: var(--muted-foreground);  /* #8C8C8C */
  /* 语义色（ok / warn / danger）保持原值不动 */
  /* 实心强调：只用于唯一主操作按钮「导出视频」与开关打开态 */
  --ws-primary-solid:       var(--primary);
  --ws-primary-solid-hover: var(--primary-hover);
  --ws-on-primary:          var(--primary-foreground);
  --ws-primary-text:        var(--primary);
  ...（尺寸类 token 不变）
}
```

`.light .editor-workbench` 只保留 `--ws-ok* / --ws-warn* / --ws-danger*` 等语义色行；删除 `--ws-bg / --ws-panel / --ws-raised / --ws-hover / --ws-border-subtle / --ws-text* / --ws-primary-solid* / --ws-primary-text` 这些行。

> 为什么 `--ws-primary-solid` 回到 `var(--primary)`：R1 为了白字对比度另设了 `#0A6FC2`，与应用其它地方的主按钮（`bg-primary`）颜色不一致，正是「蓝色不统一」的来源之一。应用全局主按钮一直是 `bg-primary text-primary-foreground`，工作台跟随全局保持一致；白字对比度问题属于全局主题议题，本轮不单独在工作台内修（见 §8 R-3）。

#### 3.1.3 「蓝色只做强调」规则与具体替换清单

**允许**使用 `--primary` 的地方（保持不变）：焦点环 `--ring`、播放头、进度条（导出进度、任务进度 `editor-workbench.css:930`）、分隔条 hover / 拖动（`:183`、`:186`）、选中描边（`border-color: var(--primary)` 的 1px 边框）、唯一主按钮「导出视频」（`EditorTopBar.tsx:138`）、开关打开态（`.ws-switch` `:597`）、链接色文字。

**必须改为中性**的大面积蓝（逐条落地）：

| 位置 | 现状 | 改为 |
|---|---|---|
| `editor-workbench.css:438` `.ws-badge-ordinal`（段落卡与时间轴片段上的「01」实心徽标） | `background: var(--ws-primary-solid)` 白字 | `background: var(--secondary)`（#333333）；`color: var(--foreground)`；选中段落时改为 `background: var(--foreground); color: var(--background)`（黑白反相，仍然醒目） |
| `:301` 工具条按钮按下态、`:377`、`:386` 图标按钮按下态、`:427` `.ws-chip--primary`、`:549` `.ws-card` 选中、`:1042` 素材卡 / 音频行选中、`:1338`、`:1477` | `var(--ws-selected-bg)`（混蓝） | 因 token 已改为 `var(--accent)` 自动生效；`:427` `.ws-chip--primary` 的 `color` 同时改为 `var(--ws-text)` |
| `:311` 工具条激活竖条、`:477` Tab 下划线 | `background: var(--primary)` | `background: var(--foreground)`（与外壳 Tab 风格一致的白色下划线） |
| `:258` 忙碌点 | `var(--primary)` | 保留（状态指示，面积极小） |
| `:822` `.timeline-item.ws-item-linked` 蓝色外框 | `outline: ... var(--primary)` | `outline: 1px solid color-mix(in srgb, var(--foreground) 55%, transparent)` |
| `:858` `.ws-drawer-icon` | 蓝色图标 | 随 §3.5 删除抽屉一起删除 |
| `:1151-1157` `.ws-audio-wave { fill: var(--primary) }`（〔v2〕RV-08：这是**素材面板音频行** `AudioMaterialRow.tsx:67` 的 SVG 波形，不是时间轴波形；时间轴波形见 §3.6.2 要点 5） | 蓝色波形 | `fill: color-mix(in srgb, var(--foreground) 70%, transparent)` |
| `video-editing.css` 播放器控制台（〔v2〕RV-06） | 规则已写成 `var(--ws-*, fallback)` | **不还原文件**：token 改为引用全局后，这些规则自动落回全局中性色，播放按钮 `.console-play-btn` 经 `--ws-primary-solid → var(--primary)` 自动回到全局主色（保留，属唯一播放主操作）。只改一处：`.console-ratio-seg[aria-pressed="true"]` 若仍为 `var(--primary)` 底，改为 `background: var(--accent); color: var(--foreground)`（选中态中性化） |
| `src/components/video/**` 中 **由 `feab883` / `9191fa5` 新增的** `bg-primary`、`bg-primary/10`、`bg-primary-a/*`、`ws-selected` 类 className | 蓝底 | 改为 `bg-accent`（选中/高亮底）或 `bg-secondary`（徽标/标签底），文字 `text-foreground`；**边框类 `border-primary` 与 `ring-primary` 保留** |

最后一行的「由这两个提交新增」判定方法（实现者必须执行，不得凭感觉挑）：

```bash
git diff feab883~1 9191fa5 -U0 -- src/components src/styles \
  | grep -E '^\+' | grep -nE 'bg-primary|primary-a|ws-selected|ws-primary-solid|from-primary|to-primary'
```

对输出的每一行：若为「底色 / 渐变 / 实心徽标」→ 按上表改中性；若为边框 / 焦点 / 文字链接 / 进度 → 保留。改完后再跑一遍命令，把保留项与理由记入实现提交说明。**不改**这两个提交之前就存在的蓝色（如 `Track.tsx:325 text-blue-600`、`VoiceSelector.tsx:151`），它们不属于本次回归范围。

#### 3.1.4 外壳侧

`TitleBarActions.tsx:68` 的 `'text-primary bg-primary/10'` 激活态改为 `'text-foreground bg-accent'`，与 `AppTitleBar.tsx:130/147` 的 `bg-accent` 一致。

### 3.2 W3 任务单例化（先于 W2 实现，W2 依赖它）

#### 3.2.1 现状

`src/hooks/useTasks.ts`：`createTask` (`:204-287`) 每次追加一个新任务，标题编号 `视频编辑 2`；首次创建时一次建出 chat + video 两个任务（`:208-250`）；`closeTab` (`:300-323`) 只删 Tab，任务留在 `tasks` 里。`Container.tsx:49` 用 `tasks.find(t => t.type === 'video')` 取「第一个」视频任务，多实例时会取到已关闭的那个（`:70-75` 打印 “No tab found”）。

#### 3.2.2 新语义

- **不变式 I-1**：`tasks` 中每个 `TaskType` 至多 1 个任务；`tabs` 中每个 `taskId` 至多 1 个 Tab；每个 Tab 的 `taskId` 必须存在于 `tasks`。
- `openTask(type: TaskType, options?: OpenTaskOptions): void`（替换 `createTask`，旧名删除，全仓改名）：
  1. 在 `tasks` 找 `type` 匹配的任务 `existing`。
  2. 若 `existing` 存在：若其 Tab 已关闭则按 `SINGLETON_TAB_ORDER`（`['chat','video']`）重新插入 Tab；把 `activeTabId` 设为该 Tab。
  3. 若不存在：新建任务（`title = buildTaskTypeLabel(type)`，不再带编号）+ Tab，激活。
  4. **不再**「首次创建时同时建 chat + video」；只建被请求的那一个。
  5. 〔v2 RV-04〕若传了 `options.updateContent`，在**同一次**更新里对目标任务（已有或新建）执行 `content = options.updateContent(content ?? null)`，并刷新 `updatedAt`。调用方因此不必知道新任务 id。
- 〔v2 RV-03〕**实现形式强制**：步骤 1–5 全部写在一个 `setAppState(prev => …)` 函数式更新里，只读 `prev`，不读闭包里的 `appState`。`useCallback` 的依赖只含 `buildTaskTypeLabel`。这样，同一 tick 内调用两次（StrictMode 双 effect、快速连点、`page.tsx` 自动打开与用户点击撞车）仍然只会得到一个任务。返回的新状态里，每个 Tab 的 `isActive === (tab.id === activeTabId)`。
- `closeTab(tabId)` 行为不变（只关 Tab、保留任务数据），这样再次从 `+` 打开时恢复原内容。
- `closeAllTabs()` 保留，行为不变（清空全部任务，测试 `useTasks.persistence.test.ts:128` 依赖它）。
- 标题：〔v2 RV-05〕`Task.title` / `Tab.title` 固定为 `buildTaskTypeLabel(type)`，即现有的 `t.tasks.types.video` / `t.tasks.types.chat`，不带序号。任务栏展示仍走 `getTaskLabel`（`t.tasks.videoEditing / aiChat`），不受影响。

```ts
export interface OpenTaskOptions {
  /** 在同一次状态更新中改写目标任务的 content（原子，避免 id 竞态）。 */
  updateContent?: (previous: unknown) => unknown;
}
```

#### 3.2.3 历史数据折叠（加载时，幂等）

新文件 `src/hooks/taskSingleton.ts`，纯函数、可单测：

```ts
export const SINGLETON_TAB_ORDER: readonly TaskType[] = ['chat', 'video'];

/** 把任意历史 AppState 规整为满足 I-1 的状态；已满足时原样返回同一引用。
 *  labelFor：由 useTasks 传入 buildTaskTypeLabel（纯函数不直接依赖 i18n，RV-05）。 */
export function collapseToSingletonTasks(
  state: AppState, labelFor: (type: TaskType) => string,
): AppState;

/** 多个聊天任务的 content 合并：会话按 id 去重，保留 kept 的 activeConversationId。 */
export function mergeChatContents(
  kept: ChatTaskContent | null, others: Array<ChatTaskContent | null>,
): ChatTaskContent | null;
```

`collapseToSingletonTasks` 算法：

1. 按 type 分组。每组选「保留者」：优先 `activeTabId` 指向的任务；否则选 `updatedAt` 最新的任务。
2. chat 组：`kept.content = mergeChatContents(kept.content, 其余.content)`；合并顺序为保留者会话在前，其余按 `updatedAt` 倒序追加，按 `conversation.id` 去重（先出现者胜）。`uiState` 用保留者的。
3. video 组：直接丢弃非保留者（工程数据在后端；`selectedProjectId` 以保留者为准）。
4. Tabs：丢弃指向被丢弃任务的 Tab；同一 `taskId` 多个 Tab 只留第一个；Tab 和任务的 `title` 都重写为 `labelFor(type)`；按 `SINGLETON_TAB_ORDER` 排序。
5. `activeTabId`：若原活动 Tab 被丢弃，改指同类型保留者的 Tab；仍无则取第一个 Tab；无 Tab 为 `null`。〔v2〕最后按 `activeTabId` 重写每个 Tab 的 `isActive`。
6. 若输入已满足 I-1、标题已规整且 `isActive` 一致，返回原对象。这是为了让单测能断言「幂等」，并不保证省掉一次 localStorage 写入（见 R-2）。

接入点：`useTasks.ts` 读取 localStorage 后（`:104-117` 过滤非法类型之后、`:119-138` 旧英文标题迁移之前）调用一次 `collapseToSingletonTasks(nextState, buildTaskTypeLabel)`；折叠已重写标题，因此其后的旧标题迁移变为空操作，可删除（删除时一并删 `LEGACY_TITLE_TO_TYPE`）；持久化 key 仍为 `'ecliptrix-tasks-state-v1'`（算法幂等，无需升版本）。`?task=<id>` URL 参数若指向被丢弃的任务：映射到同类型保留者。

#### 3.2.4 调用方改名

| 文件 | 改动 |
|---|---|
| `src/app/page.tsx:24,48,104,118` | `createTask` → `openTask`；prop `onCreateTask` → `onOpenTask`；`:44-49` 自动打开视频任务逻辑不变（调用 `openTask('video')`） |
| `src/components/Container.tsx:17,99,114` | prop 改名 `onOpenTask?: (type: TaskType, options?: OpenTaskOptions) => void`。〔v2 RV-04〕「导入素材到视频编辑」处理函数（`:48-75`）整体改为**一次调用**：`onOpenTask('video', { updateContent: prev => ({ ...(prev as VideoEditingTaskContent \| null), markdownContent: prev?.markdownContent \|\| '', lastModified: new Date(), pendingMaterials: materials }) })`。视频任务不存在时由 `openTask` 新建，Tab 已关时自动重开并激活。删除 “No Video Editing task found” 与 “No tab found” 两个 `console.error` 分支，以及对 `onUpdateTask` / `onSelectTab` / `tasks` / `tabs` 的这段依赖（其它用途保留）。 |
| `src/components/VerticalTaskbar.tsx` | 见 §3.3 |
| `CLAUDE.md` 「Shell」一行 | 由下游开发节点把 “task bar's "new task" buttons” 改为 “task bar's single "+" menu”，并说明每类型单例 |

### 3.3 W2 任务栏：单一 `+` 与类型浮层

#### 3.3.1 结构

`src/components/VerticalTaskbar.tsx`：

- 删除 `NEW_TASK_TYPES` 循环渲染的两个按钮（`:196-223`）。
- 新增一个 `+` 按钮（沿用 `.taskbar-tab.new-task-button` 样式与现有 plus SVG），`aria-haspopup="menu"`、`aria-expanded={isMenuOpen}`、`aria-label/title = t.common.newTask`（「新建任务」）。
- 点击切换 `isMenuOpen`；菜单由新组件 `src/components/shell/NewTaskMenu.tsx` 渲染。
- Tab 列表（`:148-191`）不变，但因为 I-1，最多 2 项；图标沿用 `getTaskIcon`。

#### 3.3.2 `NewTaskMenu`

```tsx
export interface NewTaskMenuProps {
  /** 已存在的任务类型：菜单项文案变为「切换到…」 */
  existingTypes: ReadonlySet<TaskType>;
  onChoose(type: TaskType): void;
  onClose(): void;
  /** 关闭后焦点归还的按钮 */
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}
```

- 〔v2 RV-01〕渲染位置：**`createPortal(menu, document.body)`**，不能放在任务栏 DOM 内部。原因：`.vertical-taskbar` 是 `width:48px; overflow:hidden`（`globals.css:299-312`），伸出右边的子元素会被裁掉。定位方式为 `position:fixed`，坐标在打开时（以及 `resize` 时）由 `+` 按钮的 `getBoundingClientRect()` 计算：`left = rect.right + 8`、`bottom = window.innerHeight - rect.bottom`，写入内联 style。`z-index: 1100`（与 tailwind `popover` 同级，写在 CSS 中）。任务栏展开 / 收起动画（`width` 过渡 0.3s）期间按钮会横移，所以在 `transitionend` 时再算一次坐标。
- Portal 带来的三处连带处理（缺一不可）：
  1. **外部点击收起**：`VerticalTaskbar` 的 `mousedown` 外部判断（`:90-100`）改为「`taskbarRef` 或 `menuRef` 包含 target 都算内部」；`NewTaskMenu` 自己的外部 `pointerdown` 关闭判断同样把 `returnFocusRef`（`+` 按钮）当作内部，避免「点 `+` 关菜单后又被 click 立即打开」。
  2. **合成事件冒泡**：React 事件会沿组件树穿过 Portal 冒泡到 `.vertical-taskbar` 的 `onClick={handleTaskbarClick}`，导致展开状态被误切换。所以菜单根节点要 `onClick={e => e.stopPropagation()}`，`onMouseDown` 也一样。
  3. **mouseleave 自动收起**：鼠标从任务栏移到 Portal 菜单上，会触发任务栏的 `mouseleave`。菜单打开期间，`VerticalTaskbar` 的自动收起（mouseleave 定时器与外部点击收起 `:61-111`）必须暂停，在两处收起判断里都加 `if (isMenuOpenRef.current) return;`；菜单关闭后，若鼠标不在任务栏上，则照常启动 300ms 收起。
- 两项（顺序固定：AI 对话在上，视频编辑在下），每项：图标（复用 `getTaskIcon`）+ 主标题 `t.tasks.aiChat` / `t.tasks.videoEditing` + 副标题：存在时为 `t.tasks.newTaskMenu.switchTo`（「已打开，点击切换」），不存在时为 `t.tasks.newTaskMenu.create`（「新建」）。（〔v2 RV-10〕i18n 放在现有 `tasks` 命名空间。）
- `role="menu"`，项 `role="menuitem"`；打开时焦点到第一项；`ArrowUp/ArrowDown` 循环；`Enter/Space` 选择；`Esc` 关闭并把焦点还给 `+`；点击菜单外关闭（`pointerdown` 监听，与 `ToolWindowRail.tsx:61-68` 相同写法）。
- 选择后：`onChoose(type)` → `VerticalTaskbar` 调 `onOpenTask(type)`，关菜单，收起任务栏。
- 任务栏处于 `isBlurred`（聊天弹窗打开）时，`+` 禁用，菜单不可打开。

#### 3.3.3 样式（`globals.css`，紧随 `.new-task-button` `:361-367`）

```css
/* 〔v2〕Portal 到 body，left/bottom 由 JS 按 + 按钮位置写入内联 style */
.new-task-menu { position:fixed; z-index:1100;
  min-width:200px; padding:4px; border-radius:8px;
  background:var(--popover); border:1px solid var(--border);
  box-shadow:0 8px 24px rgba(0,0,0,.35); }
.new-task-menu-item { display:flex; align-items:center; gap:10px; width:100%;
  min-height:40px; padding:6px 10px; border-radius:6px; color:var(--foreground); text-align:left; }
.new-task-menu-item:hover, .new-task-menu-item:focus-visible { background:var(--accent); outline:none; }
.new-task-menu-item-hint { font-size:12px; color:var(--muted-foreground); }
```

全部使用全局中性 token，不出现蓝色。

### 3.4 W4 工具条移入底部栏

#### 3.4.1 目标形态

时间轴底部轨道管理栏（`TrackContainer.tsx:401-472`，`h-8 bg-muted border-t`）改为：

```
[脚本][素材][属性][AI 助手][布局▴] │ 轨道: 4  素材: 12  时长: 00:01:23.400      添加轨道: [视][图][音][字]
```

- 左端新增 `FooterToolbar`，后接 1px 竖分隔线（`h-4 w-px bg-border mx-2`），再接原有统计文字。右端「添加轨道」不变。
- 删除工作台最左侧竖条，工作区横向多出 48px。

#### 3.4.2 组件 `src/components/video/workbench/FooterToolbar.tsx`（新增，替代 `ToolWindowRail.tsx`）

- Props：沿用并更名 `ToolWindowRailProps` → `FooterToolbarProps`（字段完全相同：`isScriptOpen / isMaterialsOpen / isPropertiesOpen / isAssistantOpen / onToggleScript / onToggleMaterials / onToggleProperties / onToggleAssistant / onApplyPreset / onResetLayout`）。
- 按钮：`<button class="ws-footer-btn" aria-pressed>`，图标 14px（`strokeWidth 1.75`）+ 文字 12px，高 24px，横向 `padding: 0 8px`，按钮间距 2px；按下态 `background: var(--ws-raised); color: var(--ws-text)`，未按下 `color: var(--ws-text-secondary)`，hover `var(--ws-hover)`。**不使用蓝色。**
- 容器 `<div className="ws-footer-tools" role="toolbar" aria-label={t.workbench.regions.rail}>`；`ArrowLeft/ArrowRight` 在按钮间移动焦点（roving tabindex）。
- 「布局」菜单：逻辑从 `ToolWindowRail.tsx:52-122` 的 `LayoutMenu` 原样搬入。〔v2 RV-07〕定位改为：`createPortal` 到 `document.body`，`position:fixed; z-index:1100`，锚在「布局」按钮上方——`left = rect.left`、`bottom = window.innerHeight - rect.top + 4`。原因：底部栏位于 `.ws-timeline { overflow:hidden }` 内，普通绝对定位向上弹出时会与轨道区片段、播放头的层叠顺序打架，时间轴很矮时还会被裁。外部 `pointerdown` 关闭判断同时把「布局」按钮和菜单视为内部；菜单根节点带 `data-overlay="true"`，这样 `EditorWorkbench.useOverlayDismiss` 不会把点击菜单当作「点了工作区」去关浮层面板。
- 窄宽度（底部栏宽 < 900px，用 `ResizeObserver` 或 CSS container query `@container (max-width: 900px)`）时隐藏文字只留图标，`title`/`aria-label` 保留。
- i18n 复用 `t.workbench.rail.*`（键名不改，避免 i18n 大面积改动；`regions.rail` 的中文值由「工具窗口」改为「面板工具」）。

#### 3.4.3 接线

1. `TrackContainer.tsx`：`TrackContainerProps` 新增 `footerLeading?: React.ReactNode`；在 `:404` 左侧统计 `<div>` 之前渲染 `{footerLeading && (<>{footerLeading}<span className="h-4 w-px bg-border mx-2" aria-hidden /></>)}`，外层左组 `div` 改为 `flex items-center min-w-0`。
2. `TimelinePanel.tsx`：Props 新增 `footerLeading?: React.ReactNode`，原样转给 `:1456-1469` 的 `<TrackContainer>`。
3. `VideoEditingInterface.tsx:2126`：删除 `rail={...}`；在 `:2200` `<TimelinePanel>` 上加 `footerLeading={<FooterToolbar {...workbench.footerToolbarProps} />}`；`:90` import 中 `ToolWindowRail` 换成 `FooterToolbar`。
4. `useWorkbenchWiring.ts:26,55,126,140`：`railProps: ToolWindowRailProps` 更名为 `footerToolbarProps: FooterToolbarProps`，内容不变。
5. `EditorWorkbench.tsx`：删除 `rail` prop（`:21`、`:74`、`:90`）；`useOverlayDismiss` 中 `closest('[data-overlay="true"], .ws-rail')` 改为 `closest('[data-overlay="true"], .ws-footer-tools')`（点击底部开关不应先关掉浮层面板再被开关反向操作）。
6. `workbench/index.ts:6`：导出 `FooterToolbar`，删 `ToolWindowRail`。
7. 删除 `ToolWindowRail.tsx`；删除 `editor-workbench.css:273-313` 全部 `.ws-rail*` 规则，新增 `.ws-footer-tools / .ws-footer-btn` 规则。删除前 `grep -rn "ws-rail" src` 必须为 0。

#### 3.4.4 Agent 执行锁的影响（已知取舍）

底部栏位于 `section.ws-timeline` 内，Agent 执行期间该区域 `inert` + 遮罩（`EditorWorkbench.tsx:130-133`），因此底部开关在 Agent 执行期间不可点。这与现有「添加轨道」按钮行为一致。AI 助手不受影响（悬浮球与顶栏按钮在 `inert` 区域之外），`Ctrl+Alt+A`、`Alt+1/2` 快捷键（文档级监听）也不受影响。见 §8 R-4。

### 3.5 W5 AI 助手：悬浮球 + 浮窗回归

#### 3.5.1 来源

三份文件在 `feab883` 被删除，最后版本在 `b4f6a4a`：

```bash
git show b4f6a4a:src/components/video/components/AgentChatDock/AgentChatFloatingButton.tsx
git show b4f6a4a:src/components/video/components/AgentChatDock/useDraggableFab.ts
git show b4f6a4a:src/components/video/components/AgentChatDock/AgentChatFloatingPanel.tsx
git show b4f6a4a:src/components/video/components/AgentChatDock/AgentChatDock.tsx
git show b4f6a4a:src/styles/video-editing.css   # :1401-1530 .agent-chat-fab* / .agent-chat-floating-panel*
```

以这些版本为基础恢复（**恢复，不重写**），然后做下面的差量修改。

#### 3.5.2 差量修改

| 项 | 修改 |
|---|---|
| `AgentChatDock.tsx` | 以 `b4f6a4a` 版本为基础。Props 为 `{ isOpen, onOpen, onMinimize, agentIsExecuting, chatProps, contextLabel }`（在旧 props 上增加 `contextLabel: string \| null`）。保留当前版本的 `AGENT_DRAWER_ID` 导出但改名 `AGENT_PANEL_ID = 'ws-assistant-panel'`（顶栏按钮 `aria-controls` 指向它）；浮窗根元素 `id={AGENT_PANEL_ID}` 取代旧的 `useId()` |
| `AgentChatFloatingPanel.tsx` | 标题区在 `title` 下增加一行上下文：`contextLabel ?? t.workbench.assistant.contextProject`（样式沿用当前抽屉 `.ws-panel-subtitle`，12px、`--ws-text-secondary`） |
| z-index | tailwind 中 `dock`/`dock-panel` token 已被 R2 删除且有测试 `r1Leftovers.tokens.test.ts` 守护不得恢复。改为在 CSS 中直接写：`.agent-chat-fab { z-index: 850; }`、`.agent-chat-floating-panel { z-index: 860; }`，并附注释「高于时间轴锁遮罩(50)，低于 overlay(900)/modal(1000)」；JSX 上删除 `z-dock` / `z-dock-panel` 类 |
| FAB 配色 | `background: var(--primary)` 保留（它是唯一悬浮主操作，属于「强调」用法）；`color: var(--primary-foreground)`（旧版 `var(--card)` 在蓝底上对比不足） |
| 默认位置 | 定位父元素为 `.ws-main`（`EditorWorkbench.tsx:91`，需确认其 `position: relative`，没有则在 CSS 中补上）。默认 `right: 24px; bottom: 48px`（避开 32px 高的底部栏及其「添加轨道」按钮） |
| 位置持久化 | `useDraggableFab` 在 pointerup 且发生过拖动时写 `localStorage['ecliptrix.agentFab.position.v1'] = JSON.stringify({right,bottom})`；初始化时读取并按当前父元素尺寸钳制（`clamp(value, 8, parentSize - FAB_SIZE - 8)`）。读写一律 `try/catch`，失败时回落默认位置并 `console.warn('[AgentFab] position storage unavailable', error)`。窗口 / 父元素尺寸变化（`ResizeObserver` 监听父元素）时重新钳制，保证不出界。〔v2 RV-14〕这是对 `b4f6a4a` 旧实现的**有意修改**：旧版只监听 `window.resize`、钳制下限为 0；新版改用 `ResizeObserver` 监听 `offsetParent`（环境不支持时回退到 `window.resize`），下限 8，拖动中的 `clamp` 也同步改为下限 8 |
| 拖拽 vs 点击 | 保留旧实现：位移 > 5px（`DRAG_THRESHOLD`）视为拖拽，`movedRef` 吞掉随后的合成 click |
| 执行中 | 保留 `.agent-chat-fab.is-busy::after` 脉冲环与 `busy` 文案 |
| 浮窗锚定 | 保留旧 `usePanelGeometry`：浮窗贴 FAB 展开，空间不足时 `compact`，并计算 FAB 是否被遮挡 |

#### 3.5.3 删除项

- `AgentChatDrawer.tsx`；`editor-workbench.css` 中 `.ws-drawer*`（`:609-625`、`:848-875` 一带，以 grep 为准）。
- `EditorWorkbench` 的 `drawer` 插槽**保留**（改名 `assistant`），其内容换成新的 `AgentChatDock`（悬浮球 + 浮窗都在 `.ws-main` 内定位）。

#### 3.5.4 接线（`VideoEditingInterface.tsx:2217-2234`）

```tsx
assistant={
  <AgentChatDock
    isOpen={isAgentDockOpen}
    onOpen={() => setIsAgentDockOpen(true)}
    onMinimize={() => setIsAgentDockOpen(false)}
    agentIsExecuting={agent.agentIsExecuting}
    contextLabel={workbench.assistantContextLabel}
    chatProps={{ /* 原样不变 */ }}
  />
}
```

顶栏 `EditorTopBar.tsx:177-182` 的 AI 助手按钮保留，并〔v2 RV-09〕**新增** `aria-controls={AGENT_PANEL_ID}`（现状没有该属性）。同时删除 `AGENT_DRAWER_ID` 导出（全仓仅 `AgentChatDock.tsx` 与 `index.ts` 引用）。

#### 3.5.5 i18n

在 `src/lib/i18n.ts` 的 `videoEditing` 类型、en、zh 三处恢复 `agentDock` 块（值取 `b4f6a4a` 版本：`fabLabel / panelTitle / close / minimize / busy`，zh：「AI 剪辑助手 / AI 剪辑助手 / 收起 / 最小化助手 / Agent 执行中…」）。新增〔v2 RV-10〕`tasks.newTaskMenu`（放在现有 `tasks` 命名空间，类型 + en + zh 三处）：`{ create: '新建' | 'Create', switchTo: '已打开，点击切换' | 'Open — switch to it' }`；菜单标题 / `+` 的 `aria-label` 复用已有 `t.common.newTask`，不另建 `title` 键。新增 `timeline.audioDisplay`（见 §3.6）。`t.workbench.assistant.*` 保留（上下文行复用）。

### 3.6 W6 音频片段默认显示波形

#### 3.6.1 现状

`timeline/TimelineItem.tsx:609-703` 的 `case 'audio'`：

- 有句段（TTS 配音，`item.sentenceSegments && visibleSentenceCount > 0`，`:612`）→ 渲染 `SentenceSegmentBar` 六色色块（每块中央有序号），**再在其上**叠一层 `absolute inset-0` 的图标 + `ClipName` + 「N 句」+ 时长（`:621-652`）。
- 无句段 → `AudioWaveformCanvas`（`absolute inset-0` 铺满）**再在其上**叠图标 + `ClipName`（`:669-684`，`relative z-[1]`）。
- 两种情况文字都压在图形上。TTS 配音素材由 `useSegmentVoiceGeneration.ts:152-167` 生成，带 `materialId`（素材 id）和 `serverUrl`（`/api/audio/generated/...`），因此具备生成波形的条件。

#### 3.6.2 新渲染规则

新增显示偏好 `AudioClipDisplay = 'waveform' | 'sentences'`，**默认 `'waveform'`**。

`case 'audio'` 改为（伪代码，下游按此实现）：

```tsx
const LABEL_STRIP_PX = 14;
const showLabelStrip = trackHeight >= 36;              // 轨道太矮时不画标题条
const bodyTop = showLabelStrip ? LABEL_STRIP_PX : 0;
const bodyHeight = trackHeight - bodyTop;
const useSentenceView = audioDisplay === 'sentences'
  && item.sentenceSegments && visibleSentenceCount > 0;

<div style={contentStyle} title={audioClipTooltip}>   // 原生提示：片段名 · N 句 · 时长
  {showLabelStrip && (
    <div className="ws-audio-label-strip" style={{ height: LABEL_STRIP_PX }}>
      <ClipName ... />  <span className="ws-audio-label-meta">{durationText}</span>
    </div>
  )}
  <div className="absolute left-0 right-0" style={{ top: bodyTop, height: bodyHeight }}>
    {useSentenceView
      ? <SentenceSegmentBar ... height={bodyHeight} />          // 句段色块，不再叠文字
      : waveformAudioUrl && item.materialId
        ? <AudioWaveformCanvas ... height={bodyHeight} />
        : <StaticPlaceholderBars />}                              // 原 :687-699 逻辑
    {!useSentenceView && item.sentenceSegments && visibleSentenceCount > 0 && (
      <SentenceHitLayer ... />   // 透明命中层：句子边界 1px 细线 + 每句原生 title
    )}
  </div>
</div>
```

要点：

1. **波形上不叠任何文字**：标题条与波形区在纵向上互不重叠（标题条 `top:0; height:14px`，波形区从 14px 开始）。标题条样式：`font-size: 11px; line-height: 14px; padding: 0 6px; color: #fff; background: rgba(0,0,0,.28); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`。时长放在标题条右侧；「N 句」芯片删除（信息进入原生 `title`）。
2. **轨道高度 < 36px**：不画标题条，波形铺满，片段名只在 `title` 提示中。
3. **句子提示不丢**：新增 `SentenceHitLayer`（放在 `SentenceSegmentBar.tsx` 同目录新文件 `SentenceHitLayer.tsx`），复用 `projectSentencesOntoClip` 计算每句 `leftPct/widthPct`，渲染透明块：`border-right: 1px solid rgba(255,255,255,.35)`（最后一句除外）、`title = getSentenceTooltip(sentence)`（把 `SentenceSegmentBar.tsx:54-59` 的提示构造抽成同目录导出函数 `buildSentenceTooltip`，两处共用）。透明块 `pointer-events: auto` 仅用于悬停；不得拦截片段拖拽：不在命中层上 `stopPropagation`，事件自然冒泡到片段容器。
4. `SentenceSegmentBar` 本身不变（只在「句段模式」使用）；其块内序号保留（此时无叠加文字，不冲突）。
5. 〔v2 RV-08〕时间轴波形是 canvas，由 `AudioWaveformCanvas` 的 `color` prop 上色，传 `'rgba(255,255,255,0.78)'`。`.ws-audio-wave`（§3.1.3）是素材面板音频行的 SVG 波形，两者互不影响。`AudioWaveformCanvas` 自带 `absolute inset-0`，所以必须包在上面伪代码的 `top: bodyTop` 容器里（该容器 `position:absolute`，是 canvas 的定位父元素），不得直接放进 `contentStyle` 根节点。

#### 3.6.3 偏好存储与开关

- 新文件 `src/components/video/timeline/audioClipDisplayPref.ts`：

```ts
export type AudioClipDisplay = 'waveform' | 'sentences';
export const AUDIO_CLIP_DISPLAY_KEY = 'ecliptrix.timeline.audioClipDisplay.v1';
export const DEFAULT_AUDIO_CLIP_DISPLAY: AudioClipDisplay = 'waveform';
export function readAudioClipDisplay(): AudioClipDisplay;          // try/catch，非法值回落默认
export function writeAudioClipDisplay(value: AudioClipDisplay): void; // try/catch + console.warn
export function useAudioClipDisplay(): [AudioClipDisplay, (v: AudioClipDisplay) => void];
```

  `useAudioClipDisplay` 用 `useSyncExternalStore` 订阅一个模块级 listener 集合，保证工具栏切换后所有 `TimelineItem` 同步重渲染；同时监听 `storage` 事件。**这是纯 UI 偏好，不写入工程数据**。
- 开关位置：`TimelineToolbar.tsx` 右侧工具组（缩放控件左边），一个图标切换按钮（lucide `AudioWaveform` ↔ `Rows3`），`aria-pressed={display === 'sentences'}`，`title = t.timeline.audioDisplay.toggleTitle`（「音频片段：显示句段（默认显示波形）」）。按钮使用中性按下态（`bg-accent`），不使用蓝色。
- 老用户：键不存在 → 默认波形，符合「默认显示为波形」。

#### 3.6.4 〔v2 RV-02〕后端补丁：波形服务识别 TTS 生成音频

**根因（已核实）**：

- TTS 片段的音频 URL 形如 `/api/audio/generated/<file>.mp3`（`sentence_tts_service.py:417`、`tts_service.py:431`），前端 `selectPlaybackUrl(item, { purpose: 'export' })` 把它作为 `audio_url` 发给 `POST /api/storage/waveform/generate`。
- `WaveformService._resolve_source_path`（`app/services/waveform_service.py:445-486`）只剥离 `/api/storage/files/` 前缀；其它相对引用直接拼到 `STORAGE_ROOT` 下（得到 `STORAGE_ROOT/api/audio/generated/...`），不是文件，于是返回 `None`，`generate` 报 `failed`。前端 `drawWaveform` 收到空 peaks，只画平直基线。
- 已有的 `app/services/local_media_resolver.resolve_media_reference` 在 `ROUTE_PREFIXES` 里本来就支持 `/api/audio/generated/`、`/api/audio/subtitles/`，含 legacy 目录回退和 `validate_local_path_for_ffmpeg` 路径护栏。合成导出走的就是它。

**改动**（加法式，不改接口，不动 DDL）：

```python
def _resolve_source_path(self, audio_url: str) -> Optional[Path]:
    ...  # 现有 /api/storage/files/ 与相对 / 绝对路径逻辑保持不变
    resolved = <现有逻辑结果>
    if resolved is not None:
        return resolved
    # TTS / 字幕等由 audio_router 服务的同源路由：与合成导出共用同一解析器，
    # 保证 "write == serve == resolve"（main.py:554 注释）。
    try:
        return resolve_media_reference(audio_url).path
    except LocalMediaResolveError as exc:
        logger.warning("Waveform source not resolvable via media resolver", {
            "audio_url": audio_url, "error": str(exc)})
        return None
```

- `resolve_media_reference` 默认 `allow_remote=False`，远程 URL 仍然拒绝，安全边界不变。
- import 方向：`services → services`，不引入 `routers ↔ services` 环。
- TTS 素材 id 形如 `audio_<segmentId>_<ts>`，符合 `_SAFE_MATERIAL_ID_RE`（`^[A-Za-z0-9._\-]+$`），可用作 peaks 文件名。实现时要用一段真实 TTS 的 segment id 核对；如果 segment id 里有其它字符，按 400 走现有错误路径，前端回落为静态占位条，仍然不叠字。
- **测试**（`backend-services/basic-service/tests/test_waveform_service.py`，新增 / 追加）：`test_resolves_generated_tts_audio_url`（在 `audio_generated_dir()` 下放一个临时 mp3，断言 `_resolve_source_path('/api/audio/generated/x.mp3')` 返回该文件）；`test_rejects_remote_url_without_storage_marker`（`https://example.com/a.mp3` 返回 `None`）。运行 `pytest tests/test_waveform_service.py -v`。

---

## 4. 文件 / 模块变更计划

| 文件 | 类型 | 意图 |
|---|---|---|
| `src/styles/editor-workbench.css` | 修改 | 灰阶/文字 token 改引用全局；删 `.light` 中对应行；徽标、选中、下划线、linked 外框、波形改中性；删 `.ws-rail*`、`.ws-drawer*`；新增 `.ws-footer-tools/.ws-footer-btn`、`.ws-audio-label-strip/.ws-audio-label-meta` |
| `src/styles/video-editing.css` | 修改 | 播放器控制台按钮还原 R1 前中性表面；恢复 `.agent-chat-fab*`、`.agent-chat-floating-panel*`（来自 `b4f6a4a`，z-index 直接写入） |
| `src/styles/globals.css` | 修改 | 新增 `.new-task-menu*` 样式 |
| `src/components/video/**`（按 §3.1.3 命令输出） | 修改 | R1/R2 新增的大面积 `bg-primary*` 改中性 |
| `src/components/shell/TitleBarActions.tsx` | 修改 | 激活态 `bg-primary/10 text-primary` → `bg-accent text-foreground` |
| `src/hooks/taskSingleton.ts` | 新增 | `collapseToSingletonTasks` / `mergeChatContents` / `SINGLETON_TAB_ORDER` 纯函数 |
| `src/hooks/useTasks.ts` | 修改 | `createTask` → `openTask`（单例语义）；加载时折叠；固定标题 |
| `src/app/page.tsx` | 修改 | 改名接线 `openTask` / `onOpenTask` |
| `src/components/Container.tsx` | 修改 | prop 改名；删除 “No tab found” 分支 |
| `src/components/VerticalTaskbar.tsx` | 修改 | 单个 `+`、菜单开合、菜单打开时暂停自动收起 |
| `src/components/shell/NewTaskMenu.tsx` | 新增 | 类型选择浮层（键盘可达） |
| `src/components/video/workbench/FooterToolbar.tsx` | 新增 | 底部栏左端面板开关 + 向上弹出的布局菜单 |
| `src/components/video/workbench/ToolWindowRail.tsx` | 删除 | 被 FooterToolbar 取代 |
| `src/components/video/workbench/index.ts` | 修改 | 导出切换 |
| `src/components/video/workbench/EditorWorkbench.tsx` | 修改 | 删 `rail` 插槽；`drawer` 改名 `assistant`；overlay 豁免选择器改 `.ws-footer-tools` |
| `src/components/video/workbench/useWorkbenchWiring.ts` | 修改 | `railProps` → `footerToolbarProps` |
| `src/components/video/timeline/TimelinePanel.tsx` | 修改 | 透传 `footerLeading` |
| `src/components/video/timeline/TrackContainer.tsx` | 修改 | 底部栏左端渲染 `footerLeading` + 分隔线 |
| `src/components/video/VideoEditingInterface.tsx` | 修改 | 去 `rail`，给 TimelinePanel 传 `footerLeading`，`assistant` 插槽换悬浮版 `AgentChatDock` |
| `src/components/video/components/AgentChatDock/AgentChatDock.tsx` | 修改（从 `b4f6a4a` 恢复 + 差量） | 悬浮球 + 浮窗 + 上下文行 |
| `src/components/video/components/AgentChatDock/AgentChatFloatingButton.tsx` | 恢复 | 圆形可拖拽按钮（去 `z-dock` 类） |
| `src/components/video/components/AgentChatDock/useDraggableFab.ts` | 恢复 + 修改 | 位置持久化与尺寸变化钳制 |
| `src/components/video/components/AgentChatDock/AgentChatFloatingPanel.tsx` | 恢复 + 修改 | 标题下上下文行；`id=AGENT_PANEL_ID` |
| `src/components/video/components/AgentChatDock/AgentChatDrawer.tsx` | 删除 | 抽屉移除 |
| `src/components/video/components/AgentChatDock/index.ts` | 修改 | 导出 `AgentChatDock, AGENT_PANEL_ID` |
| `src/components/video/workbench/EditorTopBar.tsx` | 修改 | `aria-controls` 指向 `AGENT_PANEL_ID` |
| `src/components/video/timeline/TimelineItem.tsx` | 修改 | 音频片段分区渲染：标题条 + 波形区 / 句段区，不叠字 |
| `src/components/video/timeline/SentenceSegmentBar.tsx` | 修改 | 抽出 `buildSentenceTooltip` 导出函数 |
| `src/components/video/timeline/SentenceHitLayer.tsx` | 新增 | 波形模式下的句子边界线 + 原生提示 |
| `src/components/video/timeline/audioClipDisplayPref.ts` | 新增 | 音频片段显示偏好（localStorage + 订阅） |
| `src/components/video/timeline/TimelineToolbar.tsx` | 修改 | 新增「显示句段」切换按钮 |
| `backend-services/basic-service/app/services/waveform_service.py` | 修改〔v2〕 | `_resolve_source_path` 回退到 `resolve_media_reference`，支持 `/api/audio/generated/` |
| `backend-services/basic-service/tests/test_waveform_service.py` | 新增 / 修改〔v2〕 | TTS 生成音频解析回归测试 |
| `src/lib/i18n.ts` | 修改 | 恢复 `videoEditing.agentDock`；新增 `tasks.newTaskMenu`〔v2〕、`timeline.audioDisplay`；`workbench.regions.rail` 中文改「面板工具」 |
| `CLAUDE.md` | 修改（下游开发节点做） | Shell 描述改为单一 `+` 菜单与每类型单例 |
| 测试文件 | 新增 / 更新 | 见 §7 |

---

## 5. 接口设计

本轮无 REST / WebSocket / CLI 变更。以下为前端模块接口（TypeScript）。

```ts
// src/hooks/useTasks.ts
export interface UseTasksReturn {
  tasks: Task[]; tabs: Tab[]; activeTabId: string | null; activeTask: Task | null;
  hydrated: boolean;
  /** 打开某类型任务：已存在则切换（Tab 已关则重开），否则新建。每类型至多一个。
   *  〔v2〕单个函数式 setState 内完成；options.updateContent 原子改写内容。 */
  openTask(type: TaskType, options?: OpenTaskOptions): void;
  selectTab(tabId: string): void;
  closeTab(tabId: string): void;
  closeAllTabs(): void;
  updateTask(taskId: string, patch: Partial<Task>): void;
}

// src/components/VerticalTaskbar.tsx
export interface VerticalTaskbarProps {
  tabs: Tab[]; activeTabId: string | null;
  onSelectTab(tabId: string): void; onCloseTab(tabId: string): void;
  onOpenTask?(type: TaskType, options?: OpenTaskOptions): void;   // 原 onCreateTask
  isBlurred?: boolean;
}

// src/components/Container.tsx —— onCreateTask 改名 onOpenTask，其余不变

// src/components/video/workbench/FooterToolbar.tsx
export interface FooterToolbarProps {
  isScriptOpen: boolean; isMaterialsOpen: boolean;
  isPropertiesOpen: boolean; isAssistantOpen: boolean;
  onToggleScript(): void; onToggleMaterials(): void;
  onToggleProperties(): void; onToggleAssistant(): void;
  onApplyPreset(id: Exclude<LayoutPresetId, 'custom'>): void;
  onResetLayout(): void;
}

// src/components/video/workbench/EditorWorkbench.tsx
export interface EditorWorkbenchProps {
  topBar: React.ReactNode; left: React.ReactNode; center: React.ReactNode;
  right: React.ReactNode; timeline: React.ReactNode; assistant: React.ReactNode;
  layout: UseWorkbenchLayoutReturn; isTimelineLocked: boolean;
}

// TrackContainer / TimelinePanel 新增
footerLeading?: React.ReactNode;

// src/components/video/components/AgentChatDock/AgentChatDock.tsx
export const AGENT_PANEL_ID = 'ws-assistant-panel';
export interface AgentChatDockProps {
  isOpen: boolean; onOpen(): void; onMinimize(): void;
  agentIsExecuting: boolean; chatProps: VideoChatWindowProps;
  contextLabel: string | null;
}

// src/components/video/components/AgentChatDock/useDraggableFab.ts
export type FabPosition = { right: number; bottom: number };
export const FAB_POSITION_KEY = 'ecliptrix.agentFab.position.v1';
export function useDraggableFab(): UseDraggableFabResult; // 形状同 b4f6a4a
```

快捷键：`Ctrl+Alt+A`（切换助手）、`Alt+1/Alt+2`（布局预设）保持不变（`useWorkbenchShortcuts`）。

---

## 6. 数据模型

### 6.1 持久化工程数据

**无变化**。`VideoEditingTaskContent`、时间轴 JSON、后端表结构均不改。

### 6.2 浏览器本地存储（per-viewer 偏好 / 状态）

| Key | 形状 | 说明 |
|---|---|---|
| `ecliptrix-tasks-state-v1`（已有） | `AppState { tasks: Task[]; tabs: Tab[]; activeTabId }` | 语义收紧为满足 I-1；加载时 `collapseToSingletonTasks` 幂等规整，**不升版本号** |
| `ecliptrix.agentFab.position.v1`（新） | `{ right: number; bottom: number }`（px，相对 `.ws-main`） | 拖拽后写入；读取后按当前尺寸钳制；非法 JSON / 非有限数 → 丢弃用默认 |
| `ecliptrix.timeline.audioClipDisplay.v1`（新） | `'waveform' \| 'sentences'` | 缺省 / 非法 → `'waveform'` |

所有读写包裹 `try/catch`，异常时 `console.warn` 带上下文并回落默认，页面照常渲染（隐私窗口、存储被禁用时）。

### 6.3 内存形状

- `VerticalTaskbar`：新增 `isMenuOpen: boolean` 与 `isMenuOpenRef`（供收起定时器读取）。
- `useTasks` 内部：不再需要「同类型计数」逻辑，删除 `:255-261` 的编号计算。

---

## 7. 测试与验收

### 7.1 自动化测试（vitest；每条命名即其钉住的行为）

| 测试文件 | 用例 |
|---|---|
| `src/hooks/__tests__/taskSingleton.test.ts`（新） | `collapses_two_video_tasks_keeping_the_active_one`；`keeps_most_recently_updated_when_none_active`；`merges_chat_conversations_dedup_by_id`；`remaps_active_tab_to_kept_task`；`drops_orphan_and_duplicate_tabs`；`returns_same_reference_when_already_singleton`；`orders_tabs_chat_then_video` |
| `src/hooks/__tests__/useTasks.persistence.test.ts`（更新；现有 `:47/:132/:251` 调用 `createTask` 需改名） | 旧 “编号 2/3” 断言删除；新增 `open_task_twice_does_not_duplicate`、〔v2〕`open_task_called_twice_in_same_tick_creates_one`（同一 `act` 内连调两次）、`open_task_reopens_closed_tab_with_same_content`、`first_open_creates_only_requested_type`、`legacy_multi_task_state_is_collapsed_on_load`、〔v2〕`open_task_update_content_applies_to_new_task`（无视频任务时 `updateContent` 写入新任务）、〔v2〕`tab_is_active_matches_active_tab_id` |
| `src/components/__tests__/VerticalTaskbar.a11y.test.ts`（更新；现有 `:39-40` 断言 `onCreateTask` 需反转） | 只有一个 `new-task-button`；`aria-haspopup="menu"`；菜单两项、`Esc` 归还焦点；存在的类型显示「已打开，点击切换」；〔v2〕`menu_is_portaled_outside_taskbar`（菜单节点不在 `.vertical-taskbar` 内）；〔v2〕`clicking_menu_item_does_not_toggle_taskbar_expansion` |
| `src/components/shell/__tests__/NewTaskMenu.test.tsx`（新） | `arrow_keys_cycle_items`；`choose_calls_onChoose_with_type`；`outside_pointerdown_closes`；〔v2〕`pointerdown_on_trigger_is_not_outside` |
| `src/components/__tests__/Container.importMaterials.test.tsx`（新〔v2〕） | `import_to_video_opens_video_task_with_pending_materials`（`onOpenTask` 以 `'video'` + `updateContent` 调用一次，`updateContent(null)` 产出含 `pendingMaterials` 的内容） |
| `backend-services/basic-service/tests/test_waveform_service.py`（〔v2〕pytest） | `test_resolves_generated_tts_audio_url`；`test_rejects_remote_url_without_storage_marker` |
| `src/components/video/workbench/__tests__/FooterToolbar.test.tsx`（新） | 五个按钮渲染及 `aria-pressed` 映射；布局菜单向上弹出（`bottom` 样式）；`Esc` 关闭菜单 |
| `src/components/video/workbench/__tests__/r1Leftovers.test.ts`（更新/新增用例） | `tool_window_rail_is_gone`（文件不存在，`ws-rail` 在 `src` 中 0 命中）；`dock_z_index_tokens_still_absent_from_tailwind`（保留 T-L5） |
| `src/components/video/workbench/__tests__/workbenchPalette.test.ts`（新，源码文本断言） | `.editor-workbench` 块中 `--ws-bg/--ws-panel/--ws-raised/--ws-hover/--ws-border-subtle/--ws-text*` 全部为 `var(--…)` 引用；整个文件不含 `#141619`、`#1C1F24`、`#252932`、`#2C313B`、`#2A2E36`、`#0A6FC2`；`.ws-badge-ordinal` 规则不含 `primary` |
| `AgentChatDock/__tests__/AgentChatDock.test.tsx`（重写；现有 `:27` 读取 `AgentChatDrawer.tsx`、`:46-55` 断言悬浮文件不存在，必须一并反转，否则文件删除后测试直接 ENOENT） | 反转旧断言：三个悬浮文件存在、`AgentChatDrawer.tsx` 不存在；`dock` 含 `useDraggableFab` 与 `onOpen`；浮窗 `id` 为 `AGENT_PANEL_ID`；CSS 中 `.agent-chat-fab` 有 `z-index: 850` |
| `AgentChatDock/__tests__/AgentChatDock.lifecycle.test.tsx`（更新） | 点击 FAB 打开、最小化后焦点回 FAB、`Esc` 关闭、上下文行显示、会话切换后 `VideoChatWindow` 以新 key 重建 |
| `AgentChatDock/__tests__/useDraggableFab.test.ts`（新） | `drag_beyond_threshold_suppresses_click`；`persists_position_after_drag`；`clamps_restored_position_into_parent`；`storage_failure_falls_back_to_default` |
| `timeline/__tests__/audioClipDisplayPref.test.ts`（新） | `defaults_to_waveform`；`invalid_value_falls_back`；`write_notifies_subscribers` |
| `timeline/__tests__/TimelineItem.audio.test.tsx`（新） | 默认模式下 TTS 片段渲染 `AudioWaveformCanvas`、不渲染 `SentenceSegmentBar`；标题条与波形区纵向不重叠（波形容器 `top === 14`）；轨道高 < 36 时无标题条；切到 `sentences` 渲染色块且无叠加文字；波形模式下句子 `title` 仍存在 |

### 7.2 静态与质量门

- `npm run type-check` 0 错误；`ESLINT_USE_FLAT_CONFIG=false npx eslint <改动文件>` 0 error。
- `npx vitest run` 全绿（与基线相比无新增失败）。
- 〔v2〕后端：`pytest tests/test_waveform_service.py -v` 全绿；`pytest tests/ -v` 与基线相比无新增失败。
- `grep -rn "ToolWindowRail\|ws-rail\|AgentChatDrawer\|ws-drawer\|createTask\|onCreateTask" src` → 0（`i18n` 的 `rail` 键名除外，属保留键）。
- §3.1.3 的 `git diff` 审计命令输出中，所有「底色类」项已处理。
- 新文件 ≤ 1000 行、函数 ≤ 60 行（恢复的 `AgentChatDock.tsx` 保留原注释中已声明的超长理由）。

### 7.3 手工验收（桌面端 `desktop/ npm run dev`，1600×900 与 1100×800 两种窗口）

- [ ] 编辑页任意区域（顶栏、三栏、时间轴、底部栏、菜单、弹层）与标题栏、任务栏、聊天页并排看，灰阶一致，无偏蓝底色；蓝色只出现在焦点环、播放头、进度条、选中描边、「导出视频」、悬浮球。
- [ ] 亮色主题下同样一致（切换主题后工作台跟随全局）。
- [ ] 〔v2〕任务栏**收起**（48px）和**展开**（240px）两种状态下点击 `+`，菜单都完整显示在任务栏右侧、不被裁切；鼠标从 `+` 移到菜单上时任务栏不自动收起；点菜单项后任务栏不会先闪一下展开 / 收起。
- [ ] 〔v2〕只打开过 AI 对话（先关闭视频编辑 Tab，或用只含 chat 任务的旧 localStorage 启动），在聊天里执行「导入素材到视频编辑」：自动打开视频编辑且素材进入待导入。
- [ ] 任务栏底部只有一个 `+`；点击弹出两项菜单；选「视频编辑」在已有视频任务时只切换不新建；关闭 AI 对话 Tab 后再从 `+` 打开，历史会话还在。
- [ ] 任务栏最多两个图标；用一份含 3 个视频任务 + 2 个聊天任务的旧 localStorage 启动，折叠为各 1 个，两个聊天任务的会话都能在聊天页看到。
- [ ] 编辑页左侧不再有竖向工具条；底部栏左端依次为 脚本 / 素材 / 属性 / AI 助手 / 布局，右侧紧接「轨道 / 素材 / 时长」统计；各按钮开合行为与原工具条一致；布局菜单向上弹出不被裁切。
- [ ] 右下角出现圆形 AI 悬浮球，不压住底部栏；可拖拽到任意位置，拖拽不触发打开；重启应用后位置保留；缩小窗口后悬浮球仍在可视范围内。
- [ ] 点击悬浮球弹出 AI 浮窗，可发送指令，Agent 执行期间脉冲环可见、浮窗内可取消；时间轴锁遮罩出现时悬浮球与浮窗仍可操作。
- [ ] 〔v2〕把时间轴拖到最矮（160px）时打开底部栏「布局」菜单：菜单完整显示在按钮上方，不被轨道片段或播放头遮挡。
- [ ] 〔v2〕Agent 执行期间，底部栏按钮不可点（预期，RV-12），但悬浮球、顶栏「AI 助手」、`Ctrl+Alt+A` 仍能开合助手。
- [ ] 生成一段 TTS 配音拖入音频轨：默认只见**真实起伏的**波形（〔v2〕不是平直基线；后端日志无 “Waveform source could not be resolved”），片段名在波形上方独立标题条，文字与波形不重叠；悬停波形各句区域仍能看到句子全文提示；时间轴工具栏切换「显示句段」后出现彩色句段色块，且无叠加文字；刷新后偏好保留。

---

## 8. 风险与缓解

| ID | 风险 | 缓解 |
|---|---|---|
| R-1 | 任务折叠丢数据：多个聊天任务各有会话 | `mergeChatContents` 合并会话（按 id 去重），有单测；视频任务只丢 `selectedProjectId`，工程在后端不丢。实现前先把折叠逻辑写成纯函数并覆盖边界用例 |
| R-2 | 折叠在每次加载都执行，可能造成无谓的 localStorage 写入与 URL 抖动 | 〔v2 RV-11〕水合时 scrub 步骤总会生成新对象，持久化 effect 本来就会写一次。折叠幂等，所以这次写入的内容与读到的一致，URL 也用 `replaceState`，不产生历史记录，没有副作用。「返回同一引用」只用于单测断言幂等 |
| R-3 | `--ws-primary-solid` 回到 `#0D99FF` 后，「导出视频」白字对比度 2.99:1（R1 RV-08 指出） | 与应用其它主按钮保持一致优先（用户明确要求统一）；在提交说明中记录此已知项，作为全局主题议题另立任务，不在工作台局部分叉配色 |
| R-4 | 底部开关位于 `inert` 时间轴区域内，Agent 执行时不可点 | 与「添加轨道」一致；助手入口（悬浮球、顶栏、快捷键）不受影响；如需执行中可切面板，后续可把底部栏抽出 `section.ws-timeline`（本轮不做，避免改动 S9 锁语义） |
| R-5 | 恢复的悬浮球与 R2 删掉的 tailwind z-index token 冲突 | 不恢复 token，直接在 CSS 写 850/860，并保留 T-L5 测试 |
| R-6 | 悬浮球默认位置可能遮挡时间轴片段右端 | 默认 `bottom:48px` 避开底部栏；可拖拽且持久化；浮窗打开时时间轴仍可见（浮窗宽度 `clamp(360px, 32%, 520px)`，沿用旧实现） |
| R-7 | 〔v2 RV-02 已证实〕TTS 配音的 `serverUrl`（`/api/audio/generated/...`）**当前**不被波形服务识别，波形为空 | 已由 §3.6.4 后端补丁根治，并有 pytest 回归。补丁之后若仍失败（例如 segment id 含非法字符），`AudioWaveformCanvas` 画平直基线、不阻塞，仍不叠字；§7.3 要求用真实 TTS 走查 |
| R-11 | 〔v2〕Portal 菜单（新建任务、布局）与各自的外部点击 / 自动收起逻辑交互复杂 | §3.3.2 与 §3.4.2 已逐条列出连带处理，并有对应单测（`menu_is_portaled_outside_taskbar`、`clicking_menu_item_does_not_toggle_taskbar_expansion`、`pointerdown_on_trigger_is_not_outside`）和 §7.3 走查项 |
| R-12 | 〔v2〕后端补丁改变了 `_resolve_source_path` 的可解析范围 | 只在原逻辑返回 `None` 时回退；复用合成导出已在用、带路径护栏的 `resolve_media_reference`，`allow_remote=False`；不新增任何可读目录 |
| R-8 | 句子命中层拦截片段拖拽 / 选中 | 命中层不 `stopPropagation`、不 `preventDefault`，仅设置 `title`；单测 + 手工验证拖拽、裁剪手柄正常 |
| R-9 | 大面积 className 替换误伤 R1 之前已有的蓝色 | 以 §3.1.3 的 `git diff` 审计命令为唯一依据，只改这两个提交新增的行 |
| R-10 | 重命名 `createTask → openTask`、`drawer → assistant`、`railProps → footerToolbarProps` 漏改 | §7.2 的 grep 门禁为 0；`type-check` 兜底 |

---

## 9. 实施顺序（每步可独立运行、可测试）

1. **W3 任务单例**：`taskSingleton.ts` + 单测 → `useTasks` 改造 → 调用方改名。
2. **W2 单一 `+`**：`NewTaskMenu` + `VerticalTaskbar` + 样式 + 测试。
3. **W1 配色**：token 改引用 → 徽标 / 选中 / 下划线等中性化 → 审计命令逐条处理 → `workbenchPalette` 测试。
4. **W4 底部栏工具**：`FooterToolbar` → `TrackContainer/TimelinePanel` 插槽 → 删 `ToolWindowRail` 与 `.ws-rail*` → 测试。
5. **W5 悬浮球**：从 `b4f6a4a` 恢复三文件 → 差量修改 → 删抽屉 → i18n → 测试重写。
6. **W6 音频波形默认**：〔v2〕先做后端 `waveform_service` 补丁 + pytest（§3.6.4）→ 偏好模块 → `SentenceHitLayer` → `TimelineItem` 音频分支 → 工具栏开关 → 测试。
7. 全量 `type-check` / lint / vitest / 〔v2〕后端 pytest，按 §7.3 桌面走查（〔v2〕桌面端需重启后端才能加载补丁），更新 `CLAUDE.md` Shell 描述。

---

## 评审结论（Review Verdict）

**有条件通过**（v2）。

v1 的方向与拆分正确：六项诉求一一落点，实施顺序可独立验证，选择「恢复」悬浮球而非重写。评审发现 2 个 P0、5 个 P1、7 个 P2。其中 P0 / P1 已全部改入正文（标注「〔v2〕」），P2 已在正文澄清或接受取舍。**文档中不再有未解决的 P0 / P1。**

放行条件（开发节点必须满足，验收时逐条核对）：

1. **C-1（RV-01）**：新建任务菜单与布局菜单都用 Portal + `position:fixed` 实现，§3.3.2 列出的三处连带处理（外部点击、合成事件冒泡、自动收起暂停）全部落地，对应单测通过。
2. **C-2（RV-02）**：§3.6.4 后端补丁及其 pytest 先于 W6 前端改动完成；§7.3 用一段**真实** TTS 配音验证波形有起伏，不是平直基线。
3. **C-3（RV-03 / RV-04）**：`openTask` 只在函数式 `setAppState` 内实现并支持 `updateContent`；`open_task_called_twice_in_same_tick_creates_one` 与 `import_to_video_opens_video_task_with_pending_materials` 通过。
4. **C-4（RV-06）**：`video-editing.css` 不做整文件还原，只按 §3.1.3 改 `.console-ratio-seg` 选中态。§3.1.3 的 `git diff` 审计命令（当前输出 30 行）逐行处理，保留项写入提交说明。
5. **C-5**：§7.2 门禁（type-check、lint、vitest、pytest、grep 为 0）全部实际运行并贴出结果；§7.3 桌面走查（含 v2 新增 5 项）在桌面端完成，不能只在浏览器 dev 模式下验证。

---

## 实施过程发现的方案缺陷（Issues Found During Implementation）

开发节点按 v2 实施时发现的偏差与修正。每条都已按修正方案落地。

| ID | 位置 | 发现 | 实际处理 |
|---|---|---|---|
| IM-01 | §3.1.3 `video-editing.css` 一行（C-4） | `.console-ratio-seg` 在当前 `video-editing.css` 中不存在（`grep` 0 命中），比例选择已迁到 `.ws-canvas-ratio`（选中态是 1.5px 描边 + 圆点，本来就属于允许的「选中描边」）。 | `video-editing.css` 控制台规则不改；播放按钮经 `--ws-primary-solid → var(--primary)` 自动回到全局主色。 |
| IM-02 | §3.1.3 审计命令（C-4） | 命令输出里的 `MaterialStatusOverlays.tsx` 蓝色遮罩（`bg-primary bg-opacity-50`、`from-primary to-primary/70`）、`MaterialsPanel` 的 `bg-primary` 按钮、`ScriptPanel` 的进度条，经 `git grep <片段> feab883~1` 核实都是 R1 之前就有、只是随文件拆分被「搬家」的行，不属于本次回归范围。另外两行 `--ws-*` token 行已由 §3.1.2 统一处理。 | 真正由 R1/R2 新增的「底色」只有两处：`SegmentSentenceList.tsx`、`SegmentVideoCarousel.tsx` 的 `bg-primary-a/10 + --ws-primary-text` 标签，已改为 `bg-secondary text-foreground`。其余为进度条 / 已有遮罩 / 主按钮，保留。 |
| IM-03 | §3.3.2 `NewTaskMenuProps` | 菜单项需要图标和文案，但 `getTaskIcon` / `getTaskLabel` 是 `VerticalTaskbar` 的局部函数。§3.3.2 写了「复用 `getTaskIcon`」，却没给出传入途径。 | Props 增加 `renderIcon(type)` 与 `labelFor(type)`，由任务栏传入，避免新建共享图标模块（不扩大范围）。 |
| IM-04 | §3.5.2 / §5 `useDraggableFab()` | 挂载时恢复存储位置并按父元素钳制，需要拿到 FAB 元素；旧 hook 只有在 `pointerdown` 时才知道元素。 | 签名改为 `useDraggableFab(elementRef?)`，`AgentChatDock` 传 `fabRef`。hook 内部把 ref 固定下来（`useRef(elementRef).current`），调用方每次渲染传新对象也不会让 effect 重跑、陷入 `setPosition` 死循环（单测曾复现过）。另外导出 `DEFAULT_FAB_POSITION`（24/48），`AgentChatFloatingPanel` 的锚点兜底从旧的 24/24 改为它，与 CSS 默认位置一致。 |
| IM-05 | §3.6.2 要点 3 | `buildSentenceTooltip` 需要 i18n 文案，纯函数拿不到 `t`。 | 签名为 `buildSentenceTooltip(sentence, copy)`，`copy = t.timeline.sentenceSegment`，由两个调用方传入。 |
| IM-06 | §7.1 测试文件名 | 本仓库 vitest 没有 JSX 插件，测试文件本身不能写 JSX 字面量（`*.test.tsx` 里只能用 `React.createElement`）。另外 jsdom 环境下 `node:fs` 被外部化，`r1Leftovers.test.ts`（jsdom）无法做「`ws-rail` 在 src 中 0 命中」的文件扫描。 | 新测试一律用 `.test.ts` + `createElement`：`NewTaskMenu.test.ts`、`Container.importMaterials.test.ts`、`FooterToolbar.test.ts`、`TimelineItem.audio.test.ts`。任务栏的渲染用例（`menu_is_portaled_outside_taskbar`、`clicking_menu_item_does_not_toggle_taskbar_expansion`）放在 `NewTaskMenu.test.ts`，因为 `VerticalTaskbar.a11y.test.ts` 是 node 环境的源码断言。`tool_window_rail_is_gone` 与 `dock_z_index_tokens_still_absent_from_tailwind` 放进 node 环境的 `r1Leftovers.tokens.test.ts`。 |
| IM-07 | §3.4.2 i18n | `regions.rail` 的英文值 `Tool windows` 同样不再贴切。 | 中文改为「面板工具」，英文同步改为 `Panel tools`（键名不变）。 |
| IM-08 | §3.6.4 日志写法 | 伪代码里的 `logger.warning(msg, {...})` 与本文件现有写法一致，照此实现。另外新增了 `test_missing_generated_tts_audio_returns_none` 与 `test_generate_ready_for_generated_tts_audio`（用真实 ffmpeg 生成的音频走完整 `generate`，断言 peaks 有起伏），比 §3.6.4 列出的两条多两条。 | pytest `tests/test_waveform_service.py` 16 passed。 |
| IM-09 | §7.3 走查 | 本节点运行在无桌面 GUI 的自动化环境中，无法完成 §7.3 的桌面端手工走查（C-5 后半部分）。 | 自动化门禁全部实跑；桌面走查留给下游 / 人工，作为未完成项明确列出。 |

**门禁实跑结果（本节点）**

- `npx tsc --noEmit`：0 错误。
- `ESLINT_USE_FLAT_CONFIG=false npx eslint <全部改动的 ts/tsx>`：0 error（52 个 warning 全部是改动前就有的）。
- `npx vitest run`：422 个文件、3166 条用例全部通过。
- 后端 `python -m pytest tests/test_waveform_service.py tests/test_local_media_resolver.py tests/test_derived_gc.py tests/test_tts_error_details.py`：142 passed。
- `grep -rn "ToolWindowRail\|ws-rail\|AgentChatDrawer\|ws-drawer\|createTask\|onCreateTask" src`（排除 `__tests__`）：0 命中。
- `npm run build`：exit 0。
- 未完成：§7.3 桌面端手工走查（IM-09）。

---

## 最终评审记录（Final Review）

评审节点逐项对照 §2–§7 审查了开发节点的全部改动。覆盖度：W1–W6 与 §4 文件清单全部落地，§7.2 grep 门禁 0 命中。发现并当场修复 3 处问题：

| ID | 位置 | 问题 | 修复 |
|---|---|---|---|
| FR-01 | `TimelineItem.tsx` `AudioClipBody` | 波形区高度按 `trackHeight - 14` 计算，但片段盒子实际高度是 `trackHeight - 2 × padding`（`timelineItemStyles.ts`）。80px 轨道下波形区比盒子高出 20px，底部被 `overflow:hidden` 裁掉，波形整体偏下。 | 新增 `clipHeight` prop（`Math.max(itemHeight, 16)`），波形区高度改为 `clipHeight - 14`；标题条是否显示仍按 `trackHeight >= 36` 判断。删除未使用的 `fontSize` prop。`TimelineItem.audio.test.ts` 的期望值从 66 改为 46，并注明推导。 |
| FR-02 | `audioClipDisplayPref.ts` `readAudioClipDisplay` | 它是 `useSyncExternalStore` 的 snapshot，每个音频片段每次渲染都会调用。存储被禁用时每次调用都 `console.warn`，会刷屏。 | 读失败只 warn 一次（模块级标记），写失败仍每次 warn。 |
| FR-03 | `TrackContainer.tsx` 底部栏 | 新增的左组 `div` 内子节点没有缩进，和文件其它部分风格不一致。 | 重新缩进，并补一行注释。 |

保留的取舍：`NewTaskMenu` 的「已打开 / 新建」提示依据的是任务栏上可见的 Tab。任务存在但 Tab 已关闭时显示「新建」，点击后会恢复原内容（`openTask` 重开）。这符合 §3.2.2，不改。

门禁（评审节点实跑）：`tsc --noEmit` 0 错误；改动文件 eslint 0 error；vitest 全量见提交说明；`pytest tests/test_waveform_service.py` 16 passed。§7.3 桌面端手工走查仍未执行（IM-09）。
