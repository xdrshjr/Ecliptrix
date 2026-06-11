# 剪辑轨道视频预览播放卡顿 — 问题定位与分析

- **Bug slug**: `timeline-preview-playback-stutter`
- **诊断节点**: Subtask #0（问题定位与分析）
- **日期**: 2026-06-11
- **结论一句话**: 预览播放的合成时钟（rAF，~60Hz）每一帧都把当前时间写进 React 状态 `timelineCurrentTime`，触发整个 `VideoEditingInterface` 子树（时间轴 + 各面板）在 60Hz 下整树重渲染，并在每帧对整条时间轴 / 整个工程做 `JSON.stringify` 持久化（含 autosave 内容 churn）。主线程被这条「时钟 → React 状态」的链路打满，Canvas 合成器自己的 rAF 绘制循环被饿死 → 预览画面严重卡顿。**根因是架构耦合（用动画帧率驱动 React 状态 + 每帧整工程序列化），而非视频解码 / 源解析问题。**

---

## 一、问题描述（Problem description）

在素材管理面板上传一个本地视频，将其拖入下方剪辑轨道，然后在预览面板点击「播放」时，预览画面**非常卡顿、无法流畅播放**剪辑轨道上的视频，体验远达不到达芬奇（DaVinci Resolve）那种顺滑预览。

- 现象：画面像幻灯片一样跳帧 / 顿挫，时间码与进度条更新也不稳定。
- 触发条件：进入「组合播放（composition）」模式后点击播放即出现（轨道上有至少 1 个视频 clip 即可复现，不依赖远程素材）。
- 不是「黑屏 / 无画面」（那是另一条已修复的 RC-B 问题），而是**画面能出来但播放不流畅**。

---

## 二、复现步骤（Reproduction steps）

### 2.1 用户路径复现

1. 启动应用（`npm run dev` 前端 + 后端，或桌面端打包版本）。
2. 进入一个视频剪辑工程（Video Editing 界面，`VideoEditorContainer` → `VideoEditingInterface`）。
3. 在「素材管理面板（MaterialsPanel）」上传一个本地视频文件（哪怕一个 720p/1080p 短视频即可）。
4. 把该素材添加到下方剪辑轨道（`onAddToTimeline`），使其进入 `compositionPlayback.videoSequences`，预览面板切换到 `playbackMode === 'composition'`。
5. 在「播放预览面板（VideoPlayerPanel）」点击播放按钮（▶）。
6. **观察**：预览 `<canvas>` 上的画面顿挫/跳帧，无法流畅播放。

### 2.2 用 Chrome DevTools 量化确认（任何人可复现的客观证据采集法）

1. 播放时打开 DevTools → **Performance** 面板，录制约 5 秒。
2. 观察到：
   - 主线程在播放期间被密集的 **`setState`/React commit（Reconciler）** 与 **`JSON.stringify`** 调用填满，节奏约每 16ms 一次。
   - 调用栈里反复出现 `setTimelineCurrentTime` → `VideoEditingInterface` 整树 re-render → `useProjectAutosave` 的 `JSON.stringify(normaliseProjectDataForSave(content))`。
   - `requestAnimationFrame` 回调（`PlaybackClock._onFrame` → `CanvasCompositor.renderFrame` 的 `drawImage`）被这些任务挤掉，帧间隔远大于 16ms。
3. 另一个旁证：把轨道上的 clip 数量增多 / 时间轴变复杂，卡顿会**显著加重**（因为每帧 `JSON.stringify(currentTimelineState)` 的体量随时间轴增大），这与「解码跟不上」无关、而与「每帧整工程序列化 + 整树重渲染」强相关。

> 说明：该问题是前端渲染主线程饱和导致的丢帧，**与所播放视频本身的清晰度/码率无强相关**（解码本可由 `<video>` 元素独立完成），因此本诊断以代码引用为主要、不可辩驳的证据，DevTools 录制作为可量化的现场佐证。

---

## 三、根因分析（Root cause analysis — 含证据）

### 3.1 正常预览管线（设计意图）

合成预览是**单一本地多轨 Canvas 合成器**：唯一时钟 `PlaybackClock`（rAF）每 tick 直接驱动 Canvas 绘制与音频同步，**Canvas/音频并不依赖 React 状态**。

`src/components/video/playback/MultiTrackPlaybackEngine.ts:260`：
```ts
private _onTick(comp: number): void {
  ...
  this._renderAt(comp, true);                 // ① Canvas 绘制 + 音频同步（主线程，rAF 内）
  this.playhead.reportCompositionTime(comp);  // ② 把时间回写出去
}
```
也就是说：**画面流畅与否只取决于 ① 这条 rAF 绘制循环能不能每 16ms 稳定跑一次**。`②` 只是把时间「告诉外界」，本不应影响绘制。问题就出在 `②` 这条回写链路把主线程打满，反过来饿死了 `①`。

### 3.2 致命链路：合成时钟以 ~60Hz 驱动 React 状态

`reportCompositionTime` 经 `PlayheadController` 节流后写出。**但节流窗口是 16ms（= 一帧），等于基本不节流（~60 次/秒）**：

`src/components/video/playback/internal/constants.ts:23`：
```ts
export const PLAYHEAD_THROTTLE_MS = 16;   // 一个 rAF tick —— 即 ~60Hz
```
`src/components/video/playback/PlayheadController.ts:45`：
```ts
reportCompositionTime(t: number): void {
  ...
  if (!neverWritten && now - this._lastWriteMs < this._throttleMs) return; // 16ms 才拦一次
  this._onWrite?.(t);   // ~60Hz 触发
}
```

`_onWrite` 在 attach 时被绑成「写 timeline.setCurrentTime」：
`src/components/video/playback/MultiTrackPlaybackEngine.ts:146`：
```ts
this.playhead.bindOnWrite((t) => { deps.timeline.setCurrentTime(t); });
```

facade 的 `setCurrentTime` 再把时间向上回调 `onTimeUpdate`：
`src/components/video/hooks/useCompositionPlayback.ts:334`：
```ts
setCurrentTime: (t: number) => {
  currentTimeRef.current = t;
  lastSeekedTimeRef.current = t;     // 回声防护（见 §3.5，会在卡顿时失效）
  onTimeUpdateRef.current?.(t);      // ~60Hz 向上抛
},
```

`onTimeUpdate` 在面板里又分发给 timeline + composition 两路回调：
`src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:159`：
```ts
onTimeUpdate: (time: number) => {
  compositionCurrentTimeRef.current = time;
  if (onTimelineTimeUpdate) onTimelineTimeUpdate(time);     // → handleVideoTimeUpdate
  if (onCompositionTimeUpdate) onCompositionTimeUpdate(time);
},
```

最终落到顶层界面，把时间写进 **普通的 `useState`**：
`src/components/video/VideoEditingInterface.tsx:453`：
```ts
const handleVideoTimeUpdate = useCallback((currentTime: number) => {
  playbackDrivenTimeUpdateRef.current = currentTime;
  setTimelineCurrentTime(currentTime);   // ★ ~60Hz 触发 VideoEditingInterface 整树 re-render
}, []);
```
`src/components/video/VideoEditingInterface.tsx:128`：
```ts
const [timelineCurrentTime, setTimelineCurrentTime] = useState<number>(...); // 普通 state，写一次=整树重渲染
```

而 `timelineCurrentTime` 同时喂给**时间轴面板**与**播放面板**两棵子树：
`src/components/video/VideoEditingInterface.tsx:2643`、`:2664`：
```tsx
currentTimelineTime={timelineCurrentTime}     // → VideoPlayerPanel
externalCurrentTime={timelineCurrentTime}     // → TimelinePanel（再级联进 Zustand store）
```

**结论①**：播放期间，`VideoEditingInterface` 及其整棵子树（TimelinePanel 全部轨道/clip/标尺 + MaterialsPanel + VideoPlayerPanel）以 **~60Hz 整树重渲染**。

### 3.3 放大器一：每帧对「整条时间轴」做 `JSON.stringify` + 触发 onUpdateContent

`timelineCurrentTime` 还在「持久化 UI 状态」effect 的**依赖数组**里，于是这个 effect **每帧都跑**：

`src/components/video/VideoEditingInterface.tsx:246`（effect 体）、`:282`（每帧两次整时间轴序列化）、`:299`（每帧 onUpdateContent）、`:302`（依赖含 timelineCurrentTime）：
```ts
useEffect(() => {
  ...
  const hasStateChanged =
    content.uiState?.timelineCurrentTime !== timelineCurrentTime ||   // 播放时恒为 true
    ...
    JSON.stringify(content.uiState?.currentTimelineState) !== JSON.stringify(currentTimelineState) || // ★ 每帧整时间轴序列化
    JSON.stringify(content.uiState?.videoCutModal) !== JSON.stringify(videoCutModal);
  if (hasStateChanged) {
    onUpdateContent(updatedContent);   // ★ 每帧向上抛新 content
  }
}, [ timelineCurrentTime, currentTimelineState, ... content ]);  // timelineCurrentTime 在依赖里
```
因为 `timelineCurrentTime !== content.uiState?.timelineCurrentTime` 在播放时**永远成立**，所以 `hasStateChanged` 恒为 true，每帧都会执行那两个 `JSON.stringify(currentTimelineState)` 并调用 `onUpdateContent`。

### 3.4 放大器二：onUpdateContent → setContent → 整工程再序列化（autosave）

`onUpdateContent` 在容器里就是 `setContent`，于是顶层 `content` 对象**每帧都被替换**：
`src/components/video/projects/VideoEditorContainer.tsx:154`：
```ts
const handleUpdateContent = useCallback((next) => { setContent(next); }, []);  // 每帧新 content 对象
...
useProjectAutosave(loading || error ? null : projectId, content, {...});       // content 进 autosave
```

autosave effect 的依赖是 `[projectId, content]`，`content` 每帧变 → 这个 effect **每帧也跑一次**，并**对整个工程再做一次 `JSON.stringify`**：
`src/components/video/projects/hooks/useProjectAutosave.ts:139`、`:147`：
```ts
useEffect(() => {
  ...
  json = JSON.stringify(normaliseProjectDataForSave(content));  // ★ 每帧整工程序列化
  if (json === lastSavedJsonRef.current) return;                // 因含 timelineCurrentTime，播放时恒不相等
  ...
}, [projectId, content]);
```
此外，由于 `MAX_FLUSH_MS = 10_000` 的强制 flush（`useProjectAutosave.ts:174`），连续播放还会**每约 10 秒真的向后端 PUT 一次整工程**（`updateVideoProject`），进一步偷走主线程/网络。

> **评审补强（关键缺失引用）**：上文 `:151` 的 skip-equal 短路（`json === lastSavedJsonRef.current` 时 return）之所以**在播放期间始终失效**，前提是「持久化 payload 里含 `timelineCurrentTime`」。已核实：`normaliseProjectDataForSave`（`src/lib/api/videoProjects.ts:245-285`）→ `normaliseUiState`（`:287-307`）只剔除一组瞬态弹窗/标志位（`isPolishModalOpen`、`videoCutModal`、`scriptGenerationStartTime`…），而 **`timelineCurrentTime` 落在 `...keep` 中被保留**（`:304-306`）。因此每帧 `JSON.stringify(...)` 的结果都因播放头时间不同而不同 → skip-equal 永不命中 → autosave 既**每帧执行一次整工程 `JSON.stringify`**（无论是否最终 PUT，序列化开销在 `:147` 已发生），又**每 ~10s 真正 PUT 一次**。这条引用补上后，§3.4 的「每帧整工程序列化 + ~10s PUT」证据链闭合。
> 反向佐证：若 `timelineCurrentTime` **不**在 payload 中，则播放期间 json 恒等、skip-equal 会在 `:151` 命中并 return，autosave 将自然短路——这也正是修复方案 B 的可行性依据（把实时播放头移出持久化 payload 即可让 autosave 在播放期间自动静默）。

> 注：`setContent` 让顶层 `content` 每帧变化，而 `content` 又是 `VideoEditingInterface` 中**大量 hook/effect 的依赖**（如持久化 effect 自身的 `:302` 依赖、`useDocumentState(content,...)`、`useScriptGeneration(...,content)` 等），形成自我维持的整树重渲染风暴。

### 3.5 放大器三 + 二次正确性问题：prop 驱动 scrub 的「回声防护」在卡顿下失效，触发**回跳 seek**

时间回写还会反向流回 `currentTime` prop，驱动 scrub effect：
`src/components/video/hooks/useCompositionPlayback.ts:436`：
```ts
useEffect(() => {
  ...
  const last = lastSeekedTimeRef.current;
  if (last !== null && Math.abs(last - currentTime) < 1e-6) return;  // 回声防护
  lastSeekedTimeRef.current = currentTime;
  engine.seek(currentTime);   // 否则发起 seek（停时钟→forceSet→重启时钟→重绘）
}, [currentTime, enabled, hostVersion]);
```
`lastSeekedTimeRef` 在 §3.2 的 `setCurrentTime` 里被刷成「最新 tick 的 comp」。正常情况下 prop `currentTime` 与它相等（差 < 1e-6）→ 不 seek。**但当整树重渲染来不及跟上 60Hz 时**，某次 render 携带的 `currentTime`（较旧的时间）会落后于 `lastSeekedTimeRef`（已被后续 tick 刷到更新的时间），`Math.abs(last - currentTime) < 1e-6` 不再成立 → effect 用**一个偏旧的时间**调用 `engine.seek(currentTime)`，把播放头**往回跳**并 `clock.stop()/start()` 重锚时钟（`MultiTrackPlaybackEngine.ts:212`）。这会进一步加重顿挫，并形成自我强化的抖动。

历史代码本身就留有同源「风暴」的证据：`handleTimelineTimeChange` 为打断这条反馈环加了 0.05s「playback echo」门（`VideoEditingInterface.tsx:1533`、`:1542`，引用 timeline-playhead-resume-v3 §2.2.1 的「reverse-map storm」），但该门只挡住了**二次合成 seek 的往返**，并**没有**消除 §3.2–§3.4 的「60Hz 整树重渲染 + 每帧整工程序列化」开销。

### 3.6 为什么是「卡顿」而不是「黑屏 / 不解码」

- 视频帧本由各轨 `<video>` 解码元素独立完成，Canvas 仅 `drawImage(source)`（`CanvasCompositor.ts:295`），源解析 `resolveSequencePlaybackUrl` 是**纯函数、对同一素材返回稳定 URL**（`resolveSequencePlaybackUrl.ts:88`），因此**不存在每帧重设 `src`/重载视频**的问题——画面能出来。
- 真正被破坏的是 **rAF 绘制循环的节拍**：浏览器单主线程上，§3.2–§3.4 的 React commit + 双重 `JSON.stringify` 把每帧 16ms 预算吃光，`PlaybackClock` 的 rAF 回调被一再延迟/跳过 → 画面顿挫。这正是「画面能显示但播放不流畅」的成因。

### 3.7 已排除 / 次要项（避免后续返工）

| 假设 | 结论 | 依据 |
|---|---|---|
| 每帧重设 `<video>.src` 导致永久重载 | **排除** | `resolveSequencePlaybackUrl` 纯函数、URL 稳定（`resolveSequencePlaybackUrl.ts:100-191`）；`computeSourcePlan` 用同一 key 比对/赋值（`VideoSourcePool.ts:152`） |
| 每帧 `currentTime=` seek 风暴（解码重启） | **非主因** | seek 有 0.25s 去抖（`constants.ts:77`、`VideoSourcePool.ts:354`），且 `<video>` 自行 play 推进；仅在初次追帧/超重码率时偶发 |
| scrub 回跳 seek | **次要放大器**（§3.5） | 仅在重渲染落后于 60Hz 时被触发，是主根因的派生后果 |
| 主根因 | **§3.2–§3.4：60Hz「时钟→React 状态」+ 每帧整工程序列化 + autosave content churn** | 上述代码引用 |

---

## 四、影响面（Impact surface）

- **受影响功能**：所有进入「组合播放（composition）」模式的预览播放（点击 ▶ 播放剪辑轨道）。问题与素材来源无关（本地上传 / 远程缓存皆然），与是否单 clip 无关。
- **严重度随时间轴复杂度上升**：轨道/clip/字幕越多，每帧 `JSON.stringify(currentTimelineState)` 与重渲染越重，卡顿越明显。
- **附带副作用**：
  - 播放时 `useProjectAutosave` 因 content 每帧变化而被持续触发，约每 10s 向后端 PUT 整工程一次（无谓的网络/磁盘写、saving↔saved 抖动）。
  - 时间码 / 进度条 / 时间轴播放头在卡顿下更新不稳。
- **受影响用户**：所有使用本地剪辑预览播放的用户（桌面端为主要使用场景）。
- **不影响**：导出（export 走独立 ffmpeg 管线）、黑屏/无源等已修复问题。

---

## 五、候选修复方案对比（Candidate fixes）

> 本节仅作方案设计与权衡，**不在本节写修复代码**（交由 Subtask #2 实施）。

| 方案 | 做法 | 侵入性 | 风险 | 工作量 | 见效 |
|---|---|---|---|---|---|
| **A. 节流「时钟→React 状态」回写** | 把驱动 React 的时间回写从 ~60Hz 降到 ~8–12Hz（提高 `PLAYHEAD_THROTTLE_MS`，或在 `handleVideoTimeUpdate`/`onTimeUpdate` 处做 rAF 合并/节流）。Canvas/音频仍走引擎时钟、不受影响。 | 低（1–2 处） | 低（播放头数字读数从 60Hz 变 ~10Hz，肉眼可接受） | 小 | 整树重渲染频率降 5–8 倍，单独已显著缓解 |
| **B. 把「实时播放头时间」移出 content/autosave 持久化路径** | 让 `timelineCurrentTime` 的高频变化不再进入 `VideoEditingInterface` 的持久化 effect 与 `useProjectAutosave`（从持久化 payload 中剔除，或仅在 暂停/seek/卸载 时落盘）。 | 中（持久化 effect 依赖 + autosave normalise） | 中（需保证暂停/退出时仍正确保存播放位置） | 中 | 消除每帧双重整工程 `JSON.stringify` 与 setContent 级联，去掉最重的放大器 |
| **C. 播放头/光标彻底脱离 React（命令式）** | 播放头光标与时间码用 ref/直接 DOM 或专用低频 store 订阅更新，`VideoEditingInterface` 主树在播放时**完全不因时间而重渲染**（达芬奇式）。 | 高 | 中（改动播放头渲染、需回归测试） | 大 | 顶级体验，根治；但属较大重构 |
| **D. 修复 scrub 回声防护的竞态（§3.5）** | 播放中对 prop 驱动 scrub 的判定改为「仅在引擎非 playing 或位移超过明显阈值（真实用户拖动）时才 seek」，避免重渲染落后时的回跳 seek。 | 低 | 低 | 小 | 作为 A/B 的配套，消除二次抖动 |

---

## 六、推荐方案（Recommended fix）

**推荐：A + B 组合（最小且高收益），并附带 D 作为配套；C 作为后续「顶级体验」演进方向。**

**理由：**

1. **直击根因且改动可控**。卡顿的根因是「用 60Hz 动画时钟驱动 React 状态 + 每帧整工程序列化」。A 把 React 状态更新从 ~60Hz 降到 ~10Hz，B 把实时播放头从「触发整工程持久化/autosave」的路径上摘掉——两者合并即可让主线程从持续饱和中解放，`PlaybackClock` 的 rAF 绘制循环恢复稳定 60fps，画面随即流畅。

2. **不影响画面/音频正确性**。Canvas 绘制与音频同步本就由引擎时钟在 rAF 内直接驱动（`MultiTrackPlaybackEngine.ts:278` 的 `_renderAt` / `_audioPool.tick`），**不依赖** React 的 `timelineCurrentTime`。因此降低 React 回写频率**不会**让画面变卡或音画不同步——它只让「时间码/进度条/播放头数字」从 60Hz 刷新降为 ~10Hz，肉眼完全可接受。

3. **顺带消除副作用**。B 一并解决了播放期间 autosave 被无谓触发、每 ~10s PUT 整工程、saving↔saved 抖动的问题。

4. **D 收尾**。在 A/B 降频后，§3.5 的回跳 seek 概率已大幅下降；再把 scrub 判定改为「仅真实用户拖动/非播放态才 seek」即可彻底消除二次抖动，避免在低端机/复杂工程下偶发回跳。

**实施落点（供 Subtask #2 参考，非最终代码）：**
- A：`PlayheadController` 写 React 一侧的节流窗口从 `PLAYHEAD_THROTTLE_MS = 16`（`constants.ts:23`）提高到 ~100–125ms；或在 `handleVideoTimeUpdate`（`VideoEditingInterface.tsx:453`）/ `onTimeUpdate`（`VideoPlayerPanel.tsx:159`）处加节流。**注意**保持引擎时钟与 Canvas/音频仍为满帧（不要动 `PlaybackClock`/`_onTick` 的绘制频率）。
- B：将 `timelineCurrentTime` 从 `VideoEditingInterface.tsx:246` 持久化 effect 的「变更判定 + 依赖（`:271`/`:302`）」中解耦（播放时不因它触发 `onUpdateContent`）；并/或在 `normaliseProjectDataForSave`（`useProjectAutosave.ts:147`）中令 `timelineCurrentTime` 不参与 skip-equal 比较，使播放期间 autosave 自然短路；仅在暂停/seek/卸载时落盘播放位置。
- D：调整 `useCompositionPlayback.ts:436` 的 scrub effect 判定（区分「引擎自驱回声」与「真实用户拖动」）。
- 验证：DevTools Performance 录制确认播放期间不再出现每 16ms 的 `setTimelineCurrentTime`/`JSON.stringify` 串；`CompositorStats.targetFps` 维持 60 且丢帧率显著下降；时间轴/clip 增多后仍流畅。

---

## 附：关键证据索引（file:line）

- `src/components/video/playback/internal/constants.ts:23` — `PLAYHEAD_THROTTLE_MS = 16`（实质不节流）
- `src/components/video/playback/PlayheadController.ts:45-57` — ~60Hz 触发 `_onWrite`
- `src/components/video/playback/MultiTrackPlaybackEngine.ts:146-152, 260-272, 278-292` — 时钟回写绑定 + Canvas/音频由引擎时钟直接驱动
- `src/components/video/hooks/useCompositionPlayback.ts:334-342, 436-445` — facade 向上抛时间 + 易竞态的 scrub 回声防护
- `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:159-163` — 时间分发给 timeline/composition 两路
- `src/components/video/VideoEditingInterface.tsx:128, 453-460, 246-302, 511, 2643, 2664` — `useState` 播放头 + 每帧 `setTimelineCurrentTime` + 每帧整时间轴 `JSON.stringify` + onUpdateContent + 双面板消费
- `src/components/video/projects/VideoEditorContainer.tsx:154-159, 162` — `onUpdateContent → setContent → useProjectAutosave(content)`
- `src/components/video/projects/hooks/useProjectAutosave.ts:139-187` — 依赖 `content`、每帧整工程 `JSON.stringify`、`MAX_FLUSH_MS=10s` 强制 PUT
- `src/components/video/timeline/TimelinePanel.tsx:284-291` — `externalCurrentTime` 级联进 Zustand store（再触发时间轴重渲染）
- `src/components/video/VideoEditingInterface.tsx:1533-1554` — 历史 0.05s「playback echo」门（同源 storm 旁证，仅挡往返 seek）
- `src/components/video/lib/resolveSequencePlaybackUrl.ts:88-205` — 源解析为纯函数（排除每帧重载 `src`）
- `src/lib/api/videoProjects.ts:245-307` — `normaliseProjectDataForSave` / `normaliseUiState`：**保留** `timelineCurrentTime`（评审补强；autosave 链路闭合的关键）
- `src/components/video/playback/PlaybackClock.ts:2, 150-165` — rAF 主时钟：`_raf(() => this._onFrame())` → `_emitTick` → 引擎 `_onTick`，**Canvas 绘制与 React 状态回写同处一条主线程的 rAF 回调**（§3.6 机制的直接证据）
- `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:157` — `currentTime: currentTimelineTime ?? compositionCurrentTime`：把 60Hz 的 `timelineCurrentTime` 喂回 `useCompositionPlayback` 的 `currentTime` prop，**闭合 §3.5 的回声反馈环**
- `src/components/video/VideoEditingInterface.tsx:511, 515` — 每次 render 重算 `currentEffectiveVolume`（遍历全部轨道/项目）并将 `timelineCurrentTime` 喂入 `usePreviewTransport`，构成额外的每帧开销

---

## 评审结论（Review Verdict）

> 评审人：Anthropic 工程团队资深评审。评审动作：对 §三 的每一条 `file:line` 引用**逐条打开源码核对**（已核实清单见上「关键证据索引」+「评审补强」三条新增引用），并对 §五候选方案逐项做边界/最小化/回归审查。结论：**根因成立、证据链闭合**；推荐方案在补充若干边界约束后**采纳**。

### 一、根因证据审计结论：✅ 成立（airtight）

1. **被引代码确在失败路径上。** 用户复现路径（上传→拖入轨道→`playbackMode==='composition'`→点 ▶）正是 `useCompositionPlayback` + `MultiTrackPlaybackEngine` 驱动的合成预览路径。逐条核实：
   - `PLAYHEAD_THROTTLE_MS = 16`（`constants.ts:23`）→ `PlayheadController.reportCompositionTime` 的节流窗口（`PlayheadController.ts:54`）≈ 不节流（~60Hz）。**属实。**
   - 引擎 `_onTick` 在**同一 rAF 回调内**先 `_renderAt(comp,true)`（Canvas 绘制，`MultiTrackPlaybackEngine.ts:270`）再 `reportCompositionTime(comp)`（`:271`）；`PlaybackClock` 确为真实 rAF（`PlaybackClock.ts:152`）。即「画面绘制」与「触发 React 状态」**共用同一主线程**——这是「React 重活饿死 rAF 绘制」成立的物理前提。**属实。**
   - 回写链：`bindOnWrite → timeline.setCurrentTime`（`:146-152`）→ `setCurrentTime` 抛 `onTimeUpdate`（`useCompositionPlayback.ts:341`）→ 分发 `onTimelineTimeUpdate`（`VideoPlayerPanel.tsx:161`）→ `handleVideoTimeUpdate` 写**普通 `useState`** `setTimelineCurrentTime`（`VideoEditingInterface.tsx:459` / state 声明 `:128`）。**属实，整树 60Hz 重渲染成立。**
   - 放大器一（每帧两次整时间轴 `JSON.stringify` + `onUpdateContent`）：持久化 effect 的 `hasStateChanged` 因 `content.uiState?.timelineCurrentTime !== timelineCurrentTime` 在播放时**恒为 true**（`:271`），`timelineCurrentTime` 又在依赖数组里（`:302`）→ **每帧必跑**。**属实。**
   - 放大器二（autosave 每帧整工程序列化 + ~10s PUT）：`onUpdateContent === setContent`（`VideoEditorContainer.tsx:156`）→ `content` 每帧换新 → autosave effect 依赖 `[projectId, content]`（`useProjectAutosave.ts:187`）每帧跑、`:147` 每帧 `JSON.stringify`。**评审补强**已证 `timelineCurrentTime` 留在持久化 payload（`videoProjects.ts:304-306`）→ skip-equal（`:151`）永不命中 → `MAX_FLUSH_MS=10s`（`:35,:174`）下 ~10s PUT 一次。**属实。**
   - 放大器三（TimelinePanel 级联 Zustand store）：`externalCurrentTime`（=`timelineCurrentTime`）经 `TimelinePanel.tsx:284-291` 写入 timeline store（`>0.01s` 阈值，播放帧步进通常越过），再触发标尺/播放头/轨道订阅者重渲染。**属实**（注：该 0.01s 阈值令其略粗于 60Hz，但仍随帧率触发；方案 A 降频后同步降为 ~10Hz）。

2. **替代解释 / 反例已排除，且我复核无误。**
   - 「每帧重设 `<video>.src`」→ 排除：`drawImage(source,…)` 同步绘制既有元素（`CanvasCompositor.ts:295`），不涉及重设 src；源解析为纯函数。✅
   - 「每帧 seek 风暴」→ 非主因：`_ensureSeeked` 以 `VIDEO_SEEK_TOLERANCE_SEC=0.25` 去抖（`VideoSourcePool.ts:354,359-362` + `constants.ts:77`），稳态播放不会逐帧 seek。✅
   - 「`React.memo` 能否挡住重渲染」→ **不能**：`currentTimelineTime` / `externalCurrentTime` 两个 prop 每帧变化，即便子组件被 memo 也会因 prop 变化而重渲染。✅（这是评审新增核对项，进一步堵死反例）
   - 「症状是卡顿而非黑屏」与机制自洽：单主线程上 React commit + 双重 `JSON.stringify` 吃光每帧 16ms 预算 → rAF 绘制被推迟/跳过 → 顿挫。✅

3. **证据能解释观察到的症状**：①「时间轴越复杂越卡」与「每帧 `JSON.stringify(currentTimelineState)` 体量随轨道/clip 增长」强相关（解码开销不随 JS 序列化体量变化，故可证伪「解码跟不上」）；②「时间码/进度条更新不稳」与「整树 60Hz 重渲染被自身重活拖慢」一致；③「saving↔saved 抖动 / ~10s PUT」与 autosave 链路一致。三项症状均被证据覆盖。

**根因审计结论：证据链闭合，无悬空假设。**

### 二、候选修复审计（边界 / 最小化 / 回归）

| 方案 | 采纳 | 边界与回归审查（评审补充） |
|---|---|---|
| **A 节流「时钟→React」回写** | ✅ 必选 | (a) `forceSet`（用户 seek / 标尺拖动 / replay）**不经**节流（`PlayheadController.ts:61-66`），故用户交互仍即时——回归安全。(b) 节流只影响**回写 React** 的频率；引擎时钟以 wall-time 自推（`PlaybackClock._currentComp`），Canvas/音频**不依赖** React 时间，故降频**不影响画面/音画同步**。(c) **新增边界**：`reportCompositionTime` 的节流是「丢弃式」无 trailing-emit，且 `pause()`（`MultiTrackPlaybackEngine.ts:204-209`）**未** `forceSet` 播放头 → 暂停后 React 侧时间码/播放头可能滞后最多一个节流窗口（~100ms）。**要求 Subtask #2**：在 `pause()`/暂停转场时显式把精确 comp 落到 React（forceSet 或等价写入），保证停在哪、显示在哪（达芬奇级精度）。(d) 若直接抬高共享常量 `PLAYHEAD_THROTTLE_MS`，需同步更新引用该值的测试；**更稳妥**是在 React 边界（`handleVideoTimeUpdate`/`onTimeUpdate`）做节流/rAF 合并，保持引擎单写者语义不变。 |
| **B 播放头移出 content/autosave 持久化** | ✅ 必选 | (a) 去掉最重放大器（每帧双重整工程 `JSON.stringify` + setContent 级联 + ~10s PUT）。(b) **回归点**：必须保证**暂停/seek/卸载**时仍把最新播放位置写回 `content`，否则重开工程丢失播放头。`useProjectAutosave` 已有卸载 flush（`:191-`），但前提是卸载前 `content.uiState.timelineCurrentTime` 已是最新——若播放期间不再经 setContent 写入，需在 暂停/seek/卸载 钩子里补一次写入。(c) 仅从 §3.3 持久化 effect 的「变更判定 + 依赖」摘除 `timelineCurrentTime` 是安全的：该 effect 仍有其余依赖（modal、`currentTimelineState`、`agentMode`…）正常触发持久化。 |
| **D 修 scrub 回声防护竞态** | ✅ 配套必选 | (a) §3.5 的回跳 seek 在 A 降频后概率大降，但仍应根治。(b) **关键回归警示**：修复**不得**简单写成「playing 时不 seek」——那会**破坏「播放中用户拖动标尺 scrub」**（达芬奇允许）。正确判定应区分「引擎自驱回声」与「真实用户拖动」：建议在 playing 态用「与引擎**实时** `clock.getCompositionTime()` 比较」或「显式标记用户发起的 seek」，仅当差值超出明显阈值（真实跳转）时才 `engine.seek`；自驱回声（小差值）忽略。(c) 当前 `1e-6` 阈值（`useCompositionPlayback.ts:441`）过紧、易被 render 滞后击穿，是竞态根源。 |
| **C 播放头彻底脱离 React（命令式）** | ⏸ 本次不做 | 顶级体验的长期演进方向，属较大重构（改播放头渲染 + 回归测试面广）。**本 bug 不需要**它即可达到流畅；A+B+D 已让主线程从饱和中解放。列为后续 backlog，不纳入本次最小修复，避免扩大破坏面。 |

### 三、最终推荐修复（单一方案）

**推荐采纳：`A + B + D` 作为一个内聚修复包——「把 60Hz 实时播放头同时从 ① React 状态更新频率 与 ② content/autosave 持久化路径 上解耦，并加固 scrub 回声判定」。其中 A、B 为两条互不可替代的必选腿，D 为必选配套；C 明确延后。**

**为什么是这个、且是最小集：**

1. **直击根因的两个独立成本维度，缺一不可。** 卡顿 = 主线程被「时钟→React」链路打满、饿死 rAF 绘制。该链路有两个**正交**的成本来源：**(维度1) 状态更新频率**（60Hz 整树重渲染本身，含 TimelinePanel/VideoPlayerPanel/`currentEffectiveVolume` 重算/Zustand 级联）与 **(维度2) 单次更新的序列化重量**（每帧两次整时间轴 + 一次整工程 `JSON.stringify` + setContent 级联 + ~10s PUT）。
   - 只做 A 不做 B：复杂工程下，~10Hz × 「整工程序列化」仍会周期性 jank，且 ~10s PUT churn 仍在。
   - 只做 B 不做 A：每帧 `setTimelineCurrentTime` 仍触发 60Hz 整树重渲染（即便不再序列化），复杂时间轴的纯 reconciliation 仍可能饿死 rAF。
   - 故 **A 砍频率、B 砍每次重量**，二者正交且都必要——这正是「最小且充分」的组合，没有更小的单点改动能同时消除两个维度（不存在一行修复同时解决重渲染风暴与序列化风暴）。

2. **不引入画面/音画正确性回归。** Canvas 绘制与音频同步由引擎 rAF 时钟在 `_renderAt`/`_audioPool.tick` 内直接驱动（`MultiTrackPlaybackEngine.ts:270,289`），**不消费** React 的 `timelineCurrentTime`。降低 React 回写频率/移出持久化，**只**让「时间码/进度条/播放头数字」从 60Hz 降到 ~10Hz（肉眼可接受），不改变画面与音画同步。

3. **D 收口二次抖动，且其回归点已被识别并约束**（不得破坏播放中用户 scrub）。

4. **C 延后是正确的最小化决策**：达成「流畅播放」不需要命令式播放头重构，纳入只会扩大破坏面与回归测试成本。

**交付给 Subtask #2 的实施约束（验收口径）：**
- **A**：在「时钟→React」边界做 ~8–12Hz 节流（优先在 `handleVideoTimeUpdate`/`onTimeUpdate` 处做节流或 rAF 合并；若改 `PLAYHEAD_THROTTLE_MS` 则同步修测试）。**保持引擎时钟/Canvas/音频满帧不动**。**暂停时务必 forceSet 精确 comp 到 React**（边界 A-c）。
- **B**：令 `timelineCurrentTime` 的高频变化不再经 `onUpdateContent → setContent` 进入 autosave（从持久化 effect 的变更判定 + 依赖中解耦，或令其不参与 `normaliseProjectDataForSave` 的 skip-equal）；**在 暂停/seek/卸载 时仍写回最新播放位置**到 `content`，保证重开恢复（边界 B-b）。
- **D**：重写 `useCompositionPlayback.ts:436-445` 的 scrub 判定，区分引擎自驱回声 vs 真实用户拖动；**保留「播放中用户 scrub」能力**（边界 D-b）。
- **验证口径**：DevTools Performance 录制确认播放期间不再出现每 16ms 的 `setTimelineCurrentTime`/`JSON.stringify` 串；引擎合成 fps 维持 ~60 且丢帧显著下降；时间轴/clip 增多后仍流畅；暂停后播放头/时间码停在精确位置；播放中拖动标尺仍可 scrub；重开工程恢复到上次播放位置；播放期间不再产生周期性 PUT（saving↔saved 抖动消失）。

**Definition of Done 对照**：本节已点名**单一推荐修复（A+B+D 内聚包，C 延后）**并给出充分理由；§三证据链经逐条源码核对闭合，并补全了 autosave 链路此前缺失的关键引用（`normaliseUiState` 保留 `timelineCurrentTime`）与 rAF 主线程共享、回声闭环两处佐证引用。评审通过，可进入 Subtask #2 实施。
