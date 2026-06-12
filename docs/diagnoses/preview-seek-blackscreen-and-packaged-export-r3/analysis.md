# 剪辑预览「点击 seek 到任意位置黑屏」+「打包桌面端无法导出视频」— 问题定位与分析（第 3 轮）

- **诊断节点**: Subtask #0（问题定位与分析）
- **日期**: 2026-06-11
- **轮次**: 第 3 轮 —— 上一轮已分别提交修复 `fed1e02`（预览黑屏）与 `b043015`（打包导出 SSRF），但用户反馈**两个问题均仍然存在**。本轮的核心任务是：**为什么上一轮已提交的修复没有让 Bug 消失？真正的残留根因是什么？**
- **覆盖的两个问题**（来自任务板「现在还有的问题」）：
  1. **Bug A**：点击轨道/标尺把光标 seek 到视频任意（非起点）位置，预览面板黑屏，无法播放预览。
  2. **Bug B**：开发者模式导出正常，**桌面端打包后无法导出视频**。
- **一句话结论**：
  - **Bug A**：`fed1e02` 的「就绪握手」只**重锚时钟、不强制重绘**，且其 `BIND_SEEK_TIMEOUT_MS=500ms` 预算会在**慢速冷 seek 完成之前就把握手丢弃**；预算丢弃后，自由奔跑的合成时钟 + `VideoSourcePool._ensureSeeked` 的「落定后再次前向硬拽」让上一轮分析过的**死亡螺旋复发** → 中段起播仍黑屏。其单测用的假元素 `readyState` 恒为 4、`seeking` 从不切换，因此**从未触达** `readyState<2` 黑屏窗口 —— 这就是「测试全绿但 Bug 仍在」的原因。
  - **Bug B**：上一轮的 SSRF 修复（`b043015`）**确实已进打包产物且已生效**（守卫现在放行 loopback 同源引用，合成线程能启动）。本轮失败发生在**更后面的「音频合并」阶段**：**TTS 生成的音频（`/api/audio/generated/...`）的写入 / 静态挂载 / 合成解析全部锚定到后端服务根 `SERVICE_ROOT`(= `__file__` 的 `parents[2]`，打包后即只读/易失的安装目录)，而非持久可写的 `STORAGE_ROOT`**。打包重打/真实安装会使该目录被清空或不可写，于是导出请求引用的音频文件 404/不存在 → `FileNotFoundError` → `Audio merge skipped` → `Video composition failed`。**打包 backend.log 在 13:02 与 15:53（均晚于两个修复提交时间）有逐字实证。**

> 与前两轮的关系：第 1 轮修卡顿（`d22d787`）、第 2 轮（A）修中段起播黑屏（`fed1e02`）、第 2 轮（B）修 loopback SSRF（`59a4ab6`→`b043015`）。本轮**不是推翻**前两轮，而是指出二者各自**留有未闭合的残口**，且 Bug B 的真正阻断点**已从 SSRF 转移到 generated-audio 路径**。

---
---

# Part A —— 剪辑预览「点击 seek 到任意位置黑屏」（round-3 残留）

## A.1 问题描述（Problem description）

在素材面板上传本地视频 → 拖入下方剪辑轨道（预览进入 `playbackMode==='composition'`）后：

- **点击时间轴标尺 / 轨道，把播放头（光标）移动到该 clip 的任意非起点位置** → 预览 `<canvas>` 黑屏；
- 此时点击播放 ▶ → 仍黑屏，无法进行播放预览；
- 从合成时间 0（clip 起点）起播仍正常。

即症状与上一轮（`timeline-preview-midclip-play-black-screen`）**同形**，但发生在 `fed1e02` 修复**之后**——说明该修复对「点击 seek→播放」这条路径**未完全闭合**。

## A.2 复现步骤（Reproduction steps）

### A.2.1 用户路径复现

1. 启动应用（`npm run dev` + 后端，或打包桌面端）。
2. 进入视频剪辑界面，上传一段 ≥10s、720p/1080p 的本地视频并加入下方剪辑轨道。
3. **对照组（能播）**：确保光标在最左端（合成时间 0），点击播放 → 正常。
4. **实验组（黑屏）**：点击标尺把光标移动到 clip 中段（例如第 5~8 秒，且该位置**此前未被预热缓冲**）→ 点击播放 ▶。
5. 观察：预览 `<canvas>` 持续纯黑、不出图。**越靠中后段、素材码率越高 / 磁盘越慢，黑屏越稳定**（因为冷 seek 耗时越容易超过 500ms 预算 —— 见 A.3）。

### A.2.2 DevTools 量化确认（客观判据）

1. 黑屏现场打开 DevTools → Console，开启逐轨道诊断（`src/components/video/playback/internal/previewDebug.ts`，`isPreviewDebugEnabled()`）。
2. 预期：`readyState<2`、`paused=false`、`drawn=0`、`dropped` 持续增长、合成时间 `t` 持续增大而元素 `currentTime` 反复跳变（被前向硬拽）。
3. Performance 录制：可见 `el.currentTime` 在「元素刚落定后」被再次赋值（新的 seek），`drawImage` 几乎不执行（被 `readyState<2` 短路）。

> 主要证据为下文代码引用（不可辩驳）；DevTools 为可量化现场佐证。

## A.3 根因分析（Root cause analysis — 含证据）

### A.3.0 `fed1e02` 修复回顾（它做了什么）

`fed1e02` 落了两件事：
- **方案 A（载荷）**：`play()` / `seek(while playing)` 起播时 `_armStartReanchor(targetComp)`，监听 lead 视频元素的 `seeked`/`playing`，**在其触发后把时钟 `reanchor(targetComp)`**，使时钟对齐解码；并在每个 tick 用 `BIND_SEEK_TIMEOUT_MS` 预算把「坏源永不就绪」的握手丢弃，避免永久挂起。
- **方案 B（加固）**：`VideoSourcePool._ensureSeeked` 在 `el.seeking===true || readyState<2` 时**跳过本帧 `currentTime` 重赋**，不打断在途 seek。

两者都已在源码与产物中（核对见 A.5）。但它们**留有三处未闭合的残口**，使「点击 seek→播放」仍黑屏。

### A.3.1 残口①（载荷漏洞）：握手只「重锚时钟」，**不强制重绘**

`src/components/video/playback/MultiTrackPlaybackEngine.ts:442-457`（`_armStartReanchor`）的 handler：
```ts
const handler = () => {
  if (this._disposed) return;
  // Only meaningful while playing; a stray late event just disarms.
  if (this.getPhase() === 'playing') this.clock.reanchor(targetComp);   // ← 只调时钟
  this._disarmStartReanchor();
};
```
注释（`:436-437`）也明示「**We re-anchor only (no forced repaint)**: the running rAF loop paints the corrected frame on its next tick」。即握手命中后**不主动画一帧**，下一帧能否出图完全取决于「下一个 rAF tick 恰好撞上元素 `readyState≥2`」。

而 `PlaybackClock.reanchor`（`PlaybackClock.ts`）只是移动时间基锚点，**不触发任何绘制**。

### A.3.2 残口②（自救封死）：播放态的「就绪重绘」被显式 gate 掉

唯一能在播放态把首帧救回来的机制是 `_bindReadinessRepaint`（绑定在 active/prewarm 元素的 `loadeddata/seeked/canplay` 上），但其 handler 在**播放态直接 return**：

`src/components/video/playback/MultiTrackPlaybackEngine.ts:397-401`：
```ts
const handler = () => {
  if (this._disposed) return;
  if (this.getPhase() === 'playing') return;     // ← 播放态不重绘
  this._renderAt(this._lastRenderComp, false);
};
```
于是握手（残口①）不重绘、就绪重绘（残口②）又在播放态关闭 ——**播放态下没有任何「元素一旦可画就立即补画一帧」的机制**，黑屏只能等 rAF 循环偶然撞上就绪。

### A.3.3 残口③（致命，预算丢弃 → 死亡螺旋复发）：`BIND_SEEK_TIMEOUT_MS=500ms` 在慢冷 seek 完成前丢弃握手

`src/components/video/playback/MultiTrackPlaybackEngine.ts:290-300`（`_onTick`，每帧检查预算）：
```ts
if (
  this._startReanchor &&
  this._now() - this._startReanchor.armWall > BIND_SEEK_TIMEOUT_MS   // 500ms
) {
  this._disarmStartReanchor();        // ← 超时即丢弃握手，时钟继续自由奔跑
}
```
`BIND_SEEK_TIMEOUT_MS = 500`（`src/components/video/playback/internal/constants.ts:58`）。

**问题**：一次「冷 seek 到未缓冲的中段位置」在真实磁盘/解码下**经常 > 500ms**。一旦超时：
1. 握手被丢弃，时钟从 `targetComp + 已逝时间` 继续自由奔跑；
2. 当元素**终于**落定（`seeking=false`、`readyState≥2`）时，握手已不在，**没有 reanchor**；此刻 `comp` 已领先元素真实位很多；
3. 下一帧 `_ensureSeeked`（`VideoSourcePool.ts:385-389`）：
```ts
// Never interrupt an in-flight / mid-buffer seek (方案 B).
if (el.seeking === true || el.readyState < 2) return;            // 落定后此守卫不再拦
if (Math.abs(el.currentTime - targetSourceTime) > this._seekTolerance) {
  this._assignCurrentTime(el, targetSourceTime);                 // ← 前向硬拽到 comp，开启新冷 seek
}
```
元素被硬拽到 `comp`（又一个未缓冲位置）→ `readyState` 再次掉到 <2 → 合成器再次只画黑底 → **上一轮分析过的死亡螺旋在 500ms 后原样复发**。方案 B 只覆盖「在途 seek」窗口，**覆盖不到「落定后 comp 已领先 → 再次前向硬拽」这个窗口**。

### A.3.4 合成器：源未就绪即只剩黑底（黑屏的直接成因）

`src/components/video/playback/CanvasCompositor.ts:150-153`（视频层绘制；`renderFrame` 多轨路径同理，per-layer 在 `readyState<2` 时 return 不画，参见上一轮 `_drawVideoLayer:280`）：
```ts
if (source.readyState < 2) {
  this._stats.droppedFrames += 1;
  return;                              // ← 未就绪 → 不画
}
```
当所有视频层都没画出，`renderFrame` 只剩黑色信箱底：
`CanvasCompositor.ts:215-221` 先 `fillRect` 黑底（`DEFAULT_LETTERBOX_COLOR='#000'`，`:29`），`drewAny` 保持 false → 全黑。

### A.3.5 为什么「点击 seek→播放」最容易触发（精确触发链）

`src/components/video/playback/MultiTrackPlaybackEngine.ts:216-228 / 239-255`：
- `play()`：`clock.start(comp)` → `_setPhase('playing')` → `_armStartReanchor(comp)`，**自身不调 `_renderAt`**，首帧要等下一个 rAF tick。
- `seek()` 的 **paused 分支**（`:250-253`）：`_disarmStartReanchor()` + `_renderAt(target,false)` + `_setPhase('paused')`——**点击标尺（暂停态）seek 不挂任何握手**，只靠残口②的就绪重绘把暂停帧画出（单击通常能自救，故「暂停看中段那帧」多半 OK）。
- 随后**点击播放**：`play()` 起播，若此刻冷 seek 仍在进行或刚被暂停态发起、且 > 500ms 完成 → 命中残口①②③ → 持久黑屏。

### A.3.6 为什么单测全绿但 Bug 仍在（关键佐证）

`src/components/video/playback/__tests__/MultiTrackPlaybackEngine.test.ts` 与 `VideoSourcePool.test.ts` 中的假元素 `readyState` 恒为 **4**、`seeking` 从不切换为 `true`。因此：
- `readyState<2` 的黑屏窗口（A.3.4）**从未被触达**；
- 在途 seek / 落定后再次硬拽的螺旋（A.3.3）**从未被模拟**；
- 握手单测只断言「时钟值」，**从不断言「合成器在 `readyState<2` 期间是否画出帧」**。

→ `fed1e02` 的 8 个新测试是在「元素永远就绪」的理想世界里跑的，自然全绿，却**没有覆盖真实 Bug 的失败路径**。这条「测试覆盖缺口」本身就是根因证据的一部分（满足「修 bug 先写可复现测试」规范的反面教材）。

> **【评审补正 A.3.6 — 测试缺口的精确表述】** 评审独立核对了两份测试，原文「两个文件的假元素 `readyState` 恒为 4、`seeking` 从不切换为 true」**对 `MultiTrackPlaybackEngine.test.ts` 成立，但对 `VideoSourcePool.test.ts` 不成立**，需修正以保证证据链严谨：
> - `MultiTrackPlaybackEngine.test.ts`：`fakeVideoEl()`（`:87-104`）与握手专用的 `fakeEventfulVideoEl()`（`:385-415`）`readyState` 均**硬编码为 4**、无 `seeking` 字段；`dispatchEvent('seeked')` 只触发回调、**不改变 `readyState`/`seeking`**。方案 A 的 4 个握手用例（`:551-589`）**仅断言 `clock.getCompositionTime()`**（`:557/559/568/579/588`），**从不断言合成器是否在 `readyState<2` 期间画出帧**——这部分原文准确。
> - `VideoSourcePool.test.ts`：方案 B 的 4 个守卫用例（`:431-455`）**恰恰显式设置** `seeking:true`、`readyState:1`、`readyState:0` 来验证「在途 seek 不重赋 currentTime」。所以「`seeking` 从不 true」对该文件**是错的**。
> - **真正的缺口**（修正后的精确结论）：(1) 引擎级握手测试用的是 `readyState=4` 假元素，**只校验时钟、不校验绘制**，故 A.3.4 的 `readyState<2` 黑屏窗口在引擎测试里从未被触达；(2) VideoSourcePool 的方案 B 测试在**固定目标源时间 5** 下逐条验证守卫，其中「落定后恢复去抖 seek」用例（`:451-455`）把「落定→拽到目标」断言为**期望行为**，**从未把它接入「comp 持续领跑→每次落定都拽出一次新冷 seek」的死亡螺旋**（A.3.3）；(3) **没有任何用例**把「未就绪元素 + 播放态 rAF 循环」耦合起来断言「就绪后第一帧 `drawn>0`」。下一节点补测应针对这三点，而非笼统的「readyState 恒 4」。

## A.4 影响面（Impact surface）

- **受影响功能**：合成预览（任何拖入剪辑轨道后的本地预览播放）从**非 clip 起点**起播。
- **受影响场景**：点击标尺 seek 到中段后播放、暂停在中段后续播、跳转关键帧后播放、跨 clip 边界切片（切片瞬间=一次非零起播）；**素材越大 / 磁盘越慢 / 位置越靠后越稳定黑屏**（冷 seek 越易破 500ms 预算）。
- **严重度**：高（达芬奇级顺滑预览的核心可用性缺陷；中段起播是最常见操作）。
- **不受影响**：从合成时间 0 起播（首帧在 attach 阶段已 `readyState≈4`）；**导出**（走后端 ffmpeg，不经此 rAF/解码链路）；暂停态单击查看中段帧（就绪重绘能自救）。

## A.5 候选修复方案（Candidate fixes）

> 本节只做方案对比，不在本节点落代码。改动均集中于 `MultiTrackPlaybackEngine.ts` 与 `VideoSourcePool.ts`，不触碰音频/转场/多轨统一时间基。

| 方案 | 核心做法 | 侵入性 | 风险 | 工作量 | 是否单独足够 |
|---|---|---|---|---|---|
| **A1. 握手命中后强制补画一帧** | `_armStartReanchor` 的 handler 在 `clock.reanchor(targetComp)` 之后追加一次 `this._renderAt(targetComp, true)`，直接把已可画的正确帧画出，不等下一个 rAF 撞运气 | 极小（1 处） | 低 | 极小 | 否（只补残口①，未解决预算丢弃） |
| **A2. 播放态「空帧自救」放开就绪重绘** | 放宽 `:399` 的 `phase==='playing'` 封锁：当上一帧合成器 `drewAny===false`（可由 `CanvasCompositor` 暴露 `getLayerStats`）时，允许在 `seeked/canplay/loadeddata` 上做**一次性** `_renderAt(clock.getCompositionTime(), true)`。这样**只要 lead 元素变可画，下一帧立即出图**，彻底摆脱 500ms 预算依赖 | 小 | 低-中（需确保不破坏「playing 由 rAF 拥有」不变量，仅在空帧时一次性补画） | 小 | 是（覆盖暂停 seek + 点击 seek→播放两路径） |
| **A3. 关闭「落定后再次前向硬拽」窗口 / 解码为主软同步** | (a) 起播窗口内**延长或跳过** `BIND_SEEK_TIMEOUT_MS`（`constants.ts:58` / `:297`），让握手熬过慢冷 seek；或 (b) `_ensureSeeked` 在「元素刚从 seek 落定且 comp 已领先」时，改为 `clock.reanchor(el.currentTime 对应 comp)` 跟随元素，而非硬拽元素去追时钟 | (a) 极小 /(b) 中-高 | (a) 低 /(b) 高（牵动统一时间基） | (a) 极小 /(b) 高 | (a) 否（仅加固）/(b) 是但超出最小修复 |
| **A4. 起播前等就绪再 `clock.start`（纯 gate 版）** | `play()`/`seek(playing)` 先 seek 并等 `canplay/seeked`，就绪后再启动时钟 | 中 | 中（需处理多轨/纯音频/超时兜底；漏「起转期」） | 中 | 否（不覆盖「已就绪但 play 起转延迟」窗口） |

## A.6 推荐方案（Recommended fix）

**推荐 A1 + A2 组合为本轮最小且对症的修复，A3-(a)（延长/跳过起播窗口预算）作为廉价加固；A3-(b)/A4 留作后续架构演进。**

理由：
1. **A2 是真正的载荷**：它让「lead 元素一旦可画就立刻补画一帧」**独立于 500ms 预算**成立，同时覆盖「暂停 seek」与「点击 seek→播放」两条路径，从根上消除「黑屏无自救」。
2. **A1 直接堵残口①**：握手命中即补画，成本几乎为零，与 A2 互补（A1 覆盖握手存活时；A2 覆盖握手已被预算丢弃后）。
3. **A3-(a) 廉价加固残口③**：把起播窗口的预算从固定 500ms 放宽（或在窗口内不丢弃握手），减少慢冷 seek 触发螺旋的概率；但**不能单独依赖**——必须配 A1/A2 才能在预算确实超时的情况下仍出图。
4. **回归可控**：位置 0 快路径（`readyState=4`）零影响；A2 仅在「上一帧空帧」时一次性补画，不破坏「playing 由 rAF 拥有」不变量；亚秒级 reanchor 回拉幅度落在音频漂移容差 `AUDIO_DRIFT_EPSILON_SEC`（`constants.ts`）内。
5. **必须补「真实失败路径」测试**（修正 A.3.6 的覆盖缺口）：用**可切换 `readyState`/`seeking` 的事件型假元素**写回归测试——「冷 seek 期间 `drawn=0`，元素就绪后**第一帧** `drawn>0` 且不再持续 `dropped`」「预算超时后元素落定也能出图」「`_ensureSeeked` 不在落定后把 comp 领先量硬拽成新冷 seek」。

**落地要点（供 Subtask #2）**：
- `MultiTrackPlaybackEngine._armStartReanchor` handler：`clock.reanchor(targetComp)` 后加 `this._renderAt(targetComp, true)`（A1）。
- `MultiTrackPlaybackEngine._bindReadinessRepaint` handler（`:397-401`）：在 `phase==='playing'` 且**上一帧空帧**时，放行一次 `_renderAt(this.clock.getCompositionTime(), true)`（A2）；需 `CanvasCompositor` 暴露「上一帧是否 `drewAny`」。
- （可选 A3-a）起播窗口内放宽 `BIND_SEEK_TIMEOUT_MS` 判定（`:295-300`）。
- 验收：按 A.2 从位置 0 与中段分别起播，均应在 ≤1 个 seek 周期内出图；逐轨道诊断不再出现持续 `readyState<2 + paused=false + drawn=0 + dropped 增长`；位置 0 与第 1 轮卡顿修复（`d22d787`）不回归。

## A.7 关键证据索引（Bug A）

| 证据 | 位置 | 说明 |
|---|---|---|
| 握手只重锚不重绘 | `MultiTrackPlaybackEngine.ts:442-457`（+注释 `:436-437`） | reanchor 后无 `_renderAt` |
| 播放态关闭就绪重绘 | `MultiTrackPlaybackEngine.ts:397-401` | 黑屏无自救 |
| 500ms 预算丢弃握手 | `MultiTrackPlaybackEngine.ts:290-300` + `constants.ts:58` | 慢冷 seek 超时即弃 |
| `play()`/`seek()` 起播逻辑 | `MultiTrackPlaybackEngine.ts:216-228, 239-255` | play 不调 renderAt；paused seek 不挂握手 |
| 方案 B 守卫不覆盖「落定后再硬拽」 | `VideoSourcePool.ts:385-389` | 仅拦在途 seek |
| seek 容差 0.25s | `constants.ts:99` | 触发再次前向硬拽的阈值 |
| 合成器 `readyState<2` 跳过绘制 | `CanvasCompositor.ts:150-153`（+ `:215-221` 黑底 `#000`/`drewAny`） | 未就绪即只剩黑屏 |
| 单测假元素 `readyState` 恒 4、不模拟 seeking | `__tests__/MultiTrackPlaybackEngine.test.ts`、`VideoSourcePool.test.ts` | 测试未触达失败路径 |

---
---

# Part B —— 打包桌面端「无法导出视频」（round-3，真实根因 = generated audio 不在 STORAGE_ROOT）

## B.1 问题描述（Problem description）

用户在剪辑面板把**视频 + 音频（含 TTS 生成语音）**拖到轨道后点击「导出视频」：
- **开发者模式（`npm run dev`，前端 `http://localhost:3000`，后端 CWD = `backend-services/basic-service`）**：导出正常。
- **打包桌面端（Electron 加载 `http://127.0.0.1:18320`，后端 `127.0.0.1:18321`，CWD = 安装目录 `.../resources/backend`）**：导出失败。

上一轮把失败归因于 SSRF 守卫（loopback 绝对 URL 被拒）并提交 `b043015`。本轮核对发现：**SSRF 修复已进打包产物且已生效**——守卫现在放行 loopback 同源引用，合成线程能正常启动并跑完视频归一化与拼接；**真正的失败发生在更后面的「音频合并」阶段**。

## B.2 复现步骤（Reproduction steps）

### B.2.1 环境差异（关键变量）

| | 开发者模式 | 打包桌面端 |
|---|---|---|
| 后端进程 CWD | `M:/takoAI/Ecliptrix/backend-services/basic-service`（稳定、持久） | `.../win-unpacked/resources/backend`（**每次重打包被清空**；真实 NSIS 安装在 Program Files 下**只读**） |
| `SERVICE_ROOT`（`Path(__file__).parents[2]`） | 同上（持久） | `.../resources/backend`（易失/只读） |
| `STORAGE_ROOT`（`settings.storage.root`） | `static/uploads`（相对，落在持久 basic-service 下） | `C:/Users/jdqqj/AppData/Roaming/ecliptrix-desktop/storage`（持久、可写，由 `backendService.js` 注入） |
| generated audio 实际落点 | CWD/`static/audio/generated`（与解析一致、持久） | CWD/`SERVICE_ROOT`/`static/audio/generated`（**与 STORAGE_ROOT 脱节、易失/只读**） |

### B.2.2 UI 复现（打包桌面端）

1. 安装/启动打包桌面端（窗口地址 `http://127.0.0.1:18320`）。
2. 上传本地视频；生成或加入一段 TTS 语音音频（URL 形如 `/api/audio/generated/segment-1_concatenated_*.mp3`）。
3. 把视频与音频加入轨道，点击「导出视频」。
4. **预期**：合成并下载带音频的 mp4；**实际**：导出失败。

### B.2.3 打包运行时实证（最强证据，来自打包 backend.log）

打包 backend.log 位于 `C:/Users/jdqqj/AppData/Roaming/ecliptrix-desktop/logs/backend.log`（注意：因 `package.json` 的 `name: ecliptrix-desktop` 决定 userData 路径，而非 `productName: Ecliptrix`）。同一失败在 **13:02:18** 与 **15:53:27** 各发生一次（**均晚于** `b043015`@12:30、`fed1e02`@12:36，证明不是「修复没打进去」）：

```
2026-06-11 15:53:19 - app.main - INFO - Request: GET http://127.0.0.1:18321/api/audio/generated/segment-1_concatenated_1780987839_bfd1cf60.mp3
2026-06-11 15:53:19 - app.main - WARNING - HTTP exception: 404 - Not Found
2026-06-11 15:53:19 - app.main - INFO - Response: 404 - 0.005s
...
2026-06-11 15:53:27 - app.services.video_composition_service - INFO - Converting URL to local path: /api/audio/generated/segment-1_concatenated_1780987839_bfd1cf60.mp3
2026-06-11 15:53:27 - app.services.video_composition_service - ERROR - Local file does not exist:
    M:\takoAI\Ecliptrix\desktop\release\win-unpacked\resources\backend\static\audio\generated\segment-1_concatenated_1780987839_bfd1cf60.mp3
2026-06-11 15:53:27 - ERROR - Failed to resolve single audio path for '段落1 - 开场介绍 - 语音': Audio file not found: ...\resources\backend\static\audio\generated\...mp3
  File "...\resources\backend\app\services\video_composition_service.py", line 1884, in _process_audio_tracks
    raise FileNotFoundError(f"Audio file not found: {local_path}")
2026-06-11 15:53:27 - ERROR - Audio processing error: Audio merge skipped: _process_audio_tracks returned None (audio_items=1, video_audio_paths=0).
2026-06-11 15:53:27 - ERROR - Video composition failed: Audio merge skipped: ...
2026-06-11 15:53:27 - ERROR - Async composition 299651b5-d866-4993-bce1-0ad26df5d7f9 failed: Video composition failed: Audio merge skipped: ...
```

文件系统侧佐证：
- 解析目标目录 `desktop/release/win-unpacked/resources/backend/static/audio/generated/` **为空**（mtime 15:43，被本次重打包重建）。
- 持久 `STORAGE_ROOT`（`.../ecliptrix-desktop/storage/`）下虽有 `audio/`、`static/audio/waveforms`、`static/video/thumbnails` 等，但**全盘搜不到该 `segment-1_concatenated_*.mp3`**——generated audio 从不落在 STORAGE_ROOT。
- `/api/audio/generated/...` 的 GET 返回 **404**：说明连**静态挂载**都找不到（挂载目录与解析目录同为易失安装目录）。

> 反证：导出请求里的**视频**输入解析正常（走 `/api/storage/files/...` → `STORAGE_ROOT`，落在持久 storage），ffmpeg 归一化/拼接成功；**只有音频**因路径锚定不同而 404。**video 用 STORAGE_ROOT、audio 用 SERVICE_ROOT 的不对称，正是 Bug B 的本质。**

## B.3 根因分析（Root cause analysis — 含证据）

### B.3.1 上一轮 SSRF 修复已生效，**不是本轮阻断点**

`b043015` 的后端豁免已在源码与打包产物中：`backend-services/basic-service/app/services/video_composition_service.py:1601-1613`（对 `_is_loopback_local_reference(url)` 的 loopback 同源引用 `continue`，跳过 `validate_external_url`）。打包 backend.log 显示合成请求被接受、视频归一化与拼接成功——守卫已放行。**本轮失败发生在音频合并阶段，与 SSRF 无关。**

### B.3.2 真正根因：generated audio 的「写入 / 挂载 / 解析」三处全锚定 `SERVICE_ROOT`/CWD，而非 `STORAGE_ROOT`

**(a) 解析侧（合成时）**：`_convert_url_to_local_path` 对 `/api/audio/generated/`、`/api/audio/subtitles/` 用 `_SERVICE_ROOT / rel_dir / filename`：

`video_composition_service.py:1575`：
```python
_SERVICE_ROOT = Path(__file__).resolve().parents[2]    # 打包后 = .../resources/backend（安装目录）
```
`video_composition_service.py:1579-1583, 1668-1683`：
```python
_URL_PREFIX_TO_REL_DIR = {
    '/api/audio/generated/': os.path.join('static', 'audio', 'generated'),
    '/api/audio/subtitles/': os.path.join('static', 'audio', 'subtitles'),
}
...
for prefix, rel_dir in self._URL_PREFIX_TO_REL_DIR.items():
    if url.startswith(prefix):
        local_path = str(self._SERVICE_ROOT / rel_dir / filename)   # ← 锚 SERVICE_ROOT
        if not os.path.exists(local_path):
            raise FileNotFoundError(f"Audio file not found: {local_path}")   # ← :1681
```
**对照**：紧随其后的 `/api/storage/files/` 分支（`:1685-1694`）用 `settings.storage.root`（= `STORAGE_ROOT`）。**同一函数里，audio 锚 SERVICE_ROOT、storage 锚 STORAGE_ROOT**——这就是不对称的源头。

`_convert_url_to_local_path` 先试 `resolve_media_reference`（`:1658`），但**底层 resolver 同样锚 SERVICE_ROOT**：
`backend-services/basic-service/app/services/local_media_resolver.py:41,45-48,54-65`：
```python
SERVICE_ROOT = Path(__file__).resolve().parents[2]
ROUTE_PREFIXES = (
    ("/api/storage/files/", None, "local_storage"),                       # None → 用 storage.root
    ("/api/audio/generated/", Path("static/audio/generated"), "audio_generated"),   # ← 相对 SERVICE_ROOT
    ("/api/audio/subtitles/", Path("static/audio/subtitles"), "audio_subtitle"),
)
def _absolute_root(root): return root if root.is_absolute() else SERVICE_ROOT / root   # ← audio 锚 SERVICE_ROOT
```
即**新旧两条解析路径对 generated audio 都指向安装目录**，无一映射到 STORAGE_ROOT。

**(b) 写入侧（TTS 生成时）**：`tts_service.py:331`：
```python
self.audio_dir = "static/audio/generated"          # CWD 相对
...
os.makedirs(self.audio_dir, exist_ok=True)          # :344
```
打包后 CWD = 安装目录，故 TTS 把音频写进**安装目录**（易失：重打包即清空；真实安装在 Program Files 下**只读 → 写入直接失败**）。`sentence_tts_service.py` 同样以 `static/audio/generated` 为基。

**(c) 静态挂载侧**：`backend-services/basic-service/app/main.py:665-669`：
```python
audio_static_dir = "static/audio/generated"        # CWD 相对
os.makedirs(audio_static_dir, exist_ok=True)
app.mount("/api/audio/generated", StaticFiles(directory=audio_static_dir), ...)
```
挂载目录同为易失安装目录 → 文件缺失即 GET 404（与 B.2.3 实证一致）。**对照** `main.py:682`「Silence detection audio & removal output are now stored under STORAGE_ROOT」与 `:701`（storage 挂载用 `settings.storage.root`）：项目**已经把波形、缩略图、静音检测等迁到 STORAGE_ROOT，唯独 generated/subtitles audio 仍留在 CWD/SERVICE_ROOT**——这是一次**未完成的迁移**。

### B.3.3 为什么 dev 正常、打包失败

- **dev**：CWD = `backend-services/basic-service`（持久、可写）。TTS 写入、静态挂载、合成解析**三者都落在同一个持久目录**，文件自然存在 → 导出成功。
- **打包**：CWD/SERVICE_ROOT = 安装目录（易失/只读），而 STORAGE_ROOT = 持久 userData。generated audio 落在安装目录、与持久 STORAGE_ROOT 脱节；一旦重打包清空（或真实安装只读使 TTS 写入失败），且**项目持久化把音频引用原样存为 `/api/audio/generated/...`** 跨会话存活 → 重新打开工程导出时音频 404 → `FileNotFoundError` → 整次导出失败。

### B.3.4 失败的传导链（一次导出如何被音频 404 整体打掉）

`_process_audio_tracks`（`video_composition_service.py:1884` 抛 `FileNotFoundError`）→ 返回 `None` → 调用方 `RuntimeError: Audio merge skipped: _process_audio_tracks returned None (audio_items=1, video_audio_paths=0)` → `Video composition failed` → `Async composition ... failed`。**即使视频已归一化/拼接成功，只要有一条 generated-audio 引用缺失，整次导出即失败**（音频是必经合并步骤）。

> **【评审补正 B.3.4 — 抛错点精确化】** 评审核对源码：`FileNotFoundError("Audio file not found: ...")` 的**真正抛出点在 `_convert_url_to_local_path` 内的 `:1681`**（先 `resolve_media_reference`→`LocalMediaResolveError`→`pass`@`:1665`，再落入 `_URL_PREFIX_TO_REL_DIR` 回退分支 `:1668-1683`，在 `:1680` 打印 `Local file does not exist` 后于 `:1681` 抛错——与打包 log 逐字一致）。`:1884` 是 `_process_audio_tracks` **调用** `_convert_url_to_local_path` 的语句（单音频分支 `:1877-1890`），其外层 `try/except Exception`（`:1883-1890`）**捕获**该异常、打印 `Failed to resolve single audio path` 后 **`return None`**——所以该函数本身并不向上抛，而是以「返回 None」把失败传给调用方，调用方再抛 `Audio merge skipped`。原文「`:1884` 抛 FileNotFoundError」应理解为「`:1884` 处调用触发了 `:1681` 抛出的异常」。链路结论不变，仅抛错坐标更正。

## B.4 影响面（Impact surface）

- **受影响功能**：**打包桌面端**下、**含 TTS/生成音频或字幕音频**的视频导出。
- **受影响素材**：任何 URL 为 `/api/audio/generated/*` 或 `/api/audio/subtitles/*` 的音频——典型来源：段落语音、AI 配音、拼接语音；以及**已保存工程**里持久化的这些引用（跨会话/跨打包存活，最容易踩中）。
- **严重度**：高。这是「桌面端打包后无法导出」的直接阻断点；且 TTS 配音是本平台核心用法。
- **潜在更严重面（真实安装）**：NSIS 安装到 Program Files 时，安装目录**只读** → TTS 写入 `static/audio/generated` 在生成阶段就会失败（不止导出），影响面更大。
- **不受影响**：纯视频（无音频）导出；dev 模式；走 `/api/storage/files/` 的上传素材（已锚 STORAGE_ROOT）。

## B.5 候选修复方案（Candidate fixes）

> 要守的**不变量**：「**generated/subtitles audio 的写入、静态挂载、合成解析三处必须锚定同一个持久可写根（`STORAGE_ROOT`）**」，与已迁移的波形/缩略图/静音检测一致。

| 方案 | 改动点 | 思路 | 侵入性 | 风险 | 是否闭合不变量 |
|---|---|---|---|---|---|
| **B1. 把 generated/subtitles audio 统一迁到 STORAGE_ROOT（写+挂载+解析三处一致）** | 写：`tts_service.py:331`、`sentence_tts_service.py`；挂载：`main.py:665-678`；解析：`video_composition_service.py:1579-1683` 的 `_URL_PREFIX_TO_REL_DIR` 与 `local_media_resolver.py:45-65` 的 `ROUTE_PREFIXES`/`_absolute_root` | 三处都改为基于 `settings.storage.root`（绝对化），与 `/api/storage/files/`、波形、缩略图、静音检测相同 | 中（跨 3-4 个文件，但都是「把 base 换成 STORAGE_ROOT」的同形改动） | 低（与既有 STORAGE_ROOT 迁移完全同构；解析仍走 `validate_local_path_for_ffmpeg` 容器化） | ✅ 完整闭合（写=读=挂载同根） |
| **B2. 仅解析侧回退到 STORAGE_ROOT（最小热修）** | 仅 `video_composition_service.py` + `local_media_resolver.py` 解析处：找不到 SERVICE_ROOT 路径时回退到 `STORAGE_ROOT/static/audio/generated` | 不改写入/挂载，仅让「老工程引用」能在 STORAGE_ROOT 找到 | 小 | 中（治标：新生成的音频仍写到易失/只读安装目录；真实安装写入仍会失败） | ⚠️ 部分（不闭合写入侧） |
| **B3. 桌面端把 CWD 设为持久可写目录** | `desktop/main/backendService.js` 把后端子进程 `cwd` 指向 userData 下的持久目录，并预创建 `static/audio/...` | 让 CWD 相对路径恰好落在持久目录 | 小 | 中-高（CWD 还牵动其它相对路径副作用；`SERVICE_ROOT=__file__.parents[2]` 仍指安装目录，解析与写入再次错位） | ❌ 不闭合（SERVICE_ROOT 与 CWD 仍可能不一致） |
| **B4. 重打包/重装即可** | 构建流程 | 让安装包带最新产物 | 极小 | —— | ❌ 无效（产物已是最新；根因是路径锚定，非陈旧产物） |

## B.6 推荐方案（Recommended fix）

**推荐 B1（把 generated/subtitles audio 的写入+挂载+解析三处统一锚定 `STORAGE_ROOT`）为唯一承重修复；B2 可作为对「历史已保存工程」的兼容回退叠加；B3/B4 排除。**

理由：
1. **B1 守住正确不变量**：本 Bug 的本质是「generated audio 锚在易失/只读的 SERVICE_ROOT、与持久 STORAGE_ROOT 脱节」。B1 把写入、静态挂载、合成解析三处**同时**迁到 STORAGE_ROOT，使「写=读=挂载同根、且持久可写」，**同时解决** dev/打包/真实安装三种环境，并与项目**早已完成**的波形/缩略图/静音检测迁移（`main.py:682`）保持一致——是**收尾一次未完成的迁移**，而非新增机制。
2. **闭合度最高、风险最低**：改动是同形的「base 换成 `settings.storage.root` 并绝对化」，解析仍经 `validate_local_path_for_ffmpeg` 容器化（安全姿态不变）。
3. **B2 作为兼容叠加**：对「已保存工程里存量 `/api/audio/generated/...` 引用」给一条 STORAGE_ROOT 回退，避免老工程在迁移后仍 404；但**不能单独用**（不解决写入侧只读/易失）。
4. **B3 排除**：改 CWD 治标且引入新错位（`SERVICE_ROOT` 仍指安装目录）。**B4 排除**：产物已是最新（B.2.3 时间戳证明），根因是路径锚定。

**落地要点（供 Subtask #2）**：
- 写入：`tts_service.py:331`、`sentence_tts_service.py` 的 `audio_dir` 改为 `os.path.join(settings.storage.root, 'static/audio/generated')`（或新增 `settings.storage.audio_generated_dir`），并 `os.makedirs`。
- 挂载：`main.py:665-678` 的 `audio_static_dir`/`subtitle_static_dir` 改为 STORAGE_ROOT 下同一目录。
- 解析：`video_composition_service.py:1668-1683`（`_URL_PREFIX_TO_REL_DIR` 改为相对 STORAGE_ROOT 或直接拼绝对路径）+ `local_media_resolver.py:45-65`（`ROUTE_PREFIXES` 的 audio 项 `root=None` 走 `storage.root`，或 `_absolute_root` 对 audio 改锚 STORAGE_ROOT）。
- **先写可复现失败用例**：构造 `audio_items[0].url='/api/audio/generated/x.mp3'`、文件只存在于 STORAGE_ROOT 时，断言解析命中 STORAGE_ROOT（迁移前断言 FileNotFound、迁移后通过）。
- 验证：dev 与**重打包桌面端**各导出一次（含 TTS 音频 + 已保存工程重载）确认成功；`/api/audio/generated/*` GET 返回 200；`pytest` 相关用例绿。

## B.7 关键证据索引（Bug B）

| 证据 | 位置 | 说明 |
|---|---|---|
| 打包导出失败实证（晚于修复） | `AppData/Roaming/ecliptrix-desktop/logs/backend.log:5171-5192`（15:53）、`:4695-4716`（13:02） | `FileNotFoundError`→`Audio merge skipped`→`Video composition failed` |
| 音频 GET 404 | 同 log `:5051-5062`（15:53） | 连静态挂载都找不到 |
| 解析锚 SERVICE_ROOT | `video_composition_service.py:1575, 1579-1583, 1668-1683`（`:1681` 抛错、`:1884` 调用点） | audio 用 `_SERVICE_ROOT`，storage 用 `storage.root`（`:1685-1694`） |
| 旧 resolver 也锚 SERVICE_ROOT | `local_media_resolver.py:41, 45-48, 54-65` | `ROUTE_PREFIXES` 的 audio 项相对 SERVICE_ROOT |
| 写入侧 CWD 相对 | `tts_service.py:331, 344`、`sentence_tts_service.py` | `audio_dir="static/audio/generated"` |
| 静态挂载 CWD 相对 | `main.py:665-678` | `audio_static_dir="static/audio/generated"` |
| 已迁移项对照（未完成迁移的反证） | `main.py:682, 701` | 静音检测/storage 已用 STORAGE_ROOT，audio 未迁 |
| SSRF 修复已在产物且生效（非本轮阻断点） | `video_composition_service.py:1601-1613`（`_is_loopback_local_reference`）+ 打包产物含该函数 | 守卫放行，合成已启动 |
| 桌面端注入 STORAGE_ROOT / CWD | `desktop/main/backendService.js`（`STORAGE_ROOT=userData/storage`，cwd=`resources/backend`）、`config.js`（端口 18320/18321） | 环境差异来源 |

---
---

## 结语（给下游节点）

- **两个 Bug 相互独立**：Bug A 纯前端预览引擎（`MultiTrackPlaybackEngine`/`VideoSourcePool`/`CanvasCompositor`）；Bug B 纯后端打包路径（generated audio 的 STORAGE_ROOT 锚定）。可并行修复、互不影响。
- **两个 Bug 都不是「上一轮修复没打进去」**：`fed1e02` 与 `b043015` 都已在源码与打包产物中（已逐项核对）。Bug A 是该修复**留有未闭合残口**（握手不重绘 + 500ms 预算丢弃 + 落定后再硬拽）；Bug B 是**真正阻断点已从 SSRF 转移到 generated-audio 路径**。
- **Definition of Done 对照**：两个 Bug 均给出了**可照做的复现步骤**；根因均有**实证支撑**（Bug A 为逐行代码引用 + 测试覆盖缺口分析；Bug B 为打包运行时 backend.log 逐字日志 + 代码引用 + 文件系统状态），非纯推测；并各给出**候选方案对比表 + 单一推荐方案 + 落地要点**。

---
---

## 评审结论（Review Verdict）

- **评审节点**: Subtask #1（分析报告评审与修复）
- **评审人**: 资深工程评审（独立逐行核对，非复述）
- **日期**: 2026-06-11
- **结论速览**: 两 Bug 的根因假说**均经独立核对成立、证据链可判**；评审在文中补正了 3 处「表述不严谨/坐标偏移」（A.3.6 测试缺口、B.3.4 抛错点、下方 Bug A 修复充分性），并据此**收敛出每个 Bug 唯一的承重修复**。**放行进入 Subtask #2。**

### 一、证据独立复核（逐项核对 = 实读源码，非引用原文）

| 断言 | 复核位置（评审实读） | 判定 |
|---|---|---|
| 握手只重锚不重绘 | `MultiTrackPlaybackEngine.ts:447-452`（handler 仅 `clock.reanchor`）+ 注释 `:436-437`「re-anchor only (no forced repaint)」 | ✅ 属实 |
| 播放态关闭就绪重绘 | `MultiTrackPlaybackEngine.ts:397-401`（`phase==='playing'` 直接 `return`） | ✅ 属实 |
| 500ms 预算丢弃握手 | `MultiTrackPlaybackEngine.ts:295-300` + `constants.ts:58`（`BIND_SEEK_TIMEOUT_MS=500`） | ✅ 属实 |
| `play()` 不自绘首帧 / paused seek 不挂握手 | `:216-228`（play 无 `_renderAt`）、`:250-254`（paused 分支 disarm+renderAt） | ✅ 属实（补：`seek()` while-playing 分支 `:245-249` **有** `_renderAt(target,true)` 再 `_armStartReanchor`，scrub-while-playing 同受螺旋影响） |
| 落定后再硬拽（方案 B 不覆盖） | `VideoSourcePool.ts:387`（守卫）+ `:388-390`（落定后 `>tolerance` 即 `_assignCurrentTime`） | ✅ 属实 |
| 黑屏直接成因（真实多轨路径） | **`CanvasCompositor.ts:280` `_drawVideoLayer`：`readyState<2 → return false`**；`renderFrame:218-231` `drewAny=false → 只剩 `:215-216` 黑底 | ✅ 属实，且**修正引用**：原文 A.3.4 引的 `:150-153` 是 legacy 单源 `drawFrame` 路径（引擎实走 `renderFrame→_drawLayer→_drawVideoLayer`）；评审已确认多轨路径同样在 `:280` 短路，故结论不变 |
| 解析锚 SERVICE_ROOT（双解析路径） | `local_media_resolver.py:41,45-48,54-57`（audio 相对 → `SERVICE_ROOT`）+ `_resolve_route_path:106-107`（storage 走 `storage.root`）；`video_composition_service.py:1571-1683`（回退分支同锚 `_SERVICE_ROOT`，`:1685-1694` storage 走 `storage.root`） | ✅ 属实，不对称确凿 |
| 写入/挂载 CWD 相对 | `tts_service.py:331,344`、`main.py:665-680`（`audio_static_dir/subtitle_static_dir` 相对）；对照 `main.py:682` 静音检测已迁 STORAGE_ROOT、`:700-701` storage 用 `storage.root` | ✅ 属实，「未完成迁移」成立 |
| STORAGE_ROOT 持久可写、来源 | `desktop/main/backendService.js:34`（`STORAGE_ROOT=userData/storage`）+ `config.py:950`（`os.getenv("STORAGE_ROOT","static/uploads")`→`settings.storage.root`） | ✅ 属实 |
| SSRF 修复已生效、非本轮阻断点 | `video_composition_service.py:1601-1613`（`_is_loopback_local_reference→continue`）；log 显示请求已进入解析阶段 | ✅ 属实 |

> 复核未发现任何「引用指向不存在的行/与代码相反」的硬伤；上文 3 处补正均为**精度问题**而非根因翻案。

### 二、Bug A：根因判定 + 修复充分性复审（关键发现）

**根因成立**：中段起播黑屏 = 「握手不重绘（残口①）+ 播放态就绪重绘被 gate（残口②）+ 500ms 预算丢弃握手（残口③）→ 落定后 comp 已领跑 → `_ensureSeeked` 前向硬拽出新冷 seek → 螺旋」。直接成因是合成器 `readyState<2 → 不画 → 只剩黑底`。证据链可判。

**【评审关键发现 — 推荐组合的充分性需收敛】**：原文 A.6 把 **A3-(a)（放宽/跳过起播预算）列为「可选廉价加固」**，把 A2 当主载荷。评审通过追踪螺旋的「唯一可断点」认为这一权重分配**会留下治标不治本的风险**：

- 螺旋之所以自持，是因为**落定时 `comp` 仍领先元素**，于是 `_ensureSeeked`（`:388-390`）把元素前向拽走、重启冷 seek。**唯一能令 `comp` 不再领先的动作，是握手 handler 里的 `clock.reanchor(targetComp)`**（把时钟拉回元素）。
- 而握手 handler 只有在**握手仍存活**时才会因 `seeked`/`playing` 触发。一旦冷 seek 耗时 > 500ms，预算在 `:295-300` 把握手 disarm，**迟到的 `seeked` 不再 reanchor**（已由测试 `:571-580` 反证：late `seeked` 不改时钟）。
- **A2 只补画、不 reanchor**：它在就绪事件上画一帧（且画的是已领先的 `comp`），但 `comp` 仍领先 → 下一 tick `_ensureSeeked` **照样**前向硬拽 → 冷 seek 再起 → 黑。净效果从「持久黑」变为「每个 seek 周期闪一帧」的**抖动**，**并未根除螺旋**。
- 因此「治本」**必须保证 reanchor-on-settle 发生**，即**握手必须熬过这次冷 seek**。这恰是 A3-(a) 的职责。结论：**A3-(a) 是承重项，不是可选项**；A2 应降格为「残余黑窗口的防御补画」。

**被排除的替代解释（强化证据）**：黑屏**不是** RC-B 源 URL 解析失败 —— 若是 URL 问题，位置 0 也会黑；而「位置 0 正常、仅中段黑、且暂停在中段那帧能自救」精确指向**就绪/seek 时序**，排除 URL 解析与素材损坏。

**Bug A 唯一推荐修复（承重）**：
> **A1 + A3-(a) 为承重对：** ① `_armStartReanchor` handler 在 `clock.reanchor(targetComp)` 后追加 `this._renderAt(targetComp, true)`（A1，命中即出图，去掉「等 rAF 撞运气」）；② 让起播握手**熬过真实冷 seek**——评审倾向 A3-(a) 取「**不靠墙钟定时丢弃、改为仅在被新的 play/seek/pause 取代时 disarm**（或把起播窗口 `BIND_SEEK_TIMEOUT_MS` 判定提到秒级，如 5–8s）」的形态，使迟到 `seeked` 仍能 reanchor，从根上断开螺旋（残活的握手无害：时钟本就自由奔跑，监听器在下次 play/seek/pause/dispose 释放）。**A2（播放态空帧一次性补画，依赖 `CanvasCompositor` 暴露 last-frame `drewAny`）作为防御补画叠加，缩短冷 seek 期间的黑窗口，但不单独承重。**
> **必补测试**（按上文 A.3.6 补正的三点）：用**可切换 `readyState`/`seeking`、且 `seeked` 会翻转就绪态**的事件型假元素，断言「冷 seek 期 `drawn=0`、落定后**第一帧** `drawn>0` 且不再持续 `dropped`」「预算/迟到 `seeked` 后元素落定仍能 reanchor+出图」「`_ensureSeeked` 不把落定后的 comp 领先量拽成新冷 seek」。
> **回归边界**：位置 0 快路径（`readyState=4`）零影响；A2 仅「上一帧空帧」时一次性补画，不破坏「playing 由 rAF 拥有」不变量；reanchor 亚秒级回拉落在 `AUDIO_DRIFT_EPSILON_SEC=0.5`（`constants.ts:82`）内，音画不破。

### 三、Bug B：根因判定 + 修复精度复审（防回归）

**根因成立**：打包导出失败 = 「generated/subtitles audio 的**写入（`tts_service.py:331`/`sentence_tts_service`）+ 静态挂载（`main.py:665-680`）+ 合成解析（`local_media_resolver.py:45-57` 与 `video_composition_service.py:1668-1683`）三处全锚 `SERVICE_ROOT`/CWD（易失/只读安装目录），而视频走 `/api/storage/files/`→`STORAGE_ROOT`（持久 userData）」。打包 backend.log 13:02/15:53（均晚于修复）逐字实证 `404 → FileNotFoundError → Audio merge skipped → composition failed`。证据链可判，且为**一次未完成的迁移**（静音检测/波形/缩略图已迁、唯 generated/subtitles audio 未迁）。

**被排除的替代解释**：① 非 SSRF —— log 显示请求已**穿过守卫**进入 `_convert_url_to_local_path`（`Converting URL to local path` + `Local file does not exist`），且 loopback 豁免 `:1610` 已核实、同为 loopback 的**视频解析成功**；② 非「产物陈旧/没打进去」—— 失败时间戳晚于 `fed1e02`/`b043015`；③ 「TTS 从未生成」在本次抓到的 repro 里被排除（引用存在、文件只是落在错误的根），但**真实 Program Files 只读安装**会让写入阶段就失败，属同一根因的更严重面。

**【评审关键发现 — B1 的落地精度，防新回归】**：
- **必须保留 `static/audio/generated` 子路径**。原文落地要点提到「`ROUTE_PREFIXES` 的 audio 项 `root=None` 走 `storage.root`」——评审提醒：**`root=None` 是错的**。`_resolve_route_path:106-108` 对 `root=None` 取 `candidate_root=_absolute_root(storage.root)`、`candidate=storage.root/relative`，而 `relative` 仅是文件名 → 解析成 `STORAGE_ROOT/<file>`；但写入与挂载放在 `STORAGE_ROOT/static/audio/generated/<file>` → **新的写/读错位**。正解：保留 `Path("static/audio/generated")` 子路径，仅把其**锚根从 `SERVICE_ROOT` 改为 `storage.root`**（写、挂载、双解析四处同改、同一绝对目录）。
- **容器化白名单无需新开口**：`local_media_resolver._allowed_roots():62` 与 `video_composition_service._ffmpeg_allowed_local_roots():1634` 均已含 `settings.storage.root`，音频迁入 STORAGE_ROOT 子目录后天然被覆盖，**不引入新的 SSRF/越权面**（安全姿态不变）。
- **保留 B2 作为解析侧兼容回退**：对「历史已保存工程里存量 `/api/audio/generated/...`」与「dev 旧产物」，解析时**先查新的 `STORAGE_ROOT/static/audio/generated`、未命中再回退查 legacy `SERVICE_ROOT/static/audio/generated`**，避免迁移后老引用 404。仅作回退、不承重。

**Bug B 唯一推荐修复（承重）**：
> **B1（写入 + 静态挂载 + 双解析路径四处统一锚定 `STORAGE_ROOT`，保留 `static/audio/generated`/`subtitles` 子路径）为唯一承重修复**：`tts_service.py:331`/`sentence_tts_service` 写入基改为 `os.path.join(settings.storage.root,'static/audio/generated')`；`main.py:665-680` 挂载目录同改；`local_media_resolver.py:45-57`（audio 项锚 `storage.root`）与 `video_composition_service.py:1668-1683`（`_URL_PREFIX_TO_REL_DIR` 拼绝对 `storage.root` 子目录）解析同改。**B2 解析侧 legacy 回退作为兼容叠加**。**B3/B4 排除**（改 CWD 治标且 `SERVICE_ROOT` 仍错位；产物已最新）。
> **必补测试**：构造 `audio_items[0].url='/api/audio/generated/x.mp3'`、文件**仅存在于 STORAGE_ROOT 子目录**时，断言 `_convert_url_to_local_path`/`resolve_media_reference` **命中 STORAGE_ROOT**（迁移前断言 `FileNotFound`、迁移后通过）；并加「仅存在于 legacy SERVICE_ROOT」用例断言 B2 回退命中。
> **验证**：dev 与**重打包桌面端**各导出一次（含 TTS 音频 + 已保存工程重载）成功；`/api/audio/generated/*` GET 200；相关 `pytest` 绿。

### 四、最终推荐（每 Bug 单一方案，交付 Subtask #2）

1. **Bug A（预览中段起播黑屏）** → **A1 + A3-(a) 承重 + A2 防御补画 + 三条真实失败路径回归测试**。承重逻辑：A3-(a) 让握手熬过冷 seek、A1 让命中即出图，二者共同保证「落定即 reanchor、comp 不再领跑」从而**根除螺旋**；A2 仅缩短残余黑窗口。改动集中于 `MultiTrackPlaybackEngine.ts`（+ `CanvasCompositor` 暴露 last-frame `drewAny`），不触音频/转场/统一时间基。
2. **Bug B（打包导出失败）** → **B1（generated/subtitles audio 写+挂载+双解析四处统一锚 `STORAGE_ROOT`，保留子路径）+ B2 解析侧 legacy 回退 + 两条解析单测**。守住不变量「写=读=挂载同根、且持久可写」，收尾既有未完成迁移，dev/打包/真实安装三环境同解。

> 两 Bug 相互独立（纯前端预览引擎 vs 纯后端路径锚定），可并行实现、互不影响。**评审放行。**

---
---

## 实施过程发现的方案缺陷（Issues Found During Implementation）

- **实施节点**: Subtask #2（代码修复与开发）
- **日期**: 2026-06-11
- 落代码时，按推荐方案逐项核对发现以下两处需要**修正后再落地**的缺陷（均已在本次实现中按修正方案处理）。

### 缺陷①（Bug B）：承重的「四处」漏数了 generated audio 的两个读者，迁移写侧会反向制造回归

评审把 Bug B 的承重面框定为「写（`tts_service`/`sentence_tts_service`）+ 挂载（`main.py`）+ 双解析（`video_composition_service` + `local_media_resolver`）」共四处。但**写侧一旦从 CWD/`SERVICE_ROOT` 迁到 `STORAGE_ROOT/static/audio/generated`，所有「读 generated audio」的代码都必须同步迁移**，否则它们在 dev 与打包下都会读不到刚写出的文件（dev 下 `STORAGE_ROOT=static/uploads` 相对，写入落在 `static/uploads/static/audio/generated`，而旧读者仍读 CWD 的 `static/audio/generated` → 错位）。核对后发现除评审列出的两条解析路径外，还有**两个未被计入的读者**：

1. `app/services/audio_transcription_service.py:_resolve_local_path`（ASR 转写读取 `/api/audio/generated/`、`/api/audio/subtitles/` 输入，原锚 CWD 相对 `static/audio/generated`）。
2. `app/routers/tts_router.py`（`/tts/audio/download` 下载端点，原锚 CWD 相对 `static/audio/generated`）。

**修正方案（已落地）**：在 `local_media_resolver.py` 新增共享锚点 `audio_generated_dir()/audio_subtitle_dir()`（规范=`STORAGE_ROOT`）与 `legacy_audio_generated_dir()/legacy_audio_subtitle_dir()`（B2 回退=`SERVICE_ROOT`）。写侧（`tts_service`/`sentence_tts_service`）、挂载（`main.py`）、以及**四个读者**（`video_composition_service`、`local_media_resolver._resolve_route_path`、`audio_transcription_service`、`tts_router` 下载）全部改用这套共享锚点；解析读者一律「先查 `STORAGE_ROOT` 规范目录、未命中回退 `SERVICE_ROOT` legacy（B2）」。这样才真正守住「写=所有读=挂载同根」的不变量。

**明确不改（保持最小面、与本 Bug 无关的既有不一致）**：
- `tts_router.py` 的 `ai-audio-synthesize`(克隆语音) 与 `voice_clone_router.py` 写到的是 `STORAGE_ROOT/audio/generated`（**无 `static` 子路径**），与本 Bug 的 `static/audio/generated` 子路径不同，是另一处既有不一致，**本次未触碰**（迁移前后行为一致，不属于复现链）。
- 字幕写入 `audio_transcription_service.save_srt_file` 落 `static/audio/subtitles` 并返回 `/static/audio/subtitles/` 前缀（与 `/api/audio/subtitles/` 路由前缀不同），属另一处既有前缀分歧；本次仅按评审统一了 `/api/audio/subtitles/` 的挂载与双解析（B1+B2），未改字幕写侧。

### 缺陷②（Bug A）：A2「播放态空帧补画」存在事件顺序竞态，会反向重启冷 seek

按 A.6/§四 落 A2（就绪事件上、上一帧空帧时 `_renderAt(clock.getCompositionTime(), true)`）时发现：在同一个 `seeked` 事件上，**就绪重绘监听器（A2，attach 时绑定）会先于起播握手监听器（A1，play 时绑定）触发**（监听器按注册顺序执行）。若 A2 先跑、此刻 A1 尚未 reanchor，`clock` 仍**领先**元素，A2 的 `_renderAt(comp,true)` 经 `_ensureSeeked` 把刚落定的元素**前向硬拽**到领先的 comp → 重启一次新冷 seek，**恰好复活了要根除的螺旋**。这与评审 §二「A2 只补画不 reanchor，净效果是抖动」的判断同源，但在「与 A1 抢同一个 `seeked`」时会更糟（直接打断 A1 的出图）。

**修正方案（已落地）**：A2 在「存在未决的起播握手（`_startReanchor != null`）」时**一律让位**——由 A1 负责 settle 时的 reanchor+出图；只有当握手已触发/解绑、`clock` 已跟齐元素之后，A2 才对残余空帧补画（此时 comp 落在 seek 容差内，不会再硬拽）。即 A2 的判据由「playing && 上一帧空帧」收紧为「playing && **无未决握手** && 上一帧空帧」。已补回归用例覆盖该让位逻辑与 A2 在握手解绑后的正常补画。
