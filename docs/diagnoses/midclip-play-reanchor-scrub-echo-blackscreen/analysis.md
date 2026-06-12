# 剪辑轨道视频「从中间起播仍黑屏」第 3 轮 — 问题定位与分析

- **Bug slug**: `midclip-play-reanchor-scrub-echo-blackscreen`
- **诊断节点**: Subtask #0（问题定位与分析，本节点不落修复代码）
- **日期**: 2026-06-12
- **AgentMesh 轮次**: 第 3 轮
- **前序产出**: 第 1 轮 `09bbc0a`（引擎起播握手 reanchor + in-flight seek 守卫 + A2 防御补画）、第 2 轮 `8db055f`（后端 `storage_files_router` 实现 RFC 7233 Range/206，使中段 seek 在 HTTP 层可满足）
- **结论一句话**: 第 2 轮的 HTTP Range 让「从 0 起播」与「暂停态拖到中段」都能正常出图，但**「从中段点击播放」仍黑屏**。根因是**第 1 轮引擎握手的 `clock.reanchor(targetComp)` 与第 1 轮卡顿修复 D 的「scrub 回声容差」在编排层（`useCompositionPlayback`）发生新的破坏性交互**：慢冷 seek 落定时握手把合成时钟**向后跳回** seek 目标，而这段冷 seek 期间引擎一直把**自由奔跑的 comp** 通过节流镜像推给 React（`MultiTrackPlaybackEngine.ts:315`）。reanchor 之后，React 侧 `currentTime` 比引擎实时 comp **领先了「冷 seek 时长」**，一旦超过 `PLAYBACK_SCRUB_ECHO_TOLERANCE_SEC = 0.35s`，`useCompositionPlayback` 的 scrub effect 就把这个陈旧值**误判为用户真实拖动**并重新 `engine.seek(陈旧值)`，把刚落定的解码元素**前向硬拽**进一次新的冷 seek → 再 reanchor → 再误判 → **自持螺旋 → 持久黑屏**。「从 0 起播」无需 seek、无 reanchor、不产生这种偏差，因此免疫——这正是「最开始能播、中间黑屏」的精确成因。

> 与前两轮的边界：第 1 轮根除的是**引擎内部**螺旋（`_ensureSeeked` 落定后仍前向硬拽 → 用握手 reanchor-on-settle 断开）。第 2 轮补的是**HTTP 层**可 seek（Range/206）。本轮是第三条**独立且尚未触及**的链路：握手的 reanchor 在**编排层**被 scrub-echo 守卫重新放大成 `engine.seek()` 误触发。三轮各治一段，互不替代。

---

## 一、问题描述（Problem description）

在素材面板上传本地视频 → 拖入下方剪辑轨道 → 在预览面板播放：

- **把播放头放在视频素材最开头（合成时间 0 / clip 起点）点击播放：能正常流畅预览。**
- **把播放头放到该视频素材的中间任意位置点击播放：无法预览播放，画面黑屏。**

即：可播放性仍与「起播位置是否为 clip 起点」强相关。区别于前两轮，本轮的 HTTP Range 已落地，因此：
- 「暂停态拖到中段」通常**能看到中段那一帧**（单次 seek 的 `seeked` 已可满足、就绪重绘补画成功）；
- 「从 0 起播」**能流畅播放**；
- **唯独「从中段点击播放」持续黑屏**——问题已从「全程黑」收敛为「中段起播黑」，说明 HTTP 层已修复，残留缺陷在播放控制链路。

---

## 二、复现步骤（Reproduction steps）

### 2.1 用户路径复现（任何人可照做）

1. 启动应用（桌面端打包版本，或前端 `npm run dev` + 后端）。建议用一段**码率较高 / 时长 ≥ 20s** 的本地视频（中段 seek 越「冷」、缓冲越久，越稳定复现）。
2. 进入视频剪辑界面（`VideoEditorContainer` → `VideoEditingInterface` → `VideoPlayerPanel`/`PreviewCanvas`），进入 `playbackMode === 'composition'`（合成预览）。
3. 上传该视频并添加到剪辑轨道。
4. **对照组（能播）**：确保播放头在时间轴最左端（合成时间 0），点击播放 ▶ → 流畅播放。
5. **实验组（黑屏）**：把播放头拖到该 clip 中段（例如第 10 秒，暂停态此时多半能看到第 10 秒那一帧）→ 点击播放 ▶ → **预览 `<canvas>` 转为黑屏 / 仅偶尔闪一帧后又黑**，无法稳定推进。
6. 规律：起播位置越靠后、素材码率越高（冷 seek 越久），越稳定复现；起播位置 0 永不复现。

### 2.2 DevTools 量化确认（现场证据采集法）

1. 在「中段点击播放黑屏」现场打开 DevTools → Console，打开预览逐轨道诊断（`src/components/video/playback/internal/previewDebug.ts`，`isPreviewDebugEnabled()` 开关）。
2. 预期观察到**周期性**现象（不是一次性、而是反复）：每隔一个 seek 周期，`readyState` 在 4 与 <2 之间反复跳变、`seeking` 反复 true、`currentTime` 被反复**前向跳大**（例如 10.0 → 10.6 → 11.2…一路被向前拽）、`drawn` 偶有增量后又归零、`dropped` 持续增长。
3. 关键判据（区别于第 1/2 轮的「单调黑」）：**`<video>.currentTime` 被周期性、阶梯式地向前重赋**（每次重赋 ≈ 上一次冷 seek 的时长）。这正是 scrub effect 周期性误触发 `engine.seek(陈旧 React 值)` 的指纹。
4. 在 React DevTools / 日志里观察父级 `timelineCurrentTime`：起播瞬间会先**向前冲到** 10.6/11.2…（自由奔跑 comp 的节流回声），随后引擎 reanchor 把内部 comp 拉回 10.0，两者出现 > 0.35s 的瞬时背离窗口。
5. 对照：从 0 起播时，诊断行很快稳定为 `readyState=4`、`drawn` 单调增长、`currentTime` 单调平滑前进、无周期性跳变。

> 主要证据为代码引用（第三节，不可辩驳）；DevTools 现场为可量化佐证。无法在本节点内启动桌面端实采日志，故以「代码链路 + 时序推演」给出根因，并在 §六给出可一次性证伪/证实的最小验证。

---

## 三、根因分析（Root cause analysis — 含证据）

### 3.1 合成预览的两层结构

合成预览由**两层**协作：

- **引擎层** `MultiTrackPlaybackEngine`（唯一 rAF 时钟 `PlaybackClock`）：每 tick `_renderAt` → `VideoSourcePool.sync`（赋 src / seek 解码元素）→ `CanvasCompositor.renderFrame`（`readyState<2` 的源跳过绘制、只铺黑底）。
- **编排层** `useCompositionPlayback`（React Hook，prop 驱动）：把父级 `currentTime` / `isPlaying` 翻译成 `engine.seek()` / `engine.play()`；并把引擎时钟**节流镜像**回父级 React 状态（卡顿修复 A，10Hz）。

本轮缺陷正是**这两层之间**的交互，而非任一层单独的逻辑。

### 3.2 第 1 轮握手：落定时把时钟**向后**跳回 seek 目标

第 1 轮为「从非零位置起播」装了握手：起播时 `_armStartReanchor(targetComp)`，监听 lead 解码元素的 `seeked`/`playing`，落定后把时钟 `reanchor(targetComp)` 对齐解码。

`src/components/video/playback/MultiTrackPlaybackEngine.ts:474-489`（握手 handler）：
```ts
const handler = () => {
  if (this._disposed) return;
  if (this.getPhase() === 'playing') {
    this.clock.reanchor(targetComp);        // ← 把 comp 拉回 targetComp
    this._renderAt(targetComp, true);       // A1：命中即出图
  }
  this._disarmStartReanchor();
};
```
`src/components/video/playback/PlaybackClock.ts:101-105`（reanchor 即移动时间基锚点）：
```ts
reanchor(compositionTime: number): void {
  this._baseCompositionTime = Math.max(0, compositionTime);
  this._baseWallTime = this._now();
  this._lastTickWall = this._baseWallTime;
}
```
**关键**：冷 seek 期间合成时钟一直**自由奔跑**（墙钟推算，`PlaybackClock.ts:146-148`）。例如从 comp=10 起播，冷 seek 耗时 600ms，落定瞬间 comp 已自由跑到 ~10.6；`reanchor(10)` 把 comp **从 10.6 向后跳回 10.0**——一次幅度等于「冷 seek 时长」的**向后跳变**。这是第 1 轮设计的正确意图（让 comp 对齐解码元素的真实位 10.0），但它制造了下一节的副作用。

### 3.3 冷 seek 期间，引擎把**自由奔跑的 comp** 一路推给 React（节流镜像）

`src/components/video/playback/MultiTrackPlaybackEngine.ts:314-315`（`_onTick`，**握手未决时也照推**）：
```ts
this._renderAt(comp, true);
this.playhead.reportCompositionTime(comp);   // ← comp 是自由奔跑值，冷 seek 期间一路上推
```
`reportCompositionTime` 经 `PlayheadController` 写回编排层 facade 的 `setCurrentTime`：

`src/components/video/hooks/useCompositionPlayback.ts:364-374`：
```ts
setCurrentTime: (t: number) => {
  currentTimeRef.current = t;
  lastSeekedTimeRef.current = t;
  pushReactTime(t, false);                   // ← 节流 100ms 推给父级 React 状态
},
```
于是在 600ms 冷 seek 窗口里，父级 `currentTime`（React 状态）被**阶梯式上推**到 10.1 → 10.2 → … → 10.6（每 `REACT_PLAYHEAD_THROTTLE_MS = 100ms` 一档，`constants.ts:34`）。**注意：此刻 `<video>` 的真实解码位还停在冷 seek 目标 10.0 附近、`readyState<2`，画面是黑的；但 React 侧 `currentTime` 已经「假装」播到了 10.6。**

### 3.3.1 闭环回灌路径已逐跳核实（评审补全）

§3.3 断言「引擎上报的自由奔跑 comp 会作为 `currentTime` prop 回灌到 §3.5 的 scrub effect」。评审已把这条回路逐跳核到 HEAD 源码，回路确实闭合：

`src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:157-163`：
```ts
currentTime: currentTimelineTime ?? compositionCurrentTime,   // ← 引擎 currentTime prop 的来源
onTimeUpdate: (time: number) => {
  compositionCurrentTimeRef.current = time;
  if (onTimelineTimeUpdate) onTimelineTimeUpdate(time);        // ← 引擎上报 → 父级
  if (onCompositionTimeUpdate) onCompositionTimeUpdate(time);
},
```
`src/components/video/VideoEditingInterface.tsx:496-503`（`onTimelineTimeUpdate` 落点）：
```ts
const handleVideoTimeUpdate = useCallback((currentTime: number) => {
  playbackDrivenTimeUpdateRef.current = currentTime;
  setTimelineCurrentTime(currentTime);                        // ← 直接写 timelineCurrentTime 状态
}, []);
```
`timelineCurrentTime` 经 `currentTimelineTime={timelineCurrentTime}`（`VideoEditingInterface.tsx:2686`）→ `VideoPlayerPanel` 的 `currentTimelineTime` → 上面第 157 行的 `currentTime` prop → `useCompositionPlayback` 的 scrub effect（`:489`，deps `[currentTime, ...]`）。

**闭环坐实**：`_onTick.reportCompositionTime(自由奔跑 comp)`（节流 100ms）→ `setTimelineCurrentTime(comp)` → `currentTime` prop → scrub effect。注意 `handleVideoTimeUpdate` **无条件** `setTimelineCurrentTime`（它自身不带回声门；interface 层那道 `playbackDrivenTimeUpdateRef` 0.05 回声门只挡 store→interface 这条**另一条**回路），所以引擎的自由奔跑值确实抵达 scrub effect，中途无拦截。

### 3.4 reanchor 之后，React 侧 `currentTime` 比引擎实时 comp **领先「冷 seek 时长」**

§3.2 的 `reanchor(10)` 把引擎内部 comp 拉回 10.0，但 §3.3 已把 React 侧 `currentTime` 推到了 10.6，且 reanchor 的 `_renderAt(10, true)` **不**回推 React（只有 `_onTick` 才 `reportCompositionTime`）。于是出现一段背离窗口：

> **引擎实时 comp ≈ 10.0，React 侧 `currentTime` ≈ 10.6，背离 ≈ 0.6s = 冷 seek 时长。**

### 3.5 编排层的 scrub-echo 守卫把这个陈旧值**误判为用户拖动**，重新 `engine.seek()`

卡顿修复 D 给「播放中的 prop 变化」装了回声容差：只有当 prop `currentTime` 与引擎实时 comp 背离**不超过** `PLAYBACK_SCRUB_ECHO_TOLERANCE_SEC` 时才当作引擎自身回声而忽略；否则视为用户真实拖动并重新 seek。

`src/components/video/hooks/useCompositionPlayback.ts:489-521`（scrub effect 关键分支）：
```ts
if (
  engine.getPhase() === 'playing' &&
  typeof engine.getCompositionTime === 'function'
) {
  const live = engine.getCompositionTime();           // reanchor 后 ≈ 10.0
  if (
    Number.isFinite(live) &&
    Math.abs(live - currentTime) <= PLAYBACK_SCRUB_ECHO_TOLERANCE_SEC  // |10.0-10.6|=0.6 > 0.35
  ) {
    return;                                            // ← 背离 > 容差，未命中此 return
  }
}
lastSeekedTimeRef.current = currentTime;
currentTimeRef.current = currentTime;
engine.seek(currentTime);                              // ← 误把陈旧的 10.6 当用户拖动，前向 seek！
```
`src/components/video/playback/internal/constants.ts:45`：
```ts
export const PLAYBACK_SCRUB_ECHO_TOLERANCE_SEC = 0.35;
```
**冷 seek 时长 > 0.35s 时**（中段冷 seek + 高码率解码极易超过），`|live - currentTime|` 越过容差，回声守卫失效，scrub effect 调用 `engine.seek(10.6)`。

### 3.5.1 第一道 `< 1e-6` 守卫为何不拦截（评审补全 —— 最关键的一处证据缺口）

§3.5 引用的代码块从 `engine.getPhase() === 'playing'` 起，**略过了 scrub effect 的第一道守卫**。评审认为这是最容易被质疑的一环（「facade 每 tick 都把 comp 同写进 `lastSeekedTimeRef`，第一道 `|last - currentTime| < 1e-6` 守卫难道不该把这次回灌当成自发更新而直接 return 吗？」），必须补全。

`src/components/video/hooks/useCompositionPlayback.ts:493-494`（被略过的第一道守卫）：
```ts
const last = lastSeekedTimeRef.current;
if (last !== null && Math.abs(last - currentTime) < 1e-6) return;   // 仅挡「完全相等」
```
**关键时序差**：`facade.setCurrentTime` 以 **full ~60Hz** 把**最新** comp 写进 `lastSeekedTimeRef`（`:369-370`），而 `pushReactTime` 把同一值以 **100ms 节流**推给 React（`:373`、`:326`）。于是 `lastSeekedTimeRef` 永远是**最新值**，`currentTime` prop 是**滞后一截的节流值**——两者除「节流刚命中且其后无新 tick」的瞬间外**几乎从不相等**。reanchor 之后这条差距被进一步放大：

- reanchor 把引擎内部 comp 拉回 10.0，`_renderAt(10.0)` 令 `getCompositionTime()` / `_lastRenderComp = 10.0`；
- reanchor 之后**紧随的下一帧常规 tick** 立刻 `setCurrentTime(≈10.0)`，把 `lastSeekedTimeRef` 刷回 ≈10.0（reanchor 自身的 `_renderAt(targetComp,true)` **不** `reportCompositionTime`，但其后的 `_onTick` 会）；
- 而 React 侧 `currentTime` prop 仍卡在 reanchor 前最后一次节流推送的 **10.6**（节流窗未到，10.0 还没被推上去）。

于是 scrub effect 以 `currentTime = 10.6` 触发、却在执行时读到 `lastSeekedTimeRef ≈ 10.0`：
- 第一道守卫：`|10.0 - 10.6| = 0.6 ≫ 1e-6` → **不 return**；
- 第二道守卫（回声容差）：`live = getCompositionTime() ≈ 10.0`，`|10.0 - 10.6| = 0.6 > 0.35` → **不 return**；
- → `engine.seek(10.6)` 误触发。

**结论**：两道守卫都被同一个背离击穿——「reanchor 把 `live`/`last` 拉回 10.0，而 React prop 滞后停在 10.6」。这既回答了「第一道守卫看似该拦却为何拦不住」，也正是方案 A「握手期间根本不让 React 侧跑到自由奔跑值」能从结构上消灭背离的原因：握手期 React 侧恒等于 targetComp，落定后两侧从同一点 10.0 起步，`|last - currentTime|` 与 `|live - currentTime|` 都恒落在容差内。

> 触发该螺旋的充分条件：在 reanchor 与「带陈旧 prop 的 scrub effect 执行」之间，至少跑过一帧 reanchor 后 tick 把 `lastSeekedTimeRef` 刷回 ≈targetComp。rAF 60Hz、React effect 在一次提交后才跑（≥16ms），该条件实际必然成立——故螺旋稳定复现，与 §2.2「`currentTime` 阶梯式前向跳变」指纹自洽。

### 3.6 `engine.seek(陈旧值)` 把刚落定的元素**前向硬拽**进新冷 seek → 螺旋自持

`engine.seek(10.6)`（playing 分支，`MultiTrackPlaybackEngine.ts:248-264`）：`clock.start(10.6)` → `_renderAt(10.6,true)` → `_armStartReanchor(10.6)`。其内：

`src/components/video/playback/VideoSourcePool.ts:377-391`（`_ensureSeeked`）：
```ts
if (el.seeking === true || el.readyState < 2) return;            // 元素刚落定：seeking=false、readyState=4 → 守卫放行
if (Math.abs(el.currentTime - targetSourceTime) > this._seekTolerance) {  // |10.0 - 10.6| = 0.6 > 0.25
  this._assignCurrentTime(el, targetSourceTime);                // ← 重新赋值 currentTime=10.6 → 一次新的冷 seek
}
```
于是刚落定（10.0、可画）的解码元素被**前向硬拽到 10.6**，`readyState` 再次掉到 <2、`seeking` 再起 → `CanvasCompositor` 又只铺黑底。这次新冷 seek 又耗 ~600ms、comp 又自由跑到 11.2、新握手又 reanchor(10.6) 向后跳、React 侧又被推到 11.2 → 又一次 > 0.35 背离 → scrub effect 又 `engine.seek(11.2)`……

> **闭环**：`冷 seek（黑） → 落定 reanchor 向后跳 → React 镜像滞后领先 >0.35 → scrub effect 误触发前向 engine.seek → 新冷 seek（黑）`。每个周期画面只在「落定」与「被拽走」之间闪一帧，**净观感即持久黑屏 / 偶闪**，与 §2.2 的「`currentTime` 阶梯式前向跳变」指纹一致。

### 3.7 为什么「从 0 起播」免疫

从合成时间 0 起播：起播位置在 `attach` 阶段（`MultiTrackPlaybackEngine.ts:177` `_renderAt(getCurrentTime()=0,false)`）即已加载，`readyState` 通常达 4；`play()` 后第一帧就 `seeked`/`playing` 极快落定（亚 0.35s），握手 reanchor 的向后跳幅度 ≈ 0、`_ensureSeeked` 不触发新 seek；**comp 与 React 镜像始终落在 0.35 容差内** → scrub effect 永不误触发 → 流畅。二者唯一差别：**中段需要一次「时长 > 容差」的真实冷 seek，从而触发 reanchor 向后跳 + 镜像滞后越界**；位置 0 无此 seek。

### 3.8 排除竞争假说（确认根因唯一性 / 与前两轮不重叠）

- **HTTP 层仍不可 seek（第 2 轮没修好）**：已核对后端 `storage_files_router.py:151-301` 的 RFC 7233 实现正确——开放区间 `bytes=N-` 取 `end=file_size-1`（`:191`）流到 EOF、`Content-Range/Content-Length/Accept-Ranges` 正确、416 正确；Next 透传代理 `storage/files/[...path]/route.ts` 以 `forwardHeaders:['range','cookie']` + `responseHeaderAllowlist` 放行，`backend-proxy.ts:305-330` 保留 `backendResponse.status`(206) 并流式透传。**故 HTTP 层可 seek，暂停拖到中段能出帧即旁证**——若 HTTP 层仍坏，暂停态中段也应黑。→ 排除。
- **握手绑错元素 / 元素 churn**：`PreviewCanvas.tsx:147-161` `resolveTrackElements` 用 `videoPoolRef` 缓存、按 trackId 返回**同一** `<video>` 实例；握手绑定的元素与 `_apply` 里被 seek 的是同一个。→ 排除。
- **URL/源解析错误（RC-B）**：URL 与起播位置无关，错则两端皆黑；且 `resolveSequencePlaybackUrl` 锁定 options（`useCompositionPlayback.ts:296-299`）。→ 排除。
- **时间映射错误**：映射错会画**错帧**而非黑屏；暂停态中段能画出正确帧反证映射正确。→ 排除。
- **引擎内部螺旋未根除（第 1 轮没修好）**：第 1 轮的 reanchor-on-settle + in-flight 守卫确实断开了**纯引擎内**螺旋（`MultiTrackPlaybackEngine.test.ts:724-748` 已覆盖「落定后不再被前向硬拽」）。但该测试**用 facade stub（`setCurrentTime: () => undefined`）屏蔽了编排层**，因此**测不到** §3.5 的「React 镜像滞后 → scrub effect 误触发 `engine.seek`」这条**跨层**回灌路径。→ 这正是残留缺口所在，非与第 1 轮重复。

→ 根因收敛唯一：**握手 reanchor 的「向后跳」 × 自由奔跑 comp 的「节流镜像」 × scrub-echo 守卫的「越界即重 seek」三者在编排层叠加，形成跨层自持螺旋**。

---

## 四、影响面（Impact surface）

- **受影响功能**：合成预览（`playbackMode === 'composition'`）下**从任何「需要 > 0.35s 冷 seek 的中段位置」点击播放**。包括：拖动标尺到中段后播放、暂停在中段后续播、跳关键帧后播放，以及**播放中拖动标尺到远处**（`seek(while playing)` 同样 `_armStartReanchor`，`MultiTrackPlaybackEngine.ts:258`，同受螺旋）。
- **受影响用户/场景**：所有从非起点起播预览的用户。素材码率越高 / 时长越长 / 起播越靠后，冷 seek 越久，越稳定触发——即「最像达芬奇的中段精修」场景反而最易黑屏。
- **严重度**：高。中段起播是剪辑最高频操作之一；本缺陷使「顶级顺滑预览」目标在最常见路径上失效。
- **不受影响**：从合成时间 0 起播；暂停态查看中段帧（单次 seek，就绪重绘自救）；导出（走后端合成，不经此 rAF/编排链路）。
- **关联**：本轮缺陷由第 1 轮握手（`09bbc0a`）与卡顿修复 D（`PLAYBACK_SCRUB_ECHO_TOLERANCE_SEC`）的交互引入；第 2 轮 Range（`8db055f`）使冷 seek「可满足但仍需时间」，恰好把这条交互从「全程黑」暴露成「中段起播黑」。

---

## 五、候选修复方案（Candidate fixes）

> 本节仅做方案对比，**不在本节点落代码**（节点约束）。三方案都可独立闭合根因；可叠加加固。

| 方案 | 核心做法 | 侵入性 | 风险 | 工作量 | 是否单独足够 |
|---|---|---|---|---|---|
| **A. 握手未决期间不向 React 镜像「自由奔跑的 comp」**（堵住 §3.3 的源头） | `MultiTrackPlaybackEngine._onTick`：当 `this._startReanchor != null`（冷 seek 在途）时，**跳过/改写** `playhead.reportCompositionTime(comp)`——要么不推、要么推 `targetComp`（seek 目标）而非自由奔跑值。这样冷 seek 期间 React 侧 `currentTime` 始终停在 seek 目标，reanchor 落定后**两侧零背离**，scrub-echo 守卫永不越界。落定后恢复正常上报。 | 极小（1 处 `_onTick` 加 1 个 if，并需把 `targetComp` 暴露给 `_onTick`，例如存进 `_startReanchor`） | 低（仅影响「握手未决」这段亚秒窗口的 React 回声，画面/音频由 rAF 拥有不受影响） | 极小 | **是**（直击 §3.4 背离来源） |
| **B. scrub effect 在「引擎刚 reanchor / 握手刚落定」后短暂免疫**（堵住 §3.5 的误判） | 引擎在 reanchor 时记录一个「刚 reanchor」标记（或暴露 `getLastReanchorWall()`）；`useCompositionPlayback` 的 scrub effect 在该标记后的一个节流窗口（~150–250ms）内，对「playing 态 prop 变化」一律按回声忽略，不 `engine.seek`。 | 小（引擎暴露 1 个信号 + Hook 加 1 个时间窗判断） | 中（时间窗取值需兼顾「真·用户拖动」的最坏延迟，过宽会吞掉紧跟 reanchor 的真实拖动） | 小 | 是（但属「事后补救」，不如 A 干净） |
| **C. 握手 reanchor 改为「锚到元素真实 `currentTime`」并同步回灌 React**（结构对齐） | handler 落定时 `reanchor(el.currentTime 对应 comp)` 而非固定 `targetComp`，并在 reanchor 后**一次性 `force` 回推该 comp 到 React**（`pushReactTime(t, true)` 等价物 + 同步 `lastSeekedTimeRef`），令两侧原子对齐。 | 中（动到握手目标语义 + 需引擎主动 force-flush 一次 React，跨层写） | 中（force-flush 与节流/回声判定的次序需谨慎，避免新抖动） | 中 | 是（兼顾「锚到真实解码位」更鲁棒，但改动面比 A 大） |

---

## 六、推荐方案（Recommended fix）

**推荐方案 A 为单一载荷修复（握手未决期间不把自由奔跑的 comp 镜像给 React），可选叠加 B 作为防御；C 留作后续结构演进。**

理由（airtight）：

1. **直击唯一根因的源头**：§3.8 已排除一切替代解释，根因锁定为「reanchor 向后跳 + 冷 seek 期间镜像自由 comp + scrub-echo 越界重 seek」三者叠加。方案 A 从**最上游**截断——冷 seek 期间根本不让 React 侧 `currentTime` 跑到自由奔跑值，于是 §3.4 的「reanchor 后两侧 > 0.35 背离」**从结构上不再产生**，§3.5 的误判、§3.6 的前向硬拽、§3.7 的螺旋随之全部消失。
2. **最小且对症**：A 仅改 `MultiTrackPlaybackEngine._onTick` 一处（`:315` 外包一层 `if (!this._startReanchor)` 或改推 `targetComp`），并把 `targetComp` 记入 `_startReanchor` 供 `_onTick` 读取。不触音频/转场/多轨统一时间基，不动 HTTP 层，不动第 1/2 轮的承重逻辑。
3. **语义自洽**：冷 seek 期间的「自由奔跑 comp」本就是**临时的、尚未被解码证实**的值（画面此刻是黑的、解码还停在 seek 目标）。把这种「未兑现」的 comp 推给父级时间码本身就是错误回声——A 让 React 侧时间码在握手未决期间**忠实停在 seek 目标**，落定后再恢复推进，反而更符合「时间码 = 当前真正显示的帧」语义（与 `getCompositionTime()` 用 `_lastRenderComp` 的既有取向一致）。
4. **回归可控**：仅在「握手未决」这段亚秒窗口改变 React 回声；位置 0 快路径无握手未决期，零影响；播放中拖到远处的 `seek(while playing)` 也复用同一握手，自动受益。
5. **可测、守护回归**：现有 `MultiTrackPlaybackEngine.test.ts` 的 cold-seek harness 用 `setCurrentTime: () => undefined` 屏蔽了编排层，**测不到本 bug**；修复需补**跨层回归**：用真实/拟真的 facade（记录 `setCurrentTime` 被推的值），断言「握手未决期间 React 侧不被推到自由奔跑值（仍为 seek 目标）」「冷 seek 落定 reanchor 后，`|live - reactCurrentTime| ≤ 0.35`，scrub effect 不再触发 `engine.seek`」「`<video>.currentTime` 不出现 §2.2 的阶梯式前向跳变」。满足「修 bug 先写可复现测试」规范。

**落地要点（供 Subtask #2 实施时参考，非本节点产物）**：
- 在 `StartReanchorHandshake` 上保存 `targetComp`；`_onTick` 在 `this._startReanchor != null` 时，跳过 `playhead.reportCompositionTime(comp)`（或改为上报 `this._startReanchor.targetComp`），握手 disarm 后恢复常规上报。
- 可叠加 B：引擎在 reanchor 时打「刚 reanchor」时间戳，`useCompositionPlayback` scrub effect 在其后一个节流窗内对 playing 态 prop 变化按回声忽略，作为防御性二道闸。
- 验收：按 §二 复现，从 0 与从中段（用高码率长素材）分别起播，均应在 ≤1 个 seek 周期内出图并持续流畅；逐轨道诊断不再出现 `currentTime` 阶梯式前向跳变与 `readyState` 周期性 <2；回归校验第 1 轮（`09bbc0a`，从中段冷 seek 落定后不被引擎内部硬拽）与第 2 轮（`8db055f`，Range/206）均未退化。

---

## 七、关键证据索引（便于评审复核）

| 证据 | 位置 | 说明 |
|---|---|---|
| 握手落定把 comp **向后**跳回固定 targetComp | `src/components/video/playback/MultiTrackPlaybackEngine.ts:478` | `clock.reanchor(targetComp)`；reanchor 仅移锚点 `PlaybackClock.ts:101-105` |
| 冷 seek 期间引擎推**自由奔跑 comp** 给 React | `src/components/video/playback/MultiTrackPlaybackEngine.ts:314-315` | `_onTick` 在握手未决时也 `reportCompositionTime(comp)` |
| comp 经节流镜像写回父级 React | `src/components/video/hooks/useCompositionPlayback.ts:364-374` | facade `setCurrentTime` → `pushReactTime(t,false)`（10Hz） |
| 引擎上报**回灌为 `currentTime` prop**（闭环坐实，评审补全） | `VideoPlayerPanel.tsx:157-163`、`VideoEditingInterface.tsx:496-503`、`:2686` | `onTimeUpdate → setTimelineCurrentTime → currentTimelineTime → currentTime` prop；`handleVideoTimeUpdate` 无条件写状态 |
| 第一道 `<1e-6` 守卫只挡「完全相等」、不挡节流滞后背离（评审补全） | `src/components/video/hooks/useCompositionPlayback.ts:493-494` | `lastSeekedTimeRef`（60Hz 最新）与 `currentTime`（100ms 节流滞后）几乎从不相等，reanchor 后差距 ≈ 冷 seek 时长 |
| 节流窗 100ms | `src/components/video/playback/internal/constants.ts:34` | `REACT_PLAYHEAD_THROTTLE_MS = 100` |
| scrub-echo 守卫：背离 > 容差即重 seek | `src/components/video/hooks/useCompositionPlayback.ts:505-520` | `|live - currentTime| <= 0.35` 才忽略，否则 `engine.seek(currentTime)` |
| 回声容差 0.35s | `src/components/video/playback/internal/constants.ts:45` | `PLAYBACK_SCRUB_ECHO_TOLERANCE_SEC = 0.35` |
| 误触发的 seek 把落定元素前向硬拽 | `src/components/video/playback/VideoSourcePool.ts:377-391` | `_ensureSeeked`：元素落定后守卫放行 → 重赋 `currentTime` → 新冷 seek |
| `seek(while playing)` 同样装握手（同受螺旋） | `src/components/video/playback/MultiTrackPlaybackEngine.ts:248-264` | 播放中远距拖动同路径 |
| HTTP 层已可 seek（排除第 2 轮未修好） | `backend-services/basic-service/app/routers/storage_files_router.py:151-301`、`src/lib/api/server/backend-proxy.ts:305-330` | 开放区间流到 EOF、206 状态透传 |
| 现有 cold-seek 测试屏蔽编排层、测不到本 bug | `src/components/video/playback/__tests__/MultiTrackPlaybackEngine.test.ts:705-707` | `setCurrentTime: () => undefined`（facade stub） |
| 元素实例稳定（排除绑错/churn） | `src/components/video/components/VideoPlayerPanel/PreviewCanvas.tsx:147-161` | `videoPoolRef` 缓存同一 `<video>` |

---

## 八、与前两轮的关系小结（便于评审快速对账）

| 轮次 | 修了哪一段 | 本轮为何仍黑 |
|---|---|---|
| 第 1 轮 `09bbc0a` | **引擎内部**螺旋：reanchor-on-settle + in-flight 守卫 + A2 | 引擎内已不自拽；但握手 reanchor 的「向后跳」副作用经**编排层** scrub-echo 被放大成 `engine.seek` 误触发（测试用 stub 屏蔽了编排层，未暴露） |
| 第 2 轮 `8db055f` | **HTTP 层**：Range/206 使中段 seek 可满足 | 使冷 seek「可满足但仍需时间」→ 把交互从「全程黑」暴露为「中段起播黑」，并非根因 |
| 第 3 轮（本轮） | 待修：**编排层**跨层回灌 | 握手未决期间镜像自由奔跑 comp → reanchor 后两侧 > 0.35 背离 → scrub effect 误重 seek → 螺旋（方案 A 从源头截断） |

---

## 评审结论（Review Verdict）

> 评审节点（Subtask #1）。本节为对 §一~§八 的逐条审计结论，并敲定**唯一推荐修复**。审计方式：把分析中每一处代码引用都核对到当前 HEAD 源码（非仅信任叙述），逐跳走通时序回路，并尝试构造反例。

### A. 根因证据审计 —— 通过（airtight）

逐条核验，**全部引用属实、行号准确、且确实落在失败路径上**：

1. **reanchor 向后跳**：`MultiTrackPlaybackEngine.ts:478` `this.clock.reanchor(targetComp)`；`PlaybackClock.ts:101-105` reanchor 仅移锚点；`:146-148` 冷 seek 期间 comp 由墙钟自由推算 → 落定瞬间 comp 已自由跑过 targetComp，reanchor 把它**向后**拽回。✔ 与 §3.2 一致。
2. **冷 seek 期间照推自由奔跑 comp**：`MultiTrackPlaybackEngine.ts:299-316` `_onTick` 在 `_startReanchor != null`（握手未决）时**不设任何守卫**，仍执行 `this.playhead.reportCompositionTime(comp)`（`:315`）。✔ 与 §3.3 一致——这是 A3-a 注释（`:301-305`）刻意保留握手长存所带来的、本轮才暴露的副作用。
3. **回灌闭环**（分析原文仅断言、未引）：评审已逐跳坐实（见新增 §3.3.1）——`VideoPlayerPanel.tsx:159-163` → `VideoEditingInterface.tsx:496-503` `setTimelineCurrentTime` → `:2686` `currentTimelineTime` → `currentTime` prop → scrub effect。✔ 闭环成立，中途无回声门拦截。
4. **scrub-echo 守卫被击穿**（分析原文略过第一道守卫，是最大缺口）：评审已补全（见新增 §3.5.1）——第一道 `|last - currentTime| < 1e-6`（`:494`）因 `lastSeekedTimeRef`(60Hz 最新) 与 `currentTime`(100ms 节流滞后) 几乎从不相等而**不**拦截；第二道 `≤ 0.35`（`:512`）因 reanchor 后 `live≈10.0`、prop 滞后停在 `10.6`、背离 ≈ 冷 seek 时长 > 0.35 而**不**拦截 → `engine.seek(陈旧值)`。✔ 两道守卫同源失效，证据自洽。
5. **误 seek 前向硬拽落定元素**：`VideoSourcePool.ts:377-391` `_ensureSeeked`——元素落定（`seeking=false`、`readyState=4`）后 `:387` 守卫放行，`:388` `|el.currentTime - target| > _seekTolerance(0.25)` → 重赋 `currentTime` → 新冷 seek。✔ 与 §3.6 一致；`seek(while playing)` 经 `:254-258` 再装握手（`:258`）→ 螺旋自持。
6. **常量**：`REACT_PLAYHEAD_THROTTLE_MS=100`（`constants.ts:34`）、`PLAYBACK_SCRUB_ECHO_TOLERANCE_SEC=0.35`（`:45`）、`VIDEO_SEEK_TOLERANCE_SEC=0.25`（`:99`）。✔ 全部属实。

**替代假说复核（§3.8）**：评审独立确认其排除均成立——
- **HTTP 层（第 2 轮）未修好？** 否。`storage_files_router.py:151-205` 的单段 Range 解析正确（开放区间 `bytes=N-`→`end=file_size-1`、`:201` 越界 416、`:203` 反序 200 回退），且**「暂停态拖到中段能出帧」即运行期反证**：paused 分支（`MultiTrackPlaybackEngine.ts:259-263`）走 `_disarmStartReanchor`+无时钟自由奔跑+就绪重绘（`:425`），与 playing 路径解耦——若 Range 坏，暂停态也应黑。排除成立。
- **绑错元素 / churn / URL / 时间映射**：均被「暂停态能画出正确中段帧」反证（映射对、URL 对、元素稳定）。排除成立。
- **第 1 轮引擎内螺旋未根除？** 否，但**第 1 轮的回归测试用 `setCurrentTime: () => undefined`（`MultiTrackPlaybackEngine.test.ts:706`）屏蔽了编排层**，结构上测不到本轮的跨层回灌——这正是缺口而非重复。✔ 评审认可：本轮是第三条独立链路。

→ **根因唯一性成立**：reanchor 向后跳 × 自由奔跑 comp 节流镜像 × scrub-echo 越界重 seek 三者在编排层叠加形成跨层自持螺旋。「从 0 起播免疫」（§3.7：位置 0 在 attach 即就绪、无 > 容差冷 seek、reanchor 幅度≈0）精确解释了「开头能播、中段黑」的观测，无残留反例。

### B. 候选修复审计

| 方案 | 是否闭合根因 | 边界/并发/回归 | 是否最小 | 评审裁决 |
|---|---|---|---|---|
| **A**：握手未决期间不向 React 镜像自由奔跑 comp（改推 `targetComp`） | 是，从**最上游**截断 §3.4 背离来源 | 见下「A 的边界审计」，均安全 | **是**（`_onTick` 一处 + `_startReanchor` 携带 `targetComp`） | **采纳为唯一载荷修复** |
| **B**：scrub effect 在 reanchor 后短窗内一律按回声忽略 | 是，但属事后补救 | **风险**：时间窗会**吞掉紧跟 reanchor 的真·用户拖动**；窗宽需对冲真实拖动最坏延迟，调参敏感 | 否（引擎+Hook 两处 + 一个魔法时窗） | **降级为可选防御**（非必需） |
| **C**：reanchor 锚到元素真实 `currentTime` 并 force-flush 回灌 React | 是，结构更鲁棒 | **风险**：force-flush 与节流/回声判定的**次序**易引入新抖动；跨层主动写 | 否（改握手目标语义 + 跨层 force-flush） | **不采纳本轮**，留作后续结构演进 |

**A 的边界审计（评审重点核验，全部安全）**：
- **不吞真实拖动**：A 只抑制**引擎自身**的回声上报；真·用户拖标尺由 store/ruler 驱动 `currentTime` prop，仍照常触发 scrub effect→`engine.seek(新位)`→重装握手到新目标。✔ 这正是 A 优于 B 之处（B 的时窗会误吞紧跟 reanchor 的真实拖动）。
- **`seek(while playing)` 远距拖动**：同走握手（`:258`），握手期 prop 恒为 `seek` 当时写入的 `lastSeekedTimeRef`/prop 值，落定 reanchor 后两侧同点起步 → 同样免疫。✔
- **纯音频 / 无 lead video**：`_armStartReanchor` 在无 lead 时于 `:473` **提前 return，不**置 `_startReanchor`（`:489` 才置位）→ A 的 `if (this._startReanchor)` 守卫天然不触发，常规上报不变，**播放头不会冻结**。✔
- **end-of-timeline**：A 只包裹 `:315` 的 `reportCompositionTime`，`:306-313` 的到末尾停机逻辑不动 → 无回归。✔
- **pause 精确落点 / 音频同步**：pause 落点读 `engine.getCompositionTime()`（`:470`）而非 React 镜像；音频由 `_renderAt` 内 `comp` 驱动——两者都**不**依赖 `reportCompositionTime`，A 零影响。✔
- **唯一需留意项（交给 Subtask #2）**：因 A3-a 刻意令握手**不按墙钟预算丢弃**，若 lead 元素因解码错误/网络停滞**永不**触发 `seeked`/`playing`，A 会在该停滞期内**冻结 React 播放头**。但此场景画面本就是黑/冻结，冻结播放头反而更贴近真相，且下一次 play/seek/pause 即 disarm 恢复——可接受。Subtask #2 若想更稳，可仅为「上报抑制」单独加一个就绪/预算兜底（与握手生命周期解耦），但非阻断项。

### C. 最终推荐修复（单一）

> **采纳方案 A —— 「起播/播放中 seek 的 reanchor 握手未决期间，引擎 `_onTick` 不再把自由奔跑的 comp 镜像给 React，而是上报 `targetComp`（seek 目标）；握手 disarm 后恢复常规上报」。** 不叠加 B/C 作为本轮载荷（B 仅作可选防御保留，C 留待结构演进）。

**理由（why A，单一且充分）**：
1. **打在唯一根因的最上游**：§3.4 的「reanchor 后两侧 > 0.35 背离」是整条螺旋的唯一种子；A 让握手期 React 侧恒等于 `targetComp`，落定后两侧从同一点起步，背离**从结构上不再产生**，§3.5/§3.5.1 的误判、§3.6 的硬拽、§3.7 的自持随之全部消失。
2. **最小破坏面**：仅 `MultiTrackPlaybackEngine._onTick`（`:315`）外包一层 `if (this._startReanchor)` 改推 `this._startReanchor.targetComp`，并在 `StartReanchorHandshake`（`:603-606`）上增 `targetComp` 字段、于 `_armStartReanchor`（`:489`）写入。不动 HTTP 层、不动 scrub 守卫、不动音频/转场/多轨时间基、不动第 1/2 轮承重逻辑。
3. **语义更正确**：冷 seek 期间「自由奔跑 comp」是尚未被解码兑现的临时值（画面此刻是黑的、解码停在 seek 目标），把它当时间码回灌本就是错误回声；A 让时间码在握手期忠实停在 seek 目标，与 `getCompositionTime()` 取 `_lastRenderComp`（“显示了什么帧”才是时间真相）的既有取向一致。
4. **回归可控**：仅改「握手未决」这段亚秒窗口的 React 回声；位置 0 快路径无握手未决期、零影响；`seek(while playing)` 复用同一握手、自动受益（见 B 边界审计）。
5. **优于 B/C**：A 不调任何魔法时窗、不吞真实拖动（胜 B），不改 reanchor 语义、不引入跨层 force-flush 排序风险（胜 C）。

**强制回归测试（DoD，交 Subtask #2 落地）**——现有 cold-seek harness 因 `setCurrentTime: () => undefined`（`MultiTrackPlaybackEngine.test.ts:706`）屏蔽编排层而测不到本 bug，**修复必须先补一条可复现的跨层回归测试**：用记录推送值的拟真 facade（`setCurrentTime` 收集被推的 comp 序列），断言
- 握手未决期间 React 侧收到的值**恒为 `targetComp`**（不出现自由奔跑的 10.1→10.6 阶梯）；
- 冷 seek 落定 reanchor 后 `|live - reactCurrentTime| ≤ 0.35`，scrub effect **不再触发** `engine.seek`；
- `<video>.currentTime` **不出现** §2.2 的阶梯式前向跳变（落定后稳定在 targetComp，不被前向硬拽）。

**验收**：按 §二复现，从 0 与从中段（高码率长素材）分别起播，均应在 ≤1 个 seek 周期内出图并持续流畅；回归校验第 1 轮（`09bbc0a` 引擎内不自拽）与第 2 轮（`8db055f` Range/206）均未退化。

— 评审通过，移交 Subtask #2 实施。
