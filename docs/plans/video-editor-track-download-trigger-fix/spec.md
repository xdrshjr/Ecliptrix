# 视频编辑器素材自动下载 / 轨道进度 / 播放门控修复方案（spec v2）

> Feature slug: `video-editor-track-download-trigger-fix`
> 关联前序方案：`docs/plans/video-editor-client-preview-download/spec.md`（第 2 轮）、`docs/plans/video-editor-track-download-progress/spec.md`（第 3 轮）。
> 本轮目标（第 4 轮）：修复「素材拖到视频轨道后**没有自动触发下载**、轨道片段上**看不到下载进度**、点击播放显示 **0/11 ready**」的缺陷。**本节点只产出设计文档，不写实现代码。**
> 评审版本：**v2**（资深评审已逐条核对当前仓库代码并直接修复全部 P0/P1；改动见下方「评审记录」与正文标注的「更正 Rn」）。

---

## 评审记录（Review Notes，v2）

> 评审人：Anthropic 工程团队资深评审。评审基线：当前仓库源码（已逐条核对行号与数据流）。下表按严重级别排序；**所有 P0 / P1 已在本版（v2）正文中直接修复**，P2 作为落地条件列入文末「评审结论」。

| # | 维度 | 级别 | 结论与证据 | 处置 |
|---|---|---|---|---|
| R1 | 一致性 / 正确性 | **P1** | 根因归因有误。原文称 `useVideoEditingStore.timelineState` 由 Agent 路径（`OperationApplier`/`useAgentExecution`）写入。实测：`useAgentExecution` 的 `setTimelineState` 形参在 `VideoEditingInterface.tsx:2388` 被接到**本地** `setCurrentTimelineState`；`OperationApplier.config.setTimelineState`（`OperationApplier.ts:126/548`）经同一形参最终也只写本地 state。全仓库**无任何** `getState().setTimelineState` 调用，store 的 `timelineState` 仅在 `videoEditingStore.ts:86` 被 reset 为 `null`。即该 slice **从不被写入非空值**——manual 与 AI Agent 两条编辑路径的下载触发**同样**失效（原文误以为仅 manual 失效、Agent 已写 store）。 | 已据此改写 §1 / §2 / §3.2 / §3.3 / §8，并简化死循环论证。 |
| R2 | 可行性 / 正确性 | **P1** | 文件指代有歧义、易误改。仓库存在**两个** `timelineSlice.ts`：本修复目标是 `src/stores/slices/timelineSlice.ts`（`useVideoEditingStore` 所属），而 `src/components/video/timeline/store/slices/timelineSlice.ts` 属于**另一个** `useTimelineStore`（TimelinePanel 内部源）。二者同名，混改即重新制造不一致。另：`VideoPlayerPanel` 实际路径为 `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx`（行号 658-694 对应此文件）。 | 已在 §3.2 / §4 / §5 用全路径消歧并加「禁止误改 useTimelineStore 同名 slice」提示。 |
| R3 | 完整性 | P2 | 「唯一消费方」表述略宽。除 `useMaterialManagement.ts:1159` 外，`src/stores/index.ts:99-105` 还导出一个 `useTimeline()` 选择器读取 `timelineState`/`externalUpdateId`，但**全仓库当前无人调用**，故「影响面极小」的结论成立；mirror 后若将来启用 `useTimeline()`，它将一并反映手动剪辑（有益无害）。`useVideoExport` 读的是 **prop** 而非 store（`useVideoExport.ts:18/103`），不受影响。 | 已在 §1 / §2 补注，结论不变。 |
| R4 | 一致性 | P2 | C2 机制描述不准。id 集合在 `useMaterialManagement` 按**时间轴 `item.type`** 派生，故「图片落在视频轨」(`item.type==='video'`) 的 materialId **会进入** `timelineVideoMaterialIds`/`timelineMediaMaterialIds`；C2 实由**消费端按 `material.type` 二次过滤**兜住——`useLocalMaterialDownload.ts:388`、`useRemoteMaterialPrefetch.ts:108/247`、门控 `VideoPlayerPanel.tsx:674`。结论（图片不下载、不门控）正确，但「图片不进下载集合」措辞应改。 | 已在 §6 / §7.1#4 改为「消费端按 material.type 排除」。 |
| R5 | 完整性 / 灰度 | P2 | 缺「特性关闭时为 no-op」的显式声明。mirror 无条件写 store，但下载 hook 有 `enabled` 守卫、门控在 `!localPreviewEnabled` 时直接返回 `allReady:true`（`VideoPlayerPanel.tsx:659`），故 `isLocalPreviewEnabled()` 关闭时本修复零行为变化。 | 已在 §8 增补风险/缓解行。 |

---

## 1. Overview（概述）

第 2 ~ 3 轮已经把「下载优先、本地 blob 预览」的整套机制建好了：当素材出现在时间轴上时，`useLocalMaterialDownload` 应当抓取其同源低码率文件为 `Blob`，把 `localProxyStatus / localProxyProgress` 回写到 `MaterialItem`；`TimelineItem` 用这些字段在片段横条上渲染下载进度遮罩；`VideoPlayerPanel` 的就绪门控（mediaReadiness）在所有时间轴视频/音频素材 `ready`（或终态 `degraded`）之前阻止播放，并在点击播放时弹 toast 提示「已就绪 N/M」。机制本身是对的，单元测试也全绿，但**在真实手动剪辑路径下整条链路从未被触发**。

根因是一处**时间轴数据源不一致（two-sources-of-truth）**的接线缺陷。手动把素材拖到轨道时，时间轴的真实状态只写进两个地方：(a) `TimelinePanel` 内部的 `useTimelineStore`，(b) `VideoEditingInterface` 的本地 React state `currentTimelineState`（经 `onTimelineStateChange` 回调）。它**从不**调用 `useVideoEditingStore().setTimelineState`。**更正（v2，R1）**：该 zustand slice 实际上**从不被写入非空值**——`useAgentExecution` 的 `setTimelineState` 形参在 `VideoEditingInterface.tsx:2388` 被接到本地 `setCurrentTimelineState`，故 `OperationApplier.ts:126/548` 经此也只写本地 state；全仓库无 `getState().setTimelineState` 调用，store 的 `timelineState` 仅在 `videoEditingStore.ts:86` 被 reset 为 `null`。换言之，**manual 与 AI Agent 两条编辑路径都没有写这个 slice**，下载触发对二者同样失效（原文误以为 Agent 路径已写 store、仅 manual 失效）。然而，承载自动下载与 480p 预取触发的 `useMaterialManagement` hook，恰恰**只**从 `useVideoEditingStore(state => state.timelineState)` 读取「时间轴引用的素材 id 集合」。于是该 store slice 始终为 `null`，两个 id 集合（`timelineVideoMaterialIds`、`timelineMediaMaterialIds`）恒为空 → 下载 hook 与预取 hook 都拿不到任何 id → 既不发起 480p 转码、也不发起整文件下载、更不会回写 `localProxyStatus` → 轨道遮罩无任何状态可渲染（`localProxyStatusMap` 为空）。该 slice 当前唯一的运行期读者就是此 hook（`useTimeline()` 选择器虽也读它，但全仓库未被调用；`useVideoExport` 读的是 prop 而非 store），故修复影响面极小。

与此同时，`VideoPlayerPanel` 的就绪门控读取的是**本地** `timelineState` prop（即 `currentTimelineState`，含真实的 11 个片段），它通过 `item.materialId` 回查 `materials` 统计出 `total = 11`，而没有任何素材是 `ready`，于是显示「0/11 ready」。三个症状由同一个根因解释，互相印证。本方案的目标就是**统一 `useMaterialManagement` 消费的时间轴数据源**，使其与门控所读的实时时间轴一致，从而让既有的下载 / 进度 / 门控机制按设计运转，无需改动其内部逻辑与已通过的测试。

---

## 2. Root-cause analysis（根因定位，含代码证据）

| 环节 | 文件:行 | 现状 | 后果 |
|---|---|---|---|
| 手动编辑回调 | `VideoEditingInterface.tsx:1538-1542` | `handleTimelineStateChange` 只 `setCurrentTimelineState(timelineState)`，注释明写「只更新本地状态」 | 真实时间轴只进本地 state，不进共享 store |
| 时间轴内部源 | `TimelinePanel.tsx:238/272` | 经 `onTimelineStateChange` 回调外抛 `ts`；内部用 `useTimelineStore`（**另一个** store） | 与 `useVideoEditingStore` 完全无关 |
| 共享 store 写入方（更正 R1） | `useAgentExecution.ts:238-239,423` → `VideoEditingInterface.tsx:2388`（`setTimelineState=setCurrentTimelineState`）；`OperationApplier.ts:126/548` 经同一形参 | 这些 `setTimelineState` 写的是**本地** `currentTimelineState`，**不是** `useVideoEditingStore` slice；全仓库无 `getState().setTimelineState`，slice 仅在 `videoEditingStore.ts:86` reset 为 `null` | store slice 在 manual 与 agent 路径下**都**永不更新 |
| 下载 hook 的输入源 | `useMaterialManagement.ts:1159` | `const timelineState = useVideoEditingStore(state => state.timelineState)` | manual 与 agent 路径下**都**读到 `null` |
| 预取 id（480p 触发） | `useMaterialManagement.ts:1160-1170` | `timelineVideoMaterialIds` 由上面的 store `timelineState` 派生 | 恒为空 → 不发起 480p 转码 |
| 下载 id（整文件） | `useMaterialManagement.ts:1184-1194` | `timelineMediaMaterialIds` 由同一 store `timelineState` 派生 | 恒为空 → `useLocalMaterialDownload` 不下载 |
| 门控统计 | `VideoPlayerPanel.tsx:658-694` | `mediaReadiness` 走 `timelineState` **prop**（= `currentTimelineState`，真实 11 项） | 统计出 11，全部非 ready → 「0/11 ready」 |
| 轨道遮罩源 | `TimelinePanel.tsx:96-105` | `localProxyStatusMap` 仅收录 `localProxyStatus/Progress` 已定义的素材 | 无下载发生 → map 为空 → 片段无进度遮罩 |

**关键不对称**：门控（`VideoPlayerPanel`，路径 `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:658-694`）读 `currentTimelineState` **prop**（实时、11 项），下载/预取 hook 读 `useVideoEditingStore.timelineState` **slice**（恒为空）。该 store slice 当前**唯一的运行期消费方**就是 `useMaterialManagement.ts:1159`（另有 `src/stores/index.ts:99-105` 的 `useTimeline()` 选择器读它，但全仓库未被调用，R3），而**没有任何路径**把它写成非空值（仅 `videoEditingStore.ts:86` reset 为 `null`，R1），所以修复的影响面极小且可控。注意：`MaterialItem.id` 在 `materials` 中存在、`item.materialId` 也已正确设置（否则门控统计不出 11），因此**不是 materialId 缺失**，纯粹是「id 集合来源选错了 store」。

---

## 3. Technical design（技术设计）

### 3.1 设计原则
- **单一时间轴源**：让 `useMaterialManagement` 派生「时间轴引用素材 id」的来源，与门控/遮罩所依赖的实时时间轴**同源**。
- **零改动既有机制**：不改 `useLocalMaterialDownload` / `useRemoteMaterialPrefetch` / 门控 / 遮罩 的内部逻辑（它们都已通过测试），只修正喂给它们的数据。
- **同时修复两个触发器**：必须让 `timelineVideoMaterialIds`（480p 预取）和 `timelineMediaMaterialIds`（整文件下载）都改用实时源。**只改下载 hook 不够**——视频素材的下载在 `useLocalMaterialDownload.ts:405` 处会等待 `previewProxyStatus === 'cached'`，该状态由预取 hook 产出；若预取仍读空源，视频会卡在 `transcoding` 直到 60s 超时再 `degraded`，下载依然不发生。

### 3.2 推荐方案（Option A — 把实时时间轴镜像进共享 store）

`timelineSlice.ts` 的文档自述目标是「让 React 与非 React 代码共享单一事实源」，而手动编辑从不写它正是这条契约被违反之处。因此最贴合既有架构、改动面最小、且不触碰已测 hook 的修法是：**在 `VideoEditingInterface` 里把 `currentTimelineState` 单向镜像到 `useVideoEditingStore.timelineState`**。

新增一个仅依赖 `currentTimelineState` 的 effect（覆盖手动剪辑、项目导入、Agent 回灌等所有更新 `currentTimelineState` 的路径，无遗漏）：

```ts
// VideoEditingInterface.tsx —— 紧随 currentTimelineState 声明（约 line 131）之后
const setStoreTimelineState = useVideoEditingStore(state => state.setTimelineState);

useEffect(() => {
  // 把手动剪辑产生的实时时间轴镜像进共享 store，使依赖 store.timelineState 的
  // 素材管理 hook（480p 预取 + 本地下载）能看到手动编辑。Agent 路径已自行写
  // store，这里写同值幂等无害。
  setStoreTimelineState(currentTimelineState);
}, [currentTimelineState, setStoreTimelineState]);
```

**死循环安全性论证（v2 据 R1 重写）**：本 effect 经 `useVideoEditingStore` 的 `setTimelineState` 写 `store.timelineState`，该 action 只 `set({ timelineState })`、**不** `triggerUpdate`（`src/stores/slices/timelineSlice.ts:44`）。`store.timelineState` 的读者（`useMaterialManagement`，以及当前未启用的 `useTimeline()`）**都不会反向写 `currentTimelineState`**，因此 `currentTimelineState` →（effect）→ `store.timelineState` 这条边**没有任何回灌路径，结构上即不可能成环**。需澄清两个独立量：驱动 `TimelinePanel` 重新 import 的是 `VideoEditingInterface` 的**本地** `externalTimelineUpdateId` state（`TimelinePanel.tsx:294`，仅由 import 完成与 Agent 的 `onTimelineUpdate` 在 `VideoEditingInterface.tsx:1687/2391` bump），它与 store 的 `externalUpdateId` 是两回事，本 effect 二者皆不触碰。Agent 路径同样安全：Agent 经 `setCurrentTimelineState` 写本地 `currentTimelineState=X` 并 bump 本地 `externalTimelineUpdateId` → 本 effect 顺带把 `store.timelineState=X` 镜像一次（同值、不 triggerUpdate）→ 收敛，仅多一次幂等写。换言之，mirror 让 **manual 与 agent 两条路径都能驱动下载**（修复前两者皆不能，R1）。

### 3.3 备选方案（Option B — 把实时时间轴作为入参穿入 hook）

不依赖 store 写入副作用，改为把实时时间轴显式传给 hook：

- `useMaterialManagement` 签名增加第三参 `liveTimelineState?: TimelineState | null`（`useMaterialManagement.ts:56`）。
- 两处 id 派生改用 `const liveTimeline = liveTimelineState ?? storeTimelineState;` 并遍历 `liveTimeline?.tracks`。**更正（R1）**：原文把 `storeTimelineState`（即原 `useVideoEditingStore(state => state.timelineState)`）说成「Agent 路径回退」是错的——store slice 从不被写入非空值，该回退实为**死分支**；Agent 路径其实也走 `currentTimelineState`（`setTimelineState=setCurrentTimelineState`），故只要传 `liveTimelineState=currentTimelineState` 即可覆盖 manual+agent。`?? storeTimelineState` 仅作纯防御性默认（恒为 `null`），保留或删去均可。
- 调用点 `VideoEditingInterface.tsx:518` 改为 `useMaterialManagement(taskId, content?.materials || [], currentTimelineState)`。

**取舍**：Option B 数据流更显式、不引入 store 副作用，但要改 hook 签名与两处 `useMemo`，diff 略大、需同步改测试桩。Option A 改动最小、hook 与其测试零改动、并顺带兑现了 `timelineSlice` 的既定契约。鉴于该 store slice 的唯一读者就是本 hook、唯一写者是 Agent，**推荐 Option A**；Option B 作为评审若顾虑「store 双写者」时的等价替代。下游实现**二选一**，不可混用。

### 3.4 触发后的数据流（修复后）
1. 用户拖素材到视频/音频轨 → `TimelinePanel` 内部 `useTimelineStore` 变更 → `onTimelineStateChange(ts)` → `handleTimelineStateChange` → `setCurrentTimelineState(ts)`。
2. （Option A）镜像 effect 把 `ts` 写入 `useVideoEditingStore.timelineState`。
3. `useMaterialManagement` 重新派生 `timelineVideoMaterialIds`、`timelineMediaMaterialIds`（非空）。
4. `useRemoteMaterialPrefetch` 对视频素材 POST 480p 转码；`previewProxyStatus` 流转至 `cached`。
5. `useLocalMaterialDownload` 驱动 effect（依赖 `currentRefIds`+`materials`）对每个 id：视频等 `cached` 后下载 480p proxy，音频直接下载同源原文件；`onProgress` 回写 `localProxyStatus:'downloading'` + `localProxyProgress`。
6. `patchMaterialCache` 同步更新 React `materials`（门控/遮罩同源）与 store mirror。
7. `TimelinePanel.localProxyStatusMap` 收录到状态 → `TimelineItem` 渲染「downloading NN%」遮罩。
8. 全部 `ready`/`degraded` → 门控 `allReady=true`；未就绪时点击播放弹「已就绪 N/M」toast。

---

## 4. File / module change plan（文件 / 模块变更清单）

> 推荐 Option A。下游须二选一，下表按 Option A 给出；Option B 的替代行已在「备注」标注。

| 文件 | 变更类型 | 一句话意图 |
|---|---|---|
| `src/components/video/VideoEditingInterface.tsx` | 修改 | 新增 `setStoreTimelineState` 选择器 + 一个镜像 effect，把 `currentTimelineState` 单向写入 `useVideoEditingStore.timelineState`（约 line 131 附近）。**Option B 时**改为给 `useMaterialManagement(...)`（line 518）传第三参 `currentTimelineState`，本文件不加 effect。 |
| `src/components/video/hooks/useMaterialManagement.ts` | **Option A 不改** / **Option B 修改** | Option B：签名加 `liveTimelineState?`（line 56），`timelineVideoMaterialIds`（1160-1170）与 `timelineMediaMaterialIds`（1184-1194）改用 `liveTimelineState ?? storeTimelineState`。 |
| `src/components/video/__tests__/`（新增）`VideoEditingInterface.timelineStoreMirror.test.tsx` 或 `useMaterialManagement.downloadTrigger.test.ts` | 新增 | 回归测试：实时时间轴含视频/音频项时，下载 hook 收到的 id 集合非空、且与门控统计的素材数一致（证明 0/11 不再发生）。 |
| `src/components/video/hooks/__tests__/useLocalMaterialDownload.test.ts` | 可能微调 | 若 Option B 改了 hook 装配，补一例「实时 prop 源驱动下载」断言；Option A 下既有用例应保持全绿。 |
| `docs/plans/video-editor-track-download-trigger-fix/spec.md` | 新增（本文件） | 本轮设计文档。 |

**路径消歧（R2，下游必读）**：唯一允许修改的 store slice 是 `src/stores/slices/timelineSlice.ts`（`useVideoEditingStore`）；**严禁**触碰 `src/components/video/timeline/store/slices/timelineSlice.ts`（`useTimelineStore`，TimelinePanel 内部源，与本修复无关）。`VideoPlayerPanel` 全路径为 `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx`。

**不改动且需保持现状**（仅作回归验证，证明根因唯在数据源）：`useLocalMaterialDownload.ts`（下载状态机）、`TimelineItem.tsx` / `Track.tsx` / `TrackContainer.tsx` / `TimelinePanel.tsx`（遮罩渲染，`localProxyStatusMap` 派生）、`VideoPlayerPanel.tsx`（`mediaReadiness` 门控与 toast）、`resolveSequencePlaybackUrl.ts`、`LocalMediaCache.ts`、`playbackFlags.ts`。

---

## 5. Interface design（接口设计）

本修复**不新增 REST / WebSocket / CLI 接口**，仅涉及前端内部函数契约：

- **Option A**：无签名变更。仅在 `VideoEditingInterface` 内部消费 `useVideoEditingStore` 的已有 action `setTimelineState: (state: TimelineState | null) => void`（**`src/stores/slices/timelineSlice.ts:25`**——切勿误用 `src/components/video/timeline/store/slices/timelineSlice.ts`，那是 TimelinePanel 内部 `useTimelineStore` 的**同名** slice，R2）。
- **Option B**：`useMaterialManagement` 签名由 `(taskId: string, initialMaterials?: MaterialItem[])` 扩展为 `(taskId: string, initialMaterials?: MaterialItem[], liveTimelineState?: TimelineState | null)`；第三参可选、缺省回退到 store，保证其它潜在调用点行为不变。
- 既有内部契约保持不变：`useLocalMaterialDownload(materials, { timelineReferencedMaterialIds, onPatch, onBudgetWarning })`、`patchMaterialCache(id, patch)`、`retryLocalDownload(materialId)`、`isLocalPreviewEnabled()`（默认 ON，本轮**不**改）。

---

## 6. Data model（数据模型）

无数据库 / 迁移变更。涉及的内存形状均已存在：

- `MaterialItem.localProxyStatus?: 'idle'|'transcoding'|'downloading'|'ready'|'error'|'degraded'`、`localProxyUrl?`、`localProxyProgress?`、`localProxyError?`、`localProxyBytes?`（第 2 轮已加于 `src/types/index.ts`）。
- `TimelineItem.type: 'video'|'audio'|'subtitle'`、`TimelineItem.materialId?`（`src/types/index.ts:644`）；`TimelineState.tracks: Track[]`、`Track.items: TimelineItem[]`。
- `useVideoEditingStore.timelineState: TimelineState | null`（`timelineSlice.ts:21`），本轮修复后将额外承载「手动剪辑产生的实时时间轴」。

派生口径（**C2** 实现见下；图片/字幕最终不下载、不门控）：
- `timelineMediaMaterialIds` = 遍历 `tracks[].items[]`，取 `(item.type==='video' || item.type==='audio') && item.materialId` 的 `materialId` 去重集合。
- `timelineVideoMaterialIds` = 同上但仅 `item.type==='video'`（480p 预取专用，口径不变）。
- **C2 落点更正（R4）**：上述集合按**时间轴 `item.type`** 派生，故「图片落在视频轨」(`item.type==='video'`) 的 materialId **会进入**集合；真正排除发生在**消费端按 `material.type` 二次过滤**——`useLocalMaterialDownload.ts:388`（`m.type!=='video' && m.type!=='audio' → return`）、`useRemoteMaterialPrefetch.ts:108/247`、门控 `VideoPlayerPanel.tsx:674`。净效果：图片既不被下载也不阻塞门控。

---

## 7. Testing & acceptance criteria（测试与验收）

### 7.1 单元测试（须先写可复现回归的用例）
1. **触发回归（核心）**：构造一个含 ≥1 个 `type:'video'` 与 ≥1 个 `type:'audio'` 项、且 `materialId` 命中 `materials` 的实时时间轴；断言 `useMaterialManagement` 传给 `useLocalMaterialDownload` 的 `timelineReferencedMaterialIds` 非空且与门控统计的素材集合**逐一相等**（直接锁死「门控 11 而下载 0」的不对称）。
2. **同源一致性**：断言门控（`mediaReadiness.totalCount`）与下载 hook 输入集合大小一致。
3. **Option A 专项**：手动剪辑路径（`handleTimelineStateChange` 被调用）后，`useVideoEditingStore.getState().timelineState` 等于该实时时间轴；并验证镜像 effect 不引发 `triggerUpdate`（`externalUpdateId` 不变）→ 无环。
4. **C2 排除（措辞更正 R4）**：放在视频轨上的图片素材其 `item.type==='video'`，**会进入** id 集合，但断言应落在消费端——`useLocalMaterialDownload`/`useRemoteMaterialPrefetch` 因 `material.type==='image'` 跳过下载/转码，且门控 `mediaReadiness.totalCount` 不计入它。即断言「下载=否、门控=否」，而非「不进集合」。
5. **回归保护**：第 2/3 轮既有用例（`useLocalMaterialDownload.test.ts`、`VideoPlayerPanel.localPreview.test.tsx`、`TimelineItem.localDownload.test.ts`、`resolveSequencePlaybackUrl.test.ts`）全绿。

### 7.2 类型与构建
- `npm run type-check` 通过；`npm run lint` 无新增 error（`no-explicit-any` 仅 warn）。

### 7.3 手动验收（Definition of Done 对齐用户三症状）
- 拖一个视频素材到视频轨 → 片段横条在 1~2s 内出现「转码/下载 NN%」遮罩并推进至就绪；拖音频到音频轨同理（音频无转码、直接下载）。→ **症状 1、2 解决**。
- 全部素材就绪前点击播放 → 弹「已就绪 N/M」toast 且不播放；空格/点轨道的播放路径同样被门控拦截（`seekAndPlayFromTimeline` 守卫仍生效）。
- 全部就绪后计数为 **N/N**（不再 0/N），播放流畅、走本地 blob、与轨道进度条对应。→ **症状 3 解决**。
- `git status` 可见新建的 `docs/plans/video-editor-track-download-trigger-fix/spec.md`。

---

## 8. Risks & mitigations（风险与缓解）

| 风险 | 等级 | 缓解 |
|---|---|---|
| Option A 镜像 effect 与 Agent 路径互相写 store 形成环 | 低（更正 R1） | store 的读者都不反写 `currentTimelineState`，该边无回灌路径、**结构上不成环**；`setTimelineState` 不 `triggerUpdate`（`timelineSlice.ts:44`），且本地 `externalTimelineUpdateId`（驱动 TimelinePanel 重 import）本 effect 不触碰。补「effect 后 store 与 component 的 update-id 均不变」断言。 |
| `isLocalPreviewEnabled()` 关闭时本修复引入行为变化 | 低（R5） | 无变化：mirror 无条件写 store，但 `useLocalMaterialDownload` 有 `enabled` 守卫、`useRemoteMaterialPrefetch` 同理，门控在 `!localPreviewEnabled` 时直接 `allReady:true`（`VideoPlayerPanel.tsx:659`）。特性关闭 ⇒ 零行为变化；验收须覆盖开/关两态。 |
| `currentTimelineState` 在播放中高频变更导致下载 effect 抖动 | 低 | 播放时间走独立 props（`externalCurrentTime`/`onCurrentTimeChange`），结构性编辑才更新 `currentTimelineState`；下载 driver effect 对 `ready/inflight` 素材早返回，重算成本可忽略。 |
| 视频素材永远拿不到 480p（预取未发或后端转码失败） | 中 | 必须同时修复 `timelineVideoMaterialIds` 源（已纳入方案）；`useLocalMaterialDownload` 已有 60s 转码超时 → 终态 `degraded` 回退到 round-1 流式，单素材不会永久锁死门控（C3）。 |
| 跨源素材 `fetch().blob()` 受 CORS 阻断 | 低 | 既有逻辑经同源 media-proxy（`_resolveLocalDownloadUrl` / `MediaProxyClient`）规避，本轮不改。 |
| `isLocalPreviewEnabled()` 在某些环境被关 | 低 | 默认 ON；门控已显示 0/11 证明本环境为 ON，非本轮根因；不改其语义，仅在验收前确认未被 localStorage/env 显式关闭。 |
| Option B 改 hook 签名影响其它调用点 | 低 | 第三参可选并回退 store；`grep` 确认 `useMaterialManagement` 仅 `VideoEditingInterface` 单一调用点。 |
| 误把图片素材纳入下载/门控 | 低 | 保持 C2：下载 hook 与门控均按 `material.type` 二次过滤，图片不进状态机、不阻塞。 |

---

## 9. 实施约束（给下游开发节点）
- **二选一**实现 Option A 或 Option B，不可混用（混用会出现 store 与入参双源，重新制造不一致）。**推荐 Option A**。
- 仅按本「文件变更清单」落代码，不做超范围重构；不改第 2/3 轮已测机制的内部逻辑。
- 提交时 `git add <具体路径>`（禁止 `git add -A`），避免带入 `__pycache__/`、`.next/`、`tsconfig.tsbuildinfo`、`ops/_*` 等无关产物（见 CLAUDE.md「Gitignore is minimal」）。
- commit message 以 `feat:` 前缀 + 一句话摘要（如 `feat: mirror live timeline into shared store so timeline materials auto-download`）。

---

## 评审结论（Review Verdict）

**结论：有条件通过（Approved with conditions）。**

设计的核心判断成立、推荐方案（Option A）可行、最小且能同时消除用户报告的三个症状（无自动下载 / 无进度遮罩 / 0/11 ready）；无 P0，两个 P1（**R1** 根因归因错误、**R2** 文件指代歧义）已在本 v2 正文中直接修复并复核一致。批准进入下游实现，但须满足以下条件：

1. **（强制）落地 Option A 时只改 `src/stores/slices/timelineSlice.ts` 所属的 `useVideoEditingStore`**，严禁误改同名的 `src/components/video/timeline/store/slices/timelineSlice.ts`（`useTimelineStore`）。Option A / B 二选一，不可混用。
2. **（强制）回归测试须锁死「门控统计的素材集合 == 下载 hook 输入集合」这一不变式**（§7.1 #1/#2）——这是本 bug 的本质（修复前门控 11、下载 0）；并补 Option A 的「effect 执行后 `store.externalUpdateId` 与本地 `externalTimelineUpdateId` 均不变」断言以证无环。
3. **（建议，P2 / R4）** C2 的测试断言改落在消费端的 `material.type` 过滤（而非集合成员），覆盖「图片落在视频轨」用例。
4. **（建议，P2 / R3）** 实现说明中标注 `useTimeline()` 选择器为潜在第二读者（当前未启用）；mirror 后其语义为「同步反映手动剪辑」。
5. **（建议，P2 / R5）** 验收前确认 `isLocalPreviewEnabled()` 开/关两态：关闭时本修复应为 no-op。
6. 遵守 §9：`git add <具体路径>`、`feat:` 提交前缀、不超范围重构、不携带 `__pycache__/` / `.next/` / `ops/_*` 等无关产物。

满足以上强制条件（1、2）后即可进入实现节点；建议项可在实现 PR 内一并处理。

> 文档状态：**v2 · 有条件通过**。无 P0 / P1 遗留（均已在正文修复）。
