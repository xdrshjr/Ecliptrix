# 剪辑轨道视频「从中间任意位置播放即黑屏」— 问题定位与分析

- **Bug slug**: `timeline-preview-midclip-play-black-screen`
- **诊断节点**: Subtask #0（问题定位与分析）
- **日期**: 2026-06-11
- **轮次**: 第 2 轮（第 1 轮卡顿修复 `d22d787` / `59a4ab6` 之后的残留问题）
- **结论一句话**: 合成预览的时钟 `PlaybackClock` 以**墙钟（wall-clock）自由奔跑**计算合成时间，而解码 `<video>` 从非零位置开始播放需要真实的 **seek + 缓冲 + 解码** 启动延迟。从 clip 中间位置点击播放时，时钟立即从该位置向前推进，但解码元素此刻 `readyState < 2`（HAVE_CURRENT_DATA），`CanvasCompositor` 对未就绪的源**直接跳过绘制、只填黑色信箱底**；同时 `VideoSourcePool` 因合成时间持续领先、每隔 `VIDEO_SEEK_TOLERANCE_SEC`(0.25s) 就把 `el.currentTime` 重新赋值一次（反复打断在途 seek），使元素始终停在 seeking 态、永远到不了 `readyState ≥ 2` → **预览永久黑屏**。从位置 0 播放时，解码元素的首帧在暂停渲染阶段早已加载/解码完成（`readyState ≥ 2`），播放在 0.25s 容差窗口内即开始前进、不发生 seek 抖动，因此**「放到最开始能播、放到中间就黑屏」**。**根因是「自由奔跑的合成时钟 vs 解码就绪」缺少同步握手，而非源解析（URL）或时间映射错误。**

> 与第 1 轮区分：第 1 轮（`timeline-preview-playback-stutter`）修的是「画面能出来但卡顿」（60Hz 时钟驱动 React 整树重渲染饿死 rAF）。本轮是**画面根本出不来（黑屏）**，是另一条独立的、尚未修复的链路。第 1 轮分析文档自己也写明「不是黑屏」。

---

## 一、问题描述（Problem description）

在素材管理面板上传本地视频 → 拖入下方剪辑轨道 → 在预览面板播放预览时：

- **把播放头（光标）放在该视频素材的最开始（clip 起点 / 合成时间 0）点击播放：能正常播放。**
- **把播放头放到该 clip 的中间任意位置点击播放：无法正常播放，预览画面黑屏。**

即：可播放性与「起播位置是否为 clip 起点」强相关——起点可播，任何非起点位置黑屏。

补充观察（与根因一致、便于复现确认）：
- 在中间位置**暂停**时，画面通常能显示出该位置的那一帧（短暂黑闪后出图）；一旦**点击播放**就转为持续黑屏。
- 这与「素材本身清晰度/码率」无关，与「起播位置」强相关。

---

## 二、复现步骤（Reproduction steps）

### 2.1 用户路径复现（任何人可照做）

1. 启动应用（前端 `npm run dev` + 后端，或桌面端打包版本）。
2. 进入视频剪辑界面（`VideoEditorContainer` → `VideoEditingInterface`）。
3. 在素材管理面板上传一个本地视频（一段 720p/1080p、时长 ≥ 10s 的短视频即可），并添加到下方剪辑轨道，使预览进入 `playbackMode === 'composition'`。
4. **对照组（能播）**：确保播放头在时间轴最左端（合成时间 0 = clip 起点），点击播放 ▶ → 画面正常播放。
5. **实验组（黑屏）**：拖动时间轴标尺，把播放头放到该 clip 的中间（例如第 5 秒）→ 暂停态此时多半能看到第 5 秒那一帧 → 点击播放 ▶ → **预览 `<canvas>` 变为纯黑、不出图**。
6. 反复验证：起播位置越靠近 0 越容易出图；越靠中间/后段越稳定黑屏。

### 2.2 用 DevTools 量化确认（客观证据采集法）

1. 在「中间位置点击播放黑屏」时打开 DevTools → Console，临时打开预览诊断（本仓库内置逐轨道诊断，见 `src/components/video/playback/internal/previewDebug.ts`；通过 `isPreviewDebugEnabled()` 开关）。
2. 预期观察到逐轨道诊断行持续打印：`readyState=0/1`、`paused=false`、`drawn=0`、`dropped` 持续增长、`t`（合成时间，want=desiredSourceTime）持续增大而 `currentTime`（元素实际解码位）几乎不动或在反复跳变。

> **【评审修正 R1】** 原文此处称 `classifyTrackDiagnosis` 会判定为 `H6`，**不准确**。核对 `previewDebug.ts:83-94`：`H6` 仅在 `paused===false && readyState<2 && (networkState===3(NO_SOURCE) || errorCode!=null)` 时成立。本 bug 的解码元素**持有有效 src、只是在 seek/缓冲**，既非 `NO_SOURCE` 也无 `error`，因此 `networkState≠3 && errorCode===null` → 该行 `verdict` 实际为 **`unknown`**（而非 `H6`）。请 Subtask #2 验收时以 **`readyState<2`、`paused=false`、`drawn=0`、`dropped` 持续增长、`verdict=unknown`** 作为黑屏现场判据；`H6` 反而对应「源彻底解析失败」的另一类问题，不应在本 bug 中出现。
3. 切到 Performance 录制：可见 `el.currentTime` 被反复赋值（seeking 事件密集），`drawImage` 几乎不执行（被 `readyState < 2` 短路）。
4. 对照：从位置 0 播放时，诊断行很快变为 `readyState=4`、`drawn` 正常增长、`H6` 不出现。

> 主要证据为代码引用（下节，不可辩驳）；DevTools 诊断为可量化现场佐证。

---

## 三、根因分析（Root cause analysis — 含证据）

### 3.1 合成预览的设计管线

合成预览是**单一本地多轨 Canvas 合成器**：唯一时钟 `PlaybackClock`（rAF）每 tick 调 `MultiTrackPlaybackEngine._renderAt`，其内部：
① `VideoSourcePool.sync` —— 每条可见视频轨选出活动 clip、给解码 `<video>` 赋 `src` 并 seek 到映射后的源时间、必要时 `play()`；
② `assembleLayers` + `CanvasCompositor.renderFrame` —— 把各轨解码源合成到 canvas；
③ `AudioSyncPool.tick` —— 音频同步。

### 3.2 致命前提一：合成时钟是「墙钟自由奔跑」，不等解码

`src/components/video/playback/PlaybackClock.ts:146`：
```ts
private _currentComp(wall: number): number {
  return this._baseCompositionTime + ((wall - this._baseWallTime) * this._rate) / 1000;
}
```
合成时间**只由墙钟时间推算**，与解码 `<video>` 是否真的产出了某一帧**完全无关**。`play()` 一旦 `clock.start(comp, now, 1)`，`comp` 就从起播位置按真实时间向前跑：

`src/components/video/playback/MultiTrackPlaybackEngine.ts:204`（`play()`，注意它**只启动时钟、不等待元素就绪**）：
```ts
play(): void {
  ...
  let comp = this._deps.timeline.getCurrentTime();   // 中间位置，例如 5
  ...
  this.clock.start(comp, this._now(), 1);            // 时钟立刻从 5 自由奔跑
  this._setPhase('playing');
}
```

### 3.3 致命前提二：源未就绪（readyState<2）时 Compositor 跳过绘制、只填黑底

`src/components/video/playback/CanvasCompositor.ts:280`（`_drawVideoLayer`）：
```ts
const source = layer.source;
if (!source || source.readyState < 2) return false;   // 未达 HAVE_CURRENT_DATA → 这一层不画
```
`renderFrame` 中若所有视频层都没画出（`drewAny === false`），则该帧只剩信箱底色填充——而底色是黑：

`src/components/video/playback/MultiTrackPlaybackEngine.ts:405`（viewport 注入）→ `useCompositionPlayback.ts:405`：
```ts
viewport: aspectRatio ? { aspectRatio, letterboxColor: '#000' } : null,
```
`CanvasCompositor.renderFrame` `src/components/video/playback/CanvasCompositor.ts:215`：
```ts
ctx.fillStyle = this._viewport?.letterboxColor ?? DEFAULT_LETTERBOX_COLOR; // '#000'
ctx.fillRect(0, 0, canvas.width, canvas.height);                          // 先铺黑
...
let drewAny = false;
for (const layer of sorted) { const painted = this._drawLayer(...); drewAny = painted || drewAny; }
```
**结论**：只要活动轨解码源在某帧 `readyState < 2`，该帧就是「黑屏」。

### 3.4 致命前提三：播放中每帧依据「自由奔跑的合成时间」重算 seek 目标，反复打断在途 seek

`src/components/video/playback/VideoSourcePool.ts:177`（`computeSourcePlan`，目标源时间随 `t` = 合成时间增长）：
```ts
const desiredSourceTime = hit.sourceTime;                 // = mapTimelineTimeToSourceTime(clip, t)
const needsSeek =
  needsSrcSwap ||
  Math.abs(currentTime - desiredSourceTime) > seekToleranceSec;  // seekTolerance = 0.25
```
`src/components/video/playback/VideoSourcePool.ts:354`（`_ensureSeeked`，**无 `seeking` / `readyState` 守卫**，直接赋值）：
```ts
private _ensureSeeked(el, targetSourceTime, srcJustSwapped): void {
  if (srcJustSwapped || Math.abs(el.currentTime - targetSourceTime) > this._seekTolerance) {
    try { el.currentTime = targetSourceTime; } catch { /* ... */ }   // 重新赋值 = 打断在途 seek
  }
}
```
`VIDEO_SEEK_TOLERANCE_SEC = 0.25`（`src/components/video/playback/internal/constants.ts:99`）。

### 3.5 致命前提四：播放态下「就绪重绘」被显式关闭，黑屏没有自救机会

引擎为暂停态绑定了 `loadeddata/seeked/canplay` 的「就绪单次重绘」，但**播放态直接 return**：

`src/components/video/playback/MultiTrackPlaybackEngine.ts:371`：
```ts
const handler = () => {
  if (this._disposed) return;
  if (this.getPhase() === 'playing') return;     // ← 播放态不重绘，交给 rAF 循环
  this._renderAt(this._lastRenderComp, false);
};
```
于是：暂停态 seek 到中间，`seeked` 事件能触发一次重绘把那一帧画出来（所以**暂停时能看到中间那一帧**）；但播放态完全依赖 rAF 循环，而 rAF 循环又被 3.2~3.4 的 seek 抖动卡住，**没有任何机制把第一帧救回来**。

### 3.6 串起来：为什么「起点能播、中间黑屏」

设单 clip：`startTime=0, clipStart=0`。

**从中间（合成时间 5s）播放：**
1. `play()` → `clock.start(5)`，`comp` 立刻按墙钟从 5 向前跑（3.2）。
2. 第 1 个 tick `_renderAt(5.0, true)`：`VideoSourcePool` 把 `el.currentTime` 设到 ~5（一次 seek 开始），元素 `readyState` 掉到 <2 进入缓冲（首次 seek 到中段、可能不在已缓冲区间，耗时数百 ms）。
3. 这数百 ms 内时钟没停，`comp` 跑到 5.3、5.5、5.8…… 每当 `comp` 领先「上次设定的 currentTime」超过 0.25s，`_ensureSeeked` 就再赋值一次 `el.currentTime`（5.25→5.5→5.75…），**每次赋值都打断上一次还没完成的 seek**（3.4），元素始终停在 seeking、`readyState` 长期 <2。
4. `CanvasCompositor` 对 `readyState<2` 的源**逐帧跳过绘制**，每帧只铺黑底（3.3）；播放态的就绪重绘又被关掉（3.5）→ **永久黑屏**。

**从起点（合成时间 0）播放：**
1. 进入预览时 `attach` 已用 `_renderAt(getCurrentTime()=0, false)` 让元素从源时间 0 加载，暂停态 `seeked/canplay/loadeddata` 就绪重绘也已把首帧画出 → 元素在源时间 0 处 **`readyState ≥ 2`、首帧已解码**。
2. `play()` → `comp` 从 0 起跑；元素已经在 0 处就绪，`play()` 在一两帧内就开始让 `currentTime` 前进；`comp` 与 `el.currentTime` 始终落在 0.25s 容差内 → **不触发重复 seek、不抖动**，`drawImage` 正常 → 流畅出图。

二者唯一差别：**起点位置的首帧早已 `readyState ≥ 2`，中间位置需要一次真实 seek+缓冲且被自由奔跑的时钟反复打断**。这就是「最开始能播、中间黑屏」的精确成因。

> **【评审补强 R2：触发链的精确化——不止「点击播放才首次 seek」】**
> 核对实际传输链（`useCompositionPlayback.ts` 全 prop-driven）后，本轮最常见的复现路径是「**先在中段暂停 → 再点击播放**」，此时触发机制比 3.6 的叙述更微妙，需补强（否则 Subtask #2 可能只防住「冷 seek」而漏掉真实主因）：
> 1. 暂停态把光标拖到第 5 秒：`scrub` effect（`useCompositionPlayback.ts:489-521`，paused 分支跳过 echo 判定）调用 `engine.seek(5)`；`seek()` 的 `wasPlaying=false` 分支走 `_renderAt(5,false)`（`MultiTrackPlaybackEngine.ts:235-238`），`VideoSourcePool` 把 `el.currentTime` 设到 5 并 `pause`，`seeked` 事件触发就绪重绘 → **暂停帧画出**。此刻元素**已在源时间 5 且 `readyState≥2`**。
> 2. 点击播放：prop `isPlaying=true` → transport effect（`:451-480`）→ `engine.play()` → `clock.start(5)`。**注意：元素此时已就绪在 5，并非从 0 冷 seek。**
> 3. 真正的失配在于 **`play()` 启动延迟 vs 自由时钟**：`el.play()`（`VideoSourcePool._apply` 的 `_kickPlay`，`:327-329`）是异步的，`el.currentTime` 要等解码管线真正起转后才前进；而 `clock` 自点击起就按墙钟推进 comp。在这段启动窗口里 comp 领先 `el.currentTime`，一旦差值 >0.25s，`_ensureSeeked`（`:354-369`，每帧在 play 逻辑**之前**执行）就把 `el.currentTime` 硬拽到前面 → **打断刚起转的播放、强制一次落进未缓冲区间的新 seek**。中段的 seek 昂贵、又被持续前进的时钟反复打断，元素永远进不了稳态原生播放，Compositor 持续看到 `readyState<2` → 持久黑屏。
> 4. **位置 0 为何幸免**：起点区间在 `attach` 阶段就已加载缓冲，`readyState` 通常达 4（`HAVE_ENOUGH_DATA`），`play()` 几乎立即让 `currentTime` 前进，启动窗口 < 0.25s，gap 不会张开，`_ensureSeeked` 不触发 → 流畅。
>
> **结论修正**：根因仍是「自由奔跑的合成时钟 vs 解码就绪/起转」缺少握手（与原文一致），但触发面**不限于**「点击播放才首次 seek」；即便元素已被暂停态 seek 到目标位并就绪，**`play()` 起转延迟 + 自由时钟 + `_ensureSeeked` 无守卫硬拽**这三者叠加，同样会拖入死亡螺旋。这意味着修复必须覆盖「**起转期**」的 comp/解码对齐，而不能只在「元素未就绪」时 gate（见下方评审结论对方案 A 实现要点的收紧）。

### 3.7 旁证：多轨重构丢掉了旧路径的「就绪握手」

旧的单源 A/B 控制器在切换/起播时是**带就绪握手**的——`src → load() → 等 loadedmetadata → seek → 等 seeked` 后才交给合成器：

`src/components/video/playback/AbBufferController.ts:158`、`:176`：
```ts
await _waitForReady(el, this._opts.bindLoadedMetaTimeoutMs);   // 等元数据
...
if (el.readyState < 4) {
  await _waitForSeeked(el, this._opts.maxSeekMsBeforeForceRebind);  // 等 seek 落定
}
...
this._compositor?.setActiveSource(el);   // 就绪后才设为活动源
```
而多轨重构里替代它的 `VideoSourcePool` 是**纯同步、每帧 best-effort 赋值**，没有任何「等就绪」握手（见 3.4）。换言之，本 bug 是**多轨重构时把起播/切片的就绪握手丢了**，在「非零位置起播」这一情形下暴露出来。

---

## 四、影响面（Impact surface）

- **受影响功能**：合成预览（`playbackMode === 'composition'`，即任何拖入剪辑轨道后的本地预览播放）。
- **受影响用户/场景**：所有从「非 clip 起点」起播预览的用户——包括：拖动标尺到中段后播放、暂停在中段后续播、跳转到某关键帧后播放、以及（推断）跨 clip 边界 / 切到下一 clip 时（切片瞬间也是一次「从非零源时间起播」，同样会触发短暂黑屏/卡顿）。
- **严重度**：高。这是「达芬奇级顺滑预览」目标下的核心可用性缺陷：用户极少总是从 0 起播，中段起播是最常见操作。
- **不受影响**：从合成时间 0 起播；导出（导出走后端合成、不经此 rAF/解码就绪链路，见 `useVideoExport`）；暂停态查看中间帧（就绪重绘能自救，仅短暂黑闪）。
- **关联**：第 1 轮卡顿修复（`d22d787`）与本问题正交、互不替代；本问题在卡顿修复后依旧存在。

---

## 五、候选修复方案（Candidate fixes）

> 本节仅做方案对比，**不在本节点落代码**（节点约束）。

| 方案 | 核心做法 | 侵入性 | 风险 | 工作量 | 是否单独足够 |
|---|---|---|---|---|---|
| **A. 起播/换源时按就绪握手再启动时钟**（恢复 bindActive 式握手） | 在 `play()` / `seek(while playing)` 起播前，先把活动轨元素 seek 到目标源时间并等待 `canplay`/`seeked`（或 `readyState ≥ 2`），**就绪后再 `clock.start(target)`**；或在元素就绪事件里 `clock.reanchor(target)` 把 comp 锚回目标。直接消除「时钟领先解码」的根源。 | 中（改 `MultiTrackPlaybackEngine.play/seek`，引入一个短暂 `starting` 等待 + 就绪回调） | 中（需保证不回归「位置 0 已就绪」快路径——仅在元素未就绪时才 gate；需处理多轨/纯音频/超时兜底） | 中 | **是**（直击根因） |
| **B. 给 `_ensureSeeked` 加 seeking/readyState 守卫，避免打断在途 seek** | 当 `el.seeking === true` 或 `el.readyState < 2` 时，本帧**不再重赋 `currentTime`**，让在途 seek 跑完；可选：元素持续落后时由引擎 `clock.reanchor(el 实际位)` 而非硬拽元素。 | 低（局部改 `VideoSourcePool`） | 低 | 低 | **否**（能降低抖动，但时钟仍会在缓冲期间跑远，单独用仍可能首帧黑/追不上） |
| **C. 改为「解码为主、时钟跟随」的软同步** | 播放中以活动 lead 视频的真实 `currentTime` 为准：每 tick 若 `|el 时间 − comp| > 阈值` 则 `clock.reanchor` 跟随元素，而不是 seek 元素去追时钟。结构上根除「自由时钟 vs 真实解码」的失配（同时也利于残余卡顿）。 | 高（comp 是音频/多轨/转场的统一时间基，改动面大） | 高（需谨慎处理多视频轨、无视频轨/纯音频、转场对齐） | 高 | 是（但超出最小修复范围，属长期演进） |

---

## 六、推荐方案（Recommended fix）

**推荐 A（为主）+ B（加固）的组合，作为本轮最小且对症的修复；C 列为后续架构演进，不在本轮范围。**

理由：
1. **A 直击根因**：本 bug 的本质是「合成时钟从非零位置自由奔跑、不等解码就绪」（3.2 + 3.6）。A 在起播/换源处恢复旧 `AbBufferController.bindActive` 早有的就绪握手（3.7：`等 loadedmetadata → seek → 等 seeked → 就绪后才驱动`），把「时钟开始推进」对齐到「元素已能产出目标帧」，从源头消除黑屏。并且只在「元素尚未就绪」时 gate，对「位置 0 已就绪」的快路径零影响（保住现状能播的行为）。
2. **B 加固稳态与切片**：A 解决了起播首帧；B（`seeking/readyState<2` 时不重赋 `currentTime`）确保缓冲期/跨 clip 切片时不再因每帧重赋而反复打断在途 seek，避免 A 之外的残余抖动。两者叠加覆盖「起播 + 稳态 + 切片边界」全链路。
3. **风险可控、改动局部**：A、B 都集中在 `MultiTrackPlaybackEngine` 与 `VideoSourcePool` 两个文件，不触碰音频/转场/多轨合成的时间基（与 C 相比侵入面小得多），且有清晰的就绪事件/超时兜底可写测试（参考 `AbBufferController.test.ts` 的 `loadedmetadata/seeked` 模式与 `BIND_LOADEDMETA_TIMEOUT_MS`/`BIND_SEEK_TIMEOUT_MS` 常量）。
4. **可测**：可补「从非零合成时间 `play()`，在元素 `seeked` 前 comp 不前进 / 元素就绪后第一帧 `drawn>0`」的单测，稳定复现并守护回归（满足「修 bug 先写复现测试」规范）。

**落地要点（供 Subtask #2 实施时参考，非本节点产物）**：
- `MultiTrackPlaybackEngine.play()`：读取目标 comp 后，若活动轨元素未就绪（`readyState < 2` 或 `seeking`），先 seek 到目标源时间并监听 `canplay`/`seeked`，就绪后再 `clock.start(target)`（或先 `clock.start` 但在就绪回调里 `clock.reanchor(target)` 把 comp 锚回，避免缓冲期 comp 跑远）；设置 `BIND_SEEK_TIMEOUT_MS` 级别的超时兜底，超时也照常启动（避免坏源永久卡住）。
- 可考虑在播放态放开「就绪单次重绘」对**起播第一帧**的封锁（3.5），让起播首帧在就绪时立刻补画一帧。
- `VideoSourcePool._ensureSeeked` / `_apply`：当 `el.seeking === true` 或 `el.readyState < 2` 时跳过本帧的 `currentTime` 重赋（`VideoElementLike` 需补充可选 `seeking?: boolean` 结构字段，保持纯逻辑可测）。
- 验证：按第二节复现步骤，从位置 0 与从中段分别起播，均应在 ≤1 个 seek 周期内出图、流畅播放；逐轨道诊断不再出现持续 `H6`。

---

## 七、关键证据索引（便于评审复核）

| 证据 | 位置 | 说明 |
|---|---|---|
| 合成时钟墙钟自由奔跑 | `src/components/video/playback/PlaybackClock.ts:146` | comp 只由墙钟推算，不等解码 |
| `play()` 只启动时钟不等就绪 | `src/components/video/playback/MultiTrackPlaybackEngine.ts:204` | 起播即让 comp 从非零位自由跑 |
| `readyState<2` 跳过绘制 | `src/components/video/playback/CanvasCompositor.ts:280` | 未就绪源不画 → 只剩黑底 |
| 黑色信箱底 | `src/components/video/hooks/useCompositionPlayback.ts:405` + `CanvasCompositor.ts:215` | `letterboxColor:'#000'`，未画即全黑 |
| 每帧依自由时钟重算 seek、无就绪守卫 | `src/components/video/playback/VideoSourcePool.ts:177`、`:354` | 反复打断在途 seek |
| seek 容差 0.25s | `src/components/video/playback/internal/constants.ts:99` | 触发重复 seek 的阈值 |
| 播放态关闭就绪重绘 | `src/components/video/playback/MultiTrackPlaybackEngine.ts:371` | 黑屏无法自救 |
| 旧路径本有就绪握手（已丢失） | `src/components/video/playback/AbBufferController.ts:158`、`:176` | 多轨重构遗漏握手的旁证 |

---

## 八、评审结论（Review Verdict — 由 Subtask #1 评审填写）

> 评审范围：逐条核验根因证据是否真实、是否在失败路径上被执行、有无被遗漏的替代解释；逐条核验候选方案的边界覆盖、最小破坏面与回归风险；补全薄弱证据；最终敲定**单一**推荐方案。约束：仅改 `analysis.md`，不落代码、不提交。

### 8.1 证据复核（逐条核对源码——全部命中）

| 编号 | 主张 | 核对位置（已逐行核对） | 结论 |
|---|---|---|---|
| E1 | 合成时钟纯墙钟推算、与解码无关 | `PlaybackClock.ts:146-148` `_currentComp = base + (wall-baseWall)*rate/1000` | ✅ 属实 |
| E2 | `play()` 只启动时钟、不等就绪 | `MultiTrackPlaybackEngine.ts:204-215`（`clock.start(comp,...)` 后直接 `_setPhase('playing')`） | ✅ 属实 |
| E3 | `readyState<2` 的视频层跳过绘制 | `CanvasCompositor.ts:280` `if (!source || source.readyState < 2) return false;` | ✅ 属实 |
| E4 | 无层绘出即只剩黑底 | `CanvasCompositor.ts:215-216` 先 `fillRect` 黑底；`:227-231` `drewAny=false` 时只记 dropped | ✅ 属实 |
| E5 | 黑色信箱底 `#000` | `useCompositionPlayback.ts:405` `letterboxColor:'#000'`；且 `CanvasCompositor.ts:29/215` 缺省也是 `#000` | ✅ 属实（注：`aspectRatio` 未传时 viewport=null，缺省仍黑，结论不变） |
| E6 | 每帧依自由时钟重算 seek 目标 | `VideoSourcePool.ts:174-179`（`desiredSourceTime=hit.sourceTime`，`needsSeek` 由 `t` 推） | ✅ 属实 |
| E7 | `_ensureSeeked` 无 `seeking`/`readyState` 守卫、直接赋值 | `VideoSourcePool.ts:354-369` | ✅ 属实 |
| E8 | seek 容差 0.25s | `internal/constants.ts:99` `VIDEO_SEEK_TOLERANCE_SEC = 0.25` | ✅ 属实 |
| E9 | 播放态关闭就绪重绘、黑屏无自救 | `MultiTrackPlaybackEngine.ts:371-375`（`if (getPhase()==='playing') return;`） | ✅ 属实 |
| E10 | 旧路径本有就绪握手（已丢失） | `AbBufferController.ts:158`(`_waitForReady`)、`:176-178`(`_waitForSeeked`)、`:185`(`setActiveSource`) | ✅ 属实 |

**该被执行的代码确在失败路径上**：合成预览走 `MultiTrackPlaybackEngine` 单一 rAF tick → 每 tick `_renderAt` → `VideoSourcePool.sync`（含 `_ensureSeeked`）→ `CanvasCompositor.renderFrame`（含 `readyState<2` 短路）。`play()` 与 transport effect 的 prop-driven 链路（`useCompositionPlayback.ts:451-480 / 489-521`）也已核实贯通。根因的每一环都在线上路径里执行，无「引用了不被执行的代码」问题。

### 8.2 对替代解释的排除（确认根因唯一性）

为确认根因而非巧合，逐一排除竞争假说——均与「同一素材：位置 0 可播、中段黑屏」这一**位置相关**特征矛盾：

- **URL/源解析错误**：URL 不随起播位置变化，若解析错会两端皆黑 → 排除（且 RC-B「比对键==赋值」`VideoSourcePool.ts:14-22/166-172` 已治理该类问题）。
- **时间映射（`mapTimelineTimeToSourceTime`）错误**：若映射错会画出**错帧**而非黑屏；且暂停态拖到中段能画出**正确**的第 5 秒帧（E9 就绪重绘），反证映射正确 → 排除。
- **每帧 `needsSrcSwap` 反复重载**：`needsSrcSwap=normalizeSrc(currentSrc)!==normalizeSrc(desiredUrl)`，URL 锁定后首帧即相等 → 不再重载 → 排除。
- **autoplay 被拒**：`_kickPlay` 起播即 muted（`VideoSourcePool.ts:390-399`），muted autoplay 各策略均放行；且位置 0 同上下文能播 → autoplay 非区分量 → 排除。

→ 根因收敛唯一：**自由奔跑的合成时钟 vs 解码就绪/起转之间缺少握手**。证据链成立。

### 8.3 评审发现的薄弱/错误证据（已就地修正）

1. **【R1，已在 §2.2 就地修正】** 黑屏现场的逐轨道诊断 `verdict` 应为 **`unknown`**，非原文所写的 `H6`（`previewDebug.ts:83-94`：`H6` 需 `networkState===3` 或有 `errorCode`，本 bug 二者皆不满足）。此修正直接影响 Subtask #2 的**验收判据**，不可沿用错误的 `H6`。
2. **【R2，已在 §3.6 就地补强】** §3.6 原叙述把触发点定位为「点击播放才发生首次 seek」。但 prop-driven 的「中段暂停→再播放」流里，元素在暂停态已被 `seek(5)` 拉到目标位并就绪；真正主因是 **`el.play()` 起转延迟 + 自由时钟 + 无守卫的 `_ensureSeeked` 硬拽** 三者叠加形成死亡螺旋。修复必须覆盖「**起转期**」对齐，不能只在「元素未就绪」时 gate。
3. **【R3，补充证据缺口】** `constants.ts:96` 注释称「The drift-correction loop in `PlaybackEngine` still catches any larger divergence」——但该 drift loop 属**旧单源 `PlaybackEngine`**，多轨重构后的 `MultiTrackPlaybackEngine` **没有任何 drift-correction 兜底**（本文件全程未见漂移回锚逻辑）。即：0.25s 容差当初是依赖「另有 drift loop 兜底」才敢放这么松的，而那张安全网在多轨路径上**已不存在**。这是 §3.7「重构丢了就绪握手」之外、**同源的第二处遗漏**，进一步坐实根因。
4. **【R4，方案 B 的前置依赖】** 现 `VideoElementLike`（`VideoSourcePool.ts:46-70`）只暴露 `readyState`/可选 `paused`，**没有 `seeking`**。方案 B 要读 `el.seeking` 必须先给该结构接口补 `readonly seeking?: boolean`（真实 `HTMLVideoElement` 自带；测试桩可选），否则 B 无法落地。原文「落地要点」已提及，此处确认为**硬前置**。

### 8.4 候选方案边界审查

- **方案 B 单独不足，且其守卫有盲区**：B 的守卫是「`seeking || readyState<2` 时不重赋」。但 R2 揭示的**起转期**里，元素「已就绪(`readyState≥2`)、未 seeking、只是 `currentTime` 尚未起转」——B 的守卫**覆盖不到这一窗口**，第一次硬拽仍会发生。即便第一次硬拽后 B 能阻止后续打断，若中段 seek 耗时长于「gap 重新张开」的时间，仍会再次越过 0.25s 而继续螺旋。故 B 只能作**加固**，不能独立修复（与原文判断一致，但理由更精确）。
- **方案 A 是载荷所在，但实现口径需收紧**：单纯「就绪后再 `clock.start`」只消除「冷 seek」窗口，仍可能漏掉「起转期」。正确口径是 **在 lead 活动视频轨元素确认可前进前，不让 comp 领先解码**——推荐用 **reanchor 变体**：`play()`/`seek(while playing)` 起播时，监听 lead 元素的 `seeked`/`canplay`/`playing`，在其**确认就绪并起转后** `clock.reanchor(el 实际 currentTime 对应的 comp)`，把缓冲/起转期间跑远的 comp 拉回元素真实位；并设 `BIND_SEEK_TIMEOUT_MS(500ms)` 级兜底，超时也照常启动（防坏源永久挂起）。
- **方案 A 的边界**：多视频轨 → 以**当前 lead/活动轨**的就绪为准，idle 轨不参与 gate；**纯音频时间线**（无活动视频元素）→ 无可等对象，立即启动；**跨 clip 切片**（换源即一次非零起播）→ 同一握手自动覆盖。回归面：仅在「元素未就绪/未起转」时介入，位置 0 的 `readyState=4` 快路径零影响（保住现状能播行为）。
- **方案 C（解码为主、时钟跟随）**：能根除失配，但 comp 是音频/多轨/转场的**统一时间基**，让 comp 跟随某条视频轨的真实解码位会牵动音频与转场对齐，**风险与工作量都最高**。同意原文：列为后续架构演进，不入本轮。

### 8.5 最终推荐方案（单一推荐）

**采纳「方案 A（reanchor 就绪握手）为载荷修复 + 方案 B（in-flight seek 守卫）为强制加固」作为本轮唯一推荐；C 不在本轮范围。**

> 命名上以 **A 为单一载荷修复**——即「在 lead 活动视频轨**确认就绪并起转**之前，不让自由合成时钟领先解码；起转后用 `clock.reanchor` 把 comp 锚回元素真实位」。B 是该修复**不可省略的廉价守卫**（成本极低、且补上 A 之外的稳态/切片抖动），二者作为一个改动包交付，但根因的「钉子」是 A。

**理由（airtight）**：

1. **直击唯一根因**：§8.2 已排除一切替代解释，根因锁定为「时钟领先解码、无握手」。A 在所有非零起播入口（`play()`、`seek(while playing)`、跨 clip 换源）恢复「等就绪/起转→对齐时钟」语义，等价于把 §8.1-E10 旧 `AbBufferController.bindActive` 早有、却在多轨重构中丢失的握手（§3.7）补回到新路径——从源头消除黑屏。
2. **A 必须覆盖「起转期」，B 填不了这个洞**：§8.4 证明 B 的守卫盲区正落在 R2 的起转窗口；只有 A 的「就绪并起转后 reanchor」能保证 comp 不在该窗口内越过 0.25s。因此把 A 定为载荷、B 定为加固，是由证据推出的、而非偏好。
3. **最小且对症**：A、B 均集中于 `MultiTrackPlaybackEngine`（起播握手/reanchor）与 `VideoSourcePool`（`_ensureSeeked` 守卫 + `seeking` 字段）两个文件，**不触碰**音频/转场/多轨合成的统一时间基（与 C 相比破坏面小一个量级），且复用现成的 `BIND_SEEK_TIMEOUT_MS` 与就绪事件，无新增依赖。
4. **回归可控**：仅在「未就绪/未起转」时介入，位置 0（`readyState=4`）快路径零影响；超时兜底防坏源挂起；reanchor 的回拉幅度（亚秒级）落在音频漂移容差 `AUDIO_DRIFT_EPSILON_SEC=0.5`（`constants.ts:82`）之内，不会引入可闻音画错位。
5. **可测、守护回归**：可补单测——「从非零 comp `play()`：在 lead 元素 `seeked/playing` 前 comp 不应领先解码超过容差；就绪起转后第一帧 `drawn>0`、不再持续 `dropped`」；以及「`_ensureSeeked` 在 `el.seeking===true` 或 `readyState<2` 时不重赋 `currentTime`」。满足「修 bug 先写可复现测试」规范。

### 8.6 交给 Subtask #2 的落地与验收口径（已收紧）

- **改 `MultiTrackPlaybackEngine.play()` 与 `seek()`（playing 分支）**：起播读到目标 comp 后，若 lead 活动视频元素 `readyState<2` 或 `seeking` 或尚未起转，先 seek 到目标源时间并监听 `seeked`/`canplay`/`playing`；**在确认就绪并起转后** `clock.reanchor(目标 comp / 元素实际位)`，再驱动 rAF。加 `BIND_SEEK_TIMEOUT_MS` 兜底，超时照常启动。
- **放开起播第一帧的就绪重绘封锁（E9/`:371-375`）**：允许「起播首帧」在就绪事件里补画一帧（不破坏「playing 态整体由 rAF 拥有」的不变量）。
- **改 `VideoSourcePool._ensureSeeked`/`_apply`**：当 `el.seeking===true` 或 `el.readyState<2` 时**跳过本帧 `currentTime` 重赋**；并给 `VideoElementLike` 补 `readonly seeking?: boolean`（R4）。
- **验收判据（已按 R1 修正）**：按 §二 复现，从位置 0 与从中段分别起播，均应在 **≤1 个 seek 周期**内出图并流畅播放；逐轨道诊断不再出现持续的 `readyState<2 + paused=false + drawn=0 + dropped 增长 + verdict=unknown`（**注意是 `unknown` 而非 `H6`**）；同时回归校验位置 0 起播与第 1 轮卡顿修复（`d22d787`）均未退化。

**一句话定论**：根因证据链经逐行核对成立且唯一；本轮唯一推荐 = **「就绪并起转后再对齐时钟」的握手修复（方案 A，reanchor 变体）+ `_ensureSeeked` 的 in-flight seek 守卫（方案 B 加固）**，改动局限于 `MultiTrackPlaybackEngine` 与 `VideoSourcePool` 两文件，最小、对症、回归可控；方案 C 留作后续架构演进。
