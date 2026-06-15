# 视频编辑预览面板 — 播放控制台重设计（Preview Player Console Redesign）

> Feature slug: `preview-player-console-redesign`
> Status: **v2（评审修复版 / Reviewed & Fixed）**
> Author: 方案设计节点（Subtask #0）
> Reviewer: 方案评审节点（Subtask #1，资深评审，已对照代码逐节核对）
> Scope: 仅前端样式 + 预览面板控制区 JSX 结构，无后端、无数据库改动
> 关联代码：`src/components/video/components/VideoPlayerPanel/`、`src/styles/video-editing.css`

---

## 评审记录 Review Notes（v2）

> 评审维度：**可行性 / 完整性 / 一致性 / 规模合理性**。评审方法：把方案逐节落到实际代码上核对，而非纸面校对。
>
> **已核验为真的关键前提（强项，无需改）**：
> 1. §2.3 全部主题 token（`--card`/`--border`/`--radius`/`--shadow-lg`/`--primary`/`--primary-hover`/`--primary-foreground`/`--ring`/`--muted`/`--muted-foreground`/`--accent`/`--accent-foreground`/`--font-mono`/`--foreground`）均在 `src/styles/globals.css` 实存（注：globals.css 实际位于 `src/styles/`，非 `src/app/`）；token 为 hex，`hsl(var())` 确会失效，`color-mix` 路线正确，与时间轴重设计同款。
> 2. CSS 重复块属实：`.video-controls`@637/1720、`.video-info-panel`@871/1884、`.progress-slider`@671/1800、`.play-pause-btn`@586/1770 均各定义两次，后者层叠覆盖前者。
> 3. 待删类名全仓仅 `VideoPlayerPanel.tsx` + `CoverButton.tsx` 引用，其余（`.video-overlay`/`.video-preview-window`/`.speed-*`/`.quality-*`/`.info-*` 等）已是死 CSS，R1 删除安全。
> 4. 现有测试（`aspectRatios.test.ts`/`PreviewCanvas.test.tsx`/`exportButton.test.tsx`/`VideoPlayerPanel.solePath.test.tsx`/`AgentChatDock.test.tsx`）无一断言旧类名，重命名不回归。
> 5. `.video-player-wrapper` 现为 `flex:0 0 70%`（line 491），`.video-preview-container` 有 `min-height:200px` 兜底（line 526），布局修正与 R4 成立；`CoverButton` 的 `aspect-ratio-btn aspect-ratio-btn-inactive` 为组件内硬编码，§3「改 className」需改组件源码（方案已正确列入修改文件）。

| # | 严重度 | 维度 | 问题 | 处置 |
|---|---|---|---|---|
| P1-1 | **P1** | 完整性 | §3 删除清单的行号区间（566–1058、1704–1919）**未覆盖** `@media (max-width:1024px/768px)` 内针对待删类的响应式覆盖块（实测约 1144–1150、1168–1290），其中含 `.video-controls-info-container`/`.video-controls`/`.controls-row`/`.controls-left`/`.controls-right`/`.control-btn`/`.time-display`/`.volume-slider`/`.speed-select`/`.video-info-panel`/`.info-row`/`.info-label`/`.info-value`/`.quality-*`/`.video-info-row`/`.aspect-ratio-row`/`.video-info-group`/`.info-item-inline`/`.info-separator`/`.info-title`/`.aspect-ratio-group`/`.aspect-ratio-buttons`/`.aspect-ratio-btn`。照原清单直删会**残留约 25 条孤儿媒体查询规则**，与本方案「铲除失效样式」的目标自相矛盾。 | **已修复**：§3 新增删除行，明确一并删除这些 `@media` 覆盖，并标注须**保留**同块内无关规则（`.materials-panel-content .grid-cols-3`/`.material-type-filter`/`.video-player-container{gap}`）。 |
| P1-2 | **P1** | 完整性 | `.video-controls-info-container` 基础规则（line 627，及媒体查询 line 1173）未列入删除清单，但其包裹的 JSX `div` 已被 `.player-console` 取代 → 残留孤儿基础规则。 | **已修复**：§3 删除清单补入 `.video-controls-info-container`（627 基础 + 1173 媒体）。 |
| P1-3 | **P1** | 一致性 / 可访问性 | §4.1 新 JSX 骨架的静音按钮只写 `onClick={handleVolumeToggleMute}`，省略了现状的 `aria-pressed={volume===0}` / `title` / `aria-label`（mute/unmute 切换，现 line 610–612）。虽 §2.4 有「ARIA 原样保留」总述，但实现者照抄骨架极易丢这些属性 → 静音键可访问性回归。 | **已修复**：§4.1 骨架显式补回静音键 `aria-pressed`/`title`/`aria-label`（沿用 `t.videoPlayerPanel.controls.mute/unmute`）。 |
| P2-1 | P2 | 可行性 | §6.1.4 提议用计算样式断言 `font-variant-numeric:tabular-nums`；JSDOM 不加载外部 CSS，`getComputedStyle().fontVariantNumeric` 取不到值，该断言不可行。 | **已修复**：改为断言 `.console-time` 存在 + current/separator/total 三段渲染，不依赖计算样式；`tabular-nums` 交 §6.2 人工验收兜底。 |
| P2-2 | P2 | 一致性 | §6.1.5 称分段/播放/静音键「沿用既有 onKeyDown」；新分段键改用原生 `<button>`（Enter/Space 由浏览器原生触发 click），不再需显式 onKeyDown。 | **已修复**：改述为「原生 button 激活」，避免误导实现者补冗余 onKeyDown。 |
| P2-3 | P2 | 完整性 | §3 删除行号相对当前 2425 行的文件已漂移（占位区实测延伸至约 2034），易误删/漏删。 | 维持 R1「删除前复跑 grep 二次确认」为硬约束；§3 已加注**以 grep 命中为准、行号仅作参照**。 |
| P2-4 | P2 | 规模合理性 | 纯表现层重设计未设功能开关，与项目 flag 文化（preview-proxy/local-preview）略异。 | 评审判定为**有意为之、非缺陷**：本改动无逻辑分支、git 可一键回滚，加 flag 属过度设计；已在 §8 非目标补注。 |

**P0：无。** 整体方案可行、与现有架构/约定一致、规模适中（未过度抽象——不强抽 `PlayerControls` 属正确取舍）。上述 P1 已全部就地修复，P2 已修复 2 项、其余 2 项以约束/批注消解。

---

## 1. 概述 Overview

视频编辑器采用「达芬奇式 25/50/25」三栏布局，**中央 50% 列**是播放/合成预览面板（`VideoEditingInterface.tsx:2640` 的 `.video-editing-player-panel` → `VideoPlayerPanel`）。该面板自上而下分为：标题头（`composition-panel-header`）、视频预览区（`video-preview-container`，承载多轨 canvas 合成器 `PreviewCanvas`），以及**预览区下方的两条横栏**——「播放控制栏」（`video-controls`：播放/暂停、时间、进度条、音量）和「宽高比信息栏」（`video-info-panel` → `aspect-ratio-row`：5 个比例按钮 + 封面入口 `CoverButton`）。用户反馈这两条横栏**样式陈旧、布局不合理、视觉割裂**，与已完成「达芬奇级重设计」的时间轴面板（`globals.css:55` 起的 `--timeline-*` token 体系）风格脱节。

经勘察，丑陋与不合理的**根因**有三类：（1）**样式重复且互相覆盖**——`video-editing.css` 中 `.video-controls`、`.control-btn`、`.play-pause-btn`、`.time-display`、`.progress-slider`、`.volume-slider`、`.video-info-panel`、`.placeholder-content` 等选择器各被定义**两次**（第一处约 637–1058 行，第二处约 1704–1919 行），后者凭借层叠顺序静默覆盖前者，导致实际生效样式与第一处声明南辕北辙（例如播放键最终是 36×36 方钮内塞 20px 图标、时间文本无 `tabular-nums` 与固定宽度而抖动、进度条只剩一条扁平轨无已播放填充）。（2）**布局比例错误**——`.video-player-wrapper { flex:0 0 70% }` 把预览硬锁 70%，剩余 30% 给两条本应「内容自适应高度」的横栏，于是高面板留大片空白、矮面板触发 `overflow-y:auto` 让控制栏可滚动（控制条可滚动严重违反操作直觉）。（3）**视觉语言不统一**——硬编码 `rgba(255,255,255,0.1)` 斜向高光 `::before`、`rgba(59,130,246,…)` 偏离主题色的占位渐变、失效的 `hsl(var(--primary)/0.1)`（本项目 token 为 hex，`hsl()` 包裹无效）、写死的 `6px/4px` 圆角，均未复用 `var(--radius)` / `--shadow-*` / `color-mix` 主题约定。

本方案将**预览区下方的两条横栏合并重构为一个统一的「播放控制台（Player Console）」卡片**：自上而下为「全宽进度条 → 走带行（播放键＋时间｜音量）→ 细分隔线 → 设置行（宽高比分段控件＋封面）」。同时**铲除全部重复/失效样式**，建立单一权威样式段，全面改用主题 token、`color-mix` 半透明、`var(--radius)`、`--shadow-*` 与 `:focus-visible`，使控制台与时间轴面板呈现一致的专业级 NLE（非线性编辑）质感。改造**不触碰**预览容器的 `computeContainBox` 信箱/比例适配逻辑、不触碰播放引擎/合成器/导出逻辑，纯属表现层与控制区 DOM 结构调整。

---

## 2. 技术设计 Technical Design

### 2.1 架构与目标 DOM 结构

控制区改为单卡片 `.player-console`，内部三行 + 一条分隔线。目标结构（仅展示预览区下方部分；预览区 `.video-player-wrapper` / `.video-preview-container` 结构与逻辑保持不变）：

```
.video-player-container                  flex column; gap:12px; height:100%; min-height:0
├─ .video-player-wrapper                 flex:1 1 auto; min-height:0           ← 预览，吃满剩余空间
│   └─ .video-preview-container          （保持原样：居中 contain-box + 信箱）
│       └─ PreviewCanvas / 占位空状态
└─ .player-console                       flex:0 0 auto（内容自适应高度，绝不滚动）
    ├─ .console-scrubber-row
    │   └─ input.console-scrubber[type=range]    全宽，已播放段填充
    ├─ .console-transport-row              justify-content: space-between
    │   ├─ .console-transport-left
    │   │   ├─ button.console-play-btn           主色圆钮 40px
    │   │   └─ .console-time (current / total)   等宽数字、定宽不抖
    │   └─ .console-transport-right
    │       └─ .console-volume
    │           ├─ button.console-icon-btn (mute)
    │           └─ input.console-volume-slider
    ├─ .console-divider                    1px hairline
    └─ .console-settings-row               justify-content: space-between
        ├─ .console-ratio
        │   ├─ span.console-ratio-label    "ASPECT RATIO"
        │   └─ .console-ratio-segmented    分段控件
        │       └─ button.console-ratio-seg × 5  （active 由 aria-pressed 驱动）
        └─ CoverButton (.console-cover-btn)      仅 projectId 存在时渲染
```

**关键变化**：把原先两个各带边框/内边距的卡片（`.video-controls` + `.video-info-panel`）压成**一个**卡片，消除「双重边框/双重 padding/中缝空隙」造成的割裂感；进度条提升为视觉焦点（全宽、可见已播放填充）；宽高比从一排松散按钮升级为「分段控件（segmented control）」——这是 Premiere/DaVinci/CapCut 中比例切换的主流交互范式。

### 2.2 已播放进度填充技术（核心交互细节）

`<input type=range>` 跨浏览器填充：通过内联 CSS 自定义属性 `--progress`（0%~100%）+ `linear-gradient` 实现 WebKit/Chromium（Electron 桌面端即 Chromium，是主要目标）侧的「已播放=主色 / 未播放=淡灰」轨道；Firefox 走 `::-moz-range-progress` 原生填充。组件每帧已有 `getCurrentTime()`/`getTotalDuration()`，仅需计算百分比并写入 `style`：

```tsx
// VideoPlayerPanel.tsx —— 渲染前计算
const totalForBar = getTotalDuration();
const isSeekable = totalForBar > 0;
const progressPercent = isSeekable ? (getCurrentTime() / totalForBar) * 100 : 0;
const volumePercent = Math.round(volume * 100);
```

```tsx
<input
  type="range" min={0} max={isSeekable ? totalForBar : 1} step="any"
  value={getCurrentTime()} disabled={!isSeekable}
  onChange={(e) => handleTimeSeekClick(parseFloat(e.target.value))}
  aria-label={t.videoPlayerPanel.controls.seekAriaLabel}
  aria-valuetext={formatTime(getCurrentTime())}
  className="console-scrubber"
  style={{ ['--progress']: `${progressPercent}%` } as React.CSSProperties}
/>
```

音量滑块同理用 `--vol` 写入 `${volumePercent}%`。`as React.CSSProperties` 用于让 TS 接受自定义属性键。

### 2.3 主题 Token 约定（必须遵守）

| 用途 | 取值（统一改用） |
|---|---|
| 卡片底/边/圆角 | `background: var(--card)`; `border: 1px solid var(--border)`; `border-radius: var(--radius)` |
| 卡片阴影 | `box-shadow: var(--shadow-lg)`（`globals.css:49` 已定义） |
| 主色/悬停/前景 | `var(--primary)` / `var(--primary-hover)` / `var(--primary-foreground)` |
| 半透明态 | `color-mix(in srgb, var(--primary) 14%, transparent)` 等（沿用 `globals.css:65` 时间轴重设计同款写法，**禁止** `hsl(var(--token)/α)`，本项目 token 为 hex 会失效） |
| 焦点环 | `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }`（用 `focus-visible` 避免鼠标点击也描边） |
| 等宽数字 | `font-family: var(--font-mono)`; `font-variant-numeric: tabular-nums` |
| 过渡 | 只过渡 `background-color/color/transform/opacity`，**禁止** `transition: all`（避免布局抖动与性能损耗） |

### 2.4 布局比例修正与操作时序

- `.video-player-wrapper` 由 `flex:0 0 70%` 改为 `flex:1 1 auto; min-height:0`，预览吃满剩余空间；`.player-console` 用 `flex:0 0 auto`，按内容取高、**移除 `overflow-y:auto`**（控制台不再可滚动）。`computeContainBox`（`aspectRatios.ts:70`）依旧用 `videoContainerRef` 的实测尺寸算信箱，预览随面板高度自然伸缩、垂直余量即信箱留边。
- 交互时序不变：播放键 → `handlePlayPauseClick`（内含素材就绪门 `allTimelineMediaReady` 的 toast 守卫，保留 `disabled={getTotalDuration()===0}` 与 `aria-disabled`）；拖动进度条 → `handleTimeSeekClick`；比例按钮 → `handleAspectRatioChange`（保留 `aria-pressed`）；静音 → `handleVolumeToggleMute`；封面 → `setIsCoverModalOpen(true)`。**所有事件处理器、ARIA、i18n key 原样保留**，仅换类名与外层结构。

---

## 3. 文件 / 模块变更计划 File / Module Change Plan

| 文件 | 动作 | 一句话意图 |
|---|---|---|
| `src/styles/video-editing.css` | 删除 | 移除**第二处重复块**（约 1704–1919 行）：`.video-placeholder`、第二份 `.placeholder-content`/`.video-controls`/`.controls-row`/`.left-controls`/`.center-controls`/`.right-controls`/`.control-btn(+hover)`/`.play-pause-btn(+hover)`/`.time-display`/`.time-separator`/`.progress-container`/`.progress-slider(+thumbs)`/`.volume-control`/`.volume-slider(+thumbs)`/`.speed-select(+hover)`/`.video-info-panel`/`.info-row`/`.info-item`/`.info-label`/`.info-value`。 |
| `src/styles/video-editing.css` | 删除 | 移除**第一处控制/信息块中已失效或被取代的选择器**（约 566–1058 行）：`.video-controls-info-container`（基础规则 line 627，**P1-2 补入**）、`.video-overlay`、`.video-preview-window`、`.play-pause-btn(+hover)`、`.loading-*`、`.video-controls`、`.progress-bar`、`.progress-filled`、`.progress-slider(+states)`、`.controls-row`、`.controls-left`、`.center-controls`、`.controls-right`、`.control-btn(+states)`、`.play-btn(+hover)`、`.time-display`、`.speed-control`/`.speed-select(+states)`、`.volume-control`、`.volume-slider-container`、`.volume-slider(+thumb)`、`.video-info-panel(+hover)`、`.video-info-row`、`.aspect-ratio-row`、`.video-info-group`、`.info-item-inline`、`.info-separator`、`.info-label`、`.info-value`、`.info-title`、`.aspect-ratio-group`、`.aspect-ratio-buttons`、`.aspect-ratio-btn(+所有状态/::before)`、`.info-row`、`.info-item`、`.aspect-ratio-selector-compact`、`.quality-*`。 |
| `src/styles/video-editing.css` | 删除 | **（P1-1 补入）移除针对上述待删类的响应式 `@media` 覆盖块**（实测约 1144–1150 的 `@media (max-width:1024px)` 段 + 1168–1290 的 `@media (max-width:768px)` 段内的相关规则）：`.video-controls-info-container`(@1173)、`.video-controls`(@1178)、`.controls-row`(@1183)、`.controls-left`(@1187)、`.controls-right`(@1191)、`.control-btn`(@1195)、`.time-display`(@1200)、`.volume-slider`(@1205)、`.speed-select`(@1209)、`.video-info-panel`(@1214)、`.info-row`(@1218)、`.info-label`(@1222)、`.info-value`(@1226/1267)、`.quality-control`/`.quality-select`(@1230/1235)、`.video-info-row`(@1241)、`.aspect-ratio-row`(@1245)、`.video-info-group`(@1249)、`.info-item-inline`(@1255)、`.info-separator`(@1263)、`.info-title`(@1271)、`.aspect-ratio-group`(@1276)、`.aspect-ratio-buttons`(@1281)、`.aspect-ratio-btn`(@1144/1285)。**务必保留**同 `@media` 块内与本需求无关的规则：`.materials-panel-content .grid-cols-3`、`.material-type-filter(+button)`、`.video-player-container{gap}`。若需新控制台的窄屏适配，统一由 §4.2 的 `@media (max-width:768px)` `.player-console{…}` 段承接。 |
| `src/styles/video-editing.css` | 保留 | 不动：`.video-editing-composition-panel`、`.composition-panel-header`、`.composition-panel-content`、`.video-player-container`、`.video-preview-container` 及 `.aspect-*` 比例适配规则（信箱逻辑依赖它们）；以及与本需求无关的时间轴/素材区/Markdown 样式。 |
| `src/styles/video-editing.css` | 修改 | `.video-player-wrapper` 改 `flex:1 1 auto; min-height:0`（删 `flex:0 0 70%`）。 |
| `src/styles/video-editing.css` | 新增 | 追加单一权威段「`/* ===== Player Console ===== */`」：`.player-console` 及全部 `.console-*` 规则（见 §4.2 完整 CSS），含 `:focus-visible`、`color-mix` 半透明、`--progress`/`--vol` 填充、响应式与 `prefers-reduced-motion` 适配。 |
| `src/styles/video-editing.css` | 修改 | 重写占位空状态：`.video-placeholder-container`（去掉偏主题色的 `radial-gradient`，改 `color-mix(in srgb,var(--primary) 4%,transparent)` 极淡底）、`.video-placeholder-frame`（去 `2px dashed` + 删 `::before` 流光动画，改 `1px solid var(--border)` + `var(--radius)`）、`.placeholder-text`/`.placeholder-aspect-info` 微调；删除遗留的 `@media` 流光相关。 |
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | 修改 | 用 §4.1 的新 JSX 替换从 `<div className="video-controls-info-container">`（546 行附近）到 `aspect-ratio-row` 闭合（689 行附近）的整段；新增 `progressPercent`/`volumePercent`/`isSeekable` 计算；进度条/音量条写入 `--progress`/`--vol`；比例按钮改用单类 `console-ratio-seg` + `aria-pressed` 驱动激活态。 |
| `src/components/video/components/VideoCoverModal/CoverButton.tsx` | 修改 | className 由 `aspect-ratio-btn aspect-ratio-btn-inactive …` 改为 `console-cover-btn`（保留图标 + 文案 + `aria-label`/`title`/`disabled` 逻辑不变）。 |
| `src/components/video/components/VideoPlayerPanel/__tests__/playerConsole.layout.test.tsx` | 新增 | 结构/可访问性回归测试：控制台单卡片渲染、5 个比例分段项均渲染、激活项 `aria-pressed=true`、进度条写入 `--progress`、时间区有 `tabular-nums`、播放键禁用态随 `getTotalDuration()` 变化。 |
| `docs/plans/preview-player-console-redesign/spec.md` | 新增 | 本设计文档。 |

> ⚠️ 行号说明（P2-3）：本表所有行号针对评审时刻的 `video-editing.css`（共 **2425 行**，占位区延伸至约 2034 行）；行号仅作参照，**删除以 grep 命中为准**——开发节点删除前必须复跑 R1 的 grep 清单二次确认，按选择器名逐项删，删后 `npm run build` 验证无掉样式。
>
> 注：`PlayerControls.tsx` 当前仅为透传脚手架（`children` 包一层 `div`）。本方案**不**强制抽组件，控制台 JSX 仍内联于 `VideoPlayerPanel.tsx`（与现状一致、风险最低）。若评审希望抽出，可作为非阻塞增强项把 §4.1 markup 落入 `PlayerControls.tsx`，但不在本期必做范围。

---

## 4. 接口设计 Interface Design

本需求无 REST/WebSocket/CLI 变更。「接口」即 **React 组件 props 契约** 与 **JSX↔CSS 类名契约**。

### 4.1 组件契约（保持不变）

`VideoPlayerPanelProps` / `VideoPlayerPanelRef`（`VideoPlayerPanel.tsx:22`、:56）**完全不变**；`CoverButtonProps`（`onClick/className/disabled`）不变。所有现有回调（`handlePlayPause`、`handleTimeSeek`、`handleVolumeChange`、`onImagePositionChange`…）与 i18n（`t.videoPlayerPanel.*`、`t.videoCoverModal.button`）原样复用。无新增 props、无破坏性变更。

### 4.2 类名契约（CSS API）

下列 class 为 JSX 与样式的稳定契约，须在 `video-editing.css` 权威段定义：`player-console`、`console-scrubber-row`、`console-scrubber`、`console-transport-row`、`console-transport-left`、`console-transport-right`、`console-play-btn`、`console-time`（子 `current-time`/`time-separator`/`total-time`）、`console-volume`、`console-icon-btn`、`console-volume-slider`、`console-divider`、`console-settings-row`、`console-ratio`、`console-ratio-label`、`console-ratio-segmented`、`console-ratio-seg`、`console-cover-btn`。激活态约定为属性选择器 `.console-ratio-seg[aria-pressed="true"]`（不另设 `-active` 类）。

参考实现要点（评审/开发节点据此落地，可在不改变契约的前提下微调数值）：

```css
/* ===== Player Console ===== */
.player-console{flex:0 0 auto;display:flex;flex-direction:column;gap:10px;padding:12px;
  background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow-lg);}

/* 进度条：已播放填充 */
.console-scrubber-row{width:100%;}
.console-scrubber{--progress:0%;-webkit-appearance:none;appearance:none;width:100%;height:4px;
  border-radius:999px;cursor:pointer;
  background:linear-gradient(to right,var(--primary) var(--progress),
    color-mix(in srgb,var(--muted-foreground) 32%,transparent) var(--progress));}
.console-scrubber::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:12px;
  border-radius:50%;background:var(--primary);border:2px solid var(--card);box-shadow:var(--shadow-lg);
  transition:transform .15s ease;}
.console-scrubber:hover::-webkit-slider-thumb,
.console-scrubber:focus-visible::-webkit-slider-thumb{transform:scale(1.25);}
.console-scrubber::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:var(--primary);
  border:2px solid var(--card);}
.console-scrubber::-moz-range-progress{background:var(--primary);height:4px;border-radius:999px;}
.console-scrubber::-moz-range-track{background:color-mix(in srgb,var(--muted-foreground) 32%,transparent);
  height:4px;border-radius:999px;}
.console-scrubber:disabled{cursor:not-allowed;opacity:.6;}
.console-scrubber:focus-visible{outline:2px solid var(--ring);outline-offset:4px;}

/* 走带行 */
.console-transport-row{display:flex;align-items:center;justify-content:space-between;gap:12px;}
.console-transport-left{display:flex;align-items:center;gap:12px;min-width:0;}
.console-transport-right{display:flex;align-items:center;gap:8px;flex-shrink:0;}
.console-play-btn{width:40px;height:40px;flex-shrink:0;border:none;border-radius:50%;cursor:pointer;
  display:flex;align-items:center;justify-content:center;background:var(--primary);color:var(--primary-foreground);
  transition:background-color .15s ease,transform .1s ease;}
.console-play-btn:hover{background:var(--primary-hover);}
.console-play-btn:active{transform:scale(.94);}
.console-play-btn:disabled{background:var(--muted);color:var(--muted-foreground);cursor:not-allowed;}
.console-play-btn:focus-visible{outline:2px solid var(--ring);outline-offset:2px;}
.console-play-btn svg{width:20px;height:20px;}
.console-time{display:flex;align-items:center;gap:4px;font-family:var(--font-mono);
  font-variant-numeric:tabular-nums;font-size:12px;line-height:1;white-space:nowrap;
  color:var(--muted-foreground);min-width:96px;}
.console-time .current-time{color:var(--foreground);font-weight:600;}
.console-time .time-separator{opacity:.55;}

/* 音量 */
.console-volume{display:flex;align-items:center;gap:6px;flex-shrink:0;}
.console-icon-btn{width:32px;height:32px;border-radius:var(--radius);border:1px solid transparent;cursor:pointer;
  display:flex;align-items:center;justify-content:center;background:transparent;color:var(--muted-foreground);
  transition:background-color .15s ease,color .15s ease;}
.console-icon-btn:hover{background:var(--accent);color:var(--foreground);}
.console-icon-btn:focus-visible{outline:2px solid var(--ring);outline-offset:2px;}
.console-icon-btn svg{width:16px;height:16px;}
.console-volume-slider{--vol:100%;-webkit-appearance:none;appearance:none;width:64px;height:4px;
  border-radius:999px;cursor:pointer;
  background:linear-gradient(to right,var(--foreground) var(--vol),
    color-mix(in srgb,var(--muted-foreground) 32%,transparent) var(--vol));}
.console-volume-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:10px;height:10px;
  border-radius:50%;background:var(--foreground);cursor:pointer;}
.console-volume-slider::-moz-range-thumb{width:10px;height:10px;border-radius:50%;background:var(--foreground);}

/* 分隔线 */
.console-divider{height:1px;background:var(--border);}

/* 设置行：宽高比分段控件 + 封面 */
.console-settings-row{display:flex;align-items:center;justify-content:space-between;gap:10px;}
.console-ratio{display:flex;align-items:center;gap:8px;min-width:0;}
.console-ratio-label{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;
  color:var(--muted-foreground);white-space:nowrap;flex-shrink:0;}
.console-ratio-segmented{display:flex;align-items:center;gap:2px;padding:2px;border-radius:var(--radius);
  background:var(--muted);border:1px solid var(--border);}
.console-ratio-seg{appearance:none;border:none;cursor:pointer;height:26px;min-width:34px;padding:4px 10px;
  font-size:11px;font-weight:600;line-height:1;border-radius:calc(var(--radius) - 2px);
  background:transparent;color:var(--muted-foreground);
  transition:background-color .15s ease,color .15s ease;}
.console-ratio-seg:hover{color:var(--foreground);background:color-mix(in srgb,var(--foreground) 8%,transparent);}
.console-ratio-seg[aria-pressed="true"]{background:var(--primary);color:var(--primary-foreground);}
.console-ratio-seg:focus-visible{outline:2px solid var(--ring);outline-offset:2px;}
.console-cover-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;flex-shrink:0;
  border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;background:transparent;
  color:var(--muted-foreground);font-size:11px;font-weight:600;white-space:nowrap;
  transition:background-color .15s ease,color .15s ease;}
.console-cover-btn:hover{background:var(--accent);color:var(--foreground);}
.console-cover-btn:focus-visible{outline:2px solid var(--ring);outline-offset:2px;}
.console-cover-btn svg{width:14px;height:14px;}

/* 响应式：窄列收敛 */
@media (max-width:768px){
  .player-console{padding:10px;gap:8px;}
  .console-ratio-label{display:none;}
  .console-ratio-seg{min-width:30px;padding:4px 8px;height:24px;font-size:10px;}
  .console-play-btn{width:36px;height:36px;}
  .console-volume-slider{width:52px;}
}

/* 降低动效偏好 */
@media (prefers-reduced-motion: reduce){
  .console-play-btn,.console-ratio-seg,.console-icon-btn,.console-cover-btn,
  .console-scrubber::-webkit-slider-thumb{transition:none;}
}
```

新 JSX（`VideoPlayerPanel.tsx` 替换段，结构示意，事件/ARIA/i18n 沿用现值）：

```tsx
<div className="player-console">
  <div className="console-scrubber-row">{/* 上文 §2.2 的 input.console-scrubber */}</div>
  <div className="console-transport-row">
    <div className="console-transport-left">
      <button className="console-play-btn" onClick={handlePlayPauseClick}
        disabled={getTotalDuration() === 0} aria-disabled={!allTimelineMediaReady || undefined}
        title={getCurrentlyPlaying() ? t.videoPlayerPanel.playback.pause : t.videoPlayerPanel.playback.play}>
        {/* 原 play/pause SVG */}
      </button>
      <div className="console-time">
        <span className="current-time">{formatTime(getCurrentTime())}</span>
        <span className="time-separator">/</span>
        <span className="total-time">{formatTime(getTotalDuration())}</span>
      </div>
    </div>
    <div className="console-transport-right">
      <div className="console-volume">
        <button className="console-icon-btn" onClick={handleVolumeToggleMute}
          type="button" aria-pressed={volume === 0}
          title={volume === 0 ? t.videoPlayerPanel.controls.unmute : t.videoPlayerPanel.controls.mute}
          aria-label={volume === 0 ? t.videoPlayerPanel.controls.unmute : t.videoPlayerPanel.controls.mute}>
          {/* 原 4 档音量 SVG（0 / <0.5 / <1 / =1），逻辑沿用现值 */}
        </button>
        <input type="range" className="console-volume-slider" min={0} max={1} step={0.1} value={volume}
          onChange={(e)=>handleVolumeChange(parseFloat(e.target.value))}
          style={{ ['--vol']: `${volumePercent}%` } as React.CSSProperties}
          aria-label={t.videoPlayerPanel.controls.previewVolumeAriaLabel}
          aria-valuetext={`${volumePercent}%`} />
      </div>
    </div>
  </div>
  <div className="console-divider" />
  <div className="console-settings-row">
    <div className="console-ratio">
      <span className="console-ratio-label">{t.videoPlayerPanel.info.aspectRatio}</span>
      <div className="console-ratio-segmented" role="group"
        aria-label={t.videoPlayerPanel.info.aspectRatio}>
        {ASPECT_RATIOS.map((ar) => (
          <button key={ar.id} className="console-ratio-seg" aria-pressed={selectedAspectRatio.id===ar.id}
            onClick={()=>handleAspectRatioChange(ar)} title={ar.description}
            aria-label={/* 原 selectAspectRatio 文案 */}>{ar.label}</button>
        ))}
      </div>
    </div>
    {projectId && <CoverButton onClick={()=>setIsCoverModalOpen(true)} />}
  </div>
</div>
```

---

## 5. 数据模型 Data Model

无数据库 / 持久化模型改动。涉及的均为既有内存态与新增的 DOM CSS 自定义属性：

| 名称 | 类型 | 来源 | 用途 |
|---|---|---|---|
| `selectedAspectRatioId` | `string` | 既有 `useState`（`VideoPlayerPanel.tsx:130`） | 当前比例；驱动分段控件 `aria-pressed` 与预览信箱 |
| `volume` | `number 0~1` | props（`useVideoPlayback`） | 音量；映射为 `volumePercent` 与 `--vol` |
| `currentTime`/`compositionCurrentTime` | `number(秒)` | props / 既有 state | 经 `getCurrentTime()/getTotalDuration()` 算 `--progress` |
| `--progress` | CSS 变量 `string '%'` | 内联 `style` | WebKit 进度条已播放填充比例 |
| `--vol` | CSS 变量 `string '%'` | 内联 `style` | 音量条填充比例 |

`AspectRatio`（`aspectRatios.ts:8`）形状不变；`buildAspectRatios` 仍输出 5 项（16:9 / 9:16 / 4:3 / 1:1 / 21:9）。

---

## 6. 测试与验收标准 Testing & Acceptance Criteria

### 6.1 自动化测试

新增 `__tests__/playerConsole.layout.test.tsx`（RTL），覆盖：
1. **结构**：渲染后存在唯一 `.player-console`；其中含 `.console-scrubber`、`.console-transport-row`、`.console-settings-row`。
2. **分段控件**：`.console-ratio-seg` 恰好 5 个；当前比例项 `aria-pressed="true"`、其余 `false`；点击某项后激活态随之迁移（断言 `handleAspectRatioChange` 生效）。
3. **进度条**：`.console-scrubber` 的 `style` 含 `--progress`；`getTotalDuration()===0` 时 `disabled` 为真且 `max=1`、播放键 `disabled`。
4. **时间区**（P2-1 修正）：断言 `.console-time` 存在且渲染 current/separator/total 三段文本。**不**断言 `font-variant-numeric` 计算样式——JSDOM 不加载外部 CSS，`getComputedStyle().fontVariantNumeric` 取不到值；`tabular-nums` 的视觉效果由 §6.2 人工验收兜底。
5. **可访问性**（P2-2 修正）：play、mute、各分段项均为原生 `<button>`，可键盘聚焦并由 click 响应 Enter/Space（**无需**显式 `onKeyDown`）；断言静音键 `aria-pressed` 随 `volume===0` 切换、各分段项 `aria-pressed` 随激活态切换。

同时保证既有测试不回归：`aspectRatios.test.ts`、`PreviewCanvas.test.tsx`、`exportButton.test.tsx`、`VideoPlayerPanel.solePath.test.tsx`、`AgentChatDock.test.tsx`（其断言 25/50/25 布局百分比，不涉及控制台类名，须保持通过）。

执行：`npm run type-check` 与 `npm run lint` 0 报错；`npx jest src/components/video/components/VideoPlayerPanel` 全绿。

### 6.2 人工验收（桌面 walkthrough 为强制门）

- 暗/亮主题（`.dark`/`.light`）下控制台均与时间轴面板风格一致，无硬编码偏色、无失效高光/流光。
- 预览随面板高度自适应；控制台高度恒为内容高度、**不可滚动**、无大片空白。
- 进度条可见「已播放=主色 / 未播放=淡灰」；拖动顺滑、thumb 悬停放大；时间数字滚动时**不抖动**。
- 5 个比例分段切换即时生效、预览信箱比例随之变化；封面入口（有 projectId 时）右对齐、风格与分段控件协调。
- 窄宽（≤768px / 三栏堆叠）下分段控件收敛、比例 label 隐藏、控制台不溢出不裁切。
- 键盘 Tab 遍历有清晰 `:focus-visible` 环；`prefers-reduced-motion` 下无过渡动效。

### 6.3 Definition of Done

`spec.md` 已建并出现在 `git status`；§1–§7 齐全、篇幅 ≥ 800 字；评审节点可据本文逐行落地无需再决策。

---

## 7. 风险与缓解 Risks & Mitigations

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 删除重复/失效选择器时误删被他处引用的样式 | 其他面板掉样式 | 已 grep 确认 `control-btn/progress-slider/time-display/volume-slider/video-info-panel/video-controls/aspect-ratio-btn/left-controls/right-controls` 仅 `VideoPlayerPanel.tsx`+`CoverButton.tsx` 使用；删除前开发节点须复跑该 grep 二次确认，按 §3 清单逐项删，删后 `npm run build` 验证。**评审二次核验补充（P1-1/P1-2）**：上述类名全仓仅此两文件引用，其余（`.video-overlay`/`.video-preview-window`/`.speed-*`/`.quality-*`/`.info-*` 等）已是死 CSS；务必连带删除**同名 `@media` 响应式覆盖（约 1144–1290）与 `.video-controls-info-container` 基础规则（627）**，否则残留孤儿规则——见 §3 新增删除行。 |
| R2 | WebKit 与 Firefox 进度条填充实现不同 | 跨浏览器观感差异 | 桌面端 Electron=Chromium 为主目标，已分别提供 `linear-gradient(--progress)` 与 `::-moz-range-progress/track` 两路；二者视觉等价。 |
| R3 | 比例分段控件在 50% 窄列放 5 项可能挤压走带行 | 横向溢出 | 比例独占「设置行」与走带行分离（非同行），且 ≤768px 媒体查询收敛尺寸 + 隐藏 label；分段控件 `min-width` 经压缩后 5×~30px+padding 可容纳。必要时评审可改 `.console-ratio-segmented{overflow-x:auto}`。 |
| R4 | 布局由 70/30 改为「预览 flex:1 + 控制台 flex:0 0 auto」可能影响极矮面板 | 预览被压过小 | `.video-preview-container` 仍有 `min-height` 兜底 + `computeContainBox` 返回 null 时回退 CSS min-height；控制台高度固定且小（约 120–140px），整体优于原方案的「控制条可滚动」。 |
| R5 | `--progress`/`--vol` 自定义属性 TS 类型 | 编译报错 | 用 `as React.CSSProperties` 断言；与项目既有内联 style 写法一致。 |
| R6 | CSS 自定义属性首帧未写入 | 进度条首帧空填充 | 初值在 CSS 中 `--progress:0%`/`--vol:100%` 兜底，渲染即有合法值。 |
| R7 | `CoverButton` 改类名后语义/对齐回归 | 封面键错位 | 保留其 props 与内部 markup，仅换 className；新 `.console-cover-btn` 提供等价可点击区与对齐，并由 §6 人工验收覆盖。 |
| R8 | 误改预览信箱/合成器逻辑 | 黑屏/拉伸回归 | 本方案明确**不动** `computeContainBox`、`PreviewCanvas`、播放/合成/导出；变更面仅限控制区 DOM 结构与 `video-editing.css` 控制/占位样式。 |

---

## 8. 非目标 Non-Goals

- 不改播放引擎、合成器、音视频同步、导出、素材缓存等任何逻辑。
- 不改预览区比例适配/信箱算法（`aspectRatios.ts`）。
- 不新增依赖（图标继续用内联 SVG，禁止引入 icon 库）。
- 不抽公共组件（除非评审显式要求，见 §3 备注）。
- 不改 i18n 文案 key（沿用现有 `t.videoPlayerPanel.*` / `t.videoCoverModal.button`）。
- 不为本次纯表现层重设计引入功能开关（P2-4）：改动无逻辑分支、与播放/合成/导出解耦、git 可一键回滚，加 flag 属过度设计；这是与项目 preview-proxy / local-preview flag 文化的**有意偏离**，非疏漏。

---

## 评审结论 Review Verdict

**结论：有条件通过（Approved with conditions）。**

方案在四个维度均达标：**可行性**——全部主题 token、回调、i18n key、状态均经代码核验存在，`color-mix` + `--progress/--vol` 填充在 Electron/Chromium 桌面端（主目标）成熟可落地；**一致性**——复用时间轴重设计的 token 体系与 `color-mix` 写法，类名契约清晰，无与 `CLAUDE.md`「单一预览路径」「不动合成/导出/信箱逻辑」等约定冲突；**完整性**——补齐 P1-1/P1-2 后，死/重复/孤儿 CSS（含 `@media` 覆盖）已被完整纳入删除清单；**规模合理性**——纯表现层重构、不强抽组件、不引依赖，范围克制。

本轮已就地修复全部 **3 个 P1**（P1-1 媒体查询孤儿规则、P1-2 容器孤儿规则、P1-3 静音键 a11y 属性）与 **2 个 P2**（P2-1 测试不可行断言、P2-2 onKeyDown 误述），无 P0；剩余 2 个 P2（P2-3 行号漂移、P2-4 无 flag）以「grep 为准」硬约束与「有意偏离」批注消解。**无 P0/P1 遗留。**

**放行条件（开发节点 Subtask #2 必须遵守）**：
1. 删除任何选择器前，**复跑 R1 的 grep 清单**二次确认仅 `VideoPlayerPanel.tsx`+`CoverButton.tsx` 引用；以 grep 命中为准，**行号仅作参照**。
2. 删除基础规则时**连带删除其 `@media` 响应式覆盖**（约 1144–1290）与 `.video-controls-info-container`（627/1173），同时**保留**同块内 `.materials-panel-content .grid-cols-3`/`.material-type-filter`/`.video-player-container{gap}`。
3. JSX 替换时**逐字保留**静音键的 `aria-pressed`/`title`/`aria-label`、播放键的 `disabled`/`aria-disabled`/`title`、分段键的 `aria-pressed`，以及全部既有事件处理器与 i18n key。
4. 收尾验收：`npm run type-check` 与 `npm run lint` 0 报错、`npx jest src/components/video/components/VideoPlayerPanel` 全绿、桌面 walkthrough（§6.2）作为强制门通过。

满足上述条件即视为通过，可进入代码开发节点。
