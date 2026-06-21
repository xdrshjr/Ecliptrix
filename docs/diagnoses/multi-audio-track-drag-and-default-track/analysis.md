# 多音频轨道：跨轨拖拽 + 默认轨道 Bug 分析报告

> 子任务 #0「问题定位与分析」产出物。本节点不写修复代码、不执行 `git commit`。
> 所属任务：13-BUG修复2-系统模板。
> 诊断日期：2026-06-21。代码基线：分支 `feat/remove-user-system`。

---

## 一、问题描述（Problem description）

用户在视频编辑器底部「剪辑面板」的**多音频轨道**区域反馈两个问题：

1. **Bug #1 — 不能把已经在时间轴上的音频片段从「音频轨道一」拖到「音频轨道二」。**
   用户期望：能把音频轨道 1 上的某个音频素材片段拖动转移到音频轨道 2；并且多条音频轨道能够**叠加（同时播放 / 混音）**，最终导出的视频里多条音频也能正常叠加。

2. **Bug #2 — 从素材库「搜索音频」得到的音频，添加到时间轴时默认落在「音频轨道一」，应当默认落在「音频轨道二」。**
   用户流程：素材库搜索音频 → 添加到素材管理面板（素材库）→ 点击「添加到时间轴」加入下方剪辑面板。当前默认进入 `audio-track-1`，这是错误的，期望默认进入 `audio-track-2`。

涉及模块：前端视频编辑器时间轴（`src/components/video/timeline/`，DDD 分层：domain / store / UI）、素材面板与编辑器主容器（`src/components/video/`）、以及导出/合成链路（前端 `useVideoExport` + 后端 `video_composition_service`）。

---

## 二、复现步骤（Reproduction steps）

环境：`npm run dev`（前端 :3000）；进入任意视频编辑任务，打开底部时间轴。默认时间轴含 5 条轨道（见证据 §3.0）：`video-track-1`、`image-track-1`、`audio-track-1`、`audio-track-2`、`subtitle-track-1`。

### Bug #1 复现
1. 往 `audio-track-1` 添加任意音频片段（或先复现 Bug #2 得到一条音频）。
2. 用鼠标按住该音频片段，**竖直向下**拖到 `audio-track-2` 的区域后松手。
3. **实际现象**：片段没有转移到音频轨道 2，仍停留在音频轨道 1（拖动只改变了它在本轨道上的水平时间位置；若本轨道上有相邻片段，可能触发同轨道「交换」而非跨轨移动）。
4. **期望现象**：片段被转移到音频轨道 2。

### Bug #2 复现
1. 素材库中使用「搜索音频」功能搜索并选中一条音频，添加进素材管理面板。
2. 在素材管理面板中点击该音频卡片的「添加到时间轴」按钮（`MaterialsPanel.tsx:2265`）。
3. **实际现象**：音频被加入 `audio-track-1`（音频轨道一）。
4. **期望现象**：音频被加入 `audio-track-2`（音频轨道二）。

### 「多音频叠加导出」验证步骤（用于确认这是 #1/#2 的下游表现，而非独立导出 Bug）
1. 想让两条音频叠加，必须把它们放在**两条不同**的音频轨道上（同一条轨道上的多个片段会被 `autoOrganize` 首尾相接顺序排布，而非叠加，见证据 §3.4）。
2. 当前因 Bug #1（不能跨轨拖拽）+ Bug #2（新音频都进轨道 1），用户**无法**把两条音频分别放到两条轨道，于是看不到叠加效果。
3. 导出链路本身已支持多轨混音（FFmpeg `amix`，见证据 §3.5）；修复 #1、#2 后叠加导出即可正常工作。

---

## 三、根因分析（Root cause analysis，含证据）

### 3.0 时间轴默认轨道结构（前置事实）

`src/components/video/timeline/TimelinePanel.tsx:213-219`：

```ts
tracks: [
  defaultTrack('video-track-1',    '', 'video',    0),
  defaultTrack('image-track-1',    '', 'video',    1),
  defaultTrack('audio-track-1',    '', 'audio',    2),   // 第一条音频轨（order=2）
  defaultTrack('audio-track-2',    '', 'audio',    3),   // 第二条音频轨（order=3）
  defaultTrack('subtitle-track-1', '', 'subtitle', 4),
],
```

`tracks` 数组中 `audio-track-1` 在 `audio-track-2` 之前——这一顺序是后续「取第一条音频轨」逻辑命中轨道 1 的根源。默认初始化保证 `audio-track-2` 始终存在。

---

### 3.1 Bug #1 根因：指针拖拽链路全程没有「目标轨道」概念

领域层**已经支持**跨轨移动，但拖拽链路（state machine → store → UI）从未把目标轨道传下来，所以能力存在却永远不被调用。

**(a) 领域聚合支持跨轨移动（能力存在）** — `src/components/video/timeline/domain/aggregates/TimelineAggregate.ts:167-198`：

```ts
moveItem(itemId: string, newStartTime: TimePosition, targetTrackId?: string): void {
  const found = this.findItem(itemId);
  ...
  if (targetTrackId && targetTrackId !== sourceTrack.id) {
    const targetTrack = this.findTrackOrThrow(targetTrackId);
    sourceTrack.removeItem(itemId);   // 从源轨移除
    item.moveTo(newStartTime);
    targetTrack.addItem(item);        // 加入目标轨（含类型兼容校验）
  } else {
    if (sourceTrack.isLocked) throw new TrackLockedError(sourceTrack.id, 'moveItem');
    item.moveTo(newStartTime);
    sourceTrack.sortItems();
  }
  this.recalculateTotalDuration();
}
```

单元测试也证明跨轨移动是被设计支持的（仅类型不兼容时拒绝）：`src/components/video/timeline/__tests__/moveItem.typeCompat.test.ts:51,75` 调用 `t.moveItem('clip', TimePosition.create(0), 's')` 形式（第三个参数即 `targetTrackId`）。音频→音频是类型兼容的，因此领域层允许。

**(b) Store 层丢弃了 `targetTrackId`（断点 1）** — `src/components/video/timeline/store/slices/timelineSlice.ts:55,231-243`：

```ts
// 接口签名根本没有 targetTrackId：
moveItem: (itemId: string, newStartTime: number, isPreview?: boolean) => void;

moveItem: (itemId: string, newStartTime: number, _isPreview?: boolean) => {
  const state = get();
  const aggregate = state._aggregate;
  try {
    aggregate.moveItem(itemId, TimePosition.create(newStartTime));  // ← 未传第三参 targetTrackId
  } catch (err) { console.error('[timelineSlice] moveItem failed:', err); return; }
  state._syncDerivedState();
},
```

**(c) 拖拽提交链路只算时间、不算目标轨（断点 2）** — `src/components/video/timeline/store/slices/dragSlice.ts`：
- 预览：`dragSlice.ts:236` `get().moveItem(preview.itemId, preview.startTime, true)`；
- 提交：`dragSlice.ts:162` `state.moveItem(preview.itemId, preview.startTime, false)`；
- 同轨交换分支：`dragSlice.ts:153-156` 命中 `swapTargetItemId` 时走 `swapItemsAction`（聚合 `swapItems` 明确禁止跨轨，见 `TimelineAggregate.ts:276-279`）。
全程只有 `itemId` 与 `startTime`，没有任何目标轨道入参。

**(d) 拖拽状态机不追踪指针 Y / 目标轨（断点 3）** — `src/components/video/timeline/domain/machines/dragMachine.ts`：
- 上下文 `DragContext.trackId`（`dragMachine.ts:61-63`）只保存**起始**轨道；
- 移动预览只用水平位移 `deltaX`：`dragMachine.ts:305-316` `calculateMovePreview(originalStartTime, e.deltaX, zoomLevel)`，从不处理 `clientY`；
- 预览出口 `getDragPreview()` 返回 `{ itemId, startTime, duration }`（`dragMachine.ts:587-603`），**不含目标轨道**。

**(e) UI 捕获了 `clientY` 却从不使用（断点 4）** — `src/components/video/timeline/TimelinePanel.tsx` 的指针移动处理把 `clientY` 透传进 `POINTER_MOVE`，但状态机里没人消费它来做轨道命中测试。

**(f) 交换目标检测只在同轨内进行** — `src/components/video/timeline/domain/services/DragCalculationService.ts:findSwapTarget` 先定位被拖项所在的 `hostTrack`，只在 `hostTrack.items` 内扫描候选，跨轨不参与。

> **结论（Bug #1）**：指针拖拽是围绕「同轨内沿时间轴移动 + 同轨交换」设计的，整条链路（dragMachine → dragSlice → timelineSlice）没有目标轨道这一维度；领域聚合 `moveItem` 虽支持 `targetTrackId`，但因为 store 的 `moveItem` 签名与实现都不带它，跨轨能力永远不会被触发。故把音频片段竖直拖到另一条音频轨时，只改变了它的水平时间位置，轨道不变。

---

### 3.2 Bug #2 根因：把音频素材加到时间轴时默认选「第一条音频轨」

**(a) 主路径——单素材「添加到时间轴」按钮把音频硬编码到 `audio-track-1`（核心断点）**

用户点击素材卡片的「添加到时间轴」（`src/components/video/components/MaterialsPanel/MaterialsPanel.tsx:2259-2265` 的 `onAddToTimeline(material)`）→ 主容器回调 `handleAddMaterialToTimeline`：

`src/components/video/VideoEditingInterface.tsx:1213-1238`：

```ts
let targetTrackId: string;
switch (material.type) {
  case 'video':    targetTrackId = 'video-track-1';    break;
  case 'image':    targetTrackId = 'image-track-1';    break;
  case 'audio':    targetTrackId = 'audio-track-1';    break;   // ← 硬编码到音频轨道一（Bug #2 主因）
  case 'subtitle': targetTrackId = 'subtitle-track-1'; break;
  ...
}
setMaterialsToAddToTimeline({ materials: [material], targetTrackId, timestamp: Date.now() });
```

随后 `TimelinePanel` 的 effect（`TimelinePanel.tsx:531`）把 `targetTrackId='audio-track-1'` 透传给 `handleAddMaterialsToTimeline` → `handleMaterialDrop(material, 'audio-track-1')`；因该轨存在（`TimelinePanel.tsx:452` `trackExists` 为真），直接用之 → `addItemAction(..., 'audio-track-1', materialData)`（`TimelinePanel.tsx:484`）。**搜索音频因此落到音频轨道 1。**

**(b) 次路径——自动选轨的「取第一条音频轨」回退（一致性隐患）**

当没有显式 `targetTrackId` 时（例如批量导入：`VideoEditingInterface.tsx:2122-2129` 注释「不指定 targetTrackId，让 handleMaterialDrop 根据类型自动选择轨道」），各处都用 `.find()` / `compatible[0]` 命中**第一条**音频轨：

- `src/components/video/timeline/TimelinePanel.tsx:457`（`handleMaterialDrop` 自动选轨）：`if (material.type === 'audio') return t.type === 'audio';` + `state.tracks.find(...)` → 第一条音频轨；
- `src/components/video/timeline/TimelinePanel.tsx:511-518`（`handleAddMaterialsToTimeline` 自动选轨）：同上；
- `src/components/video/timeline/domain/services/TrackSelectionService.ts:54-56`：`const compatible = getCompatibleTracks(tracks, 'audio'); return compatible[0]`（取首个）；其 `getCompatibleTracks`（`TrackSelectionService.ts:92-93`）按数组顺序返回**全部**音频轨，但调用方只取 `[0]`；
- `src/lib/video-editing-agent/tools/index.ts:59-67` `getDefaultTrackForType`：`timelineState.tracks.find(t => t.type === trackType && !t.isLocked)` → 第一条音频轨（AI Agent 加素材路径）。

> **结论（Bug #2）**：用户实际命中的是 (a) —— `VideoEditingInterface.tsx:1223` 把所有 audio 类型素材硬编码进 `audio-track-1`。(b) 是同源的「取第一条音频轨」默认策略，影响批量导入 / Agent 等无显式目标轨的路径。两者共同导致「新音频默认进轨道 1」。

---

### 3.3 「多音频叠加导出」并非独立 Bug：导出链路已支持多轨混音

- 前端导出收集**全部**可见、未锁音频轨的音频项：`src/components/video/hooks/useVideoExport.ts`（遍历 `timelineState.tracks` 中 `track.type === 'audio' && track.isVisible && !track.isLocked` 的每个 `item`，push 进 `audioItems`，并做数量硬校验）；`audio_items` 整体进入 `compositionRequest` 发往后端。`CompositionAdapter.extractAudioSequences` 亦把所有音频轨的项全部导出。
- 后端模型支持多音频项：`backend-services/basic-service/app/models/video_models.py` 中 `VideoCompositionRequest.audio_items: List[AudioCompositionItem]`。
- 后端混音：`backend-services/basic-service/app/services/video_composition_service.py` 的 `_process_audio_tracks()` 对 2 条及以上音频源逐个预处理（音量/裁剪），再交由 `app/services/composition/audio_mix.py:build_audio_mix()`（`audio_mix.py:60-95`）构造 FFmpeg 滤镜：每路 `adelay` 到各自 `start_time`、`apad` 到总时长，最后 `amix=inputs=N:duration=longest:...` 真正**叠加**所有音频；视频内嵌音频亦被抽出并并入混音。

> **结论**：导出/混音管线无需改动。当前「叠加导出失效」的现象，是 Bug #1（无法跨轨）+ Bug #2（新音频都进轨道 1）导致用户根本无法把多条音频分散到多条轨道；修复 #1、#2 后即可正常叠加导出。

---

### 3.4 关键约束：`autoOrganize` 决定「同轨顺序、跨轨叠加」

`addItemAction`（`src/components/video/timeline/store/actions/addItem.ts:41`）与拖拽提交（`dragSlice.ts:163,178`）在每次结构性改动后都会调用 `autoOrganize()`。其实现 `TimelineAggregate.organizeVideoAudioTracks()`（`TimelineAggregate.ts:233-253`）**逐轨独立**地把每条 video/audio 轨的片段按 `startTime` 排序后从 0 开始首尾相接打包（`cursor += item.duration`）。

由此推出两条重要事实：
1. `organizeVideoAudioTracks` **不会跨轨搬运片段**，因此「修好后」的跨轨移动结果能被保留（不会被 autoOrganize 撤销）；
2. 同一条音频轨上的多个片段会被**顺序排布（不叠加）**；只有放在**不同**音频轨上的片段才会因各自从 0 打包而**同时起播（叠加）**。
   —— 这正是「叠加必须分轨」的机制来源，也解释了为什么 #1/#2 不修就看不到叠加。

> 实现侧需注意的已知局限（供 #1/#2 修复节点参考）：因 autoOrganize 会把每轨片段重排到从 0 紧贴，用户**在某条音频轨上指定的自定义起始偏移不会被保留**；默认仅有 2 条音频轨，若需要叠加 3 条及以上音频，还需要新增音频轨的能力。这两点超出本次两个 Bug 的范围，仅作提示。

---

## 四、影响面（Impact surface）

| 受影响功能 | 说明 |
|---|---|
| 时间轴音频片段跨轨移动（Bug #1） | 所有用户都无法把已在时间轴上的音频片段在音频轨之间转移；间接导致无法手动构造「多音频叠加」。 |
| 素材库搜索音频 → 添加到时间轴（Bug #2） | 单素材「添加到时间轴」按钮添加的音频恒进 `audio-track-1`；若轨道 1 已有音频（如解说/视频内嵌音频抽离物），新音频会与之**顺序排布而非叠加**，与用户预期相悖。 |
| 批量导入 / AI Agent 加音频（Bug #2 次路径） | 无显式目标轨时，自动选轨同样恒选第一条音频轨。 |
| 多音频叠加导出 | 导出管线本身正常；但因 #1/#2，用户实际难以产生多轨音频，故主观上「导出没有叠加」。修复 #1/#2 后恢复。 |
| 不受影响 | 后端 FFmpeg `amix` 混音、导出收集逻辑、领域聚合 `moveItem`（已支持跨轨）、视频/字幕轨拖拽。 |

---

## 五、候选修复方案（Candidate fixes）

### Bug #1（启用音频片段跨轨拖拽）

| 方案 | 思路 | 侵入性 | 风险 | 工作量 |
|---|---|---|---|---|
| **A. 指针拖拽全链路打通目标轨（推荐）** | UI 用 `clientY` 对轨道做命中测试（`elementFromPoint` + 轨道 `data-track-id`，或各轨 bounding rect），把 `targetTrackId` 注入 dragMachine 上下文/预览 → 扩展 store `moveItem(itemId, startTime, isPreview, targetTrackId?)` → 提交时若目标轨不同且类型兼容则调 `aggregate.moveItem(id, time, targetTrackId)`，否则同轨移动；跨轨时禁用 swap 分支。 | 中-高（dragMachine、dragSlice、timelineSlice、TimelinePanel 指针处理） | 中（需正确处理 swap/autoOrganize/类型兼容；领域层已就绪降低了底层风险） | 中-高 |
| **B. 复用 HTML5 DnD 的「投放到轨道」** | 让片段可用 HTML5 拖放，复用 `Track` 已有的 drop-target（`dropMaterial(trackId,...)` 已按 drop 轨道工作），新增 `moveItemToTrack(itemId, trackId)` 走 `aggregate.moveItem`。 | 中 | 中（与指针拖拽双系统并存，易冲突、UX 不一致） | 中 |
| **C. 竖直阈值「跨轨步进」** | 在 dragSlice 提交时用累计 `deltaY` 结合轨道高度/`order` 推算目标轨。 | 中 | 中-高（无真实命中测试，越界/高度变化下脆弱） | 中 |

### Bug #2（搜索音频默认进音频轨道二）

| 方案 | 思路 | 侵入性 | 风险 | 工作量 |
|---|---|---|---|---|
| **A. 最小定向改动（推荐）** | 将 `VideoEditingInterface.tsx:1223` 的 `'audio-track-1'` 改为 `'audio-track-2'`。直击用户实际流程（单素材「添加到时间轴」按钮）。默认初始化保证 `audio-track-2` 存在；若缺失，`handleMaterialDrop` 会回退到首个兼容音频轨。 | 极低（1 行） | 低 | 极低 |
| **B. 全路径一致默认到轨道二** | 在 A 基础上，把自动选轨回退（`TimelinePanel.tsx:457/514`、必要时 `tools/index.ts:getDefaultTrackForType`）也改为优先「第二条音频轨」，例如引入常量 `DEFAULT_AUDIO_MATERIAL_TRACK='audio-track-2'`。**不要**直接改 `TrackSelectionService`（它还被 `detachAudio/resolveAudioTrack` 复用，全局改会回归）。 | 低-中（2-3 处调用方） | 低-中（须避开 detachAudio 复用点） | 低-中 |

---

## 六、推荐方案（Recommended fix）与理由

### Bug #1 → 方案 A（指针拖拽全链路打通 `targetTrackId`）
理由：领域聚合 `moveItem(id, time, targetTrackId)` 与 `Track.addItem` 的类型兼容校验**均已就绪**，缺口集中在拖拽/状态/ UI 三层未传递目标轨道，方案 A 是「补齐缺失维度」的正本清源做法，UX 与现有指针拖拽一致。落地要点：
1. UI 层（`TimelinePanel` 指针移动 / `Track`）用 `clientY` 命中目标轨道（建议给 `Track` 容器加 `data-track-id`，用 `document.elementFromPoint(clientX, clientY)` 解析）；
2. 把 `targetTrackId` 注入 `dragMachine` 上下文与 `getDragPreview()` 输出；
3. 扩展 store `moveItem` 签名与实现，把 `targetTrackId` 透传给 `aggregate.moveItem`；
4. 提交分支（`dragSlice.ts:149-168`）：当目标轨 ≠ 源轨且目标轨 `canAcceptMaterial` 兼容时执行跨轨移动，并**跳过 swap 分支**；类型不兼容则维持同轨移动（与 `moveItem.typeCompat.test.ts` 既有行为一致）；
5. 依赖既有 `autoOrganize` 把目标轨重排打包（§3.4 已证明其不跨轨搬运，结果可保留），从而实现「分轨即叠加」。

### Bug #2 → 方案 A（必要时叠加 B 做一致性收尾）
理由：用户报告的精确流程命中 `VideoEditingInterface.tsx:1223` 的硬编码，改 1 行 `'audio-track-1' → 'audio-track-2'` 即可精准修复，风险最低，且默认初始化（§3.0）保证目标轨存在。若要让「批量导入 / Agent / 拖放自动选轨」等无显式目标轨的路径同样默认到轨道二，可补做方案 B（仅改调用方默认值，避免触碰被 `detachAudio` 复用的 `TrackSelectionService`）。

### 关于「多音频叠加导出」
无需改导出/后端混音代码（§3.3 已验证 `amix` 多轨混音可用）。修复 Bug #1、#2 后，用户可将多条音频分散到多条音频轨，autoOrganize 使其各自从 0 起播叠加，导出 `amix` 即可正常叠加多路音频。实现节点请注意 §3.4 的两条已知局限（同轨多片段为顺序非叠加；默认仅 2 条音频轨）。

---

## 七、关键证据索引（file:line）

- 默认轨道结构：`src/components/video/timeline/TimelinePanel.tsx:213-219`
- 领域聚合支持跨轨移动：`src/components/video/timeline/domain/aggregates/TimelineAggregate.ts:167-198`
- 跨轨移动测试：`src/components/video/timeline/__tests__/moveItem.typeCompat.test.ts:51,75`
- store 丢弃 targetTrackId：`src/components/video/timeline/store/slices/timelineSlice.ts:55,231-243`
- 拖拽提交/预览只传时间：`src/components/video/timeline/store/slices/dragSlice.ts:162,236`（swap 分支 153-156）
- 状态机无目标轨：`src/components/video/timeline/domain/machines/dragMachine.ts:61-63,305-316,587-603`
- 同轨交换检测：`src/components/video/timeline/domain/services/DragCalculationService.ts:findSwapTarget`
- Bug #2 主因（硬编码 audio-track-1）：`src/components/video/VideoEditingInterface.tsx:1213-1238`（第 1223 行）
- 触发按钮：`src/components/video/components/MaterialsPanel/MaterialsPanel.tsx:2259-2265`
- 自动选轨「取第一条音频轨」：`src/components/video/timeline/TimelinePanel.tsx:457,511-518`；`src/components/video/timeline/domain/services/TrackSelectionService.ts:54-56,92-93`；`src/lib/video-editing-agent/tools/index.ts:59-67`
- autoOrganize（同轨顺序、跨轨叠加）：`src/components/video/timeline/domain/aggregates/TimelineAggregate.ts:233-253`；`src/components/video/timeline/store/actions/addItem.ts:41`
- 导出收集全部音频：`src/components/video/hooks/useVideoExport.ts`；`src/components/video/timeline/infrastructure/CompositionAdapter.ts:extractAudioSequences`
- 后端多轨混音：`backend-services/basic-service/app/services/composition/audio_mix.py:60-95`；`backend-services/basic-service/app/services/video_composition_service.py:_process_audio_tracks`；`backend-services/basic-service/app/models/video_models.py:VideoCompositionRequest.audio_items`

---

## 八、评审补充证据（Reviewer-added evidence，子任务 #1）

> 本节由「分析报告评审」节点补充。下列引用均已逐行复核源码，用于补齐 §三/§五 中略过的实现细节，并支撑 §九「评审结论」。

### 8.1 §三全部 file:line 证据复核结论：属实

逐条复核（行号以当前分支 `feat/remove-user-system` 为准）：

- `TimelinePanel.tsx:213-219` 默认 5 轨（`audio-track-1` order=2 在 `audio-track-2` order=3 之前）——**属实**。
- `TimelineAggregate.ts:167-198` `moveItem(itemId, newStartTime, targetTrackId?)` 跨轨分支——**属实**。
- `timelineSlice.ts:55` 接口签名无 `targetTrackId`、`timelineSlice.ts:231-243` 实现仅 `aggregate.moveItem(itemId, TimePosition.create(newStartTime))`（不传第三参）——**属实**。
- `dragSlice.ts:236` 预览 move、`dragSlice.ts:162` 提交 move、`dragSlice.ts:153-156` swap 分支、`dragSlice.ts:150` 提交前回滚（仅传 `originalStartTime`，**不传源轨**）——**属实**。
- `dragMachine.ts:59-74` `DragContext.trackId` 仅存起始轨、`dragMachine.ts:305-316` `calculateMovePreview` 仅用 `e.deltaX` 且 `currentDelta:{x,y:0}`、`dragMachine.ts:587-603` `getDragPreview()` 返回 `{itemId,startTime,duration}` 不含目标轨——**属实**。
- `VideoEditingInterface.tsx:1223` `case 'audio': targetTrackId = 'audio-track-1'`——**属实**（Bug #2 主因）。
- `TimelinePanel.tsx:452-460` `trackExists` 为真时直接采用显式轨；为假时 `.find()` 取首条音频轨（457）——**属实**。
- `TrackSelectionService.ts:54-56`（`compatible[0]`）、`92-93`（`case 'audio': return type==='audio'`）——**属实**。
- `tools/index.ts:59-67` `getDefaultTrackForType` `.find(t=>t.type===trackType && !t.isLocked)` 取首条——**属实**。
- `DragCalculationService.ts:280-319` `findSwapTarget` 仅在 `hostTrack.items` 内扫描（跨轨不参与）——**属实**。
- 后端 `audio_mix.py:60-95` 每路 `adelay`+`apad`，`amix=inputs=N:duration=longest:...normalize=0` 真正叠加——**属实**。
- `useVideoExport.ts:191` 采集 `track.type==='audio' && track.isVisible && !track.isLocked` 全部音频项，`:477` 数量硬校验，`:613` `audio_items: audioItems` 发往后端——**属实**。

> 评审判定：§三根因证据链与观察症状一致，无证据被反例推翻。导出/混音确为已就绪、非独立 Bug（§3.3 成立）。

### 8.2 补强证据 A：`data-track-id` 已存在，§六 Fig.A 第 1 步可直接落地（无需新增属性）

§六 Bug #1 方案 A 第 1 点写「**建议给** `Track` 容器**加** `data-track-id`」。复核发现该属性**已经存在**：

`src/components/video/timeline/Track.tsx:304-307`：

```tsx
<div
  className="track flex border-b border-border last:border-b-0"
  data-track-id={track.id}
  style={{ minWidth: '100%' }}
>
```

> 修订：UI 命中测试可直接 `document.elementFromPoint(clientX, clientY)?.closest('[data-track-id]')?.getAttribute('data-track-id')` 取目标轨，**无需新增 DOM 属性**，进一步降低方案 A 的工作量与风险。`clientY` 也确实已在 `TimelinePanel.tsx:325/334` 透传进 `POINTER_MOVE`，只是状态机从未消费——命中逻辑只缺「消费端」。

### 8.3 补强证据 B：`TimelineAggregate.moveItem` 跨轨非原子——存在「片段丢失」数据风险（方案 A 必须防护）

`TimelineAggregate.moveItem`（`TimelineAggregate.ts:181-187`）跨轨分支按「**先从源轨移除、后加入目标轨**」顺序执行，且 `Track.addItem`（`src/components/video/timeline/domain/entities/Track.ts:170-181`）在**锁定**或**类型不兼容**时会抛异常：

```ts
// TimelineAggregate.ts:181-187
const targetTrack = this.findTrackOrThrow(targetTrackId); // 目标不存在→此处先抛，安全
sourceTrack.removeItem(itemId);   // ← 已从源轨移除
item.moveTo(newStartTime);
targetTrack.addItem(item);        // ← 若目标轨锁定/类型不兼容，这里抛异常

// Track.ts:170-181
addItem(item: TimelineItem): void {
  this.assertNotLocked('addItem');                 // 锁定→抛 TrackLockedError
  const materialType = item.originalMaterialType ?? item.type;
  if (!this.canAcceptMaterial(materialType)) {     // 不兼容→抛 Error
    throw new Error(`Track "${this.id}" ... cannot accept material ...`);
  }
  ...
}
```

由于 `store.moveItem`（`timelineSlice.ts:235-240`）对 `aggregate.moveItem` 的异常只是 `catch + console.error + return`，一旦 `addItem` 抛出，**该片段已被移出源轨却未进入目标轨——片段从时间轴上凭空消失**（聚合进入不一致状态）。

> 评审判定（对方案 A 的硬性约束）：跨轨移动**必须在调用 `aggregate.moveItem(id, time, targetTrackId)` 之前**于提交层（`dragSlice` commit 分支）用 `targetTrack.canAcceptMaterial(...)` + 未锁校验做前置守卫，不兼容/锁定则**回退为同轨移动**（与 `moveItem.typeCompat.test.ts` 既有「拒绝即留在原轨」语义一致）。建议（防御性、可选）同时把 `TimelineAggregate.moveItem` 改为「先校验目标可接收、再 removeItem」的原子顺序，作为兜底。音频→音频虽恒兼容，但该守卫是防止「误拖到 video/字幕/锁定轨」丢片段的关键。

### 8.4 补强证据 C：方案 B「勿改 `TrackSelectionService`」的复用点不止 `detachAudio`

§五 Bug #2 方案 B 警告「不要直接改 `TrackSelectionService`（还被 `detachAudio/resolveAudioTrack` 复用）」。复核确认该警告成立，且**复用点有两处**（影响面比报告所述更大）：

- `TimelineAggregate.resolveAudioTrack()`（`TimelineAggregate.ts:656-657`）→ 由 `detachAudio()`（`TimelineAggregate.ts:352`）调用：`TrackSelectionService.selectTrackForMaterial(this._tracks, 'audio')`。改它会让「音画分离」抽出的音频默认落点一起改变。
- `timelineSlice.addItemToTrack()`（`timelineSlice.ts:170-179`）：`TrackSelectionService.selectTrackForMaterial(aggregate.tracks, material.type, trackId)`——这是 `addItemAction` 落轨的统一出口（显式 `trackId` 命中时返回该轨，见 `TrackSelectionService.ts:44-49`）。全局改默认会波及所有 add 路径。

> 评审判定：方案 B 若实施，**只能改调用方默认值**（在 `VideoEditingInterface` / `TimelinePanel` 自动选轨处引入 `DEFAULT_AUDIO_MATERIAL_TRACK='audio-track-2'`），**严禁**修改 `TrackSelectionService.getCompatibleTracks/selectTrackForMaterial` 本身，否则回归 `detachAudio` 与全部 `addItemToTrack` 路径。

---

## 九、评审结论（Review Verdict，子任务 #1）

### 9.1 证据链裁定

§三根因证据**全部复核属实**，与用户观察到的症状一致，未发现反例或更优的替代解释：

- Bug #1 = 指针拖拽链路（`dragMachine → dragSlice → timelineSlice`）缺失「目标轨道」维度，领域聚合 `moveItem(targetTrackId)` 虽支持跨轨却永不被触发——证据闭合。
- Bug #2 = `VideoEditingInterface.tsx:1223` 把 audio 硬编码进 `audio-track-1`（用户精确流程命中），叠加各处「取首条音频轨」默认策略——证据闭合。
- 「多音频叠加导出」非独立 Bug：前端采集全部音频轨 + 后端 `amix` 多路混音均已就绪（§3.3、§8.1），系 #1/#2 的下游表现——证据闭合。

### 9.2 最终推荐修复（单一方案）

**Bug #1 → 采纳方案 A（指针拖拽全链路打通 `targetTrackId`），并强制满足以下 4 项边界约束：**

1. **目标轨命中（UI 层）**：用 `document.elementFromPoint(clientX, clientY)?.closest('[data-track-id]')` 解析目标轨；`data-track-id` 已存在（§8.2，`Track.tsx:306`），`clientY` 已透传（`TimelinePanel.tsx:325/334`），仅需新增「消费端」并把 `targetTrackId` 注入 `dragMachine` 上下文与 `getDragPreview()` 输出。
2. **预览不搬轨、提交才搬轨**：`updateDrag` 预览帧（`dragSlice.ts:236`，每次 `pointermove` 触发）**禁止**做真实跨轨 `removeItem/addItem`——否则会逐帧搬运并与「提交前仅按时间回滚（`dragSlice.ts:150` 不还原源轨）」相互作用导致状态错乱。预览阶段片段保持在源轨（可用高亮/指示目标轨给视觉反馈），**仅在 commit 分支**（`dragSlice.ts:157-168`）执行一次 `aggregate.moveItem(id, time, targetTrackId)`。
3. **跨轨时禁用 swap 分支**：当 `targetTrackId !== 源轨` 时，commit 必须走跨轨移动并**跳过** `swapTargetId` 分支（`dragSlice.ts:153-156`）；因 `findSwapTarget` 只扫描源轨（§3.1f、§8.1），跨轨拖动中残留的 `swapTargetItemId` 不得劫持提交。
4. **类型/锁定前置守卫（防数据丢失）**：调用 `aggregate.moveItem(...,targetTrackId)` 前，于提交层用 `targetTrack.canAcceptMaterial(...)` + 未锁校验把关；不兼容/锁定则**回退为同轨移动**。理由见 §8.3：`aggregate.moveItem` 跨轨为「先删后加」非原子，目标轨 `addItem` 抛异常会使片段从源轨消失。音频↔音频恒兼容，但该守卫防止误拖到 video/字幕/锁定轨丢片段。（可选兜底：将 `TimelineAggregate.moveItem` 改为「先校验目标可接收、再 removeItem」原子顺序。）

> 不采纳方案 B（HTML5 DnD 双系统并存，UX 不一致、易与指针拖拽冲突）与方案 C（`deltaY` 阈值步进，无真实命中测试、脆弱）。方案 A 是「补齐缺失维度」的正本清源做法，领域层已就绪，叠加上述守卫后风险可控。

**Bug #2 → 采纳方案 A（最小定向改动，单行）：**

将 `src/components/video/VideoEditingInterface.tsx:1223` 的 `'audio-track-1'` 改为 `'audio-track-2'`。

- 这是用户精确流程（素材卡片「添加到时间轴」按钮）的唯一命中点，1 行即精准修复，风险最低。
- 默认初始化（§3.0）保证 `audio-track-2` 存在；若该轨被删，`handleMaterialDrop` 的 `trackExists=false` 分支会优雅回退到首条兼容音频轨（`TimelinePanel.tsx:452-460`），不会报错或丢素材。
- **方案 B 列为可选收尾**：仅当需要让「批量导入 / AI Agent / 拖放自动选轨」等无显式目标轨路径也默认轨道二时再做，且**只改调用方默认值，严禁触碰 `TrackSelectionService`**（复用点见 §8.4：`detachAudio` 的 `resolveAudioTrack` 与 `timelineSlice.addItemToTrack`）。本次用户报告未涉及这些路径，**不作为必做项**。

**导出/后端混音 → 不改动。** §3.3、§8.1 已验证多轨 `amix` 混音与前端音频采集均就绪；修复 #1/#2 后用户即可分轨获得叠加导出。实现节点请知悉 §3.4 两条已知局限（同轨多片段为顺序非叠加；默认仅 2 条音频轨，叠加 3 路需「新增音频轨」能力），二者**超出本次两个 Bug 范围**，不在本次修复内。

### 9.3 给下一节点（代码修复）的最小改动清单

| Bug | 必改文件 | 改动要点 |
|---|---|---|
| #1 | `TimelinePanel.tsx`（指针处理）/ `Track.tsx`（已具 `data-track-id`，多半无需改） | 用 `clientY` 命中目标轨，注入 `POINTER_MOVE` 已带的 `clientY` 消费逻辑 |
| #1 | `domain/machines/dragMachine.ts` | `DragContext` 增 `targetTrackId`；`getDragPreview()` 输出含目标轨 |
| #1 | `store/slices/timelineSlice.ts` | `moveItem` 签名/实现增 `targetTrackId?`，透传给 `aggregate.moveItem` |
| #1 | `store/slices/dragSlice.ts` | commit 分支：目标轨≠源轨且兼容未锁→跨轨移动并跳过 swap；预览不搬轨 |
| #1（可选兜底） | `domain/aggregates/TimelineAggregate.ts` | `moveItem` 跨轨改「先校验目标可接收、再 removeItem」原子顺序 |
| #2 | `VideoEditingInterface.tsx:1223` | `'audio-track-1'` → `'audio-track-2'`（单行） |

> Definition of Done 复核：§三证据链经复核闭合并补全（§8）；本节给出**单一**推荐方案（Bug #1=A+4 约束，Bug #2=A 单行，导出不改），理由与边界条件明确。
