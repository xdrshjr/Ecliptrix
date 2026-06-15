# Bug 分析报告：视频编辑「预览播放」面板里视频只占容器一小部分，没有占满

- **Bug slug**: `preview-video-not-filling-container`
- **分析人**: Subtask #0（问题定位与根因分析，本节点不写修复代码）
- **日期**: 2026-06-15
- **需求原文**: “项目的'视频编辑'功能，对应的'预览播放'这个中间的面板，播放预览的时候，需要对应的播放的视频要占满对应的这个容器，现在播放，只占用了其中一小部分，除非比例不够占满的时候，就以长边占满为准，短边占部分，进行对应比例的预览播放。”
- **结论一句话**: 合成预览的「比例帧」(`aspect-ratio` 容器) 是居中 flex 容器 `.video-preview-container`(`align-items:center`) 的直接子项，但该帧**没有 `flex-grow`、没有 `height:100%`、没有任何撑满机制，只有一条 `min-height:200px` 的下限**。因此它在 16:9 等比例下被钉死在约 **355×200px** 的小盒子里居中显示，无论外层预览区有多大都不会变大——视频（占满这个小帧）于是只占据了整个深色预览区的一小块。**修复方向 = 让这个比例帧按所选比例「contain」式撑满 `.video-preview-container`（长边占满、短边留边），而不是停在 200px 的最小高度。**

---

## 1. 问题描述（Problem description）

在视频编辑器中间的「预览播放」面板：

- 当时间线里已有素材、进入「合成播放」模式开始预览时，**画面只渲染在面板正中一个很小的方框里**，四周是大片空白（`--accent` 底色 / 黑边）。
- 期望：视频应**占满预览容器**；当视频/帧比例与容器比例不一致、无法两个方向都填满时，应**以长边占满为准、短边留边**（即标准的「按比例 contain 撑满」）。

涉及面板：`src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` 中 `playbackMode === 'composition'` 分支渲染的预览区，以及其内部的多轨 Canvas 合成器宿主 `PreviewCanvas`。

---

## 2. 复现步骤（Reproduction steps）

### 2.1 在应用内复现

1. 启动前端：仓库根目录 `npm run dev`（或桌面端 `desktop/scripts/dev.js`），打开视频编辑页面。
2. 向时间线添加至少一个视频素材，使其进入「合成播放」模式（条件：`compositionPlayback.isCompositionMode && videoSequences.length > 0`，见 `VideoPlayerPanel.tsx:169-170`）。
3. **把窗口/布局拉高**，让中间预览区（`.video-preview-container`）的可用高度明显大于 200px（例如最大化窗口）。
4. 点击播放（或仅仅进入合成模式即可观察静帧）。
5. **观察**：视频画面出现在预览区**正中一个约 16:9、高度≈200px 的小框**里，上下/左右有大片空白；把窗口拉得越高，空白越多、视频相对越小。
6. **期望**：视频帧按当前所选比例**撑满预览区**（长边占满、短边按比例留边）。

### 2.2 纯 DOM 最小复现（不依赖后端 / 素材，浏览器直接可见）

把下面这段保存成 `repro.html` 用浏览器打开，即可复现「比例帧被钉在 200px、在大容器里只占一小块」的现象（这正是面板的布局骨架）：

```html
<!doctype html>
<div style="width:900px; height:600px; background:#888;
            display:flex; align-items:center; justify-content:center;">
  <!-- 模拟 .video-preview-container：height:100% + 居中 -->
  <div style="aspect-ratio:16/9; max-height:100%; max-width:100%;
              min-height:200px; background:#000;">
    <!-- 模拟 aspect-video 比例帧；里面是绝对定位的 canvas，不贡献内容尺寸 -->
    <div style="position:absolute; inset:0;"></div>
  </div>
</div>
```

实际渲染：外层 900×600，但黑色比例帧只有约 **355×200**（= `min-height:200px` × `16/9`），居中悬在中间——与用户截图描述的“只占一小部分”一致。把 `min-height` 调大或给比例帧加 `height:100%` 才会变大，可反向印证根因。

---

## 3. 根因分析（Root cause analysis）

### 3.1 渲染链路与各层尺寸来源

合成预览的 DOM 自外向内是四层，尺寸传递如下：

| 层 | 元素 / 选择器 | 尺寸来源 | 证据 |
|---|---|---|---|
| ① 预览区 | `.video-preview-container`（`videoContainerRef`） | `height:100%` + `display:flex; align-items:center; justify-content:center` | `src/styles/video-editing.css:496-506` |
| ② **比例帧** | `aspect-video` / `aspect-[9/16]` … 的 `<div>` | `aspect-ratio` + `min-height:200px` + `max-*:100%`，**无 `flex-grow`、无 `height:100%`** | `VideoPlayerPanel.tsx:427-435` + `src/styles/video-editing.css:521-561` |
| ③ Canvas 宿主 | `PreviewCanvas` 的 wrapper `<div>` | `position:absolute; inset:0; width/height:100%`（撑满②） | `VideoPlayerPanel.tsx:443-449` |
| ④ Canvas / 视频 | `<canvas>` | 背景缓冲 = `wrapper.clientW/H × dpr`，`fitContain` 把视频画满 canvas | `PreviewCanvas.tsx:218-227`、`CanvasCompositor.ts:216-265` |

③④ 都是「100% 撑满②」+「视频按 `fitContain` 画满 canvas」，本身没有问题。**问题出在第②层「比例帧」的实际渲染尺寸**：③④ 再怎么 100%，也只能撑满一个本身就很小的②。

### 3.2 为什么比例帧会塌缩到 200px

比例帧是居中 flex 容器 ① 的直接 flex 子项，关键约束（去重后）：

- `aspect-ratio: 16/9`（`video-editing.css:521-522`）
- `min-height: 200px`（内联，`VideoPlayerPanel.tsx:432`）
- `max-height: 100%; max-width: 100%`（`video-editing.css:523-524` + 内联）
- `flex-shrink: 0`（`video-editing.css:527`），**`flex-grow` 缺省为 0**
- **没有显式 `width`/`height`，没有 `height:100%`**

而父容器 ① 是 `align-items: center`（**不是** `stretch`，`video-editing.css:499`）。于是 flex 在交叉轴（高度）上**不拉伸**该子项，子项高度 = 其「内容高度」并受 min/max 夹取。比例帧内部唯一的可见内容是**绝对定位**的 `PreviewCanvas` wrapper（`position:absolute; inset:0`，`VideoPlayerPanel.tsx:444-445`），绝对定位元素**不贡献父级的内容尺寸**，所以内容高度≈0：

```
height = clamp(内容高度≈0, [min-height 200px, max-height 100%]) = 200px
width  = height × aspect-ratio = 200 × 16/9 ≈ 355px   （再受 max-width:100% 夹取）
```

结果就是一个 **≈355×200 的固定小盒子**，被 `justify-content/align-items:center` 居中悬在 ① 的正中。① 的可用高度越大（窗口越高），这个 200px 的小帧相对越小——**视频只占容器一小部分**，正是用户所述症状。

> 对照证据：另一条分支「占位符」用的是 `.video-placeholder-container { width:100%; height:100% }`（`video-editing.css:1922-1925`）作为外层，且里面有**文本内容**撑高度；而合成播放分支里，比例帧是 ① 的直接子项、内部又全是绝对定位的 canvas，没有任何东西能把它撑高，于是只剩 `min-height:200px` 生效。

### 3.3 与「占满 / 按比例」需求的关系

- **“占满容器”**：当前永远做不到，因为②被钉死在 200px，与 ① 的实际尺寸解耦。
- **“以长边占满为准、短边占部分”**：这正是「把所选比例的帧 contain 进容器」的标准行为——当所选比例 ≠ 容器比例时，帧应在长边方向顶满 ①、短边方向留边。现有 CSS 既不顶满长边、也不随容器变化，所以这条需求同样没满足。
- 补充：第④层合成器 `fitContain` 在 `targetAspectRatio = 所选比例` 时，会把视频**拉伸到所选比例填满 canvas**（`CanvasCompositor.ts:170-182` / `internal/fitContain.ts:54-78`）。这意味着“视频在帧内是否变形/留边”由合成器决定，**与本 bug（帧本身太小）是两件事**；本 bug 的“小”完全由 §3.2 的 CSS 塌缩造成，修好帧尺寸后视频即随帧占满。

### 3.4 证据汇总（代码引用）

- `src/styles/video-editing.css:496-506` — `.video-preview-container { height:100%; display:flex; align-items:center; justify-content:center; }`（居中、不 stretch）。
- `src/styles/video-editing.css:521-561` — 五个比例类 `aspect-ratio + max-*:100% + flex-shrink:0`，**均无 `flex-grow` / `height:100%`**。
- `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:427-435` — 比例帧内联样式仅 `{ maxHeight:'100%', maxWidth:'100%', minHeight:'200px', position:'relative' }`，**无显式宽高**。
- `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:441-450` — `PreviewCanvas` 以 `inset:0 / 100%` 撑满比例帧（说明 canvas 只能跟随②的大小）。
- `src/components/video/components/VideoPlayerPanel/PreviewCanvas.tsx:218-227` — `sync()` 读取 `wrapper.clientWidth/Height`（即②的尺寸）设置 canvas 背景缓冲；②小则 canvas 小。
- `src/components/video/playback/CanvasCompositor.ts:170-182, 248-300` 与 `internal/fitContain.ts:43-79` — 视频是按 canvas 尺寸 `fitContain` 画的，canvas 满则视频满；canvas 的尺寸源头仍是②。

### 3.5 评审补充证据（Reviewer-added evidence）

> 本小节由 Subtask #1（评审节点）补入，逐条复核了 §3 引用并补全两处此前缺失/不准确的证据。**根因结论（比例帧②塌缩到 ~355×200）经逐层复核成立、证据链闭合**；下面两点是对落地与影响面的精化，不推翻根因。

**(a) 整条渲染链确实是②尺寸的下游——连 canvas 背景缓冲分辨率也被②钉死。**
`PreviewCanvas` 的根 `wrapperRef` `<div>` 直接套用传入的 `style`（`position:absolute; inset:0; width/height:100%`，`VideoPlayerPanel.tsx:443-449`），故 wrapper = ②的尺寸（`PreviewCanvas.tsx:263-269`）；`sync()` 用 `wrapper.clientWidth/clientHeight × dpr` 设置 `canvas.width/height`（`PreviewCanvas.tsx:218-227`）。因此②被钉在 200px 不仅令预览**变小**，还令 canvas 背景缓冲只有 ~355×200×dpr，**预览本身也是低清的**。→ 反向加固根因，且说明方案 A 把②撑大后预览分辨率会同步改善。

**(b) `ImageOverlay`（可拖拽句柄）的像素基准是①，不是②——这是一处此前被 §5 误述、且本就存在的潜在错位。**
- `containerDimensions` 来自绑定在①`.video-preview-container` 上的 `videoContainerRef` + ResizeObserver（`VideoPlayerPanel.tsx:138, 241-262, 422-424`），即**①的尺寸**。
- `<ImageOverlay>` 把 `position.{x,y,w,h} × containerWidth/Height`（= ①尺寸）换算成绝对像素 `left/top/width/height`（`ImageOverlay.tsx:36-41, 169-179`），但它是**②的绝对定位子节点**（②带 `position:relative`，`VideoPlayerPanel.tsx:427-435, 453-465`）。
- 而合成器在 canvas 上栅格化的**真实**图片叠加用的是②内的 `fit` 矩形（`CanvasCompositor._drawImageLayer`，`CanvasCompositor.ts:267-300`）。
- 结论：可拖拽**句柄**的坐标系（①）与画面里**真实图片**的坐标系（②）当前就不一致。现状下②≈355×200 ≪ ①，句柄按①尺寸算出的像素会溢出②并被②的 `overflow:hidden` 裁掉 → 句柄本就错位。**方案 A 把②撑大后，二者错位量会改变**，所以「`ImageOverlay` 无需改动、行为一致」不成立；正确做法见 §评审结论：把②的**计算尺寸**（而非①的 `containerDimensions`）喂给 `ImageOverlay`，一并修掉这处潜在错位。

**(c) §3.3 的「视频被拉伸到所选比例」复核为真，且与本 bug 独立。**
`fitContain` 在传入 `targetAspectRatio`（= 所选预览比例）时，用**目标比例**而非源比例算矩形（`fitContain.ts:54, 63-74`）；因 canvas 比例 = ②比例 = 所选比例，`destRatio ≈ targetAspectRatio` → 命中 `else` 分支 → `fit` = 整块 canvas；随后 `ctx.drawImage(source, fit.x, fit.y, fit.width, fit.height)` 把源视频**拉伸**铺满整块 canvas（`CanvasCompositor.ts:181-182, 294-305`）。即：源视频比例 ≠ 所选比例时，画面会被**形变**填满，而非按视频自身比例留边。这是「帧塌缩」之外的**第二处、独立**问题，是否要改取决于产品意图（见 §评审结论的范围界定）。

---

## 4. 影响面（Impact surface）

- **受影响功能**：视频编辑器中间「预览播放」面板的**合成播放（composition）预览**——即时间线有素材后的所有预览/播放/逐帧。
- **受影响比例**：全部 5 种预览比例（16:9 / 9:16 / 4:3 / 1:1 / 21:9）都走同一段塌缩 CSS（`video-editing.css:521-561`），均受影响；容器越大、表现越明显（高分屏 / 大窗口 / 桌面端最大化最严重）。
- **不影响**：导出成片的实际分辨率/构图（导出走后端 ffmpeg 合成，与预览 DOM 尺寸无关）；占位符分支的文案展示尺寸也不同（另有 `.video-placeholder-container`，问题表现较轻）。
- **用户感知**：纯视觉/可用性问题——预览画面过小、难以看清细节与字幕/叠加位置；不造成数据错误或崩溃。

---

## 5. 候选修复（Candidate fixes）

> 目标统一为：让**比例帧②按所选比例 contain 撑满 ①**（长边占满、短边留边），且 5 种比例、各种容器尺寸都正确，不破坏叠加层 `ImageOverlay` 与合成器。
>
> **【评审更正】** 原文此处称「`ImageOverlay` 坐标以②的 `containerDimensions` 归一化」并不准确：`containerDimensions` 实际测量的是**①** `.video-preview-container`（`videoContainerRef` 绑在①、ResizeObserver 观测①，见 `VideoPlayerPanel.tsx:138, 241-262, 422-424`），而 `<ImageOverlay>` 是②的绝对定位子节点、却用①的尺寸换算像素位置。详见新增的 §3.5 与 §评审结论——这会影响方案 A 的落地细节（需把②的计算尺寸喂给 `ImageOverlay`），但不动摇根因结论。

| 方案 | 做法 | 侵入性 | 风险 | 工作量 |
|---|---|---|---|---|
| **A. JS 计算帧像素尺寸（推荐）** | 复用现成的 `containerDimensions`(`videoContainerRef` 的 ResizeObserver，`VideoPlayerPanel.tsx:138-258`)，按 `ratio` 算出 contain 盒子：`cw/ch > ratio ? {h:ch, w:ch*ratio} : {w:cw, h:cw/ratio}`，作为内联 `px` 宽高赋给比例帧②（替代只靠 `min-height` 的写法）。 | 低（只改一个 `<div>` 的 style + 一个 memo） | 低：帧 DOM/层级不变 → 叠加层归一化坐标、Canvas、合成器全部照旧；纯加法逻辑、可单测 | 小 |
| **B. Canvas 满铺、交给合成器 letterbox** | 去掉合成分支的比例帧约束，让 `PreviewCanvas` 直接撑满 ①；由合成器 `fitContain(targetAspectRatio=所选比例)` 在整块 canvas 上画出居中的比例区+黑边。 | 中：要把 `ImageOverlay` 的容器从②改到①并重算归一化坐标映射（合成器内的图片叠加用的是 fit-rect，已 OK，但 React `<ImageOverlay>` DOM 层用的是②的尺寸） | 中：叠加层定位易回归；视频会被拉伸到所选比例（object-fit: fill），是否符合“对应比例”需产品确认 | 中 |
| **C. 纯 CSS 撑满** | 改 ① 不再 `align-items:center`、给比例帧②加 `width:100%/height:100%` 之一并配 `max-*:100%` + `margin:auto` 做 contain。 | 低（仅改 CSS） | 中：纯 CSS 把「任意比例 contain 进任意比例容器」很脆——`max-*` 夹取会破坏 `aspect-ratio` 或溢出，需对 5 种比例 × 宽/高受限两种场景逐一手测，跨浏览器行为差异大 | 小~中 |

---

## 6. 推荐修复（Recommended fix）

**推荐 A：用 JS 按容器尺寸 + 所选比例计算比例帧的像素宽高（contain），赋给②的内联 style。**

理由：

1. **最小侵入、最低回归**：DOM 结构与层级完全不动，`PreviewCanvas`/Canvas/合成器/`ImageOverlay` 全部无需改动；叠加层仍以②的 `containerDimensions` 归一化，行为一致。
2. **直接命中需求**：`cw/ch > ratio ? 按高撑满 : 按宽撑满` 正是“以长边占满为准、短边占部分”的 contain 定义，5 种比例统一正确。
3. **基础设施已就绪**：`containerDimensions` 状态与 `videoContainerRef` 的 `ResizeObserver` 已存在（`VideoPlayerPanel.tsx:138-258`），窗口/布局变化会自动重算，无需新增监听。
4. **确定性、可测**：纯函数 `computeContainBox(cw, ch, ratio)` 可直接单测，规避方案 C「纯 CSS contain」在 `aspect-ratio` + `max-*` 夹取下的跨浏览器脆弱性。

落地要点（供修复节点参考，本节点不写代码）：
- 新增一个纯函数（建议放在 `aspectRatios.ts` 旁）：给定 `containerDimensions` 与 `previewAspectRatio`，返回 `{ width, height }`（px）。注意 `containerDimensions` 为 0 时回退到现有 `min-height:200px` 行为，避免首帧抖动。
- 在 `VideoPlayerPanel.tsx:427-435` 把 `minHeight:'200px'` 之外补上算出的 `width/height`（或在 `cw/ch` 已知时直接以 px 宽高取代 `aspect-ratio` 依赖）。
- 同步处理占位符分支（`VideoPlayerPanel.tsx:480-486`）以保持空/非空态尺寸一致，避免切换跳动。
- 验证：16:9 / 9:16 / 4:3 / 1:1 / 21:9 五种比例下，分别在「宽受限」与「高受限」两种容器形状里确认帧顶满长边、短边留边；并确认 `ImageOverlay` 拖拽定位仍正确。

> 如果产品确认预览应当“按视频自身比例”留边（而不是拉伸到所选导出比例），则在 A 的基础上，另需调整合成器 `fitContain` 的 `targetAspectRatio` 取值（改为不传、用源比例）——但那是与本 bug（帧塌缩）独立的第二处改动，应分开评估，见 §3.3。

---

## 评审结论（Review Verdict）

> 评审人：Subtask #1（资深评审节点）。结论：**根因诊断成立、证据链闭合，采纳方案 A，并附两处必须落地的精化与一条明确的范围边界。** 本节点仅评审，不写修复代码。

### 一、根因证据审计：通过（airtight）

逐条复核了 §3.4 的全部引用，均与现行代码一致，根因推理（比例帧②在居中 flex 容器①里因「`align-items:center` 不拉伸 + 唯一内容是绝对定位 canvas 不贡献内容高度 + 只有 `min-height:200px` 兜底」而塌缩到 ≈355×200）**逻辑闭合、可复现、可反证**：

1. **失败路径上的代码确实被执行**：进入合成预览的条件 `playbackMode === 'composition'`（`VideoPlayerPanel.tsx:169-170, 425`）命中的就是带塌缩 CSS 的②分支；②→③→④ 全部是②的下游（§3.5(a) 又补证了连 canvas 背景缓冲分辨率都被②钉死）。
2. **证据确实解释症状**：`min-height:200px × aspect-ratio` 精确推出 ≈355×200 的小框居中，与「容器越大、画面相对越小」的现象一一对应；§2.2 纯 DOM 复现可独立验证，调大 `min-height` 或加 `height:100%` 即变大，构成反证。
3. **排除了替代解释**：占位符分支用 `.video-placeholder-container{width/height:100%}` 外层 + 文本内容撑高，故表现不同（§3.2 对照）——证明问题特定于「②是①的直接子项且内部全为绝对定位」这一组合，而非通用 CSS 失误。

仅发现 **1 处表述不准确**（非根因错误）：§5 原文称 `ImageOverlay` 以「②的 `containerDimensions`」归一化；实测 `containerDimensions` 测的是**①**（已在 §5 就地更正并在 §3.5(b) 补全证据）。该更正**不影响**根因，但**改变方案 A 的落地细节**。

### 二、候选修复审计

| 方案 | 边界/并发/错误路径覆盖 | 是否最小改动 | 回归风险 | 评审裁定 |
|---|---|---|---|---|
| **A. JS 算 contain 像素尺寸** | 纯函数，覆盖 5 比例 × 宽/高受限两形态；`containerDimensions=0` 首帧需兜底；`min-height:200px` 在「容器高 < 200px」时会反噬（见下） | **是**——DOM/层级/合成器/canvas 全不动，只加一个 memo + 改②的内联 style | **低**，但 `ImageOverlay` 句柄基准需同步（见精化①） | **采纳** |
| B. canvas 满铺 + 合成器 letterbox | 需把 `ImageOverlay` 容器从②改到①并重算归一化；视频被拉伸到所选比例 | 否——牵动叠加层坐标系与合成器假设 | 中——叠加层定位易回归 | 不采纳（非最小） |
| C. 纯 CSS 撑满 | `aspect-ratio` + `max-*` 夹取在 5 比例 × 两形态下跨浏览器脆弱 | 是 | 中——难稳定、需逐一手测 | 不采纳（确定性差） |

**为何 A 是「最小且正好解决」**：用户诉求「占满容器；比例不匹配时以长边占满、短边留边」本质即「把所选比例的帧 contain 进容器」。A 的 `cw/ch > ratio ? {h:ch, w:ch*ratio} : {w:cw, h:cw/ratio}` 就是标准 contain——让②在受限轴顶满①、另一轴留边，5 比例统一正确；且复用既有 `ResizeObserver`→`containerDimensions`，窗口/布局变化自动重算，无新增监听、无新依赖。A 不做任何多余的事（不碰合成器、不碰导出、不碰 DOM 层级）。

### 三、采纳方案 A，但必须带上两处精化（落地约束，交由 Subtask #2 实现）

1. **把②的计算尺寸喂给 `ImageOverlay`，而非①的 `containerDimensions`。**
   原因见 §3.5(b)：句柄当前按①算像素却定位在②内，与 canvas 里真实图片（按②的 `fit` 栅格化）坐标系不一致；②一旦撑大，错位量会变。落地时让 `<ImageOverlay containerWidth/Height>` 接收 §三的 `computeContainBox` 结果（②的像素宽高），使「可拖拽句柄」与「画面真实叠加」对齐，**顺手修掉这处既有潜在错位**。这是采纳 A 的**前置条件**，不是可选项。

2. **`min-height:200px` 不能与计算尺寸并存，只能作为「`containerDimensions=0` 首帧」的回退。**
   一旦容器有效尺寸已知，应以计算出的 `{width,height}`（px）作为②尺寸；若同时保留 `min-height:200px`，当容器可用高度 < 200px（极窄布局/小窗）时 `min-height` 会反超计算高度，重新撑破②并溢出①、再现「不 contain」。正确做法：`containerDimensions` 有效时直接给 `width/height`（此时 `max-*:100%` 因 contain 结果 ≤ 容器恒为 no-op，可保留作保险），`min-height` 仅在尺寸未知时兜底。

   附带项（非阻塞）：占位符分支（`VideoPlayerPanel.tsx:480-486`）建议套用同一尺寸，避免空/非空态切换时的尺寸跳动；`computeContainBox(cw, ch, ratio)` 应作为纯函数（建议置于 `aspectRatios.ts`）并补单测，覆盖 5 比例 × 宽受限/高受限 + 退化输入（0、NaN）。

### 四、范围边界（不要在本 bug 里顺手改）

§3.5(c) 已复核：合成器 `fitContain(targetAspectRatio=所选比例)` 会把源视频**拉伸形变**铺满所选比例的 canvas。这与本 bug（帧塌缩）**相互独立**：本 bug 修好后，画面已能占满容器、长边占满短边留边，满足用户原始诉求。「视频是否应按自身比例留边（不形变）」属于**另一个产品决策**，若需要，再单独调整 `fitContain` 的 `targetAspectRatio`（改为不传），**不应混入本次修复**，以保持改动最小、回归面可控。

### 五、最终推荐（单一方案）

> **采纳方案 A：用 `videoContainerRef` 的 `containerDimensions` + 所选比例，JS 计算比例帧②的 contain 像素宽高并作为内联 `width/height` 赋给②**；同时（前置条件）**把该计算尺寸传给 `ImageOverlay` 的 `containerWidth/Height`**，并**将 `min-height:200px` 降级为仅在 `containerDimensions=0` 时的回退**。
>
> 验收口径：16:9 / 9:16 / 4:3 / 1:1 / 21:9 五种比例，分别在「宽受限」与「高受限」两种容器形状下，②顶满受限轴、另一轴居中留边且随窗口缩放自适应；`ImageOverlay` 拖拽/缩放的句柄与画面叠加图对齐；空时间线占位态不跳动。视频「形变 vs 留边」不在本次范围内（§四）。
