# 图片轨道叠加层：默认居中 80% 适配 + 缩放/拖拽修复

> Feature slug: `image-overlay-fit-and-transform`
> Version: **v2 (评审定稿)**
> Author: Solution Architect (Subtask #0 方案设计)
> Reviewer: Senior Reviewer (Subtask #1 方案评审与修复)
> Date: 2026-06-21
> Status: Reviewed — **有条件通过**（见文末「§11 评审结论」）；P0/P1 已就地修复

---

## 评审记录（Review Notes — Subtask #1）

> 本节由方案评审节点（Subtask #1）写入。评审已对 spec 引用的全部代码位逐一核验（`CanvasCompositor.ts`、`ImageOverlay.tsx`、`imageOverlays.ts`、`ImageOverlayLayer.ts`、`ItemPlacementService.ts`、`useVideoExport.ts`、`internal/assembleLayers.ts`、`internal/fitContain.ts`、`VideoPlayerPanel.tsx`、`useTimelineExport.ts`、`VideoEditingInterface.tsx` 及相关测试）。结论：原稿对现状的事实陈述**基本准确**，根因定位正确；存在 3 个 P1 与 4 个 P2，**P1 已在本文正文就地修复**，severity 与处置如下。

| 编号 | 维度 | 严重度 | 问题 | 处置 |
|------|------|--------|------|------|
| C1 | 完整性 / 一致性 | **P1** | **D2（canvas contain）与 D4（等比缩放）及验收 #5（边框与画面完全重合）三者模型冲突**。`<ImageOverlay>` 的蓝色选中边框/缩放手柄绘制在**外层显示框**（`ImageOverlay.tsx:172-201`，框=默认 0.8×0.8、比例=帧比例），而可见图片是框内 `object-contain` 的**内嵌矩形**；当图片比例 ≠ 帧比例时（默认即如此），边框始终大于可见图片 → 验收 #5 在原稿模型下**不可达**，且 UX 困惑（大边框套小图）。D4「等比缩放」本质属于「图片矩形」语义，与「显示框=帧比例」相矛盾。 | **已修复**：§4.1 新增 **D6 显示框模型 + 首帧对齐**，重写 D2/D4、§4.2 几何说明与 §8 验收 #5。统一为「`imagePosition`=显示框 + 可见图片 `object-contain` 嵌入」，并在 `onLoad` 拿到 `naturalW/H` 后**仅对仍等于新建默认 sentinel 的项**一次性把显示框归一化为「居中 80% 包络内、与图片比例一致的内嵌矩形」，使新建项边框贴合可见图片、等比缩放自洽、并顺带缓解 R1；历史/已调整项不触发（守 R6），由 contain+clamp 兜底安全显示。 |
| C2 | 可行性 / 完整性 | **P1** | **D3 钳制必须同时喂给「渲染」与「拖拽/缩放计算」，而非仅钳制渲染用的 `pixelPosition`**。现状 `handleMouseMove` 用原始 `position.width` 计算 `Math.min(1 - position.width, newX)`（`ImageOverlay.tsx:82-83`）；若读到历史/异常 `width > 1`，则 `1 - width < 0`、钳制区间反转 → 拖拽产出负值/错位。仅在渲染前 clamp 无法消除该路径缺陷。 | **已修复**：D3 明确要求组件入口计算一次 `safePosition = clampImagePosition(position)`，并作为 `pixelPosition`、`handleMouseMove`、`handleResizeMouseMove` 的**唯一基准**。 |
| C3 | 完整性 | **P1** | **现有单测断言旧默认，改默认后必红，且 DoD 未把「单测套件全绿」列为门槛**。`playback/__tests__/ImageOverlayLayer.test.ts:97`（`computeImageBounds(undefined)` 断言旧 `{0.1,0.1,0.3,0.3}`）与 `components/VideoPlayerPanel/__tests__/imageOverlays.test.ts:75`（断言默认 `{...,0.3,0.3,zIndex:10}`）会随 D1 失败；原稿验收 #7 仅列 type-check/lint。 | **已修复**：§5 测试行点名这两处「必改」断言并要求新增 `_containRect` 用例；§8 验收 #7 与 DoD 增列「前端单元测试套件（vitest）全绿」。 |
| C4 | 一致性（事实修正） | P2 | **R2 / §2.3 对 canvas 参考框的描述不准**。`_baseFit`（`CanvasCompositor.ts:252-269`）对首个就绪 video 调 `fitContain` 时**传入 `targetAspectRatio = _viewport.aspectRatio`（项目比例）**，故返回的是**整张项目帧**（canvas 缓冲比例==项目比例时），而非「视频 letterbox 子区」。即 canvas 叠加参考框与句柄基准 `previewFrameBox` **本就同框**，WYSIWYG 比原稿担忧的**更好**；仅当 `viewport.aspectRatio` 未注入时才退化为视频子区。 | **已修正**：§2.3 路径①、D5、风险 R2 的描述均改写为准确表述（现状已注入 aspectRatio，主流程无错位）。 |
| C5 | 右尺寸 | P2 | **D2 要求顺带修改 `_drawOverlays`/`setOverlays` 旧图片分支以「保持一致」，但该分支已是 dead path**。经核实 `drawFrame` 在「单路合成器」重构（local-video-editing-refactor）后**无任何生产调用方**（仅测试引用），生产唯一绘制路径是 `renderFrame → _drawImageLayer`。 | **已修正**：D2 注明该旧分支为 dead path，**不强制修改**、不计入改动量与验收，避免无谓扩面。 |
| C6 | 完整性 | P2 | 缩放最小尺寸需按「受约束更紧的一轴」定义，避免两轴 min（各 0.1）不一致；等比缩放在 `naturalW/H` 未就绪时的退化路径需明确。 | **已补**：写入 D4。 |
| C7 | 一致性（可行性确认） | P2 | 导出链路（`useVideoExport.ts:239`）默认兜底仍为旧 30%，且 ffmpeg overlay 按框拉伸（R1）。 | 维持 §5 同步该兜底为 80%；§9 R1 说明：D6 使新建项「框==图片比例」后导出==contain（不失真），**历史项导出仍可能失真**作为后续项。`useTimelineExport.ts:128` 仅透传、无独立默认，无需改。 |

**默认值/常量站点完整性复核（针对原稿 R4）**：生产代码中「图片叠加默认位置」共 4 处——`ItemPlacementService.ts:217-224`、`ImageOverlayLayer.ts:73-79`、`imageOverlays.ts:19-25`、`useVideoExport.ts:239-245`，与原稿 §5 一致；`useTimelineExport.ts` 与 `VideoEditingInterface.tsx` 仅透传，无独立默认（`VideoCoverModal` 的 `width:0.8` 属封面标题模板，非本特性，不在范围）。**枚举完整，R4 成立。**

---

## 1. Overview（概述）

视频编辑器在「素材管理」中上传图片后，可把图片拖到「图片轨道」（`image-track-*`，本质是 video 轨道上 `originalMaterialType === 'image'` 的 `TimelineItem`）。当前的问题是：图片被添加到「播放组合预览面板」时，其在预览中的默认尺寸/位置不符合用户预期——**当源图片像素较大时，叠加层会直接盖住整个预览画面，把下方的视频完全遮挡**，用户无法看到组合后的画面。期望行为是：**无论源图片本身多大，图片被加入预览面板时都默认居中摆放在预览面板正中央，约占预览画面 80% 的宽高；之后用户可以自由缩放调整大小，并能在预览面板上拖拽移动它的位置。**

本方案修复三件事：(1) **默认位置/尺寸**——把图片叠加层的默认 `imagePosition` 从「左上角 30%」改为「居中 80%」，且该默认值与源图片像素尺寸完全解耦（大图小图一视同仁）；(2) **不失真渲染**——让 canvas 合成器（`CanvasCompositor._drawImageLayer`）与 React 句柄（`<ImageOverlay>`）都以 `object-contain` 语义在边界框内等比绘制图片，保证大图不会被拉伸/溢出，且画布栅格化结果与可拖拽句柄始终所见即所得（WYSIWYG）；(3) **可靠的缩放与拖拽**——保留并加固现有的拖拽/缩放交互，缩放默认锁定图片原始宽高比（等比缩放，符合「缩放」语义而非拉伸），并对越界位置做钳制，确保叠加层永远不会溢出预览面板。

本节点只产出设计文档，不写实现代码。所有改动集中在前端预览/时间轴域层（`src/components/video/**` 与 `src/types/index.ts`），不触碰后端与导出链路（导出一致性作为风险条目单列）。

---

## 2. 现状梳理与根因分析（Background & Root Cause）

### 2.1 数据模型现状

- `ImagePosition`（`src/types/index.ts:641-648`）：归一化 `[0,1]` 坐标 `{ x, y, width, height, zIndex? }`，相对预览画面（fit-rect）的宽高。
- `TimelineItem.imagePosition?`（`src/types/index.ts:700`）：图片项保存其叠加位置；`originalMaterialType === 'image'` 标识图片项放在 video 轨道上。

### 2.2 三处「默认位置」常量（核心病灶）

当前默认值统一为「左上角 30%」`{ x: 0.1, y: 0.1, width: 0.3, height: 0.3, zIndex: 10 }`，分散在：

| # | 文件:行 | 用途 |
|---|---------|------|
| 1 | `src/components/video/timeline/domain/services/ItemPlacementService.ts:217-224` | **添加图片到轨道时**写入 `itemData.imagePosition`（主路径） |
| 2 | `src/components/video/playback/ImageOverlayLayer.ts:72-79` (`DEFAULT_POSITION`) | canvas 合成时 item 无 `position` 的兜底 |
| 3 | `src/components/video/components/VideoPlayerPanel/imageOverlays.ts:19-25` (`DEFAULT_OVERLAY_POSITION`) | React 句柄选择时 item 无 `imagePosition` 的兜底 |

### 2.3 两条渲染路径

1. **Canvas 合成（真实画面）**：`MultiTrackPlaybackEngine._assemble` → `assembleLayers`（`internal/assembleLayers.ts`，图片 z 抬升 `DEFAULT_OVERLAY_BASE_Z = 1_000_000`，恒在视频之上）→ `buildImageLayersAt`（`ImageOverlayLayer.ts:153-175`）→ `computeImageBounds`（`ImageOverlayLayer.ts:121-137`，把归一化 bounds 投影到 fit-rect 并钳制 `w ≤ 1-x、h ≤ 1-y`）→ `CanvasCompositor.renderFrame` → `_drawImageLayer`（`CanvasCompositor.ts:322-343`）：
   ```ts
   const x = fit.x + layer.bounds.x * fit.width;
   const y = fit.y + layer.bounds.y * fit.height;
   const w = layer.bounds.w * fit.width;
   const h = layer.bounds.h * fit.height;
   ctx.drawImage(img, x, y, w, h);   // ← 直接拉伸到 bounds，未保持图片宽高比
   ```
   - fit-rect 由 `_baseFit`（`CanvasCompositor.ts:252-269`）算出：它对首个就绪 **video** 源调用 `fitContain`，但**传入 `targetAspectRatio = _viewport.aspectRatio`（项目比例）**，故当 canvas 像素缓冲比例==项目比例时返回的是**整张 canvas（即项目帧）**，而**非视频 letterbox 子区**；无 ready video 时同样退化为整张 canvas。此外 `_assemble`/`assembleLayers` 调用 `buildImageLayersAt` 时**未传 `imageFit`**（默认 `FULL_RECT`），故归一化只在 `_drawImageLayer` 经 `fit` 投影**一次**，无双重投影（默认 80% 在画布上即 80%）。【评审核验】
   - 该路径已对 bounds 做钳制，**画布内不会溢出**，但 `drawImage` 把图片**拉伸**填满 bounds，非框比例图片会变形。

2. **React 可拖拽句柄（叠加在 canvas 之上的 DOM）**：`VideoPlayerPanel` 用 `selectActiveImageOverlays`（`imageOverlays.ts:34-72`）选出当前时间的图片项，渲染 `<ImageOverlay>`（`VideoPlayerPanel.tsx:484-496`）。归一化基准在「组合模式」用 `previewFrameBox`②（项目比例 contain 盒，`aspectRatios.ts:computeContainBox`），在「占位/预览模式」用 `containerDimensions`①。`<ImageOverlay>`（`ImageOverlay.tsx:36-41`）：
   ```ts
   const pixelPosition = {
     x: position.x * containerWidth,  width:  position.width  * containerWidth,
     y: position.y * containerHeight, height: position.height * containerHeight,
   };
   ```
   - 内部 `<img className="object-contain">`（`ImageOverlay.tsx:185`）等比包含，但**外层 div 的 px 尺寸没有任何上限钳制**：若 `position.width > 1`，div 会超出基准盒。
   - 组合模式外层 wrapper 带 `overflow-hidden`（`VideoPlayerPanel.tsx:443`）；占位模式外层（`:500-518`）**不裁剪**，此时句柄可溢出整个面板。

### 2.4 拖拽/缩放与回写

- 拖拽：`ImageOverlay.handleMouseMove`（`ImageOverlay.tsx:70-99`）把屏幕坐标换算为归一化并钳制 `clampedX ∈ [0, 1-width]`。
- 缩放：仅右下角手柄 `handleResizeMouseMove`（`ImageOverlay.tsx:121-143`），**自由改 w/h**（可改变框比例 → 配合 canvas 的拉伸会失真）。
- 回写链：`onPositionChange` → `VideoPlayerPanel.handleImagePositionChange`（`VideoPlayerPanel.tsx:237-240`）→ `onImagePositionChange` → `VideoEditingInterface.handleImagePositionChange`（`VideoEditingInterface.tsx:2002-2031`）→ 更新 `currentTimelineState` + `timelineComposition.handleTimelineStateChange`。该链路完整可用，本方案沿用。

### 2.5 根因结论

- **遮挡根因**：默认 `imagePosition` 语义不符合「居中 80%」预期；且当历史项/异常项的归一化宽高 > 1（或接近 1）时，canvas 会被钳制到「填满 fit-rect → 完全盖住视频」，React 句柄在不裁剪的占位模式下会**溢出面板上方**。两条路径对「过大尺寸」缺乏统一的「居中 + 等比 contain + 钳制」处理。
- **失真根因**：canvas `drawImage` 拉伸到 bounds，与 React 句柄的 `object-contain` 语义不一致；当框比例 ≠ 图片比例时，画布画面与句柄、以及用户预期都不一致。

---

## 3. 目标与非目标（Goals / Non-Goals）

**Goals**
1. 任意像素尺寸的图片，添加到预览面板时默认**居中**且约占 **80%** 宽高，绝不默认盖满/遮挡视频。
2. 图片在 canvas 与 React 句柄两条路径上都**等比不失真**（`object-contain`），且二者所见即所得。
3. 用户可**等比缩放**调整图片大小；可**拖拽移动**位置；位置/尺寸越界自动钳制，永不溢出预览面板。
4. 历史工程（已存旧 `imagePosition`）打开后行为正确、不再溢出。

**Non-Goals**
- 不改后端、不改 ffmpeg 导出链路（导出一致性见 §8 风险，作为后续项）。
- 不新增旋转、裁剪、滤镜等图片变换能力。
- 不改 video/audio/subtitle 轨道的既有行为。
- 不引入新的第三方拖拽库（沿用现有手写实现）。

---

## 4. 技术设计（Technical Design）

### 4.1 关键决策（Decisions）

- **D1 默认值改为居中 80%**：新默认 `imagePosition = { x: 0.1, y: 0.1, width: 0.8, height: 0.8, zIndex: 10 }`（左右上下各留 0.1 → 居中、占 80%）。三处常量（§2.2）统一改为该值，保证「无 `imagePosition` 的兜底」与「新建写入」一致。**与源图片像素尺寸完全解耦**，从根上消除「图片越大遮挡越多」。
- **D2 canvas 等比 contain（不变形的硬不变量）**：`_drawImageLayer` 改为在 `bounds` 盒内按图片自然宽高比 `object-contain` 居中绘制（计算内嵌矩形 `_containRect`），与 `<ImageOverlay>` 内 `<img object-contain>` 对齐。这是「无论显示框比例如何，图片永不被拉伸/变形」的**硬不变量**，对新建项、历史项、异常项一律成立；当显示框比例==图片自然比例时 contain 退化为「填满盒」，与旧 `drawImage(img,x,y,w,h)` 结果一致（二者不冲突）。**关于 `_drawOverlays`/`setOverlays` 旧图片分支（`CanvasCompositor.ts:464-522`）**：经核实 `drawFrame` 在「单路合成器」重构后已**无生产调用方**（仅测试引用），生产唯一绘制路径是 `renderFrame → _drawImageLayer`，故该旧分支属 **dead path，本方案不强制修改**（如顺手对齐可做，但不计入验收与改动量）。【评审修正 C5】
- **D3 句柄越界钳制（钳制值须为唯一基准）**：`<ImageOverlay>` 在组件入口计算一次 `safePosition = clampImagePosition(position)`（`width,height ∈ (0,1]`、`x ∈ [0,1-width]`、`y ∈ [0,1-height]`），并以 `safePosition` 作为 `pixelPosition`（渲染）**以及** `handleMouseMove`/`handleResizeMouseMove` 的**唯一基准**——绝不能只钳制渲染用的 `pixelPosition` 而让拖拽/缩放仍读原始 `position`，否则历史/异常 `width>1` 会令 `1 - width < 0`、钳制区间反转、拖拽产出负值。占位模式外层补 `overflow-hidden` 作防御兜底。【评审修复 C2】
- **D4 等比缩放**：缩放手柄锁定图片原始宽高比的等比缩放（`naturalWidth/naturalHeight`，`onLoad` 写入组件 state）。配合 D6，缩放后显示框始终==图片比例 → 边框贴合可见图片、画布 contain 无留白。`naturalW/H` **未就绪时退化**为「自由改框 + D2 contain」（仍不失真，仅可能短暂留白），就绪后恢复等比。**最小尺寸沿受约束更紧的一轴**（取 `1-x`/`1-y` 更紧者）设下限，避免两轴各自 `0.1` 的 min 不一致。拖拽（move）维持现有逻辑但与 D3 的 `safePosition`/clamp 统一。【评审补充 C6】
- **D5 归一化基准对齐**：维持组合模式句柄以 `previewFrameBox` 为基准（与 wrapper/canvas 同盒）。**评审核验更正**：canvas 叠加参考框由 `_baseFit` 以 `targetAspectRatio=项目比例` 取得 → 等于**整张项目帧**（非视频子区），与句柄基准 `previewFrameBox` **本就同框**，主流程 WYSIWYG 成立；仅当 `_viewport.aspectRatio` 未注入（退化为视频自身比例）时 canvas 参考框才变为视频 letterbox 子区、与句柄轻微错位——现状播放器始终注入 aspectRatio（`useCompositionPlayback` 的 `aspectRatio` 传参），该退化不在主流程，列为后续项（见 §9 R2）。
- **D6 显示框模型与首帧对齐（评审补充，修复 WYSIWYG 与边框贴合）**：`imagePosition.width/height` 表示图片的**显示框**；可见图片以 D2 的 `object-contain` 嵌入该框。为使「蓝色选中边框/缩放手柄」与「可见图片」在新建场景下完全贴合，组件在 `<img>` `onLoad` 拿到 `naturalWidth/naturalHeight` 后，**仅当该项 `imagePosition` 仍等于新建默认 sentinel（`{0.1,0.1,0.8,0.8,10}`，未被用户调整）时**，把显示框一次性归一化为「居中 80% 包络内、与图片自然比例一致的内嵌矩形」（保持中心、占用 ≤80%），并经既有回写链落库（仅触发一次、用 ref 防重入）。归一化后显示框比例==图片比例 → contain 无留白、边框贴合可见图片、等比缩放（D4）语义自洽，且导出（ffmpeg 填充框）对新建项亦等同 contain（顺带缓解 R1）。**历史项 / 用户已调整项绝不触发此归一化**（与 R6 一致）：它们仍由 D2/D3 的 contain+clamp 保证不失真、不溢出，此时蓝色边框包围的是显示框（图片在框内居中、可能留白），属可接受的退化表现。归一化所需的显示框像素比例由组件已有的 `containerWidth/containerHeight`（即 `previewFrameBox`）计算，**无需新增依赖**。【评审修复 C1】

### 4.2 居中 80% 的几何

归一化空间（相对 fit-rect / previewFrameBox），目标盒 `target = 0.8`：

```
width  = 0.8, height = 0.8
x = (1 - width)  / 2 = 0.1
y = (1 - height) / 2 = 0.1
```

图片在该 0.8×0.8 盒内由 `object-contain` 等比包含：设图片自然宽高比 `r = naturalW / naturalH`，盒在画布像素下宽高比 `boxAR = (0.8*fitW)/(0.8*fitH) = fitW/fitH`，则内嵌矩形：

```
if (r >= boxAR) {  // 图片更宽，宽顶满盒
  innerW = boxW;            innerH = boxW / r;
} else {           // 图片更高，高顶满盒
  innerH = boxH;            innerW = boxH * r;
}
offsetX = boxX + (boxW - innerW) / 2;   // 盒内居中
offsetY = boxY + (boxH - innerH) / 2;
```

canvas 与 DOM 句柄都用同一套 contain 计算，结果一致。最终「图片可见区」约占预览 ≤80%（取决于图片比例），满足「大概占 80%」。

**显示框 vs 可见图片（D6 配套说明）**：上式 `box` 即 `imagePosition` 描述的**显示框**。经 D6 首帧对齐后，**新建项**的显示框已被归一化为==图片比例，contain 退化为「填满框」→ 可见图片 == 显示框 == 蓝色选中边框，三者完全重合，可见区恰为居中 80% 的等比内嵌矩形（满足验收 #5）。**历史 / 已调整项**不做对齐：可见图片仍为框内 `object-contain` 的内嵌矩形（≤80%，框比例 ≠ 图比例时有留白），蓝色边框包围显示框、可能大于可见图片——二者均**不失真、不溢出**。

### 4.3 操作时序（Sequence）

**添加图片**：
1. 用户从素材面板拖拽图片到图片轨道 → `Track.handleDrop` → `dropMaterial` → `addItemAction` → `timelineSlice.addItemToTrack` → `ItemPlacementService.createItemFromMaterial`。
2. 图片分支写入新默认 `imagePosition = {0.1,0.1,0.8,0.8,zIndex:10}`（D1）。
3. 播放/定位到该时间 → `MultiTrackPlaybackEngine._assemble` → `buildImageLayersAt`/`computeImageBounds`（保持现有钳制）→ `CanvasCompositor._drawImageLayer`（D2 等比 contain 绘制居中 80%）。
4. `VideoPlayerPanel` 渲染 `<ImageOverlay>`，按 `previewFrameBox` 定位句柄（D3 `safePosition` clamp），与 canvas 画面重合。
5. `<img onLoad>` 拿到 `naturalW/H`（D6）：若该项 `imagePosition` 仍等于默认 sentinel，则一次性把显示框归一化为「居中 80% 包络内、与图片比例一致」并经 `onPositionChange` 回写（ref 防重入）；此后边框贴合可见图片、等比缩放自洽。历史/已调整项跳过此步。

**缩放**：用户拖右下角手柄 → `handleResizeMouseMove`（D4 等比，基于 `safePosition`）→ 新 `position`（锁定 `naturalW/H` 比例、≥最小尺寸、clamp 越界）→ `onPositionChange` 回写 → 重渲染。

**拖拽**：用户在叠加层按下拖动 → `handleMouseMove`（基于 D3 `safePosition`、clamp）→ 新 `position` → `onPositionChange` 回写 → 重渲染。

---

## 5. 文件 / 模块变更计划（File / Module Change Plan）

| 文件 | 变更意图（一句话） |
|------|------------------|
| `src/components/video/timeline/domain/services/ItemPlacementService.ts` | 图片分支默认 `imagePosition` 改为居中 80% `{0.1,0.1,0.8,0.8,10}`（D1）。 |
| `src/components/video/playback/ImageOverlayLayer.ts` | `DEFAULT_POSITION` 改为居中 80%，与 D1 对齐（D1）。 |
| `src/components/video/components/VideoPlayerPanel/imageOverlays.ts` | `DEFAULT_OVERLAY_POSITION` 改为居中 80%，与 D1 对齐（D1）。 |
| `src/components/video/playback/CanvasCompositor.ts` | 新增纯函数 `_containRect`；`_drawImageLayer` 改为按图片自然比例 `object-contain` 在 bounds 盒内居中绘制（D2）。**不改 `_drawOverlays`/`setOverlays` 旧图片分支（dead path，C5）**。 |
| `src/components/video/components/VideoPlayerPanel/ImageOverlay.tsx` | 入口计算 `safePosition = clampImagePosition(position)` 作为渲染+拖拽+缩放唯一基准（D3）；缩放手柄改等比缩放（`onLoad` 读 `naturalWidth/Height` 存 state）+ 沿限制轴最小尺寸（D4）；`onLoad` 对「仍等于默认 sentinel」的项一次性归一化显示框为图片比例并回写（D6，ref 防重入）。 |
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | 占位/预览模式叠加容器（`:500-501` `video-placeholder-container`）补 `overflow-hidden` 兜底裁剪（D3，防御性；组合模式 `:443` 已有 `overflow-hidden`）。 |
| `src/components/video/hooks/useVideoExport.ts` | 同步默认值（`item.imagePosition || {...}` 兜底，`:239-245`）改为居中 80%，与 D1 一致，避免导出兜底用旧 30%（仅同步常量，不改导出几何）。 |
| `src/components/video/playback/__tests__/ImageOverlayLayer.test.ts` | **必改**：`:97` `computeImageBounds(undefined)` 断言由旧 `{x:0.1,y:0.1,w:0.3,h:0.3}` 改为居中 80%（默认变更后否则必红）。 |
| `src/components/video/components/VideoPlayerPanel/__tests__/imageOverlays.test.ts` | **必改**：`:75` 默认断言由 `{...,width:0.3,height:0.3,zIndex:10}` 改为 80%。 |
| `src/components/video/playback/__tests__/CanvasCompositor.*.test.ts` | 新增 `_containRect` 用例（宽/高/方图在 16:9 / 9:16 / 1:1 盒内等比居中、不拉伸不溢出）；`renderFrame.test.ts` 现仅断言 `alpha/source`、不断言图片几何，contain 改动不破坏既有断言（已核验）。 |
| `hooks/__tests__/useCompositionPlayback.test.tsx` | 用例使用**显式** position（`:243`），不受默认变更影响；若新增 contain 几何断言再同步。 |

> 注：`TimelineRepository.ts`、`timeline/domain/types.ts`、`TimelineItem.ts` 仅透传 `imagePosition`，**无需改动**。

---

## 6. 接口设计（Interface Design）

无 REST / WebSocket / CLI 变更。仅前端内部函数签名/语义调整（保持兼容）：

```ts
// CanvasCompositor.ts —— 新增私有几何辅助（纯函数，便于 jsdom 测试）
/** 在 bounds 盒内按图片自然比例 contain 居中，返回画布像素矩形。 */
private _containRect(
  natW: number, natH: number,
  boxX: number, boxY: number, boxW: number, boxH: number,
): { x: number; y: number; w: number; h: number };

// ImageOverlay.tsx —— 渲染前钳制（纯函数，可抽出单测）
function clampImagePosition(p: ImagePosition): ImagePosition; // x,y,width,height ∈[0,1] 且 x+width≤1, y+height≤1

// ImageOverlay.tsx —— 等比缩放：在自由 newW 基础上按 aspect 推导 newH（或反之）
// aspect = naturalWidth / naturalHeight（onLoad 写入组件 state）

// ImageOverlay.tsx —— D6 首帧对齐（纯几何，可单测）：把「仍为默认 sentinel」的显示框
// 归一化为「居中 80% 包络内、与图片自然比例一致」的内嵌矩形。
// frameAR = containerWidth / containerHeight；返回 null 表示无需对齐（非 sentinel）。
function alignDefaultBoxToImage(
  p: ImagePosition, naturalW: number, naturalH: number,
  frameAR: number,
): ImagePosition | null;
const DEFAULT_IMAGE_POSITION: ImagePosition; // { x:0.1, y:0.1, width:0.8, height:0.8, zIndex:10 } —— 单一来源，sentinel 比对用
```

> **建议**：把居中 80% 默认值收敛为一个共享常量 `DEFAULT_IMAGE_POSITION`（或各处引用同一字面量并加注释），既作为新建写入值，又作为 D6 「是否仍为默认 sentinel」的判定基准，避免 §5 四处常量再次漂移（R4）。

`onPositionChange(position: ImagePosition)`、`onImagePositionChange(itemId, position)`、`ImagePosition` 结构**保持不变**（向后兼容）。

---

## 7. 数据模型（Data Model）

`ImagePosition`（结构不变）：

```ts
interface ImagePosition {
  x: number;       // [0,1] 相对 fit-rect 左边距
  y: number;       // [0,1] 相对 fit-rect 上边距
  width: number;   // (0,1] 占 fit-rect 宽度比
  height: number;  // (0,1] 占 fit-rect 高度比
  zIndex?: number; // 多图叠放顺序，越大越上
}
```

**默认值（本方案）**：`{ x: 0.1, y: 0.1, width: 0.8, height: 0.8, zIndex: 10 }`（居中 80%）。

**历史数据**：旧工程多为 `{0.1,0.1,0.3,0.3}`（左上 30%），打开后由 D3 的 `safePosition`/clamp 保证不溢出、按原值正常显示。**D6 首帧对齐只命中「等于新默认 sentinel `{0.1,0.1,0.8,0.8,10}`」的项**（即本次改动后新建、未被用户调整者）——旧 30% sentinel 与用户已调整值都**不**匹配，故不被 D6 触碰（守 R6）。如确需统一旧默认，可另列可选迁移，默认不做以免误改用户已调位置。无持久化结构/迁移变更，无 DB 改动。

---

## 8. 测试与验收标准（Testing & Acceptance）

**单元测试**
- `ImageOverlayLayer`：`DEFAULT_POSITION` 为居中 80%；`computeImageBounds` 对超大归一化值仍钳制在 `[0,1]`。
- `CanvasCompositor._containRect`：宽图/高图/方图在 16:9、9:16、1:1 盒内的内嵌矩形等比且居中（无拉伸、无溢出）。
- `imageOverlays.selectActiveImageOverlays`：item 无 `imagePosition` 时回退到居中 80%。
- `ImageOverlay.clampImagePosition`：`width=1.5/x=0.9` 等非法值被钳制到合法区间（`x+width≤1`、`y+height≤1`）；拖拽/缩放基于 `safePosition` 时不产出负坐标。
- `ImageOverlay.alignDefaultBoxToImage`（D6）：对默认 sentinel + 给定 `naturalW/H`、`frameAR` 返回「居中、≤80%、比例==图片」的框；对非 sentinel 返回 `null`（不改用户/历史值）。
- 等比缩放：基于 `naturalW/H` 推导另一轴，保持比例；`naturalW/H` 未就绪时退化为自由改框且不溢出。
- `ItemPlacementService.createItemFromMaterial`：image 素材生成的 item `imagePosition` 为 `{0.1,0.1,0.8,0.8,10}`；video/audio 不受影响。

**集成 / 手动验收（桌面端走查为强制门槛，见 CLAUDE.md）**
1. 上传一张**超大**图片（如 6000×4000）→ 拖入图片轨道 → 预览中图片**居中**、约占 80%、**未遮挡**整段视频、**未溢出**面板上方。
2. 上传**竖图/方图/横图**各一张 → 均等比不失真、居中、约 80%。
3. 拖动图片到四角与中心 → 位置实时跟随、不溢出、松手后保持。
4. 拖右下角手柄缩放 → 图片**等比**放大/缩小、有最小尺寸下限、不失真。
5. **新建图片**：加载后 canvas 可见图片、DOM `<img>`、蓝色选中边框三者**完全重合**（D6 已把显示框对齐为图片比例、无留白）；**历史/已调整图片**：可见图片在蓝色边框内居中 `contain`（边框=显示框、可能大于可见图片），不失真、不溢出。
6. 打开含旧 `imagePosition`（含异常 `width>1`）的工程 → 正常显示、可继续拖拽缩放、不溢出、不产出负坐标（D3 `safePosition`）。
7. `npm run type-check` 与 `npm run lint` 通过；**前端单元测试套件（vitest）全绿**——尤其 `ImageOverlayLayer.test.ts`、`imageOverlays.test.ts` 的默认值断言已随新默认更新；相关 `pytest` 不涉及（纯前端）。

**Definition of Done**：上述 1–7 全部满足；新默认、contain（`_containRect`）与 D6 首帧对齐行为有单测覆盖；**前端单元测试套件全绿**；无 ESLint error、无 TS 编译错误。

---

## 9. 风险与缓解（Risks & Mitigations）

| 风险 | 影响 | 缓解 |
|------|------|------|
| **R1 预览/导出不一致**：canvas 改 contain，而 ffmpeg 导出 overlay 仍按 bounds 拉伸 | 导出画面与预览有差（非框比例图片） | **D6 使新建项「显示框==图片比例」→ ffmpeg 填充框==contain（不失真），新建项预览/导出一致**；仅**历史/已调整**且框比例≠图比例的项导出仍可能失真。**列为后续项**：导出 overlay 改 `force_original_aspect_ratio=decrease` + 居中（`useVideoExport`/后端），不在本次范围。 |
| **R2（评审修正）句柄与 canvas 参考框对齐**：`_baseFit` 实际以 `targetAspectRatio=项目比例` 取整张项目帧（非视频子区），与句柄基准 `previewFrameBox` 同框 → 主流程 WYSIWYG 成立，优于原稿担忧 | 仅当 `_viewport.aspectRatio` 未注入（退化为视频自身比例）时，canvas 参考框才变成视频子区、与句柄错位 | 现状播放器始终注入 `viewport.aspectRatio`（`useCompositionPlayback` 的 `aspectRatio` 传参），主流程无错位；极端缺省下的错位列为后续项，不改本次归一化语义（D5）。 |
| **R3 桌面端打包陈旧**：用户实测可能是旧 standalone 包（见记忆库多条） | 修了代码但桌面端仍现旧象 | 在交付说明中要求**重新打包桌面端**并按 CLAUDE.md 走查门槛验证。 |
| **R4 三处默认常量未同步** | 兜底与新建不一致，行为漂移 | §5 已列全部三处 + 导出兜底；评审清单逐项核对。 |
| **R5 等比缩放需 naturalW/H**：图片未加载完时比例未知 | 加载前缩放比例不准 | `onLoad` 写入比例；未就绪时退化为自由缩放并钳制，加载后恢复等比；最小尺寸兜底防 0。 |
| **R6 历史项归一化误改** | 强制迁移可能覆盖用户已调位置 | 默认**不**做强制迁移；仅靠 D3 clamp 保证安全显示。 |

---

## 10. 实施过程发现的方案缺陷（Subtask #2 回填）

实现过程未发现根因/技术路线错误，方案整体可落地。仅就「纯函数落点」与「测试可运行性」做了一处**与 §6 措辞不同、但完全符合 §6『可抽出单测』意图**的工程调整，记录如下：

- **F1（已处置）测试基建限制：组件 `.tsx` 无法被本项目 Vitest 导入 → 纯几何须落到独立 `.ts` 模块。**
  - **现象**：§6 把 `clampImagePosition` / `alignDefaultBoxToImage` / `DEFAULT_IMAGE_POSITION` 标注在 `ImageOverlay.tsx`。但本项目 `vitest.config.ts` 未挂 React 插件、且 `tsconfig.json` 设 `jsx: "preserve"`，Vitest（vite import-analysis）**无法解析任何含 JSX 的 `.tsx` 模块**——既有测试 `exportButton.test.tsx` 顶部注释亦明确「project's Vitest config (tsconfig jsx: "preserve") cannot mount React components」，故只能以「读源码文本做正则断言」绕过。若把纯函数留在 `ImageOverlay.tsx` 并从测试 `import`，会触发 `Failed to parse source ... invalid JS syntax`，**§8/放行条件 #3 要求的 `clampImagePosition`/`alignDefaultBoxToImage` 真值单测无法运行**。
  - **处置（符合 §6『纯函数，可抽出单测』）**：新增**无 JSX** 的同级模块 `src/components/video/components/VideoPlayerPanel/imageOverlayGeometry.ts`，承载 `DEFAULT_IMAGE_POSITION`、`MIN_OVERLAY_SIZE`、`clampImagePosition`、`isDefaultSentinel`、`alignDefaultBoxToImage`，并把 D4 等比缩放求解抽成纯函数 `resizeKeepingAspect`（组件 `handleResizeMouseMove` 仅负责从鼠标算 raw 值后调用它）。`ImageOverlay.tsx` 改为从该模块 `import`。测试落在 `__tests__/imageOverlayGeometry.test.ts`（而非 §5 表里写的 `ImageOverlay.test.ts`，因后者必须是 `.tsx` 才能含/导 JSX，反而触发上述限制）。
  - **影响**：放行条件 #4「建议收敛为单一 `DEFAULT_IMAGE_POSITION` 常量」在 React/句柄侧已实现为单一来源；canvas 数据层 `ImageOverlayLayer.DEFAULT_POSITION` 与 `ItemPlacementService` / `imageOverlays` / `useVideoExport` 三处兜底，因分属不同层（数据层刻意不耦合 `@/types` barrel；service/hook 各自就地），按 §6「或各处引用同一字面量并加注释」执行——四处均已同步为居中 80% 并加交叉引用注释，R4 闭环。
  - **`_containRect`**：按 §6 维持为 `CanvasCompositor` 私有方法，单测经 `(compositor as unknown as { _containRect }).bind` 直接调用（`CanvasCompositor.containRect.test.ts`）。

**验证结论**：`npm run type-check` 通过（exit 0）；改动文件 `next lint` 无 error（仅既有 `<img>`/`any`/未用 import 警告，均非本次引入）；本特性相关单测 52 例全绿（`CanvasCompositor.containRect` / `imageOverlayGeometry` / `ImageOverlayLayer` / `imageOverlays` / `renderFrame`）。全量 `vitest run` 仅余 **3 例预存失败**（`backend-proxy.test.ts` 的 `/api/user/toggle-status` 与 `cachePlayback.integration.test.ts` 的导出 URL origin），经 `git stash` 净树复跑确认**与本改动无关**（本分支 `feat/remove-user-system` 正在移除 user 路由），不在本特性范围。

---

## 11. 评审结论（Review Verdict — Subtask #1）

**结论：有条件通过（Approved with conditions）。版本已升至 v2。**

整体评价：方案根因定位准确、对现状代码引用核验属实，技术路线（默认居中 80% + 两路 `object-contain` + 钳制 + 等比缩放/拖拽）能落地、可解决「大图遮挡视频 / 拉伸失真 / 拖拽缩放」三类问题，作用域恰当（仅前端预览/时间轴域，不动后端与导出几何）。3 个 P1（C1 模型冲突、C2 钳制基准、C3 测试/DoD 门槛）与 2 个事实类 P2（C4 R2 描述、C5 dead path）均已在正文就地修复，无遗留 P0/P1。

进入 Subtask #2（代码开发）须满足的**放行条件**：

1. **C1/D6**：实现「显示框=图片矩形」统一模型——`<img onLoad>` 仅对「仍等于默认 sentinel」的项一次性把显示框对齐为图片比例并回写（ref 防重入）；canvas 与 DOM 均 `object-contain`；新建项须满足验收 #5 三者重合，历史项须不失真、不溢出。
2. **C2/D3**：`<ImageOverlay>` 入口计算一次 `safePosition` 并作为渲染 + 拖拽 + 缩放的唯一基准，杜绝 `width>1` 时钳制区间反转。
3. **C3**：同步更新 `ImageOverlayLayer.test.ts:97` 与 `imageOverlays.test.ts:75` 的默认值断言，新增 `_containRect`（及 D6 对齐）单测；**交付前 `vitest` 套件须全绿**，连同 `type-check`/`lint`。
4. **R4**：四处默认常量（`ItemPlacementService` / `ImageOverlayLayer` / `imageOverlays` / `useVideoExport` 兜底）必须同时改为居中 80%，建议收敛为单一 `DEFAULT_IMAGE_POSITION` 常量。
5. **C5 边界**：不要扩面修改 `_drawOverlays`/`setOverlays`（dead path）；如发现 `drawFrame` 实际仍被调用，回填 §10 并再评审。
6. **桌面端走查门槛**（CLAUDE.md 强制）：按 §8 集成验收 1–6 在桌面端实测；若用旧 standalone 包复现旧象，先重新打包（R3）。

遗留为「后续项」（不阻塞本次、不在范围）：R1 历史项导出失真（ffmpeg overlay contain 化）、R2 `viewport.aspectRatio` 缺省时的参考框退化。实施中若发现方案缺陷，回填 §10 并视情回流评审。
