# 音频片段「从轨道二拖回轨道一」失败 —— Bug 分析报告

> 子任务 #0「问题定位与分析」产出物。本节点不写修复代码、不执行 `git commit`。
> 所属任务：13-BUG修复2-系统模板（第 2 轮）。
> 诊断日期：2026-06-21。代码基线：分支 `feat/remove-user-system`（HEAD `201b29a`）。
> 前置：第 1 轮已打通「拖拽片段跨轨移动」链路（提交 `a0a756e`），其分析见
> `docs/diagnoses/multi-audio-track-drag-and-default-track/analysis.md`。

---

## 一、问题描述（Problem description）

用户在视频编辑器底部「剪辑面板」的多音频轨道区域反馈：

> 多个音频轨道之间，要能够支持来回随意的拖拽切换，**现在从 2 轨道拖拽到 1 轨道，就是失败的**。

即：第 1 轮已让「从音频轨道一拖到音频轨道二」（向下，1→2）可用并通过验证；本轮发现**反方向「从音频轨道二拖回音频轨道一」（向上，2→1）失败**——把轨道二上的音频片段往上拖到轨道一后，片段并没有「停在用户松手的位置上、与轨道一已有音频叠加显示」，看起来像没拖成功。

涉及模块：前端时间轴（`src/components/video/timeline/`，DDD 分层 domain / store / UI）。

默认轨道结构（`src/components/video/timeline/TimelinePanel.tsx:213-219`，从上到下渲染）：

```
video-track-1 (order 0)
image-track-1 (order 1)
audio-track-1 (order 2)   ← 音频轨道一（在上）
audio-track-2 (order 3)   ← 音频轨道二（在下）
subtitle-track-1 (order 4)
```

关键背景（第 1 轮确立的内容约定，来自提交 `a0a756e` 的 Bug #2 说明
"default it to audio-track-2 so it overlays **track 1 (narration / embedded audio)**"）：

- **音频轨道一** 默认承载「解说 / 视频内嵌（音画分离）音频」——通常是一条**从 0 开始、时长很长**的片段；
- **音频轨道二** 默认承载「素材库搜索添加的音频」——通常是一条**较短**的片段。

这条约定正是本轮「方向不对称（2→1 失败、1→2 正常）」的根源（见 §三）。

---

## 二、复现步骤（Reproduction steps）

环境：`npm run dev`（前端 :3000），进入任意视频编辑任务，打开底部时间轴。

### 主复现（确定性，命中根因 §3.1）
1. 让 **音频轨道一** 有一条较长音频（最常见：先生成/使用解说音频，或右键视频片段「音画分离」把内嵌音频抽到轨道一；它默认从 0 开始、时长较长，如 0–60s）。
2. 让 **音频轨道二** 有一条较短音频（素材库搜索音频 → 添加到时间轴，按第 1 轮默认进入轨道二，如 0–5s）。
3. 用鼠标按住轨道二的短音频片段，**竖直向上**拖到 **音频轨道一** 的区域后松手。
4. **实际现象**：该片段从轨道二消失，却**没有出现在轨道一的可见区域**，看起来「拖丢了 / 拖失败了」。
5. **期望现象**：该片段落在用户松手处（横向位置），停在轨道一上与解说音频**叠加**显示。

> 真相（见 §三）：片段其实**已经成功移动到了音频轨道一**，但被 `autoOrganize` 重排到了「解说片段之后」（≈ 解说结束时刻，如第 60s），**滚出了当前视口**，所以肉眼看不到 → 被判定为「失败」。

### 对照复现（说明为何反方向「正常」）
1. 同样的两条音频（轨道一长解说、轨道二短素材）。
2. 把 **轨道一的长解说** 竖直向下拖到 **音频轨道二** 后松手。
3. **实际现象**：解说片段出现在轨道二上（其起点落在轨道二已有短片段之后，如第 5s，仍在视口内可见）→ 用户判定「正常」。

### 退化复现（说明为何第 1 轮的测试没发现）
1. 保持 **音频轨道一为空**。
2. 把轨道二的音频片段向上拖到（空的）轨道一。
3. **实际现象**：片段落在轨道一第 0s，可见 →「正常」。
   —— 第 1 轮回归测试正是只测了「移入空目标轨」（见 §3.3 证据），所以没暴露「移入已占用的轨道一」这一路径。

---

## 三、根因分析（Root cause analysis，含证据）

### 3.0 前置事实：第 1 轮的跨轨链路本身是对称且已测的（store / domain 层）

跨轨移动的 store / 领域逻辑对两个方向**完全对称**，无方向性 bug：

- 领域聚合 `TimelineAggregate.moveItem(itemId, time, targetTrackId)` 跨轨分支先校验「源未锁、目标未锁、目标类型兼容」再「先删源、后加目标」——
  `src/components/video/timeline/domain/aggregates/TimelineAggregate.ts:179-201`。音频↔音频恒兼容，两个方向一视同仁。
- store 守卫 `timelineSlice.moveItem(..., targetTrackId)` 同样对称：只要目标轨未锁且 `canAcceptMaterial` 通过即透传 `effectiveTargetId`——
  `src/components/video/timeline/store/slices/timelineSlice.ts:231-260`。
- `canAcceptMaterial('audio')` 仅判断 `trackType === 'audio'`，对 `audio-track-1` 与 `audio-track-2` 结果相同——
  `src/components/video/timeline/domain/value-objects/TrackType.ts:88-107`。
- 提交分支 `isCrossTrackMove = move && targetTrackId && targetTrackId !== sourceTrackId` 对称，跨轨时跳过 swap——
  `src/components/video/timeline/store/slices/dragSlice.ts:144-179`。

> 结论：方向不对称**不来自** store/domain 计算本身。既然「2→1 失败、1→2 正常」是用户稳定可复现的现象，方向性必然来自**与轨道既有内容相关的、确定性的下游环节**——即 `autoOrganize` 重排（§3.1）。

---

### 3.1 主根因：`autoOrganize` 把跨轨移入的片段「顺序打包」到目标轨已有片段之后，导致移出视口

每次跨轨提交后都会调用 `state.autoOrganize()`：
`src/components/video/timeline/store/slices/dragSlice.ts:164-179`（跨轨分支）：

```ts
if (isCrossTrackMove && targetTrackId) {
  state.recordAction('MOVE_ITEM', { itemId, newStartTime: preview.startTime, targetTrackId });
  state.moveItem(preview.itemId, preview.startTime, false, targetTrackId); // 片段确实转移到目标轨
  state.autoOrganize();                                                    // ← 紧接着重排目标轨
  ...
}
```

`autoOrganize` 的实现 `TimelineAggregate.organizeVideoAudioTracks()`
（`src/components/video/timeline/domain/aggregates/TimelineAggregate.ts:247-267`）**逐轨独立**地把每条 video/audio 轨的片段**按 `startTime` 排序后从 0 开始首尾相接打包**：

```ts
organizeVideoAudioTracks(): void {
  for (const track of this._tracks) {
    if (track.isLocked) continue;
    if (track.type !== 'video' && track.type !== 'audio') continue;
    if (track.items.length === 0) continue;
    const sorted = [...track.items].sort((a, b) => a.startTime.value - b.startTime.value);
    let cursor = 0;
    for (const item of sorted) {
      if (item.startTime.value !== cursor) item.moveTo(TimePosition.create(cursor)); // 紧贴排布
      cursor += item.duration.value;
    }
    track.sortItems();
  }
  this.recalculateTotalDuration();
}
```

把这套规则套到「2→1」主复现场景上（轨道一已有解说 N(0–60s)，从轨道二拖入短片段 M）：

1. 跨轨 `moveItem` 把 M 从轨道二移到轨道一，M 的 `startTime` = `preview.startTime`（用户松手处的横向时间，被 `calculateMovePreview` 钳到 ≥0，见 `domain/machines/dragMachine.ts:197-204`）。
2. `autoOrganize` 对轨道一按 `startTime` 排序：N 起点 0，M 起点 ≥0；**N 永远排在前**（N 从 0 开始）。
3. 打包：`N → 0..60`（`cursor=60`），`M → 60..65`。
4. **M 落到第 60s（≈ 解说结束处），整段在视口外**。M 确实在轨道一，但肉眼看不到 → 用户判定「2→1 失败 / 把片段拖丢了」。

> 注意：由于 N 从 0 开始，**无论用户把 M 横向松手在哪里**（甚至松在最左端、`startTime` 被钳为 0），排序后 M 都排在 N 之后、被推到 `N.duration` 处。因此该现象是**确定性的**，而非偶发。

**反方向（1→2）为什么「正常」**：把长解说 N 从轨道一拖到轨道二（已有短片段 M(0–5s)）。`autoOrganize` 排序后 `M → 0..5`、`N → 5..65`。N 的**起点 5s 仍在视口内可见**，用户看到 N「成功移动到轨道二」→「正常」。
—— 这就是**方向不对称的本质**：把「短片段」移到「有长片段的轨道」上时，短片段整段被推到长片段之后（视口外，看似失败）；把「长片段」移到「有短片段的轨道」上时，长片段起点仍可见（看似成功）。该不对称由第 1 轮确立的内容约定（解说/内嵌→轨道一，素材库→轨道二）确定性触发。

> 与第 1 轮分析的呼应：该限制第 1 轮分析 §3.4 已明确预警——
> 「因 autoOrganize 会把每轨片段重排到从 0 紧贴，**用户在某条音频轨上指定的自定义起始偏移不会被保留**」。
> 本轮就是这一已知限制在「跨轨移入已占用音频轨」场景下显形为可见 Bug。

---

### 3.2 这与用户真实意图（来回随意拖拽 + 叠加）直接冲突

用户要的是「多音频轨道之间来回随意拖拽切换」并能**叠加**。`autoOrganize` 的「同轨顺序打包」语义使得：**只要目标音频轨已经有一条从 0 开始的片段，任何被拖入的片段都无法停在用户指定的时间位置，只能被顺次推到末尾**。这从机制上否定了「把某条音频拖到轨道一、与解说从某时刻起叠加」这一诉求——即便数据层的跨轨移动成功了，结果也既不可见也不可控。

---

### 3.3 次根因 / 共因：跨轨能力唯一的 DOM 环节（命中测试）未被测试，且松手时不重算目标轨——存在「真的没移动」的并发/边界失败

即便排除 §3.1，跨轨移动还依赖一个**第 1 轮唯一未覆盖测试**的环节——UI 命中测试。第 1 轮回归测试文件自己写明了这一点：

`src/components/video/timeline/__tests__/autoOrganize.integration.test.ts:274-276`：

```
// these tests drive that store surface directly (the UI hit-test that produces
// targetTrackId is the only piece not exercised here).
```

且该测试只把片段移入**空目标轨**（`twoAudioTrackData` 中 `audio-track-2` 为空，
`autoOrganize.integration.test.ts:298-305`；用例移动 `a-2 → audio-track-2`，
`:317-337`），**从未测过「移入已占用轨」**，所以 §3.1 的「打包到末尾」从未被测到。

命中测试本身（`src/components/video/timeline/TimelinePanel.tsx:321-340`）有两处脆弱点，可能让 `targetTrackId` 落到**源轨或不兼容轨**，从而触发 store 守卫的「回退为同轨移动」（`timelineSlice.ts:240-250`），表现为**片段真的没移动**：

1. **松手（pointerup）不重算目标轨**：`handlePointerUp` 只发 `clientX/clientY`，状态机 `committed` 状态不跑任何 preview action（`domain/machines/dragMachine.ts:549-556`），提交读到的 `targetTrackId` 是「最后一次 pointermove」的值，而非「松手落点」——
   `TimelinePanel.tsx:342-348`。
2. **节流的尾调用用的是「窗口内首个」而非「最新」坐标**：内联 `throttle` 的尾部 `setTimeout` 闭包捕获的是设定定时器那次的 `args`，窗口内后续调用被丢弃（`TimelinePanel.tsx:33-51`）。快速拖拽时，提交所用坐标可能滞后于真实落点。

两者叠加时，若提交时刻的 `targetTrackId` 恰好仍是源轨/不兼容邻轨，跨轨分支不触发（`dragSlice.ts:146-147`），片段留在原轨 → 用户同样看到「失败」。该失败为时序/落点相关，不如 §3.1 确定，但属同一「跨轨能力未被端到端验证」的缺陷面。

补充 UX 缺陷（放大上述问题、与方向无关）：拖拽预览**从不改变片段的纵向位置**——`currentDelta.y` 恒为 0（`dragMachine.ts:329`），`getDragPreview` 不含纵向信息（`dragMachine.ts:605-623`），片段 `top` 固定为 `padding`（`timelineItemStyles.ts:48-60`）。用户拖动时看不到片段「跟到目标轨」的任何反馈，也没有目标轨高亮，难以判断会落到哪条轨，进一步加剧「看似失败」。

---

## 四、影响面（Impact surface）

| 受影响功能 | 说明 |
|---|---|
| 音频片段「轨道二 → 轨道一」拖拽（本轮主症状） | 当轨道一已有从 0 开始的较长解说/内嵌音频时（第 1 轮默认布局），拖入的片段被 `autoOrganize` 打包到解说之后、移出视口，确定性表现为「拖失败/拖丢」。 |
| 音频片段移入任何「已占用」的音频轨 | 通用问题：被移入片段无法停在松手位置，总被顺次推到末尾，无法实现「指定时刻叠加」。 |
| 「来回随意拖拽切换 + 叠加」诉求 | 因同轨顺序打包语义，机制上无法满足。 |
| 跨轨移动在并发/边界落点下偶发不触发（§3.3） | 松手不重算目标轨 + 节流尾调用陈旧坐标，可能回退为同轨移动（片段真的没移动）。 |
| 不受影响 | store/domain 的跨轨 `moveItem`（已对称、已测）、类型兼容/锁定守卫、防丢片段逻辑、后端多轨 `amix` 混音与导出采集（第 1 轮 §3.3 已验证）。 |

---

## 五、候选修复方案（Candidate fixes）

### 主症状（§3.1：移入已占用轨被打包到末尾、移出视口）

| 方案 | 思路 | 侵入性 | 风险 | 工作量 |
|---|---|---|---|---|
| **A. 跨轨提交后「保留落点、不打包目标轨」（推荐）** | 在跨轨提交分支（`dragSlice.ts:164-179`）**不再调用会把目标轨从 0 紧贴的 `autoOrganize()`**；改为：仅对**源轨**收口补洞（移走后的空隙），**目标轨保留被移片段的 `preview.startTime`**（允许与既有片段叠加）。这样片段就停在用户松手处、与轨道一解说叠加，正中「随意拖拽 + 叠加」诉求。 | 中（仅改跨轨提交分支 + 一个「只整理源轨」的调用） | 中（需保证不影响「添加素材时打包从 0」的既有路径；添加路径与拖拽提交是不同入口，可不动） | 中 |
| **B. 音频轨整体不做顺序打包（允许同轨叠加）** | 让 `organizeVideoAudioTracks` 对 `audio` 轨**跳过打包**（只打包 video 轨）。音频本就应允许叠加。 | 中-高（改 `TimelineAggregate.organizeVideoAudioTracks`，全局语义变更） | 高（同轨多音频从「顺序」变「可叠加」，牵动添加/导出预期，回归面大） | 中-高 |
| **C. 跨轨提交后选中并自动滚动到被移片段** | 不改打包逻辑，仅在提交后 `selectItem` + 把视口滚到片段位置，让用户「看得到」。 | 低 | 低（治标不治本：片段仍在解说之后、不在松手处，无法叠加） | 低 |

### 次根因（§3.3：命中测试脆弱、松手不重算目标轨）—— 建议作为加固项随主方案一并落地

| 方案 | 思路 | 侵入性 | 风险 | 工作量 |
|---|---|---|---|---|
| **D. 松手时按落点重算目标轨（推荐加固）** | `handlePointerUp` 用 `document.elementFromPoint(e.clientX, e.clientY).closest('[data-track-id]')` 重算，并把它带进 `POINTER_UP` → 提交分支用「落点目标轨」而非「最后一次 pointermove」。 | 低-中（`TimelinePanel` + dragMachine `POINTER_UP` 透传 / commit 读取） | 低 | 低-中 |
| **E. 修复节流尾调用用最新坐标** | 让 `throttle` 尾部触发使用最近一次入参（leading+trailing 正确实现），或对最终位置绕过节流。 | 低 | 低 | 低 |
| **F. 纵向拖拽反馈 / 目标轨高亮（UX）** | 预览时给目标轨加高亮（命中态已能算出 `targetTrackId`），让用户看清会落到哪条轨。 | 低-中 | 低 | 低-中 |

---

## 六、推荐方案（Recommended fix）与理由

**主方案 = A（跨轨提交后保留落点、不对目标轨做从 0 打包），并叠加 D 作为加固。**

理由：
1. **直击确定性根因**：§3.1 已证明「失败」其实是 `autoOrganize` 把移入片段打包到解说之后、移出视口；A 让被移片段保留 `preview.startTime`，停在用户松手处并与轨道一解说叠加——既消除「看似失败」，又一次满足用户「来回随意拖拽 + 叠加」的真实诉求。
2. **最小破坏面**：只改「拖拽跨轨提交」这一个入口（`dragSlice.ts:164-179`），把 `state.autoOrganize()` 换成「只整理源轨、保留目标轨落点」的处理；**素材「添加到时间轴」走的是另一条 `addItemAction` 入口，仍可保留其「打包从 0 → 自动叠加」的既有行为**（第 1 轮 Bug #2 的默认叠加不受影响）。
3. **不采纳 B**：把音频轨全局改为「不打包」语义变更过大，会牵动同轨多片段排布、添加路径与导出预期，回归风险高；本轮诉求用 A 的局部改动即可达成。
4. **不采纳 C**：仅滚动可见治标不治本——片段仍被推到解说之后、不在松手处，无法叠加。
5. **叠加 D（+可选 E/F）**：§3.3 指出命中测试是第 1 轮唯一未端到端验证的环节，且松手不重算目标轨 + 节流尾调用陈旧坐标会带来偶发「真没移动」。以落点重算 `targetTrackId`（D）成本低、收益直接，建议随主方案一并落地，把「跨轨命中」从「最后一次 pointermove」纠正为「松手落点」。

落地要点（供下一节点参考，本节点不写代码）：
- 在 `dragSlice` 跨轨提交分支：`moveItem(..., targetTrackId)` 后，**不要** `state.autoOrganize()`；改为仅对**源轨**做收口（关闭被移走留下的空隙），目标轨保留 `preview.startTime`（钳 ≥0，允许叠加）。撤销/重做的 `recordAction('MOVE_ITEM', { targetTrackId, newStartTime })` 已携带目标轨与落点，逻辑可沿用。
- 在 `handlePointerUp`（`TimelinePanel.tsx:342-348`）按 `clientX/clientY` 重算 `targetTrackId` 并随 `POINTER_UP` 透传；提交读取该「落点目标轨」。
- 补一条端到端回归测试：**移入「已占用」音频轨**（不仅是空轨），断言被移片段停在落点、且与既有片段叠加（两者 `startTime` 区间相交），堵住第 1 轮 §3.3 的测试缺口。

> 关于「叠加导出」：导出/后端 `amix` 多轨混音第 1 轮已验证就绪，无需改动；A 让用户能把片段叠到轨道一指定时刻后，导出即按多轨叠加。

---

## 七、关键证据索引（file:line）

- 默认轨道结构（轨道一 order 2 在轨道二 order 3 之上）：`src/components/video/timeline/TimelinePanel.tsx:213-219`
- 跨轨提交后调用 autoOrganize（主根因触发点）：`src/components/video/timeline/store/slices/dragSlice.ts:164-179`（`state.autoOrganize()` 见 :174）
- autoOrganize 逐轨「按 startTime 排序 + 从 0 紧贴打包」：`src/components/video/timeline/domain/aggregates/TimelineAggregate.ts:247-267`
- 领域跨轨 moveItem（先校验后转移、对称）：`src/components/video/timeline/domain/aggregates/TimelineAggregate.ts:179-201`
- store moveItem 守卫（对称、防丢片段、不兼容回退同轨）：`src/components/video/timeline/store/slices/timelineSlice.ts:231-260`
- 音频类型兼容对两条音频轨一致：`src/components/video/timeline/domain/value-objects/TrackType.ts:88-107`
- 提交分支 isCrossTrackMove 判定（对称）：`src/components/video/timeline/store/slices/dragSlice.ts:144-147`
- UI 命中测试（唯一 DOM 环节）：`src/components/video/timeline/TimelinePanel.tsx:321-340`
- 第 1 轮测试自述「UI 命中测试是唯一未覆盖项」+ 只测移入空轨：`src/components/video/timeline/__tests__/autoOrganize.integration.test.ts:274-276`、`:298-305`、`:317-337`
- 松手不重算目标轨（committed 不跑 preview action）：`src/components/video/timeline/domain/machines/dragMachine.ts:549-556`；`TimelinePanel.tsx:342-348`
- 节流尾调用用陈旧坐标：`src/components/video/timeline/TimelinePanel.tsx:33-51`
- 无纵向拖拽反馈：`dragMachine.ts:329`（`y:0`）、`dragMachine.ts:605-623`（preview 无纵向）、`timelineItemStyles.ts:48-60`（`top` 固定）
- 第 1 轮内容约定（解说/内嵌→轨道一，素材库→轨道二）：提交 `a0a756e` 说明 + 第 1 轮分析 `docs/diagnoses/multi-audio-track-drag-and-default-track/analysis.md` §3.0 / §3.2 / §3.4

---

## 八、结论（一句话）

「从轨道二拖回轨道一失败」并非跨轨移动逻辑坏了（store/domain 已对称且已测）——而是**跨轨提交后 `autoOrganize` 把移入轨道一的片段按 startTime 顺序打包到那条从 0 开始的长解说之后，整段被推出视口**，看似拖丢；反方向因长片段起点仍可见而看似正常。

> ⚠️ 修复方案的最终建议见 §十「评审结论」——经评审节点核验，原 §五/§六 推荐的 **方案 A/B（允许同轨叠加）经审计不成立**，改荐 **C + D**（理由与证据见 §九、§十）。本节及 §一~§七 的「根因」结论仍然成立，仅「推荐修复」被修正。

---

## 九、评审补充证据（Reviewer-added evidence，由子任务 #1 评审节点补充）

> 评审定位：本节逐条复核了 §三~§七 引用的 file:line（dragSlice / TimelineAggregate / timelineSlice / TrackType / dragMachine / TimelinePanel / 回归测试），**根因（§3.0–§3.1）全部属实、证据链成立**。但在审计「候选修复」时发现 §五/§六 缺失三条决定性证据，足以推翻原推荐方案 A/B。现补全如下。

### E1（推翻「方案 A 最小且足够」）：`autoOrganize` 是「每次结构性编辑都重排所有 video/audio 轨」的全局不变量，调用点约 15 处

原 §六 主张「只改跨轨提交一个入口、把 `state.autoOrganize()` 换成只整理源轨」即可保留落点叠加。但 `autoOrganize()`（→ `organizeVideoAudioTracks()`）并非只在跨轨提交处调用，而是**几乎每一个结构性 mutation 入口都会调用**，把每条 video/audio 轨重新「按 startTime 排序 + 从 0 紧贴打包」：

- `store/actions/addItem.ts:41`、`store/actions/moveItem.ts:39`、`store/actions/resizeItem.ts:38`
- `store/actions/removeItem.ts:35`、`:77`、`store/actions/swapItems.ts:31`、`store/actions/splitItem.ts:78`
- `store/actions/detachAudio.ts:63`、`store/actions/trackActions.ts:228`、`:282`
- `store/slices/dragSlice.ts:174`（跨轨提交）、`:190`（同轨提交）、`:205`（resize 提交）
- `TimelinePanel.tsx:630`、`:656`

> 推论：即便方案 A 在「跨轨提交那一刻」让被移片段停在落点并与解说叠加，**用户随后任意一次编辑**（move / resize / add / remove / split / detach / 轨道控制）都会再次触发 `autoOrganize` → 把轨道一重排打包 → 把该片段重新推回 ≈60s（视口外）。**A 的叠加是非持久的，下一次编辑即被撤销，bug 复现。** 故 §六「A 最小且足够」不成立。

### E2（推翻「允许同轨叠加」）：预览引擎「每条音频轨同一时刻只播一条 clip」，且要求轨内 clip 互不重叠（INV-5）

A、B 的共同前提是「让两条音频在同一条轨上重叠播放」。但本项目的多轨预览合成器**不支持单轨内重叠**：

- `playback/TrackScheduler.ts:42` 文档明确：*"Items must be sorted by `startTime` ascending and **non-overlapping (INV-5)**"*；实现 `activeClipAt`（`:49-77`）按序返回**首个**覆盖时间 `t` 的 clip——若两条 clip 在 `t` 处重叠，**只会命中排在前面的那条，后一条永远取不到 → 在预览里静音**。
- `playback/AudioSyncPool.ts:158-176` 的 `computeAudioSyncActions` 对**每条轨（group）**只取 `activeClipAt(group.items, t)` 一条 clip 来决定 play/seek/pause（`:173`）。即「一轨一元素、同刻一条」。

> 推论：A/B 制造的「同轨重叠」是一个**预览引擎无法正确播放**的非法状态（INV-5 违反）——被叠的第二条音频在预览里听不到。这正是第 1 轮把「叠加」设计成「分到两条不同音频轨」的原因（见 `docs/diagnoses/multi-audio-track-drag-and-default-track/analysis.md` §3.4：「同轨顺序、跨轨叠加」）。

### E3（推翻「不影响导出」）：导出却是「拍平所有音频 clip + 各自 start_time + amix」，与预览口径不一致

- `hooks/useVideoExport.ts:190-193` 逐轨逐 item 统计音频；`:388-395` 把**每一条**音频 item `push` 进 `audioItems`，携带各自 `start_time` / `track_id` / `volume`。导出后端按 `start_time`（adelay）+ `amix` 混音。
- 因此**导出会把同轨重叠的两条都混进去**（各按 start_time 延迟），而**预览只播一条**（E2）。

> 推论：若按 A/B 允许同轨重叠，则「所见（预览只响一条）≠所得（导出混两条）」，破坏 WYSIWYG——这是一个比原 bug 更隐蔽的回归。

### E4（修正 §五对 B 的风险评估）：新增素材的落点本就由 `ItemPlacementService` 顺序排布，不依赖音频打包

- `timelineSlice.addItemToTrack`（`:189`）用 `ItemPlacementService.createItemFromMaterial(material, track)`（不传显式 startTime）。
- `createItemFromMaterial` 缺省落点 = `calculatePlacementPosition(track)`（`domain/services/ItemPlacementService.ts:167`）；该函数对**空轨返回 0、非空轨返回 maxEnd（轨尾）**（`:123-139`）。

> 推论：第 1 轮「素材库音频 → 默认空的轨道二 → 落 0、与轨道一解说叠加」这一行为**不依赖 `autoOrganize` 打包**（空轨落点本就是 0）。所以 §五对 B 的「会破坏添加默认叠加」担忧并不成立。但 B 仍因 **E2/E3** 不可取——「全局不打包音频」依然会撞 INV-5 并造成预览≠导出，且要连带改播放引擎与导出，远超本 bug。

### E5（核验 §3.3 次根因，确认成立但为次要）

- 松手不重算目标轨：`dragMachine.ts:549-556`（`committed` 态只处理 `COMMIT_COMPLETE`、不跑任何 preview action）；`TimelinePanel.tsx:342-348`（`handlePointerUp` 只发 `clientX/clientY`，不重新 hit-test）。提交读到的 `targetTrackId` 是「最后一次已执行的 pointermove」的值（`dragMachine.ts:332`）。
- 节流尾调用陈旧坐标：`TimelinePanel.tsx:33-51`，尾部 `setTimeout` 闭包捕获的是**设定定时器那一次**的 `args`，窗口内后续调用被丢弃。
- 结论：快速拖拽时，提交所用 `targetTrackId` 可能滞后/落到源轨，使跨轨分支根本不触发（片段真没动）。属时序相关的次要失败面，**对「2→1 看似失败」这一稳定可复现主症状不是主因**（主因是 §3.1 的确定性打包移位），但会损害「来回随意切换」的可靠性，须随主修复一并加固。

---

## 十、评审结论（Review Verdict）

### 1. 根因裁定：成立

§3.0–§3.1 经逐条核验成立、证据链完整：跨轨 `moveItem` 在 store/domain 两层对称且已测；「2→1 看似失败」的**确定性**根因，是跨轨提交后 `autoOrganize` 把移入的短片段按 `startTime` 打包到从 0 开始的长解说之后（≈60s），滚出视口。**关键定性：数据其实已正确转移、且处于可播状态（顺序、非重叠），这是一个纯「可见性 / UX」缺陷，不是数据缺陷。**

### 2. 对原推荐方案 A / B 的裁定：不采纳

- **A 不持久（E1）**：`autoOrganize` 是约 15 个编辑入口每次都跑的全局不变量；只在跨轨提交分支跳过它，叠加结果会被用户的下一次任意编辑重新打包推回 60s——bug 复现。
- **A、B 违反播放不变量 + 制造预览≠导出（E2/E3）**：二者都会产生「同轨重叠」，而预览每轨同刻只播一条且要求轨内不重叠（INV-5），被叠的第二条在预览里静音；导出却把两条都 `amix`——WYSIWYG 被打破。
- **B 收益不成立**：「全局不打包音频」并不能换来可用的同轨叠加（同样撞 INV-5），反而要连带改播放引擎与导出，远超本 bug 范围。

### 3. 最终推荐修复（单一方案）：**C（提交后将被移片段选中并自动滚入视口）为主修复，叠加 D（pointerup 落点重算 `targetTrackId`）作为可靠性加固**

理由（直接对应「最小且能解决 bug、且不引入回归」的评审标准）：

1. **直击观测到的真实缺陷**：用户报告的是「拖丢 / 失败」（看不到片段）。片段本就已正确落在轨道一（顺序、可播），缺的只是**可见性**。C 在跨轨提交后 `selectItem(被移片段)` 并据其最终 `startTime` 调 `setScrollLeft` 把它滚入视口（可选加一次高亮闪烁），用户即可看到「片段确实移到了轨道一」。
2. **最小改动、零数据语义变更**：C 不触碰 `autoOrganize` / INV-5 / 导出，**天然持久**（不存在「下一次编辑被打回」问题），也不会引入预览≠导出。相较之下 A 反而要新增「只整理源轨」的特殊逻辑且仍不工作——C 才是真正的最小修复。
3. **D 处理次根因（E5）正交且低风险**：松手按落点 `document.elementFromPoint(...).closest('[data-track-id]')` 重算 `targetTrackId` 并经 `POINTER_UP` 透传、commit 读取，把「跨轨命中」从「最后一次 pointermove」纠正为「松手落点」，保证「来回随意切换」在快速拖拽下也可靠触发（否则 C 可能滚到的是仍停在源轨、根本没移动的片段）。

### 4. 落地要点与边界（供子任务 #2 参考，本节点不写代码）

- **C**：在 `dragSlice.ts:164-179` 跨轨提交分支，于 `state.moveItem(..., targetTrackId)` + `state.autoOrganize()` **之后**（二者均同步完成，可同步读到最终 `startTime`）：`get().selectItem(preview.itemId)`（`selectionSlice.ts:68`）+ 据该片段最终 `startTime`×`pixelsPerSecond` 计算并 `get().setScrollLeft(...)`（`timelineSlice.ts:494` → `TimelineAggregate.setScrollLeft` `:503`）使其进入可视区。撤销/重做不受影响（`recordAction('MOVE_ITEM', …)` 已携带 `targetTrackId` 与落点）。
- **D**：`handlePointerUp`（`TimelinePanel.tsx:342-348`）用 `document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-track-id]')?.getAttribute('data-track-id')` 重算 `targetTrackId`；在 `POINTER_UP` 事件上携带该字段（需扩展 `PointerUpEvent`，`dragMachine.ts:143-147`）；`committed` 提交分支（`dragSlice.ts:144-147`）以「落点目标轨」覆盖 `preview.targetTrackId`。可选叠加 E（修复节流尾调用用最新坐标）。
- **保持 `autoOrganize` 对音频轨打包不变**（维持 INV-5）；**不改导出**（`useVideoExport` 已按 `track_id` + `start_time` 采集，分轨叠加照常）。
- **回归测试**：补「移入**已占用**音频轨」端到端用例——断言被移片段最终在目标轨、与既有片段**顺序非重叠**（不应制造同轨重叠），并断言提交后 `scrollLeft` 使其落入可视区；堵住第 1 轮「只测移入空轨」（`__tests__/autoOrganize.integration.test.ts:317-337`，`audio-track-2` 为空）的缺口。
- **范围外（产品决策，非本 bug）**：若确需「同轨任意位置叠加音频」，须改播放引擎（`AudioSyncPool` / `TrackScheduler` 支持单轨多并发 clip）+ 导出一致性，属新特性；现阶段「叠加」仍走第 1 轮的「分到不同音频轨」路径。

### 5. 一句话裁定

根因正确（移入片段被 `autoOrganize` 打包到长解说之后、滚出视口，是可见性缺陷而非数据缺陷）；但原荐 A/B 因 **非持久（E1）+ 违反 INV-5 单轨单 clip（E2）+ 预览≠导出（E3）** 不可取，**最终推荐 C（提交后选中并自动滚入视口）+ D（pointerup 落点重算目标轨）**，保持音频打包与导出不变，并补「移入已占用轨」的端到端回归测试。

---

## 十一、实施过程发现的方案缺陷（Issues Found During Implementation，由子任务 #2 实施节点补充）

> 由代码修复节点（子任务 #2）在落地 §十 推荐方案 C+D 时发现并据此修正。根因结论与 C+D 的总体方向**不变**，仅 C 的具体落地机制被纠正。

### F1（C 的落地机制有误）：`store.setScrollLeft(...)` 不会移动真实滚动容器，无法让被移片段「滚入视口」

§十.4 给出的 C 落地要点是：提交后 `get().setScrollLeft(片段最终 startTime × pixelsPerSecond)` 使其进入可视区。逐条核验滚动数据流后发现该机制**行不通**：

- `timelineSlice.setScrollLeft`（`store/slices/timelineSlice.ts:494-498`）只把值写进 `_aggregate._scrollLeft` 与派生字段 `scrollLeft`（store 镜像），**并不触达任何 DOM 元素**。
- 滚动同步是**单向的 DOM → store**：`TrackContainer`/`TimelineRuler` 仅在用户滚动时通过 `onScroll → handleTrackScroll/handleRulerScroll → setScrollLeft` 把 DOM 实际值回写 store（`TimelinePanel.tsx:922-949`）。**全仓没有任何 `useEffect` 读取 `store.scrollLeft` 再写回 `scrollRef.current.scrollLeft`**（已 grep 全部 `scrollLeft` 引用确认）。store 端的 `scrollLeft` 只被用于：标尺刻度虚拟化窗口（`TimelineRuler.tsx:199-204`）、标尺点击换算时间（`:103`）、以及持久化/恢复。
- 推论：在 store 里调用 `setScrollLeft` 只会更新「镜像值」，**轨道滚动容器的 DOM `scrollLeft` 原地不动**，被移片段仍在视口外——C 的目标（让用户看到片段确实移到了轨道一）落空。

### F2（修正方案）：把「滚入视口」放到拥有滚动容器 ref 的 UI 层，按真实几何滚动

改为不依赖 `setScrollLeft`，而在 UI 层用真实 DOM 几何把片段滚入视口（与既有「新增轨道后纵向滚入」逻辑 `TrackContainer.tsx:239-270` 同构、同样用 `getBoundingClientRect` + `requestAnimationFrame`，对轨道头列/各种偏移天然鲁棒）：

1. **store 仅承担「信号」**：在 `uiSlice` 新增瞬态字段 `pendingScrollItemId` + `requestScrollItemIntoView(itemId)` / `clearPendingScrollItem()`（不入快照/历史，与 `showVolumeSlider` 等既有瞬态 UI 状态同级）。
2. **dragSlice 跨轨提交分支**（`store/slices/dragSlice.ts` 跨轨 `if` 块）在 `moveItem(..., targetTrackId)` + `autoOrganize()` 之后：`selectItem(被移片段)` + `requestScrollItemIntoView(被移片段)`。
3. **TimelinePanel 消费信号**：`useEffect([pendingScrollItemId])` 中 `requestAnimationFrame` → `trackScrollRef.current.querySelector('[data-clip-id="…"]')`（`TimelineItem` 根元素已带 `data-clip-id`，`TimelineItem.tsx:601`）→ 按 `getBoundingClientRect` 计算片段相对滚动容器的左右边界，若落在视口外则写 `trackScrollRef.current.scrollLeft` 使其起点带少量左边距滚入视口，然后 `clearPendingScrollItem()`。写 DOM `scrollLeft` 会自然触发 `onScroll → handleTrackScroll`，把标尺与 store 镜像一并同步，无需手动 `setScrollLeft`。

> D（pointerup 落点重算目标轨）按 §十.4 原样落地：扩展 `PointerUpEvent` 携带 `targetTrackId`；`handlePointerUp` 用 `document.elementFromPoint(...).closest('[data-track-id]')` 重算并透传；dragMachine 在 `dragging`/`previewing` 的 `POINTER_UP → committed` 上以 `applyPointerUpTarget` 把落点目标轨写入 context（落点解析为 null 时回退保留最后一次 move 的目标轨，保证纯增量、不改既有行为）。

### F3（回归测试随之微调）

§十.4 要求断言「提交后 `scrollLeft` 使其落入可视区」。因 F2 把滚动改到 UI 层（依赖真实 DOM 渲染），store 级 headless 集成测试无法断言 DOM 滚动；改为在 store 层断言 C 的**可观测信号** `pendingScrollItemId === 被移片段 id`（+ 选中态、+ 目标轨非重叠顺序排布），DOM 滚动行为由 UI 层人工走查验证。
