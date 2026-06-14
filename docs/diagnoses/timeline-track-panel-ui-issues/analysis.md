# 诊断报告：时间线轨道面板三处 UI 缺陷

> Bug 标识：`timeline-track-panel-ui-issues`
> 诊断节点：Subtask #0（问题定位与分析）
> 关联轮次：第 2 轮需求（在第 1 轮「DaVinci 级时间线重设计」之上继续打磨）
> 约束：本节点**只产出分析，不写修复代码、不 commit**。

---

## 一、问题描述（Problem description）

视频编辑功能下方的「剪辑轨道面板」（`TimelinePanel`）在第 1 轮重设计后仍存在三处影响美观与可用性的缺陷：

1. **左侧轨道标题文字被截断**：每条轨道左侧标题列（轨道名，如 `视频轨道 1` / `Subtitle Track 1`）文字显示不全，被 `truncate` 裁成 `视频…`。需要适当加宽标题列以完整显示文字，但不能太宽（会挤占时间轴可视区域，并破坏标尺对齐）。
2. **顶部工具栏按钮出现蓝色边框**：轨道面板顶部的按钮横栏（`TimelineToolbar`：导入/剪切/复制/删除/撤销/重做/导出/字幕…）在点击 / 聚焦 / 激活态下出现蓝色边框/描边，观感生硬。用户要求按钮点击时不需要边框颜色。
3. **轨道标题右侧小按钮的 hover 提示被遮挡**：每条轨道标题右侧的控制按钮（音量/全选/锁定/可见/删除等）在 hover 时弹出的文字提示（tooltip）会被上方的横栏（工具栏 / 标尺）遮挡或裁切，没有浮在「整个项目的最高层级」。

三处都属于**纯表现层（presentation-only）**问题，不涉及业务逻辑。

---

## 二、复现步骤（Reproduction steps）

> 以下步骤在本仓库的前端开发服务器上可稳定复现；桌面 Electron 包内表现一致（同一套组件 + 同一套 Chromium 渲染）。

### 环境准备
1. 仓库根目录执行：`npm run dev`（前端 dev server，端口 `:3000`）。
2. 浏览器打开 `http://localhost:3000`，进入「视频编辑」功能页面，新建或打开一个项目，使时间线面板挂载。
   - 默认会种入 5 条轨道（见 `src/components/video/timeline/TimelinePanel.tsx:213-219`）：`video-track-1`、`image-track-1`、`audio-track-2`×2、`subtitle-track-1`，足以同时复现三处问题。
3. 视线落到页面底部的时间线面板（工具栏横栏 + 标尺 + 轨道区）。

### 缺陷 1（标题截断）复现
- 观察任意一条轨道左侧的标题列。中文界面下 `视频轨道 1` 被截成 `视频…`；英文界面下 `Subtitle Track 1` 被截成 `Subtitle T…`。
- 鼠标悬停标题可见原生 `title` 完整文本（`Track.tsx:324`），印证文字本身完整、只是显示区域不足被 `truncate` 裁切。

### 缺陷 2（蓝色边框）复现
- 用键盘 `Tab` 聚焦工具栏任一按钮，或点击「剪切」按钮（toggle）将其激活 → 按钮出现蓝色描边/边框。
- 蓝色取自主题 token `--ring` / `--primary` = `#0D99FF`（`src/styles/globals.css:25` 暗色、`:143` 亮色 `#0C8CE9`）。

### 缺陷 3（提示被遮挡）复现
- 把鼠标悬停到**最上面一条轨道**标题右侧的某个小按钮（如音量/锁定）上。
- 期望：提示气泡完整浮现在按钮上方、压在所有内容之上。
- 实际：气泡向上弹出后被轨道滚动容器裁切 / 被上方的标尺与工具栏横栏盖住，看不全或看不到。
- 对照：**同样写法的工具栏按钮**提示却显示正常（见根因分析，差异在于父级 `overflow` 与层叠上下文）。

---

## 三、根因分析（Root cause analysis）

### 缺陷 1：标题列固定 `w-48`（192px），右侧 5 个按钮挤占后留给文字的空间不足 30px

轨道标题列宽度被硬编码为 `w-48`（192px）：

- `src/components/video/timeline/Track.tsx:310`
  ```tsx
  className={`track-controls w-48 bg-muted border-r border-border transition-opacity ...`}
  ```
- 列内是一个 `justify-between` 的行（`Track.tsx:316`），左侧是「图标 + 名称」组（`Track.tsx:320` `flex-1 min-w-0`，名称 `Track.tsx:324` 带 `truncate`），右侧是控制按钮组（`Track.tsx:330` `flex items-center space-x-1`）。
- 右侧按钮每个 `w-[22px]`（`Track.tsx:342/404/442/480/520/560`）。对 video/audio/subtitle 轨道，右侧固定有 **5 个按钮**（音量或字幕编辑 + 全选 + 锁定 + 可见 + 删除）。

宽度账（粗算）：列内可用宽 = 192 − `p-2` 左右各 8 = **176px**；右侧 5 按钮 = `5×22 + 4×4(space-x-1)` ≈ **126px**；左侧图标 `w-4`（16px）+ `space-x-2`（8px）≈ 24px。留给名称的宽度 ≈ `176 − 126 − 24` ≈ **26px**。

在 `text-xs`（约 12px 字号）下，26px 连两个中文字都放不下，于是 `truncate`（`Track.tsx:324`）生效，文字被截。English 标签更长（`Subtitle Track 1` 见 `src/lib/i18n.ts:3382`），截断更明显。**根因即「固定 192px 列宽 − 5 个 22px 按钮 = 文字空间被压到不足 30px」**。

> 名称文本本身完整：`deriveTrackDisplayName`（`src/components/video/timeline/trackDisplayName.ts:23`）会从轨道 id 推导出 `视频轨道 1` 等完整标签，并通过 `title` 属性原样挂上（`Track.tsx:324`）。问题纯粹是显示宽度不够。

### 缺陷 2：工具栏按钮的「聚焦描边 / 激活边框」用了蓝色 token `#0D99FF`

`renderIconButton` 给每个工具栏按钮加了两类会产生蓝色框的样式（`src/components/video/timeline/TimelineToolbar.tsx:258-266`）：

```tsx
className={`
  relative p-2 rounded-md transition-all duration-200 flex items-center justify-center w-8 h-8
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1   // ← 蓝色聚焦 ring
  ${button.disabled
    ? 'text-muted-foreground cursor-not-allowed bg-muted'
    : isActive
      ? 'text-primary bg-primary/15 border border-primary shadow-inner'                                  // ← 蓝色激活 border
      : button.className || 'text-foreground hover:text-foreground hover:bg-muted active:bg-accent border border-transparent'
  }
`}
```

- **聚焦 ring**：`focus-visible:ring-2 focus-visible:ring-ring`，`ring-ring` 解析到 `--ring`；按钮被 `:focus-visible`（键盘 Tab 聚焦，或 Chromium 在部分交互后判定为 focus-visible）命中时出现 2px 蓝色 box-shadow 描边。
- **激活 border**：剪切等 toggle 按钮激活后 `border border-primary`，`--primary` 同为蓝色，呈现持久的蓝色 1px 边框（点击「剪切」后最直观）。
- **全局兜底**：`src/styles/globals.css:280-282` 还有一条全局规则
  ```css
  *:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
  ```
  对**没有** `focus-visible:outline-none` 的按钮（如轨道头按钮、加轨道按钮）也会画蓝色描边；工具栏按钮虽用 `outline-none` 覆盖了它，但改用了同色 ring，颜色来源一致。

蓝色来源 token 证据：`src/styles/globals.css:25` `--ring: #0D99FF;`（暗色）、`:100` 同值、`:143` `--ring: #0C8CE9;`（亮色）。**根因即「按钮的聚焦/激活态视觉直接采用了高饱和蓝色 `--ring/--primary`，在点击/聚焦时形成刺眼蓝框」**。

### 缺陷 3：tooltip 被多层 `overflow` 裁切 + 无法逃出滚动容器的层叠上下文

轨道头每个按钮的 tooltip 都是「相对按钮 `.relative.group` 绝对定位、向上 `bottom-full`、`z-[9999]`」：

- `src/components/video/timeline/Track.tsx:368`（音量）、`:414`（字幕编辑）、`:461`（全选）、`:496`（锁定）、`:536`（可见）、`:570`（删除）：
  ```tsx
  <div className="absolute bottom-full left-1/2 ... mb-2 z-[9999] pointer-events-none ...">
  ```

这些按钮位于左侧 `.track-controls` 列内，而该列又嵌在轨道容器的**多层 `overflow` 裁剪盒**里：

- `src/components/video/timeline/TrackContainer.tsx:290`：`track-container flex-1 flex flex-col overflow-hidden`
- `:293`：`flex-1 relative overflow-hidden`
- `:296`：`absolute inset-0 overflow-y-auto overflow-x-auto`（真正的滚动容器）

层叠/裁切机制：`z-index` 只在**同一层叠上下文内**生效，并且**无法突破祖先的 `overflow` 裁剪**。最上面一条轨道的 tooltip 用 `bottom-full` 向上弹出时，会落到轨道行上沿之外，正好被上述 `overflow-y-auto / overflow-hidden` 容器在顶边裁掉；即使没被裁，`z-[9999]` 也被困在滚动容器的层叠上下文内，无法盖到面板更上方的标尺（`TimelinePanel.tsx:999`）与工具栏横栏（`TimelinePanel.tsx:988`）之上。三者在 `TimelinePanel` 里是 flex 纵向兄弟（工具栏 → 标尺 → 轨道容器，见 `TimelinePanel.tsx:988/999/1005`），轨道容器整体在下方且自带裁剪，于是顶部轨道的提示「被上方横栏遮挡」。

**对照证据（为什么工具栏按钮的同款 tooltip 不被遮挡）**：工具栏根节点是 `overflow-visible` 且自身就是面板最顶元素（`src/components/video/timeline/TimelineToolbar.tsx:300`：`timeline-toolbar h-8 ... relative overflow-visible`），它的 tooltip 向上弹出时上方无裁剪盒、也无更高的兄弟去盖它，故正常。差异点正是「父级 `overflow` + 是否处于会被上层兄弟覆盖的位置」，这反向印证了根因。

**根因即「轨道头 tooltip 仍用 DOM 内绝对定位 + 高 z-index，但被滚动容器的 `overflow` 裁切并困在其层叠上下文中，无法真正浮到全局顶层」**。

---

## 四、影响面（Impact surface）

| 缺陷 | 受影响范围 | 严重度 | 备注 |
|---|---|---|---|
| 1 标题截断 | 所有轨道（video/image/audio/subtitle）的左侧标题；中英文都受影响，英文更严重 | 中（可用性/可读性） | 修复需**同步**改动标尺控制列与共享常量，否则破坏标尺/播放头对齐（见下） |
| 2 蓝色边框 | `TimelineToolbar` 全部图标按钮（导入/剪切/复制/删除/撤销/重做/整理/导出/特效/转场/字幕） | 低（纯观感） | 仅表现层；需兼顾键盘可达性（不能直接把聚焦反馈删光） |
| 3 提示被遮挡 | 轨道头 6 类控制按钮的 hover/focus tooltip；**最上方轨道最明显** | 中（信息不可见） | 同款 tooltip 模式在底部「加轨道」按钮（`TrackContainer.tsx:444+`）也存在，修复方案宜可复用 |

**缺陷 1 的关键耦合（决定「不能太宽」且「改一处不够」）**：`192px` 是被三处共享的同一来源——

- 轨道头列宽 `w-48`：`Track.tsx:310`
- 标尺左侧控制列宽 `w-48`：`TimelineRuler.tsx:295`
- 共享常量 `TRACK_HEADER_WIDTH = 192`：`theme/timelineTheme.ts:32`，并被用作播放头/对齐线的原点偏移：`TrackContainer.tsx:120`（`alignmentLinePosition = currentTime * pixelsPerSecond + TRACK_HEADER_WIDTH`）。

因此加宽标题列**必须三处一起改**（`Track.tsx` 的 `w-48`、`TimelineRuler.tsx` 的 `w-48`、`timelineTheme.ts` 的 `TRACK_HEADER_WIDTH`），否则标尺刻度、网格线与播放头会与轨道内容产生水平错位（这正是第 1 轮 review R5 强调的「单一来源、锁步」约束）。同时不宜过宽，以免压缩时间轴可视宽度。

---

## 五、候选修复方案（Candidate fixes）

### 缺陷 1：加宽标题列

| 方案 | 做法 | 侵入性 | 风险 | 工作量 | 评价 |
|---|---|---|---|---|---|
| 1A 同步加宽固定值 | 把三处 `192` 统一调到约 `208–224px`（`w-52`/`w-56`），并把右侧按钮组与名称之间留更合理的间距 | 低 | 低（只要三处锁步即对齐不破） | 小 | **推荐**：最小、可控，满足「能显示全但不太长」 |
| 1B 名称区动态/换行 | 让名称 2 行显示或随轨道高度自适应 | 中 | 中（轨道高度由 `TrackContainer` 动态算，易抖动） | 中 | 过度设计，行业 NLE 也多用单行 |
| 1C 收纳右侧按钮 | 右侧 5 按钮收进「⋯」溢出菜单，腾出名称空间 | 高 | 中（改交互习惯、需新组件） | 大 | 偏离本轮诉求，留作后续 |

### 缺陷 2：去掉/弱化蓝色边框

| 方案 | 做法 | 侵入性 | 风险 | 工作量 | 评价 |
|---|---|---|---|---|---|
| 2A 工具栏按钮去蓝框 | 工具栏按钮：移除 `border border-primary` 与蓝色 `ring`，激活态改用**背景底色**（如 `bg-accent`/`bg-muted` + 文字主色）表达；聚焦反馈改为极淡 ring 或仅背景变化 | 低 | 低 | 小 | **推荐**：精准命中「点击不要蓝边框」，且不牺牲激活/可达性反馈 |
| 2B 全局改 token | 调淡/改色 `--ring`/`--primary` | 高 | 高（波及全站所有聚焦态/主色） | 小 | 破坏面过大，禁用 |
| 2C 全局删聚焦描边 | 删掉 `globals.css:280` 的 `*:focus-visible` outline | 中 | 高（损害全站键盘可达性/A11y） | 小 | 不可取 |

### 缺陷 3：让 tooltip 浮到全局顶层

| 方案 | 做法 | 侵入性 | 风险 | 工作量 | 评价 |
|---|---|---|---|---|---|
| 3A Portal tooltip | 抽一个 `Portal` tooltip 组件：`createPortal` 到 `document.body`，用按钮 `getBoundingClientRect()` 计算 `position: fixed` 坐标，复用到轨道头各按钮（及加轨道按钮） | 中 | 低 | 中 | **推荐**：真正满足「整个项目最高层级、不被遮挡」，一次到位且可复用 |
| 3B 提升 z-index | 仅调大 `z-[9999]` | 低 | 高（无效：`overflow` 裁切与层叠上下文不是 z-index 能解决的） | 小 | **无效**，已是根因否定项 |
| 3C 去掉父级 overflow | 让滚动容器 `overflow-visible` | 高 | 高（破坏横/纵向滚动、渐变指示器、拖拽滚动等既有逻辑） | 中 | 副作用大 |
| 3D 仅留原生 title | 删自定义气泡只保留 `title` | 低 | 中（丢掉第 1 轮统一的视觉气泡与 focus-within 可达性） | 小 | 退化，不符诉求 |

---

## 六、推荐方案（Recommended fix）

- **缺陷 1 → 1A（同步加宽固定值）**：将 `Track.tsx:310`、`TimelineRuler.tsx:295` 的 `w-48` 与 `timelineTheme.ts:32` 的 `TRACK_HEADER_WIDTH` 三处**锁步**调到约 `w-52~w-56`（208–224px），并适当增大名称与按钮组的间距/给名称留 `min-w`。理由：直接消除「26px 文字空间」的根因，改动面最小且明确可验证（标尺/播放头对齐不破，因为三处同源同改）；符合「显示全但不太长」与第 1 轮 R5 单一来源约束。
- **缺陷 2 → 2A（工具栏按钮去蓝框）**：在 `TimelineToolbar.tsx:258-266` 把激活态的 `border border-primary` 换成纯背景底色表达（如 `bg-accent` + `text-primary`，去掉边框），并移除/弱化蓝色聚焦 `ring`（保留极淡、非蓝的可达性反馈）。理由：精准满足「点击不需要边框颜色」，作用域仅限工具栏，不动全局 `--ring`/`*:focus-visible`，不伤其它组件与 A11y。
- **缺陷 3 → 3A（Portal tooltip）**：将轨道头按钮 tooltip 改为渲染到 `document.body` 的 Portal，按 `getBoundingClientRect` 定位（`position: fixed`），从而逃出 `TrackContainer` 的多层 `overflow` 与层叠上下文，真正置顶。理由：这是唯一能根治「被上方横栏遮挡」的方案（3B 提 z-index 已被根因证伪），且可同时复用到底部加轨道按钮，统一收口。

> 三项均为表现层改动，互不耦合，可独立提交、独立回归；缺陷 1 唯一需要注意的连带项是「三处 192 必须一起改」，已在影响面中明确给出文件与行号。

---

## 七、证据索引（便于评审快速核对）

- 标题列固定宽与截断：`src/components/video/timeline/Track.tsx:310`、`:320`、`:324`、`:330`、`:342`
- 宽度三处耦合：`src/components/video/timeline/TimelineRuler.tsx:295`、`src/components/video/timeline/theme/timelineTheme.ts:32`、`src/components/video/timeline/TrackContainer.tsx:120`
- 标签文本来源：`src/components/video/timeline/trackDisplayName.ts:23`、`src/lib/i18n.ts:3380-3383`（英）/`:5888-5891`（中）
- 工具栏蓝框样式：`src/components/video/timeline/TimelineToolbar.tsx:258-266`
- 蓝色 token / 全局聚焦描边：`src/styles/globals.css:25`、`:143`、`:280-282`
- 轨道头 tooltip（z-[9999] / bottom-full）：`src/components/video/timeline/Track.tsx:368`、`:414`、`:461`、`:496`、`:536`、`:570`
- 裁切祖先（overflow）：`src/components/video/timeline/TrackContainer.tsx:290`、`:293`、`:296`
- 面板纵向层级（工具栏/标尺/轨道容器为兄弟）：`src/components/video/timeline/TimelinePanel.tsx:988`、`:999`、`:1005`
- 对照（工具栏 overflow-visible 故不被裁）：`src/components/video/timeline/TimelineToolbar.tsx:300`

---

## 评审结论（Review Verdict）

> 评审节点：Subtask #1（分析报告评审与修复）。评审人：资深前端 Reviewer。
> 方法：对第三章每一条引用逐行回读源码二次取证；对第五/六章候选方案逐项审计边界、最小化与回归风险；对证据薄弱处就地补全代码引用。
> 约束遵循：本节只评审与补证，不写修复代码、不 `git commit`。

### A. 根因证据复核（逐行回读，全部命中）

| 缺陷 | 报告论断 | 引用位置 | 回读核验 | 结论 |
|---|---|---|---|---|
| 1 | 标题列固定 `w-48`(192px) | `Track.tsx:310` | `className="track-controls w-48 …"` 实测命中 | ✅ 准确 |
| 1 | 名称 `flex-1 min-w-0` + `truncate`(+`title`) | `Track.tsx:320/324` | 行 320 `flex-1 min-w-0`、行 324 `truncate … title={trackDisplayName}` | ✅ 准确 |
| 1 | 右侧按钮各 `w-[22px]`、共 5 个 | `Track.tsx:342/404/461/496/536/570` | 实测：video/audio = 音量+全选+锁定+可见+删除(5)；subtitle = 字幕编辑+全选+锁定+可见+删除(5)；**image = 4（无音量，见 `Track.tsx:332` 的 `!track.id.startsWith('image-track')` 排除条件）** | ✅ 准确（补：image 为 4 个，最坏情形仍是 5 个，宽度账成立） |
| 1 | 宽度三处同源耦合 192 | `TimelineRuler.tsx:295`、`timelineTheme.ts:32`、`TrackContainer.tsx:120` | 行 295 `w-48`；`TRACK_HEADER_WIDTH=192` 且 `timelineTheme.ts:20-32` 注释**明文**写「`TRACK_HEADER_WIDTH (192) ⇄ w-48 on the ruler control panel + track header」**；行 120 `alignmentLinePosition = currentTime*pixelsPerSecond + TRACK_HEADER_WIDTH` | ✅ 准确，且耦合关系有源码自注释佐证，「锁步三改」约束成立 |
| 1 | 标签由 id 派生、文本本身完整 | `trackDisplayName.ts:23`、`i18n.ts:3380-3383` | `deriveTrackDisplayName` 由 id 前缀拼 `${label} ${num}`；英文 `Video/Audio/Subtitle/Image Track` | ✅ 准确 |
| 2 | 聚焦 ring + 激活 border 皆为蓝 | `TimelineToolbar.tsx:258-266` | 行 260 `focus-visible:ring-2 focus-visible:ring-ring …`；行 264 `isActive` → `border border-primary shadow-inner` | ✅ 准确 |
| 2 | 蓝色 token 来源 | `globals.css:25/143` `--ring` | 行 25 `--ring:#0D99FF`(暗)、行 143 `--ring:#0C8CE9`(亮) | ✅ 准确 |
| 2 | 全局兜底描边 | `globals.css:280-282` | `*:focus-visible{outline:2px solid var(--ring);…}`（实占 280-283，含 `border-radius`） | ✅ 准确 |
| 3 | tooltip 绝对定位 `bottom-full z-[9999]` | `Track.tsx:368/414/461/496/536/570` | 六处逐行命中，写法一致 | ✅ 准确 |
| 3 | 多层 overflow 裁剪盒 | `TrackContainer.tsx:290/293/296` | 行 290 `overflow-hidden`、行 293 `overflow-hidden`、行 296 `overflow-y-auto overflow-x-auto`（真实滚动容器） | ✅ 准确 |
| 3 | 面板纵向兄弟序：工具栏→标尺→轨道容器 | `TimelinePanel.tsx:988/999/1005` | 三者为 `timeline-panel flex flex-col`(行 984) 下的顺序兄弟 | ✅ 准确 |
| 3 | 对照：工具栏 `overflow-visible` 故不被裁 | `TimelineToolbar.tsx:300` | `timeline-toolbar … relative overflow-visible` | ✅ 准确 |
| 3 | 同款 tooltip 亦存在于加轨道区 | `TrackContainer.tsx:444+` | 行 444/466/488/510 同为 `absolute bottom-full … z-[9999]` | ✅ 准确（方案可复用判断成立） |

**结论：三章引用全部经源码二次核验无误，根因链成立。** 下列为补全的证据与三处需收紧的论断。

### B. 证据补全（原报告未给/略弱之处，此处补齐）

1. **缺陷 2 的 `--primary` 行号补全**：原报告称激活态 `border-primary` 「`--primary` 同为蓝色」但只给了 `--ring` 行号。补：`--primary:#0D99FF`（暗，`globals.css:13`、`:87`）、`--primary:#0C8CE9`（亮，`globals.css:131`）——与 `--ring` 同色，故 `border border-primary` 确为蓝边，证据闭合。
2. **缺陷 2 的「toggle 按钮」收紧**：原报告「剪切**等** toggle 按钮激活后…」措辞偏宽。回读 `TimelineToolbar.tsx:314-351`，**仅 `cutButton` 以 `isActive` 调用**（`renderIconButton(cutButton, isCutActive)`，行 320），其余按钮一律 `isActive=false`。即**持久蓝边只出现在「剪切」一个 toggle 上**；其余按钮的蓝色只可能来自键盘 `:focus-visible` 的蓝 ring（鼠标单击普通按钮在 Chromium 通常不触发 `:focus-visible`）。这一精确化不改变修复方向，但界定了「点击后持久蓝边」的唯一来源是激活态 border。
3. **缺陷 3 机制收紧（决定性原因 = overflow 裁切，而非 z 序覆盖）**：用户感知为「被上方横栏遮挡」，但按 DOM 兄弟序，`TrackContainer`(行 1005) 在工具栏/标尺**之后**绘制，同层叠上下文内本应「压在其上」。因此**真正决定缺陷的机制是 `overflow` 裁切**（tooltip 在抵达横栏区域前已被 `TrackContainer.tsx:290/293/296` 的裁剪盒在顶边切掉），而非 z-index 覆盖。此点对修复极关键：**仅靠 `position:fixed` 原地渲染不足以根治**——时间线内大量元素带 `transform`（如 tooltip 自身的 `-translate-x-1/2`、播放头/片段位移），任一带 `transform/filter/will-change` 的祖先都会成为 fixed 元素的包含块，把它重新困住。**只有 Portal 到 `document.body`（脱离所有祖先裁剪/包含块）才彻底解决**，故方案 3A 的「Portal」是必要条件，而非可选优化。

### C. 候选方案审计（边界 / 最小化 / 回归）

**缺陷 1 — 1A（同步加宽）：方向正确，但单纯加宽对最长英文标签不充分，需配合收紧右侧按钮占位。**
- 宽度账（沿用报告口径，按最坏 5 按钮）：列内可用 = `W − 16(p-2)`；名称可用 ≈ `W − 16 − 126(按钮组) − 24(图标+space-x-2)`。
  - `w-56`(224px) → 名称 ≈ **58px**：可放下中文 `视频轨道 1`(≈56px，**用户当前正是中文界面**，截图即 `视频…`)，达成本轮主诉。
  - 但英文最长默认标签 `Subtitle Track 1`（`i18n.ts:3382`+编号，`text-xs` 下 ≈ 100–105px）在 58px 下**仍会截断**；要纯靠加宽容纳需 ≈ `w-72`(288px)，明显违反「不要太长」。
- 边界结论：**「显示全」与「不要太长」在「5 个常驻 22px 按钮 + 单行名称」下，对最长英文标签不可兼得**。
- 回归：三处 `192` 必须锁步同改（`Track.tsx:310`/`TimelineRuler.tsx:295`/`timelineTheme.ts:32`），否则标尺刻度·网格·播放头水平错位（`TrackContainer.tsx:120` 以 `TRACK_HEADER_WIDTH` 为原点）——此为唯一且已被准确标注的连带项。
- 评审取舍：**采纳 1A，并把目标钉为 `w-56`(224px) 锁步**作为基线（彻底满足中文等 CJK 默认标签）；**若需同时兼容最长英文标签，必须配合压缩右侧按钮占位**（二选一/可叠加：①把 `space-x-1` 收为 `space-x-0.5`；②让右侧控制按钮在 `.track-controls` 的 `group-hover`/`group-focus-within` 时才显形——列上已有 `transition-opacity` 基建、且为各 NLE 常见交互，静息时名称可独占约 184px 内宽，最长英文亦可完整显示），而**不要把列宽撑过 ~240px**。

**缺陷 2 — 2A（工具栏按钮去蓝框）：精准、作用域正确、最小化达标。**
- 命中点：①去掉激活态 `border border-primary`（改 `bg-accent`/`bg-primary/15` 等背景底色 + `text-primary` 表达「选中」，`TimelineToolbar.tsx:264`）；②把 `focus-visible:ring-ring`（行 260）换成中性/极淡反馈或非蓝 ring。
- 最小化校验：用户诉求是「点击不要边框颜色」。**持久蓝边唯一来源是 `cutButton` 激活态 border**（见 B.2），改它即直接消除；键盘蓝 ring 一并弱化即可。**作用域仅限工具栏**，不动全局 `--ring`/`*:focus-visible`，故 2B（改 token）、2C（删全局描边）正确否决（破坏面过大 / 伤 A11y）。
- 回归红线：①激活态去掉 border 后必须保留**可区分的选中视觉**（背景底色），否则用户看不出「剪切」是否处于激活；②**不得把键盘聚焦反馈删光**（A11y），需保留一个低对比/非蓝的可见聚焦指示。报告 2A 已含此约束，认可。

**缺陷 3 — 3A（Portal tooltip）：唯一根治方案，最小「正确」改动；3B 已被根因证伪。**
- 正确性：见 B.3——必须 Portal 到 `body` 才能同时逃出 `overflow` 裁切与 `transform` 包含块；`3B 提 z-index`、`3C 去 overflow`、`3D 仅留 title` 的否决均成立。
- 回归/边界（实施须覆盖）：①**事件等价**——现有气泡靠 `group-hover` + `group-focus-within`（键盘可达），Portal 组件须同时接 `mouseenter/leave` 与 `focus/blur`，不得丢失键盘悬浮提示；②**定位时机**——以 `getBoundingClientRect()` 在「显示时」计算 `fixed` 坐标即可（hover 瞬态，无需跟随滚动持续重算）；③保留 `pointer-events-none` 不挡点击；④主题继承——`body` 下的 Portal 仍继承挂在 `html`/根上的 `:root`/`.dark` CSS 变量，气泡用现有 token 即可，无需额外处理；⑤**建议抽成单一可复用组件**，统一替换轨道头 6 处 + 加轨道区 4 处（`TrackContainer.tsx:444+`）的内联气泡，既根治又收敛重复（本仓另有 `docs/diagnoses/ai-sidebar-zindex-overlay/` 的层级处置先例，可参考其 Portal/z 序范式）。

### D. 最终推荐修复（每缺陷单一方案）

1. **缺陷 1 →【1A，钉死为 `w-56`(224px) 锁步三改，并配合收紧右侧按钮占位以容纳最长标签】**
   理由：直接消除「名称仅余 ≈26px」的根因；`w-56` 已完整容纳用户当前中文界面的默认标签（达成本轮主诉），又不破坏「不要太长」；三处同源锁步（`Track.tsx:310`/`TimelineRuler.tsx:295`/`timelineTheme.ts:32`）保证标尺·播放头零错位。因「5 常驻按钮 + 单行名称」对最长英文标签不可纯靠加宽兼得，故并入「按钮组 hover 显形 / 收紧 `space-x`」作为同一修复的组成部分，使「显示全」对各 locale 都成立。
2. **缺陷 2 →【2A，工具栏按钮去蓝：删激活态 `border-primary` 改背景底色 + 弱化非蓝聚焦 ring】**
   理由：精准命中「点击不需要边框颜色」，唯一来源（cut 激活 border）被直接移除；作用域仅 `TimelineToolbar.tsx:258-266`，不触全局 token 与 `*:focus-visible`，零跨组件回归；保留背景态选中反馈与低对比聚焦指示，兼顾可用性与 A11y。
3. **缺陷 3 →【3A，Portal 到 `document.body` 的 `fixed` 定位 tooltip，封装为可复用组件】**
   理由：经 B.3 论证，唯有 Portal 能同时脱离 `overflow` 裁切与 `transform` 包含块，真正置于「整个项目最高层级」；`3B` 已被根因证伪、`3C/3D` 副作用过大。实施须保持 hover+focus 事件等价、`pointer-events-none` 与显示时定位，并复用到加轨道区按钮。

### E. 给 Subtask #2（实施节点）的验收要点

- [ ] 缺陷 1：`Track.tsx:310`、`TimelineRuler.tsx:295`、`timelineTheme.ts:32` 三处**同时**改为 `w-56`/`224`；缩放/滚动下标尺刻度、网格线、播放头与轨道内容**仍水平对齐**（重点验 `TrackContainer.tsx:120` 原点）。
- [ ] 缺陷 1：用**最长标签**实测——中文 `视频/音频/字幕/图片轨道 1` 不再截断；英文 `Subtitle Track 1` 在所选方案（hover 显形或收紧 `space-x`）下亦能完整显示；列宽不超过 ~240px。
- [ ] 缺陷 2：点击/激活「剪切」**不再出现蓝色边框**，但仍能看出其处于激活态；键盘 `Tab` 聚焦工具栏按钮**无刺眼蓝框**，但仍有可见聚焦指示；**未改动** `globals.css` 的 `--ring`/`--primary`/`*:focus-visible`。
- [ ] 缺陷 3：滚到顶部时，**最上一条轨道**头部按钮的 hover/键盘聚焦提示**完整浮现于工具栏/标尺之上、不被裁切**；加轨道区按钮同样修复；提示不挡点击、亮/暗主题文字色正常。
- [ ] 全局：仅触前述文件；`npm run type-check` 通过；改动为表现层、未引入新依赖与计划外文件。

---

## 实施过程发现的方案缺陷（Issues Found During Implementation）

> 节点：Subtask #2（代码修复与开发）。本节记录实施时对推荐方案做出的取舍与已落地实现。

### 缺陷 1：「最长英文标签完整显示」与「不要太长」「状态图标常驻可见」三者不可兼得 —— 取「收紧 space-x」而非「hover 显形」

C 节已证明「5 个常驻 22px 按钮 + 单行名称」对最长英文标签（`Subtitle Track 1`，`text-xs` 下 ≈100–105px）无法纯靠加宽容纳（要容纳需 `w-72`≈288px，违反「不要太长」）。验收 E 第 2 条要求英文亦完整显示，D.1 给出两条候选：**①收紧 `space-x`**、**②右侧控制按钮 `group-hover` 时才显形**。实施时发现 **②会引入新的可用性回归**：锁定/可见（lock/visibility）按钮同时也是「轨道当前是否锁定 / 隐藏」的**状态指示器**，若静息时整组隐藏，用户将无法一眼看出哪条轨道被锁/被隐藏（DaVinci / Premiere 的轨道头这些状态恰恰是**常驻**显示的）。

**采取的修正方案**：选 D.1 的选项① + 钉死 `w-56`(224)，**不**采用 hover 隐藏：

- 三处锁步：`Track.tsx` 列宽 `w-48→w-56`、`TimelineRuler.tsx` 控制列 `w-48→w-56`、`timelineTheme.ts` `TRACK_HEADER_WIDTH 192→224`（其余消费者均从该单一常量读取，播放头/对齐原点 `TrackContainer.tsx:120` 自动跟随，零错位）。
- 收紧占位：右侧按钮组 `space-x-1→space-x-0.5`、左侧图标与名称 `space-x-2→space-x-1.5`，给名称多让出空间。
- 实测口径：当前**中文界面**默认标签 `视频/音频/字幕/图片轨道 1`（≈58px）在让出的名称宽度（≈66–68px）内**完整显示**，达成本轮主诉且「不要太长」（列宽 224px ≤ 240px）。
- **已知折衷**：最长**英文**默认标签 `Subtitle Track 1` 在 224px 上限内仍可能省略号截断。这是为同时满足「不要太长」与「状态图标常驻可见」而做的**刻意取舍**；用户当前为中文界面，主诉已解决。若后续产品确需英文也零截断，应另立任务评估「lock/visibility 状态以其它常驻标记表达 + 其余按钮 hover 显形」的组合，而非在本轮牺牲状态可见性。

### 缺陷 2 / 缺陷 3：按推荐方案落地，无新增缺陷

- 缺陷 2（`TimelineToolbar.tsx`）：激活态 `border border-primary`→`border border-transparent`（保留 `bg-primary/15 + text-primary` 作为选中底色，无布局抖动、无蓝边）；聚焦 `focus-visible:ring-ring`→`focus-visible:ring-foreground/15`（中性极淡、非蓝、仍可见），保留 `focus-visible:outline-none` 以压制 `globals.css:280` 的全局蓝色 outline；未触全局 token。
- 缺陷 3：新增可复用组件 `src/components/video/timeline/PortalTooltip.tsx`（`createPortal` 到 `document.body`、按 `getBoundingClientRect` 算 `fixed` 坐标、`pointer-events-none`、`mouseenter/leave` + `focus/blur` 事件等价、显示时定位），替换轨道头 6 处与加轨道区 4 处内联气泡，逃出 `TrackContainer` 多层 `overflow` 与 `transform` 包含块，置于全局顶层。工具栏自身的气泡因其根节点 `overflow-visible` 且为面板最顶兄弟、本就不被裁切，按最小化原则**未改动**。
