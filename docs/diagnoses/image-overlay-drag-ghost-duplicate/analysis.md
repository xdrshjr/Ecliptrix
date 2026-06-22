# 图片叠加拖拽后旧位置残留副本 — 根因分析

> Bug slug: `image-overlay-drag-ghost-duplicate`
> 关联轮次：第 3 轮（多轮迭代任务）
> 用户原话（# 目前问题）：「目前挪动以后，图片原本的那个位置还留有一个副本」
> 分析节点：Subtask #0「问题定位与分析」（本节点只做定位，不写修复代码、不提交）

---

## Problem description（问题描述）

在视频编辑器的「播放组合预览」面板上，用户把图片素材添加到图片轨道后，点击预览中的图片可以拖拽移动 / 缩放。

**症状**：把图片拖到新位置后，**原来的位置仍然留着一张同样的图片（副本）**，于是画面上同时出现两张图——一张停在旧位置，一张跟着鼠标到了新位置。这个副本不是拖拽过程中的瞬时残影，**松手（commit）之后依然持续存在**，直到用户去拖动时间轴/播放/切换比例等触发一次重绘才会消失。

第 3 轮还要求：在缩放控制框右上角加「确定 / 取消」小按钮，确定后才落盘新位置与缩放。本报告聚焦「副本」缺陷的根因；该缺陷与确定/取消特性正交——即使加了确定/取消，只要「确定」后不触发画布重绘，副本同样会残留（见 Candidate fixes）。

---

## Reproduction steps（复现步骤）

前置：本地启动前后端（`npm run dev` + 后端 `uvicorn app.main:app`），进入视频编辑界面，时间轴上至少有一个视频片段使其进入「组合播放（composition）」模式。

1. 在素材管理中上传一张图片素材。
2. 把该图片素材拖到「图片轨道」上，使其覆盖当前播放头所在时间。
3. **保持暂停**（不要点播放）。此时预览面板中心约 80% 处显示这张图片（此时画布栅格化的图片与 React 叠加层的 `<img>` 完全重合，看起来是一张）。
4. 在预览面板里**点击该图片**选中它（出现蓝色选中框与四角手柄）。
5. **按住图片拖到另一个位置**后松手。

**预期**：图片整体移动到新位置，旧位置不留任何东西。
**实际**：新位置出现被拖动的图片，**同时旧位置仍留着一张一模一样的图片**，画面上变成两张。拖拽缩放（四角手柄）同样会在旧的包围盒位置留下一张旧尺寸的副本。

最小复现要点：**必须在暂停态下编辑**（编辑器默认就是暂停态）。如果先点播放再观察，rAF 循环每帧重绘画布，副本会被「追上」而难以察觉——这恰好反向印证了根因（见下）。

---

## Root cause analysis（根因分析，含证据）

### 一句话根因

图片叠加在预览里被**渲染了两遍**：① 画布合成器把图片**烤进 canvas 像素**（真正参与多轨合成/导出的那一层），② React `<ImageOverlay>` 在 canvas 之上又渲染了一张**完整不透明的 `<img>`** 作为可拖拽句柄层。两者 z 轴一上一下、位置一致时严丝合缝看起来是一张。**而在暂停态下，画布合成器的 rAF/tick 循环是停止的，`imagePosition` 变化没有任何重绘触发**——于是拖拽时只有上层 React `<img>`（z=10）跟着移动，下层那张被烤进 canvas（z=2）的旧图保持不动、原地暴露出来，形成「旧位置的副本」。

### 证据链

**1) 两条渲染路径同时画这张图，且各自读同一份 `imagePosition`。**

- React 叠加层（句柄/可拖拽层）在 `VideoPlayerPanel` 中被渲染，叠在 `PreviewCanvas` 之上：
  - `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:470` 渲染 `PreviewCanvas`，其内联样式 `zIndex: 2`（`VideoPlayerPanel.tsx:477`）。
  - `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:484` 起 `getCurrentImageOverlays().map(... <ImageOverlay/>)`，把每个活动图片项渲染成 React 叠加层。
- React `<ImageOverlay>` 不只是画几个手柄，它渲染的是**一整张占满包围盒的 `<img>`**，并且自身 z 轴在 canvas 之上：
  - `src/components/video/components/VideoPlayerPanel/ImageOverlay.tsx:259` 根 div `zIndex: safePosition.zIndex || 10`（= 10，高于 canvas 的 2）。
  - `src/components/video/components/VideoPlayerPanel/ImageOverlay.tsx:266-274` `<img className="w-full h-full object-contain" .../>` 渲染完整图片。
- 设计注释明确写了这是「双层」：画布栅格化负责像素，React 列表负责可拖拽句柄——
  - `src/components/video/components/VideoPlayerPanel/imageOverlays.ts:5-7`：「The compositor rasterises image overlays on-canvas (ImageOverlayLayer); this list drives the draggable React `<ImageOverlay>` handles layered over the preview.」
  - `src/components/video/playback/ImageOverlayLayer.ts:1-3`：该数据层「replaces the React `<ImageOverlay>` rasterisation」（即画布侧才是真正的栅格化）。

**2) 画布侧确实把图片烤进了像素，数据来自 live 的 `item.imagePosition`。**

- 引擎每帧管线 `_renderAt` 折叠图层时取的是「live 图片项」：
  - `src/components/video/playback/MultiTrackPlaybackEngine.ts:337-351` `_renderAt(...)` → `_assemble(...)` → `this.compositor.renderFrame(layers)`。
  - `src/components/video/playback/MultiTrackPlaybackEngine.ts:374-386` `_assemble` 调 `assembleLayers({ ..., imageItems: tl.getImageItems() })`。
  - `getImageItems` 即 `src/components/video/hooks/useCompositionPlayback.ts:362-363` → `buildImageOverlayInputs(timelineStateRef.current, materialsRef.current)`，其内 `position: item.imagePosition ?? null`（`useCompositionPlayback.ts:180`）。
- 图层折叠 → 画布绘制：
  - `src/components/video/playback/internal/assembleLayers.ts:164` `buildImageLayersAt(input.imageItems, input.t, input.imageFit)`。
  - `src/components/video/playback/CanvasCompositor.ts:281-282` `case 'image': return this._drawImageLayer(...)`；`CanvasCompositor.ts:322-343` `_drawImageLayer(...) → ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h)`。

**3) 关键：暂停态下，画布只在极少数显式时机重绘，而 `imagePosition` 变化不在其中。**

- 引擎靠时钟 tick 驱动 `_renderAt`，**时钟只在播放时跑**：
  - `src/components/video/playback/MultiTrackPlaybackEngine.ts:175` `this._clockUnsub = this.clock.subscribeTick((comp) => this._onTick(comp))`；`MultiTrackPlaybackEngine.ts:299-314` `_onTick → _renderAt`。
  - `pause()` 里 `this.clock.stop()`（`MultiTrackPlaybackEngine.ts:241`），tick 不再产生 → `_renderAt` 不再被周期调用。
- 暂停态下能触发单帧重绘的，只有：`pause()`（`:243`）、`seek()` 的暂停分支（`:259-262`）、解码元素就绪事件 `_bindReadinessRepaint`（`:440`）、以及视口尺寸变化订阅。**没有任何一处响应 `imagePosition` 变化。**
- 已有的「暂停态变更→显式重绘」先例恰恰只覆盖了视口尺寸，没覆盖叠加位置：
  - `src/components/video/hooks/useCompositionPlayback.ts:526-543`（H5）：「viewport (canvas size) changes while paused do NOT repaint by themselves (the rAF loop is stopped)... when NOT playing, re-seek the engine ... so it repaints one frame」——这正是为「暂停态画布不会自重绘」补的洞，但它**只订阅 viewport，没有订阅图片叠加数据**。
  - 滚动条/scrub 重绘 effect 依赖的是 `currentTime`（`useCompositionPlayback.ts:524` deps `[currentTime, enabled, hostVersion]`）。拖动图片**不会改变播放时间** `currentTime`，所以这个 effect 也不会触发 `engine.seek()`。

**4) 数据确实落盘了，所以「React 叠加层会跟着动、canvas 不会」是必然结果。**

- 拖拽每次 `onPositionChange` 一路回写到唯一真源 `currentTimelineState`：
  - 拖拽 `src/components/video/components/VideoPlayerPanel/ImageOverlay.tsx:130-161` `handleMouseMove → onPositionChange(newPosition)`。
  - `VideoPlayerPanel.tsx:492` → `handleImagePositionChange` → `onImagePositionChange?.(...)`（`VideoPlayerPanel.tsx:237-240`）。
  - `src/components/video/VideoEditingInterface.tsx:2023-2052` `handleImagePositionChange` `setCurrentTimelineState(... item.imagePosition = position ...)`。
- 同一份 `timelineState` 既喂给 React 叠加层（`selectActiveImageOverlays` → `<ImageOverlay position={...}>`，会因 props 变化**立即重渲染到新位置**），又喂给引擎（`timelineStateRef.current` → `getImageItems()`，但引擎在暂停态**不会去读它重绘**）。**两路读同一真源，却只有 React 那路会自更新**——这就是「上层图跟着动、下层 canvas 烤进去的旧图不动」的根因。

**5) 反例排除（评审补强）：写回真源那条链路确实「不会」顺带触发画布重绘。**

唯一可能反驳根因的猜想是：`handleImagePositionChange` 里第 2048 行还调了 `timelineComposition.handleTimelineStateChange(updatedState)`，会不会顺带触发了画布重绘？逐行核对后排除：

- `setCurrentTimelineState` 引发 re-render 后，引擎侧只是**静默刷新 ref**：`src/components/video/hooks/useCompositionPlayback.ts:313` `timelineStateRef.current = timelineState`（裸赋值，不调用 `engine.seek`/`_renderAt`，也不 `setState`）。新 `imagePosition` 只是「躺进」ref，等下一次 `_renderAt` 来读——而暂停态没有下一次。
- 引擎的「重新 attach / 重绘 effect」只看 `hostVersion`，而 `hostVersion` **只在 host 句柄 (un)bind 时自增**：`useCompositionPlayback.ts:289-295`（`hostRef` 回调里 `setHostVersion((v) => v + 1)`）。拖图既不换 host 句柄也不改 `currentTime`，`hostVersion` 与 `currentTime` 都不变 → 依赖 `[currentTime, enabled, hostVersion]` 的 scrub 重绘 effect（`useCompositionPlayback.ts:524`）整段不重跑。
- 图片叠加走的是 `timelineStateRef`/`materialsRef`（`getImageItems` → `buildImageOverlayInputs`，`:362-363`），**根本不经过 `compositionRef`**；即便 `handleTimelineStateChange` 改了 composition，也与图片这层的重绘无关。

结论：写回真源的整条链路上没有任何一处会在暂停态触发 `_renderAt`，反例不成立，根因成立。

### 为什么平时看起来正常 / 播放时副本不明显

- 初次挂载时 `attach()` 会 `_renderAt(getCurrentTime(), false)` 画首帧（`MultiTrackPlaybackEngine.ts:177`），此刻 canvas 烤的图与 React `<img>` 同位置完全重合 → 看起来一张。
- 一旦播放，rAF/tick 每帧 `_renderAt` 都按最新 `imagePosition` 重画 canvas → canvas 图能在一帧内追上 React 图，副本被覆盖、难以察觉。问题只在**暂停态编辑**时暴露——而编辑器默认就是暂停态，所以用户必然撞上。

---

## Impact surface（影响面）

- **受影响功能**：图片轨道叠加图在预览面板上的**拖拽移动**与**四角缩放**（第 1、2 轮交付的核心交互），仅在 composition / preview 的**暂停编辑态**下出现。
- **受影响用户**：所有使用「图片叠加 + 在预览里手动调位/缩放」的用户。由于编辑默认暂停，几乎是 100% 触发。
- **是否影响导出**：不影响最终导出。导出走 `useVideoExport`/后端 FFmpeg 按落盘的 `imagePosition` 渲染（单一真源已被正确更新），导出结果只有「新位置」一张，没有副本。**副本纯属预览态视觉假象**，但会让用户误以为加了两张图或位置没改成功，严重干扰编辑判断。
- **数据正确性**：`currentTimelineState.imagePosition` 始终是对的（唯一真源被正确更新），问题只在「暂停态画布未重绘」这一表现层。

---

## Candidate fixes（候选修复方案对比）

| 方案 | 思路 | 侵入性 | 风险 | 工作量 | 说明 |
|---|---|---|---|---|---|
| **A. 暂停态按叠加数据变化重绘画布**（推荐） | 在 `useCompositionPlayback` 增加一个 effect：监听「图片叠加输入的签名」（位置/尺寸/集合）变化，当 `engine.getPhase() !== 'playing'` 时 `engine.seek(currentTimeRef.current)` 重画一帧。完全复刻已存在的 H5 视口订阅模式（`useCompositionPlayback.ts:526-543`）。 | 低（约 1 个 effect） | 低 | 小 | 直击根因。重绘后 canvas 图回到新位置、与 React `<img>` 再次重合，副本消失。对接「确定/取消」时只要 commit 改动 `imagePosition` 就会被这个 effect 重绘，天然兼容。 |
| **B. 预览态让画布不画图片，只由 React `<ImageOverlay>` 渲染** | 暂停/编辑态画布跳过 image 图层，图片只由上层 React 画；播放/导出才由画布栅格化。 | 高（改渲染模型 + 播放/暂停切换 toggle） | 高 | 中 | 破坏 z 轴合成：图片本应按 z 夹在多条视频轨之间合成，只有 canvas 能做；交给 React 单画会丢失正确层叠，且 play/pause 切换易闪烁。不推荐。 |
| **C. 实现第 3 轮「确定/取消」草稿态 + 确定时强制重绘** | 拖拽/缩放只改 React 本地草稿态（不落盘），右上角「确定」才写回 `imagePosition` **并触发画布重绘**，「取消」回滚。 | 中（新增草稿态 + 两个按钮 + 回滚） | 中 | 中 | 这是第 3 轮的产品诉求本身，能顺带解决副本——但**前提仍是「确定」时必须触发画布重绘**（本质还是方案 A 的重绘触发）。草稿态拖拽过程中旧位置 canvas 副本仍会短暂可见（作为「将移到此处」的预览可接受）。 |

> 补充：方案 A 与方案 C 不冲突，可叠加。无论采用「连续提交」还是「草稿+确定提交」，**真正消除副本的关键动作都是：`imagePosition` 落盘后，在暂停态显式让引擎重画一帧**（`engine.seek(currentTime)`）。这正是当前代码缺失的那一环。

---

## Recommended fix（推荐方案与理由）

**推荐方案 A**（暂停态按图片叠加数据变化重绘画布），可与第 3 轮的「确定/取消」（方案 C）叠加落地。

理由：

1. **直击根因、最小破坏面**：副本的本质是「暂停态画布对 `imagePosition` 变化无重绘触发」，方案 A 正好补上这唯一缺口，不动渲染模型、不改 z 轴合成、不碰唯一真源逻辑。
2. **有现成同构先例可照抄**：`useCompositionPlayback.ts:526-543` 的 H5 视口订阅就是「暂停态画布不自重绘 → 显式 `engine.seek` 补一帧」的成熟范式，方案 A 等于把同一范式从「视口尺寸」扩展到「图片叠加数据」，风险与认知成本都最低。
3. **天然兼容第 3 轮诉求**：第 3 轮要加「确定/取消」并在确定后落盘新位置/缩放。只要确定动作更新了 `imagePosition`（真源），方案 A 的重绘 effect 就会让画布同步到新结果——副本不会再残留。
4. **不影响导出与数据**：导出和落盘本就正确，方案 A 只修预览表现层，零数据风险。

落地指引（供 Subtask #2，不在本节点实现）：
- 在 `useCompositionPlayback` 中，用 `useMemo` 基于 `timelineState`/`materials` 推导一份「图片叠加签名」（例如把每个图片项的 `id + x + y + width + height + zIndex + opacity` 序列化）。
- 新增 `useEffect`，deps 含该签名与 `hostVersion`；effect 内若 `engineRef.current` 存在且 `engine.getPhase() !== 'playing'`，则 `engine.seek(currentTimeRef.current ?? 0)` 重画一帧。
- 注意只在「非播放」时重画（播放态由 rAF 自然覆盖），避免与 tick 循环重复抢画；签名而非整个 `timelineState` 作 dep，避免无关变更触发重绘。
- 若同时落地方案 C 的草稿态：拖拽中走本地草稿（不落盘），「确定」时一次性 `onImagePositionChange` 落盘 → 方案 A 的 effect 自动重绘；「取消」时丢弃草稿、React 叠加层 snap 回旧位置（与未变的 canvas 旧图重合，亦无副本）。

---

## 附：关键代码位置速查

| 作用 | 位置 |
|---|---|
| React 叠加层（z=10）渲染完整 `<img>` + 手柄 | `src/components/video/components/VideoPlayerPanel/ImageOverlay.tsx:251-292` |
| 拖拽每次回写位置 | `ImageOverlay.tsx:130-161`（`onPositionChange`） |
| PreviewCanvas（z=2）+ 叠加层挂载 | `VideoPlayerPanel.tsx:470-496` |
| 位置回写到唯一真源 | `VideoEditingInterface.tsx:2023-2052` |
| 画布烤图（image 图层） | `CanvasCompositor.ts:281-343` |
| 帧管线读 live 图片项 | `MultiTrackPlaybackEngine.ts:337-386` |
| 暂停态仅 pause/seek/readiness 重绘 | `MultiTrackPlaybackEngine.ts:239-264, 418-446` |
| 暂停态视口变化重绘先例（缺图片叠加版） | `useCompositionPlayback.ts:526-543` |
| 图片叠加输入构建（读 imagePosition） | `useCompositionPlayback.ts:161-186, 354-381` |
| 暂停态写回真源仅静默刷新 ref、不重绘 | `useCompositionPlayback.ts:289-295, 313` |
| scrub 重绘 effect 的回声护栏（防 seek 自循环） | `useCompositionPlayback.ts:497, 508-519` |

---

## 评审结论（Review Verdict）

> 评审节点：Subtask #1「分析报告评审与修复」。本节逐项复核了上文根因证据链与候选方案，并补强了一处反例排除证据（见「根因分析 5)」）。以下为最终评审结论。

### 一、根因证据是否成立 —— 成立，证据链已闭合

逐条 `file:line` 对照活代码全部命中，无虚引、无错位：

1. **双重渲染属实**：React `<ImageOverlay>` 渲染整张 `object-contain` 的 `<img>`、根 div `zIndex: safePosition.zIndex || 10`（`ImageOverlay.tsx:259, 266-274`），叠在 `zIndex: 2` 的 `PreviewCanvas` 之上（`VideoPlayerPanel.tsx:470-479`）；而画布侧另有一条独立栅格化路径把同一张图烤进 canvas（`assembleLayers.ts:164` → `CanvasCompositor.ts:281-282, 343`）。设计注释自陈两层并存：`ImageOverlayLayer.ts:3`「replaces the React `<ImageOverlay>` rasterisation」与 `imageOverlays.ts:5-7`「this list drives the draggable React `<ImageOverlay>` handles」——栅格化本应「替代」React 那张图，实际却两张同时在画，这正是副本之源。
2. **画布读 live `imagePosition` 属实**：`useCompositionPlayback.ts:362-363` `getImageItems` → `buildImageOverlayInputs`（`:180` `position: item.imagePosition ?? null`）。
3. **暂停态无 `imagePosition` 重绘触发属实**：`_renderAt` 仅由 tick / pause / seek / readiness 四处调用（`MultiTrackPlaybackEngine.ts:299-314, 243, 261, 440`），tick 只在播放时产生（`:175, 234, 241`）；暂停态唯一的「变更→显式补画」先例只订阅视口尺寸（`useCompositionPlayback.ts:526-543`），scrub 补画 effect 只认 `currentTime`/`hostVersion`（`:524`）。拖图二者皆不变。
4. **反例已排除**：写回真源链路（`VideoEditingInterface.tsx:2023-2052`）在暂停态只是静默刷新 ref（`useCompositionPlayback.ts:313`），`hostVersion` 仅在 host (un)bind 时自增（`:289-295`），图片层不经 `compositionRef`——整条链无任何一处在暂停态触发 `_renderAt`。

**症状—证据吻合度**：用户原话「挪动**以后**……还留有一个副本」「**松手后依然持续存在**，直到拖时间轴/播放/切比例才消失」与证据完全自洽——这三个「消失时机」恰好对应三条会调 `engine.seek`/`_renderAt` 的路径（scrub→`currentTime` 变→scrub effect 重绘；play→rAF 重绘；切比例→视口变→H5 effect 重绘），从反面再次印证「暂停态缺的就是这一次重绘」。无遗漏的替代解释。

### 二、候选方案复核

- **方案 A（推荐）**——成立且为最小修复。它只补「暂停态按图片叠加签名变化 → 非播放时 `engine.seek(currentTimeRef.current)` 补一帧」这唯一缺口，1 个 effect，照抄已上线的 H5 视口先例（`useCompositionPlayback.ts:526-543`），不动渲染模型 / z 轴合成 / 真源逻辑。**无额外工作、不做多余事**。
- **方案 B**——维持否决，但**修正其否决理由**。原报告称「图片本应按 z 夹在多条视频轨之间，只有 canvas 能做」对**图片层并不严格成立**：`assembleLayers.ts:161-166` 把所有 image 层用 `overlayBaseZ` 统一抬到全部 video 层之上，预览里图片恒在视频之上，不存在「夹在视频轨之间」。B 真正该被否决的理由是：(a) 它让暂停/播放两态走**不同渲染模型**，play/pause 切换有闪烁风险；(b) 导出永远走 canvas 栅格化，B 会让**预览与导出渲染源分叉**，埋下 WYSIWYG 漂移隐患；(c) 改动面远大于 A。结论不变：否决。
- **方案 C（确定/取消草稿态）**——本质是**第 3 轮的产品特性，而非本 Bug 的修复**。关键判断：**C 单独无法消副本**——即便加了「确定」按钮，「确定」在暂停态写回 `imagePosition` 后，若不触发画布重绘，副本照旧残留。也就是说 **A 的重绘机制是 C 能生效的前提**。故 C 与本 Bug 正交，应作为独立产品需求落地，且其「确定」提交必须复用 A 的重绘。

### 三、最终推荐修复（单一结论）

**采用方案 A：在 `useCompositionPlayback` 中新增一个「暂停态按图片叠加签名变化重绘画布」的 effect。**

**理由（为何是它、且是最小改动）**：副本的因果链已收敛为唯一缺口——「暂停态下 `imagePosition` 变化没有任何重绘触发」。A 精确补上这一缺口，不多不少；它复刻的是同文件、同语义、已上线验证过的 H5 视口补画范式（仅把订阅源从「视口尺寸」换成「图片叠加签名」），认知成本与回归风险都最低；它对导出与真源零影响（二者本就正确）；它天然兼容第 3 轮「确定/取消」——确定提交改了真源即被该 effect 重绘。B 改动面过大且使预览/导出分叉，C 不能独立修复本 Bug，均不选为本 Bug 的修复。

**实现护栏（交 Subtask #2，务必遵守，避免引入新回归）**：

1. **重绘条件加 `getPhase() !== 'playing'` 守卫**：播放态由 rAF 自然覆盖，不可重复抢画（照抄 `:539` 的 `if (engine.getPhase() === 'playing') return;`）。
2. **`seek` 到 `currentTimeRef.current ?? 0`（不改变时间）**：这样 `engine.seek` 经 `playhead.forceSet` 回写的 playhead 与现值相等，会被 scrub effect 的回声护栏吸收（`useCompositionPlayback.ts:497` `Math.abs(last - currentTime) < 1e-6 → return`，及 `:508-519` 播放态容差护栏），**不会形成 seek 自循环**。已核验：不引入递归重绘。
3. **依赖用「派生签名」而非整个 `timelineState`**：签名须覆盖「图片项集合 + 每项 `id/x/y/width/height/zIndex/opacity`」，使**新增 / 删除 / 改位 / 改尺寸 / 改透明度**都能触发补画，同时避免无关字段（如纯 `currentTime` scrub）误触发与 scrub effect 抢画。
4. **D6 首帧对齐不会触发死循环**：`alignDefaultBoxToImage` 仅对 sentinel 默认框生效一次且有 `alignedRef` 防重入（`ImageOverlay.tsx:91-101`），其 `onPositionChange(aligned)` 让签名变一次→补画一次，随后稳定。
5. **关于「拖拽过程中是否还可能瞬时见到副本」**：若仅落地 A（拖拽每步都写回真源），canvas 每步随拖重烤，副本**全程不出现**，体验最佳；若后续叠加 C 的草稿态（仅「确定」才写回），则拖拽途中 canvas 不更新、旧位置会**短暂**可见，「确定」后清除——这属第 3 轮产品取舍，可接受；若要连草稿态也无残影，需让草稿位置也喂进 live 叠加输入，但那是第 3 轮的设计决定，**不属于本 Bug 修复范围**。

**Definition of Done 对照**：根因证据链已闭合（每条 `file:line` 实测命中 + 反例排除）；本节给出**唯一**推荐修复（方案 A）并附「为何最小、为何不选 B/C」的显式推理与防回归护栏。本节点仅评审与补证，未改任何源码、未提交，符合约束。
