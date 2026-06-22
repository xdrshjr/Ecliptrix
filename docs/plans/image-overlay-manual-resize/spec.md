# 图片轨道叠加层：点击图片后可手动缩放（修复选区被即时清除 + 多角缩放手柄）

> Feature slug: `image-overlay-manual-resize`
> Version: **v2（方案评审与修复 — Subtask #1）**
> Author: Solution Architect（Subtask #0 方案设计）
> Reviewer: Senior Reviewer（Subtask #1 方案评审与修复）
> Date: 2026-06-21（v1 方案设计）／2026-06-21（v2 评审定稿）
> 多轮迭代：第 2 轮。前置成果见 `docs/plans/image-overlay-fit-and-transform/spec.md`（第 1 轮：默认居中 80% + 两路 `object-contain` + 等比缩放/拖拽 + D6 首帧对齐，已落地于 `201b29a`）。本轮**不回滚/不重写**第 1 轮成果，仅在其之上修复「点击图片后无法缩放」。

---

## 评审记录（Review Notes — Subtask #1）

> 评审维度：可行性 / 完整性 / 一致性 / 适度性。下表逐条列出问题、严重级与处置；P0/P1 已在 v2 正文就地修复，P2 给出指引或留作实施注意。所有根因 file:line 引用经源码逐行核对属实（`ImageOverlay.tsx`、`VideoPlayerPanel.tsx:464/503`、`imageOverlayGeometry.ts`、`exportButton.test.tsx`/`VideoPlayerPanel.solePath.test.tsx` 范式均确认存在）。

| # | 维度 | 级别 | 问题 | 处置（v2） |
|---|------|------|------|-----------|
| **C1** | 完整性/可行性 | **P0** | **手势结束后的尾随 click 仍会清空选区**。v1 把 D1（叠加层根 div `onClick stopPropagation`）当作充分修复、把 D3 守卫降级为「可选兜底，首选只做 D1」。但缩放/拖拽手势的 `mouseup` 常落在叠加层 box 之外（典型：抓角向外放大）；此时浏览器在 mousedown-target 与 mouseup-target 的**共同祖先 = 外层 wrapper** 上派发 `click`，绕过叠加层根 div 的 `onClick`，命中 `wrapper onClick → setSelectedImageOverlay(null)` → 手柄随即消失。等于「缩放这个功能」在最自然的放大手势上仍不可用。 | **就地修复**：把取消选择从 `onClick` 改挂到 `onMouseDown`（`VideoPlayerPanel.tsx:464` 组合模式、`:503` 占位模式各一处）。现有 `handleMouseDown`/`handleResizeMouseDown` 已在 **mousedown** 上 `stopPropagation`，改为 mousedown 触发取消后，**点击/拖拽结束/缩放结束三种时序的尾随 click 一并失效**，选区在所有路径上稳定。详见 §4.1 D1′、§4.2。 |
| **C2** | 适度性/一致性 | **P1** | v1 在 D1 与 D3 之间留有「可选/兜底/首选只做 D1」的摇摆表述，下游开发节点很可能据此只落半个修复（仅 D1），交付即 C1 复现。 | 删除摇摆表述，**收敛为单一稳健机制**（C1 的 `onMouseDown` 取消选择）。保留叠加层根 div 的 `onClick stopPropagation` 仅作**廉价 defense-in-depth**（一行、无副作用、防未来在 wrapper 上新增 onClick）。见 §4.1。 |
| **C3** | 可行性 | **P1** | 「当前被拖的角」必须用 **`useRef`** 承载，而非 `useState`。全局 `mousemove` 监听在 effect（`ImageOverlay.tsx:217-235`）中按 `handleResizeMouseMove` 的标识订阅；若用 state 存放 handle，则每次 setState 改变回调标识 → effect 重订阅 → 手势中途可能丢事件/读到陈旧角。v1 仅一处提到 `resizeHandleRef`，文件变更计划未把「ref 非 state」立为硬约束。 | 在 §4.1 新增 D2b、§5 文件计划明确：活动角用 `useRef<HandleId\|null>`，`handleResizeMouseDown(handle)` 写入、`handleMouseUp` 复位 `null`；`handleResizeMouseMove` 从 ref 读取，保持回调标识稳定。 |
| **C4** | 一致性 | P2 | 手柄定位类**自相矛盾**：§4.1 写 `-top-1 -left-1`（角内偏），§6 示例写 `top-0 left-0 -translate-x-1/2 -translate-y-1/2`（角居中）。 | 统一为**角居中** `-translate-*-1/2` 形式（见 §4.1 D2、§6）。并提示：图片贴帧边时上排手柄不得溢出到比例控制行（组合 wrapper 无 `overflow-hidden`，偏移仅 ~10px，视觉可接受，但定位以不遮挡控件为准）。 |
| **C5** | 一致性 | P2 | `resizeFromHandle` 四角各算「锚点+raw+反推」，朴素 switch 易超 CLAUDE.md 阈值（方法 ≤50 行、圈复杂度 ≤10）。 | 见 §4.3 末：把每角「固定哪两条边、raw 轴符号」编码为**数据表**（复用 `RESIZE_HANDLES` 元数据），通用计算，函数保持短小、低圈复杂度。 |
| **C6** | 完整性 | P2 | 柯里化后的 `handleResizeMouseDown` 须**保留 `e.preventDefault()`**。现有实现 `preventDefault()`+`stopPropagation()` 二者皆有；v1 §4.1 D2 只提 `stopPropagation`，漏掉 `preventDefault` 会引入缩放时文本选中/图片原生拖拽残影。 | §4.1 D2、§6 注明保留 `preventDefault`。 |
| **C7** | 一致性 | P2 | 措辞不一：§3/§4.2 说组件「算 raw 值」，§6 签名收的是 `mouseXNorm/mouseYNorm`（归一化鼠标坐标）。 | 统一口径：**组件只算归一化鼠标坐标**，raw/锚点反推全在 `resizeFromHandle` 内部（§4.3）。见 §4.2、§4.3。 |
| **C8** | 完整性 | P2 | 极小图（缩到 `MIN_OVERLAY_SIZE=0.1`）时四个 ~18–20px 命中区可铺满整图，挤掉中央「移动」拖拽区。 | §9 风险表新增条目：命中区控制在 ~18–20px 且贴角，保证中央留有移动区；必要时低于某像素阈值时仅留对角两手柄。属体验兜底，不阻断本轮。 |
| **C9** | 完整性/测试 | P2（接受） | 核心交互（点击后选区稳定、缩放尾随 click 不清选）受 vitest `jsx:"preserve"` 限制**无法 mount 验证**，只能源码正则 + 手动走查。 | 接受现状（与 `exportButton.test.tsx`/`solePath.test.tsx` 既有范式一致）。**强制门槛 = §8 手动走查 #7–#12**，并新增 #8a「缩放手势在 box 外松开后选区仍在」。源码正则补 `onMouseDown` 取消选择断言（§8）。 |

**评审结论摘要**：根因定位准确、范围适度、与第 1 轮成果无冲突；唯一实质缺陷是 v1 把「手势尾随 click 清选」当作可选项（C1=P0）。v2 已把取消选择改为 `onMouseDown` 单一稳健机制并就地修复 C1–C3、澄清 C4/C6/C7、记录 C5/C8/C9。最终判定见文末 **§11 评审结论：有条件通过**。

---

## 1. Overview（概述）

视频编辑器允许用户在「素材管理」上传图片，再把图片拖到「图片轨道」（本质是 video 轨道上 `originalMaterialType === 'image'` 的 `TimelineItem`）。第 1 轮已经把图片叠加层默认改为「居中 80% + 等比 contain」，并在 `<ImageOverlay>`（`src/components/video/components/VideoPlayerPanel/ImageOverlay.tsx`）中实现了拖拽移动与**等比缩放**：选中后右下角会出现一个蓝色缩放手柄，配套纯几何 `resizeKeepingAspect`（`imageOverlayGeometry.ts`）保证缩放保持图片原始宽高比、不失真。换言之，「缩放」的**计算逻辑与渲染手柄本身已经存在**。

但本轮用户反馈「点击预览视频上的图片时无法缩放」。经逐行核查，根因不在缩放算法，而在**交互层的选区被点击事件即时清除**：组合预览的外层容器（`VideoPlayerPanel.tsx:464`，以及占位/预览模式的 `:503`）挂了 `onClick={() => setSelectedImageOverlay(null)}` 用于「点击空白处取消选择」；而 `<ImageOverlay>` 的 `handleMouseDown`（`ImageOverlay.tsx:98-121`）只对 **mousedown** 调用了 `e.stopPropagation()`，对 mouseup 之后浏览器派发的、独立的 **click** 合成事件没有任何拦截。于是用户点击图片的完整时序是：mousedown 选中并渲染出缩放手柄 → mouseup → **click 冒泡到外层 `onClick` → 立刻 `setSelectedImageOverlay(null)` 取消选中 → 手柄随之消失**。手柄只在「鼠标按住」的极短窗口内可见，用户根本无法「先点选、再去抓那个仅 12px 的右下角手柄」，最终表现为「点了图片但不支持缩放」。

本方案修复两件事：(1) **核心缺陷（P0）**——让「点击图片」产生**稳定选区**，使缩放手柄常驻可见、可抓取；做法是阻止源自叠加层的 click 冒泡到外层的「取消选择」处理器，同时**完全保留**「点击空白处取消选择」的既有行为。(2) **缩放可用性（P1，推荐）**——把现状「仅右下角一个 12px 手柄」升级为**四角缩放手柄 + 更大命中区 + 光标反馈**，让「手动缩放」真正可被发现、可被精确抓取；等比缩放语义、最小尺寸下限、越界钳制均**沿用**第 1 轮的纯几何，不另起炉灶。本节点只产出设计文档，不写实现代码；所有改动集中在前端预览域（`src/components/video/components/VideoPlayerPanel/**`），不触碰后端、导出链路与数据结构。

---

## 2. 现状梳理与根因分析（Background & Root Cause）

### 2.1 已有缩放能力（第 1 轮成果，本轮复用，不改）

- `ImageOverlay.tsx:36-37`：组件内部状态 `isResizing` / `isDragging`。
- `ImageOverlay.tsx:168-174`：`handleResizeMouseDown` —— 在缩放手柄上 `e.stopPropagation()` 并置 `isResizing(true)`。
- `ImageOverlay.tsx:176-214`：`handleResizeMouseMove` —— 由鼠标算出自由 `rawWidth/rawHeight`，调用纯函数 `resizeKeepingAspect(...)`（`imageOverlayGeometry.ts:134-167`）做**等比缩放**，再 `clampImagePosition` 钳制，最后 `onPositionChange` 回写。
- `ImageOverlay.tsx:264-269`：**唯一一个**缩放手柄，位于 `bottom-0 right-0`、`w-3 h-3`（12px）、`cursor-se-resize`，**仅在 `isSelected` 时渲染**。
- `imageOverlayGeometry.ts`：`clampImagePosition`、`resizeKeepingAspect`、`MIN_OVERLAY_SIZE = 0.1`、`DEFAULT_IMAGE_POSITION`、`alignDefaultBoxToImage`（D6 首帧对齐）等纯几何，已具单测（`__tests__/imageOverlayGeometry.test.ts`）。

> 结论：缩放的**数学与手柄渲染都在**，缺的是「选中后手柄能稳定停留」这一交互前提。

### 2.2 选区驱动链路

- `VideoPlayerPanel.tsx:137`：`const [selectedImageOverlay, setSelectedImageOverlay] = useState<string | null>(null)`。
- `VideoPlayerPanel.tsx:243-246`：`handleImageOverlaySelect(itemId)` → `setSelectedImageOverlay(itemId)`。
- `VideoPlayerPanel.tsx:484-496`（组合模式）与 `:533-545`（占位模式）：渲染 `<ImageOverlay ... isSelected={selectedImageOverlay === overlay.id} onSelect={() => handleImageOverlaySelect(overlay.id)} />`。
- `ImageOverlay.tsx:104`：`handleMouseDown` 内 `onSelect?.()` 触发选中。
- `ImageOverlay.tsx:243`：`isSelected` 为真时根 div 加 `ring-2 ring-blue-500`，并渲染手柄与边框（`:264-274`）。

### 2.3 根因（确证）

**R-A（P0，主因）——点击图片后选区被 click 事件即时清除。**

- 外层容器的取消选择处理器：组合模式 `VideoPlayerPanel.tsx:464` `onClick={() => setSelectedImageOverlay(null)}`；占位模式 `:503` 同理。
- `<ImageOverlay>` 根 div（`ImageOverlay.tsx:241-252`）只挂了 `onMouseDown={handleMouseDown}`，**没有 `onClick`**；`handleMouseDown` 里的 `e.preventDefault()` + `e.stopPropagation()` 只作用于 **mousedown**，对 mouseup 之后浏览器单独派发的 **click** 无效。
- React 合成 `click` 事件在 mouseup 后从命中元素（叠加层根 div / 其子节点）向上冒泡；路径上无任何 `stopPropagation`，最终命中外层 `onClick` → `setSelectedImageOverlay(null)`。
- 叠加层根 div `zIndex: 10`（`ImageOverlay.tsx:249`）高于 `PreviewCanvas` 容器 `zIndex: 2`（`VideoPlayerPanel.tsx:477`），故叠加层确实先收到事件——但 click 仍会冒泡到二者**共同父节点**（外层 wrapper）。

完整时序：
1. mousedown 命中图片 → `onSelect()` 置 `selectedImageOverlay = id` → 重渲染：`isSelected=true`，右下角手柄出现。
2. mouseup → 全局 `handleMouseUp`（`ImageOverlay.tsx:158-165`）复位 `isDragging/isResizing`。
3. **click 冒泡到外层 `onClick` → `setSelectedImageOverlay(null)` → `isSelected=false` → 手柄消失。**

净效果：手柄只在「按住鼠标」的瞬间存在，松手即灭。用户无法完成「先点选 → 松手 → 再抓手柄」的常规缩放交互，于是「点了图片但不支持缩放」。

**R-B（P2，次因/体验）——即便选区可保持，缩放也难发现、难抓取。** 现状仅右下角一个 12×12px 蓝点、无其它角、无外扩命中区，普通用户难以察觉「这里可以缩放」，更难精确点中。要让「手动缩放」真正可用，应提供多角手柄 + 更大命中区 + 光标提示。

### 2.4 回写链路（本轮不改）

`onPositionChange` → `VideoPlayerPanel.handleImagePositionChange`（`:237-240`）→ `onImagePositionChange` → `VideoEditingInterface.handleImagePositionChange` → 更新 `currentTimelineState` + `timelineComposition.handleTimelineStateChange`。第 1 轮验证可用，本轮沿用。

---

## 3. 目标与非目标（Goals / Non-Goals）

**Goals**
1. **点击预览中的图片后选区稳定**：缩放手柄/选中边框常驻显示、可抓取，直到用户点击空白处或选中其它图片才取消（修复 R-A）。
2. **保留「点击空白处取消选择」**：点击画布空白区/占位区仍能取消当前选区（不被本次修复破坏）。
3. **手动缩放可用且符合直觉**：提供四角缩放手柄 + 更大命中区 + 光标反馈；缩放沿用第 1 轮**等比**语义（保持图片原始宽高比、不失真）、最小尺寸下限、越界钳制（修复 R-B）。
4. **不回归第 1 轮成果**：默认居中 80%、两路 `object-contain`、D6 首帧对齐、拖拽移动、`clampImagePosition` 单一基准等行为保持不变。

**Non-Goals**
- 不改 `ImagePosition` 数据结构、不改回写链路、不改后端/ffmpeg 导出几何。
- 不新增旋转、裁剪、翻转、滤镜等图片变换。
- 不引入第三方拖拽/缩放库（沿用现有手写实现）。
- 不实现触摸/手势缩放（桌面端鼠标为主；`onPointerDown` 化列为后续项）。
- 不改 video/audio/subtitle 轨道既有行为。
- 不引入「自由拉伸（破坏宽高比）」为默认；等比缩放是默认且唯一交互（可选的「按住某修饰键自由拉伸」列为后续项，不在本轮）。

---

## 4. 技术设计（Technical Design）

### 4.1 关键决策（Decisions）

- **D1′（P0，必做）把「取消选择」从 `onClick` 改为 `onMouseDown`——单一稳健机制（v2 据评审 C1/C2 收敛）。** 将外层两处取消选择处理器（组合模式 `VideoPlayerPanel.tsx:464`、占位模式 `:503`）由 `onClick={() => setSelectedImageOverlay(null)}` 改为 `onMouseDown={() => setSelectedImageOverlay(null)}`。理由与语义：
  - **根因复盘**：v1 原拟用「叠加层根 div 加 `onClick stopPropagation`」拦截尾随 click。但缩放/拖拽手势的 `mouseup` 常落在 box **之外**，浏览器在 mousedown-target 与 mouseup-target 的**共同祖先（= 外层 wrapper）** 上派发 `click` → 绕过根 div 的 `onClick` → 仍命中 wrapper 取消选择。故「只做 D1（onClick 拦截）」无法覆盖最自然的放大手势（评审 C1=P0）。
  - **为何 `onMouseDown` 一招制胜**：现有 `handleMouseDown`（`ImageOverlay.tsx:98-121`）与各手柄 `handleResizeMouseDown` 都已在 **mousedown** 上 `e.stopPropagation()`。把取消选择改到 mousedown 后——
    - 点击/按下图片本体 → 根 div `handleMouseDown` `stopPropagation` → wrapper 的 `onMouseDown` 取消**不触发** → `onSelect()` 选中、手柄常驻。✓
    - 按下任一缩放手柄 → `handleResizeMouseDown(handle)` `stopPropagation` → wrapper 取消不触发 → 进入缩放。✓
    - 缩放/拖拽结束（`mouseup` 落在何处、是否派发尾随 click 都不再重要）→ wrapper 已**没有 onClick**，尾随 click 无处可去 → **选区在所有时序稳定**。✓（彻底消除 C1 的整类问题，无需 `justInteractedRef` 之类状态守卫。）
    - 按下画布空白/视频区（叠加层 box 之外）→ mousedown 命中 `PreviewCanvas`/占位 div → 冒泡至 wrapper `onMouseDown` → `setSelectedImageOverlay(null)` 取消选中。✓（「按空白取消」语义保留，只是触发时机由 click 提前到 mousedown——与编辑器惯例一致，体验不退化。）
    - 选中图片 A 后按下图片 B → B 的 `handleMouseDown` `stopPropagation` 阻断 wrapper 取消、`onSelect(B)` → 单选状态自然由 A 切 B。✓
  - **defense-in-depth（保留，非主依赖）**：仍在 `<ImageOverlay>` 根 div 加一行 `onClick={(e) => e.stopPropagation()}`。它在新机制下并非必需（wrapper 已无 onClick），但成本仅一行、无副作用，可防御「将来有人又在 wrapper 或其它祖先上挂 onClick」的回归。
  - **不动** `handleMouseDown` 的既有逻辑（`preventDefault`/`stopPropagation`/`onSelect`/起拖）。

- **D2（P1，推荐）四角缩放手柄 + 更大命中区 + 光标反馈。** 把 `ImageOverlay.tsx:264-269` 的「单一右下角手柄」升级为四角（`tl/tr/bl/br`）手柄：
  - 视觉：可见方块（`w-3 h-3` 蓝色，复用现有样式），手柄外包一层透明 padding 命中区（实际可点 ≈ 18–20px），降低抓取难度；**定位统一用角居中形式**（v2 据评审 C4 统一）：`top-0 left-0 -translate-x-1/2 -translate-y-1/2`（tl）、`top-0 right-0 translate-x-1/2 -translate-y-1/2`（tr）、`bottom-0 left-0 -translate-x-1/2 translate-y-1/2`（bl）、`bottom-0 right-0 translate-x-1/2 translate-y-1/2`（br），使手柄**中心**精确对齐 box 四角。注意图片贴帧边时上排手柄略微外溢，须确保不遮挡比例控制行（组合 wrapper 无 `overflow-hidden`，偏移仅 ~10px，视觉可接受）。
  - 光标：`tl`/`br` 用 `cursor-nwse-resize`，`tr`/`bl` 用 `cursor-nesw-resize`。
  - 每个手柄 `onMouseDown={handleResizeMouseDown('tl'|'tr'|'bl'|'br')}`（柯里化，写入 `resizeHandleRef.current`），处理器内**保留 `e.preventDefault()` 与 `e.stopPropagation()`**（v2 据评审 C6；`preventDefault` 抑制缩放时文本选中/图片原生拖拽残影，`stopPropagation` 避免触发根 div 拖拽）。
  - 拖某角时**固定其对角**、等比缩放（见 §4.3 几何）。
  - 仅 `isSelected` 时渲染（与现状一致）。

- **D2b（P1，必做）活动角用 `useRef` 承载，非 `useState`（v2 据评审 C3）。** 新增 `const resizeHandleRef = useRef<HandleId | null>(null)`。`handleResizeMouseDown(handle)` 写入 `resizeHandleRef.current = handle` 并置 `isResizing(true)`；`handleMouseUp` 复位 `resizeHandleRef.current = null`；`handleResizeMouseMove` 从 `resizeHandleRef.current` 读当前角。**必须用 ref 而非 state**：全局 `mousemove` 监听在 effect（`ImageOverlay.tsx:217-235`）中按回调标识订阅，若用 state 存放活动角则每次 setState 改变 `handleResizeMouseMove` 标识 → effect 重订阅 → 手势中途可能丢事件/读到陈旧角。ref 不进依赖数组，回调标识稳定，手势连续。

- **D3（已并入 D1′，删除独立守卫）。** v1 的「`justInteractedRef` 可选兜底」在 v2 中**不再需要**——`onMouseDown` 取消选择从源头消灭了尾随 click 清选问题，无须任何一次性状态守卫。保留此条仅为说明评审决议：**不引入** `justInteractedRef`，降低状态与心智成本。

- **D4（沿用，不改）等比缩放与钳制。** 缩放仍调用 `resizeKeepingAspect(rawWidth, rawHeight, maxW, maxH, imageAspect, frameAR)`（`imageOverlayGeometry.ts`）求 `{width,height}`，`imageAspect = naturalWidth/naturalHeight`（`onLoad` 写入 state，未就绪退化为自由改框），`frameAR = containerWidth/containerHeight`，最小边长 `MIN_OVERLAY_SIZE`。求得 `{width,height}` 后按「固定对角」反推 `{x,y}`，再 `clampImagePosition` 钳制。**唯一基准仍是 `safePosition`**（`ImageOverlay.tsx:46`，第 1 轮 D3），不读原始 `position`。

- **D5（沿用，不改）选中边框与拖拽移动。** `ring-2 ring-blue-500`、内嵌边框（`:272-274`）、`handleMouseDown`/`handleMouseMove`（拖拽移动）保持不变；移动仍基于 `safePosition` + clamp。

### 4.2 操作时序（Sequence）

**点击选中并缩放（修复后，v2 机制）**
1. 用户在预览中按下图片 → `handleMouseDown`：`stopPropagation`（mousedown，阻断 wrapper 的 `onMouseDown` 取消）+ `onSelect()` 置选中 → `isSelected=true`、四角手柄常驻。
2. mouseup → `handleMouseUp` 复位 `isDragging`/`isResizing`、`resizeHandleRef.current=null`。
3. 尾随 click（若有）→ wrapper **已无 onClick**，且根 div 仍有 defense-in-depth 的 `onClick stopPropagation` → **选区稳定，不被清空**。
4. 用户抓住任一角手柄按下拖动 → `handleResizeMouseDown(handle)`：`preventDefault`+`stopPropagation`、写 `resizeHandleRef.current=handle`、置 `isResizing` → 全局 `mousemove` → `handleResizeMouseMove`：算出**归一化鼠标坐标** `mx,my` → `resizeFromHandle(resizeHandleRef.current, safePosition, mx, my, imageAspect, frameAR)` → 内部等比求 `{width,height}` + 固定对角反推 `{x,y}` + `clampImagePosition` → `onPositionChange` 回写 → 重渲染。
5. 松手 → `handleMouseUp` 复位 `isResizing`、清 `resizeHandleRef`；**即便 mouseup 落在 box 外、尾随 click 命中 wrapper，wrapper 无 onClick → 选区不丢**（这正是 v2 相对 v1 的关键修复）。

**按下空白处取消（行为保持，触发时机由 click 提前到 mousedown）**
- 用户按下画布空白/占位区（叠加层 box 之外）→ 命中 `PreviewCanvas`/占位 div → mousedown 冒泡至 wrapper `onMouseDown` → `setSelectedImageOverlay(null)` → 取消选中、手柄消失。

### 4.3 多角等比缩放几何（归一化 [0,1] 空间，相对 previewFrameBox）

记 `base = safePosition = {x, y, width, height}`，右边 `R = x+width`，下边 `B = y+height`；鼠标归一化坐标 `mx, my`。各角**固定对角**，被拖角追随鼠标：

| 手柄 | 固定锚点 | rawWidth | rawHeight | maxWidth | maxHeight | 反推 x | 反推 y |
|------|---------|----------|-----------|----------|-----------|--------|--------|
| `br` | TL `(x,y)`     | `mx - x` | `my - y` | `1 - x` | `1 - y` | `x`（不变） | `y`（不变） |
| `bl` | TR `(R,y)`     | `R - mx` | `my - y` | `R`     | `1 - y` | `R - newW` | `y`（不变） |
| `tr` | BL `(x,B)`     | `mx - x` | `B - my` | `1 - x` | `B`     | `x`（不变） | `B - newH` |
| `tl` | BR `(R,B)`     | `R - mx` | `B - my` | `R`     | `B`     | `R - newW` | `B - newH` |

求解：`{newW, newH} = resizeKeepingAspect(rawWidth, rawHeight, maxWidth, maxHeight, imageAspect, frameAR)`；再按上表反推 `{x,y}`；最后 `clampImagePosition({...base, x, y, width:newW, height:newH})`。

由于 `bl/tl` 的 `maxWidth = R ⇒ newW ≤ R ⇒ x = R - newW ≥ 0`，`tr/tl` 的 `maxHeight = B ⇒ y = B - newH ≥ 0`，反推坐标天然非负；`clampImagePosition` 仅作安全网。`br` 退化为第 1 轮现状（固定左上、向右下生长），行为完全兼容。

**纯函数化（遵循第 1 轮 §10 的 jsx:preserve 测试限制）**：把上表逻辑抽成 `imageOverlayGeometry.ts` 的纯函数 `resizeFromHandle(...)`，内部复用 `resizeKeepingAspect`，单测落在 `imageOverlayGeometry.test.ts`。`ImageOverlay.tsx` 的 `handleResizeMouseMove` 只负责「算出归一化鼠标坐标 `mx,my`（`(e.clientX - containerRect.left)/containerWidth` 等）+ 调用 `resizeFromHandle` + 回写」（C7：组件不再自算 rawWidth/rawHeight，统一交由纯函数按上表反推）。

**复杂度收敛（v2 据评审 C5）**：`resizeFromHandle` 不要写成四分支朴素 `switch`（易超 CLAUDE.md 的「方法 ≤50 行、圈复杂度 ≤10」阈值）。建议把上表「每个角固定哪两条边、被拖轴方向」编码为查找表——例如对每个 `HandleId` 标注 `{ fixLeft, fixTop }`（是否固定左/上边）——再统一计算 `rawWidth/rawHeight/maxWidth/maxHeight` 与反推 `{x,y}`，使函数体保持短小、低圈复杂度、四角共用一条代码路径。

---

## 5. 文件 / 模块变更计划（File / Module Change Plan）

| 文件 | 变更意图（一句话） |
|------|------------------|
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | **(D1′，v2 新增)** 把两处取消选择由 `onClick` 改为 `onMouseDown`：第 `464` 行（组合模式 wrapper）与第 `503` 行（占位模式 wrapper），即 `onClick={() => setSelectedImageOverlay(null)}` → `onMouseDown={() => setSelectedImageOverlay(null)}`。**净行数不变**（两处就地改属性名），文件现 710 行，远低于 800 行上限，`VideoPlayerPanel.solePath.test.tsx` 的「≤800 行」「无 `<video>`」断言不受影响。 |
| `src/components/video/components/VideoPlayerPanel/ImageOverlay.tsx` | **(D1′ defense)** 根 div 新增 `onClick={(e) => e.stopPropagation()}`（廉价兜底，非主依赖）；**(D2)** 把单一右下角手柄改为四角手柄（角居中定位 + ~18–20px 命中区 + `nwse/nesw` 光标），`handleResizeMouseDown` 改为**按角柯里化**、写 `resizeHandleRef.current=handle`、保留 `preventDefault`+`stopPropagation`；**(D2b)** 新增 `resizeHandleRef = useRef<HandleId\|null>(null)`，`handleMouseUp` 复位为 `null`；`handleResizeMouseMove` 改为读 `resizeHandleRef.current` + 算归一化鼠标坐标 + 调 `resizeFromHandle`；**(D4/D5)** 等比缩放、`safePosition` 单一基准、拖拽移动、选中边框均沿用不改。 |
| `src/components/video/components/VideoPlayerPanel/imageOverlayGeometry.ts` | 新增纯函数 `resizeFromHandle(handle, base, mouseXNorm, mouseYNorm, imageAspect, frameAR): ImagePosition`，内部按 §4.3 查找表反推 raw/锚点、复用 `resizeKeepingAspect` 求 `{width,height}`、按固定对角反推 `{x,y}`、`clampImagePosition` 钳制；新增 `HandleId` 类型、`RESIZE_HANDLES` 常量（四角元数据：id、定位 class、光标 class）与每角「固定边」标志，保持函数短小（C5）。 |
| `src/components/video/components/VideoPlayerPanel/__tests__/imageOverlayGeometry.test.ts` | 新增 `resizeFromHandle` 用例：四角各自「固定对角、等比、≥最小尺寸、不溢出、坐标非负」；`imageAspect=null` 退化路径；`br` 与第 1 轮 `resizeKeepingAspect`+固定左上行为一致的回归断言。 |
| `src/components/video/components/VideoPlayerPanel/__tests__/VideoPlayerPanel.solePath.test.tsx`（或新增 `ImageOverlay.interaction.test.tsx`） | **源码级正则断言**（项目 vitest `jsx:"preserve"` 无法 mount 组件，沿用 `exportButton.test.tsx` 范式）：**(D1′)** `VideoPlayerPanel.tsx` 取消选择用 `onMouseDown={() => setSelectedImageOverlay(null)}`（且**不再**以 `onClick` 触发该清空）；`ImageOverlay.tsx` 根 div 含 `onClick={(e) => e.stopPropagation()}`；**(D2)** 渲染四角手柄（含 `nwse-resize` 与 `nesw-resize` 两类光标、四个手柄）、`handleResizeMouseDown` 接受 handle 参数。 |

> **不再「不改 `VideoPlayerPanel.tsx`」**（v2 修正 v1）：D1′ 必须就地把该文件的两处取消选择从 `onClick` 改为 `onMouseDown`，这是消除 C1（手势尾随 click 清选）的唯一稳健落点；改动为属性名替换、净行数不变、不触及 S4 既有断言。`imageOverlays.ts`、`ImageOverlayLayer.ts`、`CanvasCompositor.ts`、`ItemPlacementService.ts`、`useVideoExport.ts`、`@/types` 仍**不涉及**（数据模型与渲染管线不变）。

---

## 6. 接口设计（Interface Design）

无 REST / WebSocket / CLI 变更。仅前端内部新增/调整纯函数与组件内事件签名（向后兼容）：

```ts
// imageOverlayGeometry.ts —— 新增
export type HandleId = 'tl' | 'tr' | 'bl' | 'br';

export interface ResizeHandleMeta {
  id: HandleId;
  /** Tailwind 定位类，使手柄中心对齐 box 对应角。 */
  positionClass: string;     // e.g. 'top-0 left-0 -translate-x-1/2 -translate-y-1/2'
  /** 光标类。 */
  cursorClass: string;       // 'cursor-nwse-resize' | 'cursor-nesw-resize'
}
export const RESIZE_HANDLES: readonly ResizeHandleMeta[];

/**
 * 多角等比缩放求解：按 handle 固定对角，鼠标驱动被拖角，保持「显示框像素比例 ==
 * 图片自然比例」（imageAspect 为 null 时退化为自由改框），并钳制到合法区间。
 * 返回完整的归一化显示框 {x,y,width,height,zIndex?}。
 */
export function resizeFromHandle(
  handle: HandleId,
  base: ImagePosition,           // = safePosition（已 clamp）
  mouseXNorm: number,            // 鼠标归一化 x ∈ 任意（内部钳制）
  mouseYNorm: number,            // 鼠标归一化 y
  imageAspect: number | null,    // naturalW/naturalH，未就绪传 null
  frameAR: number,               // containerWidth/containerHeight
): ImagePosition;
```

```ts
// ImageOverlay.tsx —— 事件签名调整（组件内部，不对外暴露 props 变更）
// 旧：handleResizeMouseDown(e: React.MouseEvent)
// 新：handleResizeMouseDown(handle: HandleId) => (e: React.MouseEvent) => void
//     （柯里化：先 e.preventDefault() + e.stopPropagation()，再写
//      resizeHandleRef.current = handle，再置 isResizing(true)。
//      preventDefault 不可省——抑制缩放拖动时的文本选中/图片原生拖拽残影。）
```

`ImageOverlayProps`（`imageUrl/position/containerWidth/containerHeight/onPositionChange/isSelected/onSelect/imageId`）、`onPositionChange(position)`、`onImagePositionChange(itemId, position)`、`ImagePosition` 结构**全部保持不变**（向后兼容，第 1 轮调用方零改动）。

---

## 7. 数据模型（Data Model）

`ImagePosition`（`src/types/index.ts`，结构不变）：

```ts
interface ImagePosition {
  x: number;       // [0,1] 相对 previewFrameBox 左边距
  y: number;       // [0,1] 相对 previewFrameBox 上边距
  width: number;   // (0,1] 占 previewFrameBox 宽度比
  height: number;  // (0,1] 占 previewFrameBox 高度比
  zIndex?: number; // 多图叠放顺序
}
```

- 默认值仍为第 1 轮的居中 80% `{0.1,0.1,0.8,0.8,zIndex:10}`（`DEFAULT_IMAGE_POSITION`），本轮**不改默认**。
- 缩放/拖拽产出的新 `{x,y,width,height}` 仍写回同一字段，经既有回写链落库。
- **无持久化结构变更、无 DB 改动、无迁移**。历史工程打开后由 `clampImagePosition`（第 1 轮 D3）保证安全显示，本轮新增的缩放交互对历史项同样可用（基于 `safePosition`）。

---

## 8. 测试与验收标准（Testing & Acceptance）

**单元测试（`imageOverlayGeometry.test.ts`，纯几何，可在本项目 vitest 直接跑）**
1. `resizeFromHandle('br', ...)`：固定左上、向右下等比放大/缩小；与第 1 轮 `resizeKeepingAspect` + 固定 x/y 的行为一致（回归）。
2. `resizeFromHandle('tl'|'tr'|'bl', ...)`：固定对角（对应边坐标不变），等比，`x,y ≥ 0`，`x+width ≤ 1`、`y+height ≤ 1`，不溢出。
3. `imageAspect = null`（自然尺寸未就绪）：退化为自由改框，仍 ≥ `MIN_OVERLAY_SIZE`、不溢出。
4. 鼠标拖到极小/极大/越界：宽高被 `MIN_OVERLAY_SIZE` 与可用空间钳制，比例不被破坏。

**源码级断言（`@vitest-environment node` + 读源码正则，沿用 `exportButton.test.tsx` 范式）**
5. **(D1′ 主修复)** `VideoPlayerPanel.tsx` 取消选择经 `onMouseDown={() => setSelectedImageOverlay(null)}`，且**不再**存在以 `onClick` 触发 `setSelectedImageOverlay(null)` 的写法（正则反向断言）。
6. `ImageOverlay.tsx` 根 div 含 defense-in-depth 的 `onClick={(e) => e.stopPropagation()}`（D1′ 兜底）。
7. `ImageOverlay.tsx` 渲染四角手柄：出现 `nwse-resize` 与 `nesw-resize` 两类光标类、四个手柄、`handleResizeMouseDown` 接受 handle 参数（D2）。

**集成 / 手动验收（桌面端走查为强制门槛，见 CLAUDE.md）**
8. 上传一张图片 → 拖入图片轨道 → 在预览中**单击图片** → 选中边框与**四角手柄常驻显示**（不再一闪即灭）。
8a. **(C1 回归门槛，必测)** 抓任一角手柄**向外放大、在叠加层 box 之外松开鼠标** → 缩放生效且**松手后选区仍在、四角手柄仍显示**（验证尾随 click 不再清空选区——这是 v1→v2 的关键修复点）。
9. 抓任一角手柄拖动 → 图片**等比**放大/缩小、保持原始宽高比、不失真、有最小尺寸下限、不溢出预览面板；松手后保持缩放结果。
10. 抓不同角缩放 → 对角保持固定（如抓右下角时左上角不动；抓左上角时右下角不动）。
11. 选中图片后**按下预览空白处** → 取消选中、手柄消失（「按空白取消」行为未被破坏）。
12. 选中图片 A 后**按下图片 B** → 选区从 A 切到 B，B 显示手柄。
13. 拖拽移动图片（非手柄区按下拖动）仍正常、即便在 box 外松开选区也不丢、不溢出（D5 未回归 + C1 修复覆盖拖拽路径）。
14. 打开含旧 `imagePosition`（含异常 `width>1`）的工程 → 可正常选中、缩放、拖拽，不产出负坐标、不溢出（第 1 轮 `safePosition` 未回归）。
15. `npm run type-check`、`npm run lint` 通过；**前端 vitest 套件全绿**（新增 `resizeFromHandle` 与源码断言用例，且不破坏既有 `imageOverlayGeometry`/`imageOverlays`/`ImageOverlayLayer`/`VideoPlayerPanel.solePath` 等断言）。

**Definition of Done**：8–15 全部满足；D1′ 使点击/拖拽/缩放三种时序选区均稳定、缩放手柄可抓取（含 #8a「box 外松手不丢选区」）；D2 四角缩放有单测 + 源码断言覆盖；第 1 轮成果与 S4 既有断言无回归；无 TS 编译错误、无 ESLint error。

---

## 9. 风险与缓解（Risks & Mitigations）

| 风险 | 影响 | 缓解 |
|------|------|------|
| **R-A1（v2 已化解）尾随 click 清选**：v1 的「仅 D1 onClick 拦截」无法覆盖 mouseup 落在 box 外的手势 | 缩放/拖拽后选区被清、手柄消失 | **D1′ 改 wrapper 为 `onMouseDown` 取消选择**——尾随 click 已无 onClick 可命中，整类问题从源头消除（不再依赖 `justInteractedRef`）。验收 #8a 专测「box 外松手不丢选区」。 |
| **R-A2 D1′ 误伤「按空白取消」/选中**：若漏改某一处 wrapper（仅改了 464 未改 503，或反之），或 `handleMouseDown`/`handleResizeMouseDown` 的 mousedown `stopPropagation` 被误删 | 占位/组合模式之一不能取消，或按图片即被取消 | **两处 wrapper（`:464`/`:503`）都要改**；**严禁删** `handleMouseDown`/`handleResizeMouseDown` 的 `stopPropagation`。验收 #11/#12 核验「按空白取消」「A→B 切换」在两种模式均正常。 |
| **R-C 等比缩放需 naturalW/H**：图片未加载完时比例未知 | 加载前缩放比例不准 | 沿用第 1 轮：`onLoad` 写入 `naturalSize`；未就绪 `imageAspect=null` 退化为自由改框 + 画布 contain（不失真，仅可能短暂留白），就绪后恢复等比。 |
| **R-D 多角手柄命中区与拖拽区重叠**：手柄外扩命中区过大可能盖住可拖拽的图片本体、误触缩放 | 难以发起「移动」拖拽 | 命中区控制在 ~18–20px、仅贴四角；手柄 `mousedown` `stopPropagation` 与根 div 拖拽互斥；中间大片区域仍触发移动。验收 #13 核验移动未回归。 |
| **R-G（评审 C8）极小图手柄拥挤**：图片缩到 `MIN_OVERLAY_SIZE`（10%）时四个 ~18–20px 命中区可铺满整图，挤掉中央移动区 | 小图难以发起「移动」 | 命中区不超 ~18–20px 且严格贴角；必要时低于某像素阈值仅渲染对角两手柄、保中央移动区。属体验兜底，不阻断本轮。 |
| **R-H（v2 新增）改动了 `VideoPlayerPanel.tsx`**：D1′ 触碰该文件，须确认未破坏 S4 既有断言 | 误触 `solePath` 测试 | 改动仅属性名替换、净行数 0；交付前跑 `VideoPlayerPanel.solePath.test.tsx`，确认「≤800 行」「无 `<video>`」「compositor 唯一路径」全绿。 |
| **R-E 桌面端打包陈旧**：用户实测可能是旧 standalone 包（见记忆库多条） | 修了代码但桌面端仍现旧象 | 交付说明要求**重新打包桌面端**并按 §8 走查门槛验证。 |
| **R-F 触摸/笔输入不支持**：现为 `onMouseDown`，触屏不触发 | 触屏端无法缩放 | 桌面鼠标为主，列为后续项（`onPointerDown` 化），不在本轮范围（非目标）。 |

---

## 10. 实施过程发现的方案缺陷（Subtask #2 回填占位）

> 本节预留给代码开发节点（Subtask #2）。如实现中发现根因定位偏差、纯函数落点冲突、或 vitest 限制等问题，请在此回填「现象 / 处置 / 影响」，必要时回流评审（Subtask #1）。**当前方案已由 Subtask #1 评审定稿为 v2**（评审记录见文首 §评审记录、结论见 §11）。

### 实施回填（Subtask #2，2026-06-21）

方案按 §5 文件变更计划逐项落地，未对设计架构做任何偏离。仅一处**测试落点澄清**（非功能缺陷）：

- **现象**：§8 #7 措辞为「`ImageOverlay.tsx` 出现 `nwse-resize` 与 `nesw-resize` 两类光标类」，但 §5/§6 的架构把光标类编码在 `imageOverlayGeometry.ts` 的 `RESIZE_HANDLES.cursorClass` 中，`ImageOverlay.tsx` 仅 `RESIZE_HANDLES.map(...)` 渲染、不再字面出现这两个光标字符串。两处口径轻微不一致。
- **处置**：忠于 §5/§6 架构。光标类的「四角 + 两类对角线光标」断言改为 **直接 import `RESIZE_HANDLES`** 在 `imageOverlayGeometry.test.ts` 做真值断言（比源码正则更强）；`ImageOverlay.tsx` 侧（新增 `__tests__/ImageOverlay.interaction.test.tsx`，§5 已允许「或新增」）断言其 `RESIZE_HANDLES.map`、`handle.positionClass`/`handle.cursorClass` 渲染与柯里化 `handleResizeMouseDown(handle.id)`。§8 #7 的验收意图（四角手柄、两类光标、按角柯里化）完整覆盖。
- **影响**：无功能影响；ImageOverlay 不再用 `resizeKeepingAspect`（已并入 `resizeFromHandle` 内部），故从其 import 移除。全部 84 项 vitest 通过、`npm run type-check` 通过、`next lint` 仅余第 1 轮即存在的 `<img>` 非阻断 warning。

---

## 11. 评审结论（Review Verdict — Subtask #1）

**判定：有条件通过（Approved with Conditions）。**

方案根因定位准确（所有 file:line 引用经源码逐行复核属实）、范围适度、与第 1 轮成果及 S4 既有约定无冲突，是一份高质量设计。评审发现的唯一实质缺陷是 v1 把「手势尾随 click 清选」当作可选兜底（C1=P0）——若按 v1「仅做 D1（onClick 拦截）」落地，最自然的向外放大手势在松手后即丢选区，等于交付一个仍不可用的缩放功能。v2 已就地把取消选择改为 wrapper 的 `onMouseDown` 单一稳健机制，从源头消除该类问题，并修复 C2（机制收敛、删除摇摆表述）、C3（活动角必须用 `useRef`），澄清 C4（手柄定位统一角居中）、C6（保留 `preventDefault`）、C7（组件只算归一化鼠标坐标），记录 C5（`resizeFromHandle` 数据表化以守复杂度阈值）、C8（极小图手柄拥挤兜底）、C9（交互行为受 jsx:preserve 限制、以手动走查 #8/#8a/#11/#12 为强制门槛）。**无遗留 P0/P1。**

**放行条件（Subtask #2 开发与 Subtask #3 Review 须逐条满足）：**
1. **C1/D1′（必做）**：`VideoPlayerPanel.tsx` 第 `464`、`503` 两处取消选择**都**由 `onClick` 改为 `onMouseDown={() => setSelectedImageOverlay(null)}`；不得只改其一。
2. **C3/D2b（必做）**：当前被拖的角用 `useRef<HandleId|null>` 承载（非 `useState`），`handleMouseUp` 复位为 `null`；保证全局 `mousemove` 监听不在手势中途重订阅。
3. **C6（必做）**：柯里化后的 `handleResizeMouseDown` 保留 `e.preventDefault()` 与 `e.stopPropagation()` 两者；不得删 `handleMouseDown` 既有的 mousedown `stopPropagation`。
4. **C5（建议）**：`resizeFromHandle` 以「每角固定边」查找表实现，保持 ≤50 行、圈复杂度 ≤10。
5. **测试门槛**：新增 `resizeFromHandle` 几何单测 + 源码正则断言（含 D1′ 的 `onMouseDown` 取消选择、且反向断言不再以 `onClick` 触发清空）；`VideoPlayerPanel.solePath.test.tsx`（≤800 行、无 `<video>`、compositor 唯一路径）与既有 `imageOverlayGeometry`/`imageOverlays`/`ImageOverlayLayer` 套件保持全绿；`npm run type-check`、`npm run lint` 通过。
6. **手动走查门槛（强制）**：§8 的 #8、**#8a（box 外松手不丢选区）**、#11、#12、#13、#14 在**重新打包后的桌面端**逐项通过（见 R-E/R-H）。

满足以上条件即视为达成本轮需求「点击预览图片后可手动缩放」。
