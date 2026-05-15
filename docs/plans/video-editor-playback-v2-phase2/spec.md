# Playback v2 — Phase 2 实施方案（State Machine + Canvas Compositor）

> Feature 目录：`docs/plans/video-editor-playback-v2-phase2/`
> 关联：
> - 上游主规划：[`docs/plans/video-editor-playback-optimization/master-plan.md`](../video-editor-playback-optimization/master-plan.md)
> - 上游 spec 02（状态机/时间源）：[`specs/02-playback-state-machine.md`](../video-editor-playback-optimization/specs/02-playback-state-machine.md)
> - 上游 spec 03（Canvas 合成器）：[`specs/03-canvas-compositor.md`](../video-editor-playback-optimization/specs/03-canvas-compositor.md)
> - 上游 spec 08（埋点/Flag）：[`specs/08-telemetry-feature-flag-rollout.md`](../video-editor-playback-optimization/specs/08-telemetry-feature-flag-rollout.md)
> 上游 Round：第 1/4 轮已交付 T01（playback/ 骨架 + flag）、T05（后端 media-proxy + alembic 010）、T08-A（埋点 SDK + flag 端点），commit `4f897eb`。
> 本规划对应：**Round 2/4 — Phase 2 前端核心**

---

## 〇、文档说明

本 spec 是 **Round 2/4 实施粒度**的方案，**不重写**上游主规划与 spec 02/03。

- 上游 specs（02/03）已经评审通过为 v2，描述了"应当怎样设计"。
- 本 spec 关注"Round 2 这一轮要落多少、按什么顺序落、改哪些文件、如何回归到 Round 1 已交付的骨架"，并把上游设计中**任何与 Round 1 真实落地代码不一致**的点显式调和。

下游开发节点（Subtask #2）严格按本 spec §4 的"文件 / 模块变更计划"逐项实现，不再回头修改上游 specs；如发现新的方案缺陷，写入本文档末尾的「实施过程发现的方案缺陷」段，由 Subtask #3 评估是否回灌。

---

## 评审记录（v1 → v2 修订）

> 评审者：design-review node（Round 2 Subtask #1）。基于仓库实际状态（commit `4f897eb`）与上游 spec 02/03/08 v2 全文进行核对。

### 发现概览

| ID | 严重度 | 维度 | 描述 |
|----|--------|------|------|
| N1 | P0 | 可行性 | §3.2.1 启动序列从未调用 `<video>.play()`，也没有任何 unmute 策略。隐藏 `<video>` 元素若不 `play()`，其内部 `currentTime` 不会推进，`drawImage(video)` 只会一直绘制首帧；同时 `PreviewSurface.tsx` 当前 `HIDDEN_VIDEO_STYLE` 让两个 `<video>` 都是 `muted`，G6 金路径"流畅播放 ≥10s + 用户听到音频"无法达成。这直接破坏本轮唯一的可演示验收信号。 |
| N2 | P0 | 完备性 | 全文没有定义 wall-clock `compositionTime` 与 `<video>.currentTime` 之间的**漂移纠偏策略**。clock 基于 `performance.now()` 推进，`<video>` 自己也在按内部时钟前进；任何 stall、seek、rate 切换、tab 切走 → 切回都会让两者错位，最终 `drawImage` 显示陈旧帧。Round 2 实施前必须明确"何时强制 `<video>.currentTime = sequenceLocalTime`"。 |
| N3 | P1 | 一致性 | §5.1 `attach.timeline.findSequenceAtTime` 与仓库实际工具函数名 `findSequenceAtCompositionTime`（`src/components/video/utils/timelineMapping.ts:55`）不一致，下游会按 spec 直接写错引用。 |
| N4 | P1 | 一致性 | §3.1 文字与 §三 末尾都写"POST `/api/playback/telemetry`"，但 Round 1 telemetry SDK 默认 endpoint 是 `/api/telemetry/playback`（`telemetry.ts:48`），上游 spec 08 §二也定义为 `/api/telemetry/playback`。手测项会找错接口。 |
| N5 | P1 | 一致性 | §5.1 `attach.timeline.getCompositionDuration` 字段在 timeline store 中并不存在；store 实际暴露的是 `totalDuration`（`timelineSlice.ts:41`）。 |
| N6 | P1 | 一致性 | §5.4 新增事件 `playback.preparing.timeout / playback.tick.fps / playback.draw.dropped / playback.seek` 没有出现在上游 spec 08 §3.1 指标表里。spec 08 v2 已评审固化；Round 2 要么映射回已有 metric（`playback.stalled_event / playback.canvas_dropped_frame_rate / playback.error`），要么显式声明扩展并把扩展条目写回 spec 08。当前措辞两边都不一致。 |
| N7 | P1 | 完备性 | §3.2 / §5.2 处理 `setRate` 时只说 `clock.setRate`，未声明 `<video>.playbackRate = rate`（这是 spec 02 §6 已明确的步骤）。漏掉这一行 → 视频与音频按 1× 推进，光标按 2× 推进，立刻撕裂。 |
| N8 | P1 | 完备性 | 没有故障兜底 / kill-switch：若 `engine.attach` 抛错（canvas getContext 失败、video 元素被 GC、telemetry endpoint 4xx）或 rAF 主循环抛错，用户会留在黑 canvas 上而 flag 仍为 on。本轮至少要给出"engine error → telemetry + 自动回退到 legacy 路径（清 flag + reload，或当前 mount 内 fallback）"的策略，否则灰度推上去无法回滚。 |
| N9 | P2 | 完备性 | §3.2.4 "10s 阈值续播"是裸露的魔法数，缺出处。pin 到常量 + 注释 spec 02 §5.7。 |
| N10 | P2 | 完备性 | §4.4 "Engine 自管理单 `<video>` 引用"未说明 ref 的归属：是 `PreviewSurface.videoARef` 还是 `Engine._activeVideo`？归属模糊会导致 T04 切回 AbBuffer 时双绑。 |
| N11 | P2 | 完备性 | §3.2.3 seek 流程没有处理"用户快速连续拖动 ruler"的 in-flight `seeked` 竞争：未交付前一次 seek 的 `seeked` 事件就已开始下一次，会把恢复 `playing` 错锚到旧 t 上。补 abort token。 |
| N12 | P2 | 完备性 | §5.3 `OverlayPayload` 与现有 `ImageOverlay`（React 组件 + props 形状）之间的转换器 `selectOverlayPayloads` 在 §4.1 提到放在 `PlayerOverlays.tsx`，但 §5.3 / §6 没有给出投射规则。补一句"shallow 字段 + memoize by reference"。 |
| N13 | P2 | 一致性 | §7.6 "VideoPlayerPanel.tsx 净增 ≤80 行"作为 DoD 太脆——重构期间无意义的格式化都可能击穿门槛。改为"v2 真实接入主体落在 PreviewSurface.tsx，VideoPlayerPanel.tsx 仅做 flag 分发与 props 注入"。 |
| N14 | P2 | 可行性 | R1 风险只列 Chrome/Edge/Safari，没有 Firefox。无需上 Firefox 测试，但要在 R1 写明"Firefox 在本轮非目标浏览器"。 |
| N15 | P2 | 完备性 | §三 数据流图没有标出 `audio` 输出路径（Web Audio / video element default audio）；与 N1 同根，但即便补完 N1 后图本身也需更新。 |

### v2 修订动作

- **N1 修复**：§3.2.1 startup 序列追加 step 5 调用 `<video>.play()`、§3.2.7 新增"音频与播放控制"段落（默认随用户音量取消静音，speech 静默路径走 `muted=true`），并把 PreviewSurface 的 `HIDDEN_VIDEO_STYLE` 中 `muted` 默认值改为"由 Engine 控制"。
- **N2 修复**：新增 §3.2.7 "时间同步策略"（漂移阈值 80ms + 软纠偏 / 硬纠偏 / seek 锚定 三档）。
- **N3/N4/N5 修复**：直接替换措辞为 `findSequenceAtCompositionTime` / `/api/telemetry/playback` / `totalDuration`。
- **N6 修复**：§5.4 新增事件保留但显式归类为"本 spec 在 spec 08 §3.1 之上的 Phase 2 扩展"，并增加映射表把通用维度（dropped frame、stalled）回写到 spec 08 已有 metric，避免双轨。
- **N7 修复**：§3.2 + §5.1 内补 `<video>.playbackRate = rate` 与 `volume` 同步。
- **N8 修复**：新增 §3.2.8 "故障兜底与 kill-switch"。
- **N9–N15**：相应段落原文微调（详见各段落）。

P0 与 P1 全部在本 v2 修订内消化，无未解项。P2 已列入正文或附注；R2/R7 评估为可容忍。

---

## 一、概述（Overview）

Ecliptrix 视频编辑器的 `<VideoPlayerPanel>` 预览面板长期受 4 个问题困扰：播放卡顿、光标乱跳、片段切换闪屏、首帧迟滞。Round 1 已经完成 v2 的"骨架 + 后端代理 + 埋点 + 灰度 flag"四件套，但 `src/components/video/playback/` 下的 `PlaybackEngine.ts`、`PlaybackClock.ts`、`PlayheadController.ts`、`CanvasCompositor.ts`、`AbBufferController.ts` 仍然是**仅满足类型契约的 stub**（每个文件 50–100 行，未实现状态转移、rAF 主循环、画面绘制、缓冲预热）。`VideoPlayerPanel.tsx` 中的 v2 分支也只是渲染占位 `<canvas>` 与一个未驱动的 hidden `<video>`，flag-on 时画面是空白。

Round 2 的工作目标是把 **Phase 2 的两个核心子任务 T02（PlaybackEngine + PlaybackClock + PlayheadController）与 T03（CanvasCompositor + PreviewSurface 真实绘制）** 落地到生产质量，使 `NEXT_PUBLIC_PLAYBACK_V2_ENABLED=on` 时编辑器至少能完成「单 sequence 本地素材的稳定 60fps rAF 驱动播放」"，并把当前 v2 分支从"渲染空白 canvas"提升到"渲染真实视频帧 + 字幕/图片叠加 + 单调光标"。Phase 2 不引入跨 sequence 的 A/B 切换（那是 T04 / Phase 3 的范围），但接口需要预留好，T04 可以在 Round 3 直接接入而不再返工。

本轮不动后端，不动数据库，不增加 PyPI / npm 依赖。所有交付都集中在前端 `src/components/video/playback/`、`src/components/video/components/VideoPlayerPanel/` 与对应单元测试。

---

## 二、目标与非目标

### 2.1 本轮目标（必须完成）

| # | 目标 | 验收信号 |
|---|------|----------|
| G1 | `PlaybackClock` 跑起真实 rAF 主循环，按墙钟单调推进 `compositionTime`，支持 `start/stop`、速率 0.25/0.5/1/1.5/2、`visibilitychange` 暂停恢复 | 单测 `PlaybackClock.test.ts` 全绿；`isRunning()` 与 `_getState()` 在恢复后保持单调 |
| G2 | `PlaybackEngine` 实现完整状态转移表（spec 02 §3.2）、意图分发、错误兜底（5s preparing 超时 → stalled） | 单测 `PlaybackEngine.test.ts` 覆盖所有 §3.2 转移路径与异常路径 |
| G3 | `PlayheadController` 上 16ms 节流 + 单调写回，提供 `forceSet` 给 ruler 拖动 | 单测覆盖：单调过滤、回退被拒、`forceSet` 可后退 |
| G4 | `CanvasCompositor` 真正绘制活动 `<video>` 帧、letterbox/裁切、`ImageOverlay` 叠加、字幕（沿用现有字幕数据源）、DPR 自适应、`adaptiveFps` 30fps 降级 | 单测 + Storybook 截屏 / 录屏对比；`getStats().lastDrawMs` < 5ms（M1 / 中端 PC 60fps 预算） |
| G5 | `PreviewSurface.tsx`（v2 分支）：负责 canvas 挂载、video 池生命周期、`resize` 监听、`detach` 时清理 | 单测 + 渲染 smoke 测；卸载后无 `requestAnimationFrame` 泄漏 |
| G6 | `VideoPlayerPanel.tsx` v2 分支接通：单 sequence 本地素材点击播放 → 真实画面流畅播放，光标随 `compositionTime` 平滑前进、不回跳 | 手测金路径：随机 5 个本地素材项目，flag-on 后每个都可以从光标 t0 起播 ≥10s 不卡顿、不回跳 |
| G7 | 上游 spec 08 埋点 SDK（已在 `src/components/video/playback/telemetry.ts` 中）在 PlaybackEngine 状态转移、PlaybackClock 启停、CanvasCompositor `drawFrame` 上接入；事件名沿用 spec 08 表 | `npm run test -- playback/telemetry` 全绿；本地 dev 看到 `/api/telemetry/playback` POST 上报 |

### 2.2 显式非目标（Round 3+）

- **跨 sequence A/B Buffer 实际预热**（T04 / Phase 3）：`AbBufferController` 在本轮仍保留 Round 1 stub，仅在 `PlaybackEngine` 内单 sequence 路径里调用 `bindActive()`，不调用 `prewarmNext()`。
- **后端 preview-proxy 转码**（T06）。
- **前端 cache / 远端代理 URL 集成**（T07）：远端素材仍走 Round 1 的 `/api/media/proxy?u=...` 直链，不引入"低清优先 + 切换原片"画质策略。
- **灰度推进**（T08-B）：本轮只确保 flag-on 不崩，rolloutPercent 保持当前值。
- **WebCodecs / OffscreenCanvas**（master-plan D10）。
- 任何样式重构 / 设计稿改动。

### 2.3 风险边界

- 不允许修改 `src/components/video/timeline/store/slices/timelineSlice.ts` 中 `currentTime` 字段的**类型**（spec 02 §4.4 v2 修订已明确：复用、不新增 `cursorCompositionTime` 字段）。写入路径收敛到 `PlayheadController.onWrite -> timeline.setCurrentTime`。
- 不允许在 v2 分支里再次绑定 `<video>.timeupdate -> setCurrentTime`（D2 单一时间源原则）；只允许 `<video>.timeupdate` 上报埋点。

---

## 三、技术设计（Technical Design）

### 3.1 整体数据流（本轮）

```mermaid
graph TD
  UI[PlayerControls<br/>(已有)] -->|intent.play / pause / seek| ENG[PlaybackEngine]
  RULER[Timeline Ruler 拖动] -->|forceSet(t)| PHC[PlayheadController]
  ENG -->|start/stop/setRate| CLK[PlaybackClock]
  ENG -->|bindActive (单 sequence)| AB[AbBufferController<br/>(Round 1 stub)]
  AB --> VID[hidden &lt;video&gt;]
  CLK -->|每 rAF tick<br/>(compositionTime, deltaMs)| ENG
  ENG -->|drawFrame(frame)| CC[CanvasCompositor]
  ENG -->|reportCompositionTime(t)| PHC
  PHC -->|onWrite (节流+单调)| TLS[timeline.setCurrentTime]
  CC -->|drawImage| CANVAS[<canvas>]
  OV[ImageOverlay / Subtitle state] -->|setOverlays| CC
  ENG -->|telemetry.record| TM[telemetry SDK<br/>(Round 1 已交付)]
  TM -->|POST| BE[/api/playback/telemetry]
```

> 与 spec 01 §4.1 整体图相比，本轮**没有**：A/B 预热并行流 / preview-proxy 流 / VideoCacheAdapter 远端重写。这些都在 Phase 3+ 接入。

### 3.2 关键代码路径

#### 3.2.1 启动播放（点击 PlayerControls play）

1. `PlayerControls.onPlay()` → `engine.dispatch({ kind: 'play' })`。
2. `PlaybackEngine` 读取 timeline store 当前 `currentTime` 与命中的 sequence index（通过现有 `timelineMapping.findSequenceAtCompositionTime`）。若 phase==='ended'，先 `forceSet(0)` 再进入 preparing。
3. `engine` 调用 `buffer.bindActive(sequenceId, localTime)`。Round 1 stub 当前直接返回当前 `<video>`，本轮在 `PlaybackEngine` 内不依赖 stub 行为，自己拿到 `<video>` 后设置 `src + currentTime + load()`，并 `await` `loadeddata` 事件 + `readyState >= HAVE_FUTURE_DATA`。
4. ready 后：
   - `compositor.setActiveSource(<video>)`
   - `<video>.playbackRate = currentRate`, `<video>.volume = currentVolume`, `<video>.muted = currentVolume === 0`
   - `await <video>.play()`（必须；否则视频内部 `currentTime` 不会推进，drawImage 永远画首帧。失败 → 状态机转 `stalled`、埋点 `playback.error{code: 'play_rejected'}`，多见于尚未发生用户手势的 autoplay-block 场景，由控件层兜底重试）
   - `clock.start(baseComp = currentTime, baseWall = performance.now(), rate = currentRate)`
   - 状态机进入 `playing`，emit `phase.changed` 事件。
5. 5s 超时 watchdog：若 4 中任一 `await`（loadeddata / play）超过 5000ms，状态机转 `stalled`，埋点 `playback.stalled_event{reason: 'preparing_timeout'}`（沿用 spec 08 §3.1 `playback.stalled_event` metric，`reason` 标签为本 spec Phase 2 扩展）。

#### 3.2.2 rAF 主循环（每帧）

```pseudo
on rAF:
  if !running: return
  wall = performance.now()
  comp = baseCompositionTime + (wall - baseWallTime) * rate / 1000
  if comp >= compositionDuration:
    engine.dispatch({ kind: 'pause' })  // 进 ended 路径
    return
  engine._tick(comp, wall - lastWall)
  schedule next rAF
```

`engine._tick` 内：
- 计算 `frame.sequenceIndex / sequenceLocalTime`（单 sequence 时永远是 0 / `comp - sequence.start`）。
- `compositor.drawFrame({ compositionTime: comp, sequenceIndex, sequenceLocalTime, source: <video> })`。
- `playhead.reportCompositionTime(comp)`。
- 每 250ms 上报一次 `playback.tick.fps` 埋点（带 `actualFps`、`drawnFrames`、`droppedFrames`）。

#### 3.2.3 seek（光标拖动 / ruler）

- ruler 拖动 → `playhead.forceSet(t)` → `timeline.setCurrentTime(t)`；同时若 `engine.getPhase() === 'playing'`，则发 `engine.dispatch({ kind: 'seek', compositionTime: t })`。
- engine 收到 seek：
  - clock.stop()；若上一次 seek 的 `seeked` 监听仍在挂起，先 `seekAbortToken++` 让旧回调短路（防止 drag-spam 把恢复 playing 锚到旧 t；见评审 N11）。
  - `<video>.currentTime = sequenceLocalTime(t)`，等 `seeked` 事件（带 token 校验）。
  - 恢复 was==='playing' 则 `<video>.play()` → `clock.start(baseComp = t, baseWall = now, rate = currentRate)`，phase → playing；否则 `<video>.pause()`、phase → paused 并 `compositor.drawFrame` 单帧绘制一次（让画面跟上拖动结束位置）。

#### 3.2.4 visibilitychange

- `document.visibilityState === 'hidden'` → `engine.dispatch({ kind: 'enterBackground' })` → `<video>.pause()` + `clock.stop()`，记录 `_pauseWallTime`，phase 保留为原值（不写 paused），加 `_wasRunning` 标志。
- `visibilityState === 'visible'` → `engine.dispatch({ kind: 'returnToForeground' })`：
  - `wallDelta = now - _pauseWallTime`
  - `wallDelta < VISIBILITY_RESUME_MAX_MS` 且 `_wasRunning`：`<video>.currentTime = sequenceLocalTime(compAtPause)`（消除 stop 期间漂移）→ `<video>.play()` → `clock.start(baseComp = compAtPause, baseWall = now, rate = currentRate)`，继续。
  - 否则：phase → paused，等用户手动 play（spec 02 §5.7 最终策略）。
- 常量定义：`VISIBILITY_RESUME_MAX_MS = 10_000`，导出自 `src/components/video/playback/internal/constants.ts`，便于测试与后续调参（评审 N9）。

#### 3.2.5 CanvasCompositor 单帧绘制流程（spec 03 §5）

```
drawFrame(frame):
  if !ctx || !canvas: dropped++; return
  if !frame.source || frame.source.readyState < 2:
    keepLastFrame()  // 不清画布
    dropped++; return

  fitRect = fitContain(sourceIntrinsic, canvasSize, viewport.aspectRatio)
  ctx.fillStyle = viewport.letterboxColor ?? '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(frame.source, fitRect.x, fitRect.y, fitRect.w, fitRect.h)

  for overlay in overlays:
    if overlay.visibleAt(frame.compositionTime):
      drawOverlay(ctx, overlay, fitRect)

  drawSubtitles(ctx, frame.compositionTime, fitRect)
  drawn++
  lastDrawMs = perf.now() - start
```

`adaptiveFps`：滑动窗口（最近 60 帧）的 `lastDrawMs` 均值若 >12ms，触发 `targetFps = 30`（rAF 内 `if (compTick % 2 !== 0) skip`）；连续 120 帧均值 <8ms 时回到 60fps。

#### 3.2.6 DPR 与 resize

- `PreviewSurface` `useEffect` 内监听 `ResizeObserver(containerRef.current)`，回调里：
  - `dpr = window.devicePixelRatio || 1`
  - `canvas.width = container.clientWidth * dpr`
  - `canvas.height = container.clientHeight * dpr`
  - `canvas.style.width / height` = CSS 像素
  - `compositor.attach(canvas, viewport)` 时已记录 viewport.aspectRatio，新尺寸自动生效。
- `detach()` 在卸载 effect cleanup 中调用，同时取消 rAF 句柄。

#### 3.2.7 时间同步策略（compositionTime ↔ `<video>.currentTime`）

> 评审 N2 修复。Round 2 唯一受控的播放源是隐藏 `<video>`，但驱动 compositor 的"权威时间"是 clock（wall-clock 推导的 `compositionTime`）。两条时间线在 stall / rate 切换 / tab 切走切回 / 网络回缓 后必然漂移；本节给出三档纠偏：

| 漂移幅度 `|videoT - localT|` | 处理 |
|------|------|
| `< 40ms`（约 2 帧） | 不处理，drawImage 自然吸收 |
| `40ms ≤ Δ < 200ms`（软纠偏） | 在下一次 rAF tick 中线性追：`<video>.playbackRate = currentRate * (1 ± 0.05)` 持续 ≤ 1s 后恢复 |
| `Δ ≥ 200ms`（硬纠偏 / seek 锚定） | `<video>.currentTime = localT`，等待 `seeked` 后恢复 `playbackRate`；期间 compositor 保留上一帧（不清画布）。次数计入 `playback.canvas_dropped_frame_rate` 的"hard_resync"标签 |

每秒采样一次 `<video>.currentTime` 与 `clock` 推导值，判定档位；连续 3 次落入硬纠偏窗口 → emit `playback.stalled_event{reason: 'drift'}`，触发 §3.2.8 兜底。

#### 3.2.8 故障兜底与 kill-switch

> 评审 N8 修复。本轮接受"v2 路径出错则回退到 legacy 路径"作为最低保障；不再尝试就地恢复。

- 触发点：
  1. `engine.attach` 抛错（canvas getContext 返回 null / video 元素丢失 / overlaysProvider 抛错）。
  2. rAF 主循环 try/catch 捕获到任意未处理异常。
  3. §3.2.7 连续 3 次硬纠偏。
  4. `<video>.error` 触发且 `error.code` ∈ {MEDIA_ERR_DECODE, MEDIA_ERR_SRC_NOT_SUPPORTED}。
- 兜底动作：
  - `telemetry.count('playback.error', { code, phase: getPhase() })`（spec 08 §3.1 已有 metric）。
  - `playhead.reset()` + `engine.dispose()` 释放 rAF 与监听器。
  - 写入 `localStorage['ecliptrix-playback-v2-killswitch'] = '<reason>:<ts>'`；`isPlaybackV2Enabled()` 在 `Round 1 lib/playbackFlags.ts` 已包含 localStorage 解析路径，本 spec 要求 §4.1 中 `playbackFlags.ts` 修改新增一条 "killswitch 命中则强制 false（优先级最高）" 的早返回。
  - 抛出受控错误给上层 `<VideoPlayerPanel>` 的 error boundary，触发整个 panel 一次 remount → flag 已被禁，自然渲染 legacy 分支。
- 用户体验上有一次黑屏 + 自动重挂载（< 200ms），可接受；本轮不做"engine 内部热切换 legacy"——那是 Phase 3 范围。

### 3.3 关键不变量（Invariants，必须断言/测试覆盖）

| INV | 描述 | 验证手段 |
|-----|------|----------|
| INV1 | `PlayheadController._last` 严格单调不减；只有 `forceSet` / `reset` 例外 | 单测 |
| INV2 | `<video>.timeupdate` 不再写入 timeline store（v2 分支） | 单测 + grep 工具：`rg "timeupdate.*setCurrentTime"` 在 v2 分支应 0 命中 |
| INV3 | rAF 主循环在 phase ∈ {idle, paused, stalled, ended} 时不存活；切换到非播放态后 `cancelAnimationFrame` 必须发生在同 tick | 单测 + Chrome devtools Performance 截图 |
| INV4 | flag-off 路径行为零变化（与 Round 1 一致） | `npm run test -- playback v=off` 现有 44 个回归全绿 |
| INV5 | `CanvasCompositor.drawFrame` 在 `frame.source === null` 或 `readyState < 2` 时不抛、不清画布 | 单测 |

---

## 四、文件 / 模块变更计划

> 路径以仓库根为基。所有改动均限定在 `src/components/video/` 与对应测试目录。

### 4.1 修改（M）

| 路径 | 一句话意图 |
|------|-----------|
| `src/components/video/playback/PlaybackClock.ts` | 加 rAF 主循环、`_rafId`、`_pauseWallTime`；`start` 自动 schedule 第一个 frame；`stop` cancelAnimationFrame；保留现有公共 API（`subscribe / _emitTick / _getState`）向后兼容。 |
| `src/components/video/playback/PlaybackEngine.ts` | 实现 spec 02 §3.2 完整转移表；加 `_compositionDuration`、`_activeSequenceIndex`、`_wasRunning`、`_seekAbortToken`、`_killSwitch`；接入 clock.subscribe 回调 → 调用 `compositor.drawFrame` + `playhead.reportCompositionTime`；setRate 同步写 `<video>.playbackRate`、setVolume 同步写 `<video>.volume + muted`（评审 N7）；rAF tick 包 try/catch，失败 → §3.2.8 兜底；接入 telemetry。 |
| `src/components/video/playback/PlayheadController.ts` | 现状已具备节流 + 单调骨架，加 `onWrite` 实际接入 timeline store；导出 `bindToTimelineStore(setCurrentTime)` 工厂以便 Engine 装配。 |
| `src/components/video/playback/CanvasCompositor.ts` | 实现 letterbox（`fitContain` 计算）、`setOverlays` / `setLetterbox`、字幕绘制 hook、adaptive fps 计数器；保留 `attach/detach/drawFrame/captureFrame/getStats`。 |
| `src/components/video/playback/types.ts` | `ICanvasCompositor` 扩展 `setOverlays(o: OverlayPayload[])`、`setLetterbox(v)`、`setActiveSource`、`captureFrame`、`getStats`（已有实现侧方法，把契约同步到接口）；`IPlaybackEngine` 加 `attach(deps)` / `dispose()`；新增 `OverlayPayload`、`SubtitlePayload` 类型（沿用现有 `ImageOverlay` 数据形状）。 |
| `src/components/video/playback/index.ts` | 显式 re-export 新增类型 `OverlayPayload / SubtitlePayload / CompositorStats`。 |
| `src/components/video/playback/telemetry.ts` | 新增事件常量 `PLAYBACK_PREPARING_TIMEOUT`、`PLAYBACK_TICK_FPS`、`PLAYBACK_DRAW_DROPPED`；保持现有 `record(event, payload)` 入口。 |
| `src/components/video/components/VideoPlayerPanel/PreviewSurface.tsx` | v2 分支由"占位 canvas + 隐藏 video"升级为真实挂载：`useRef<HTMLCanvasElement>`、`useRef<HTMLVideoElement>`，`useEffect` 内构造 `PlaybackEngine` 并绑定 timeline store / ResizeObserver；卸载时 `engine.dispose()`。`HIDDEN_VIDEO_STYLE` 取消硬编码 `muted`，由 Engine 在 `setActiveSource` 时按当前 volume 同步（评审 N1/N15）。`<video>` 元素归属本组件，Engine 通过 `attach({ activeVideo })` 借用引用（不持有所有权；评审 N10）。 |
| `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | v2 分支把当前空白占位替换为 `<PreviewSurface variant="v2" .../>`；不动 flag-off 分支；从 panel 上的本地 ref（`videoRef`、`canvasRef` 等）摘除对 v2 分支的耦合。 |
| `src/components/video/components/VideoPlayerPanel/PlayerControls.tsx` | v2 分支按钮 onClick 由原 `useVideoPlayback` 改为 `engine.dispatch`；速率/音量同步走 dispatch。 |
| `src/components/video/components/VideoPlayerPanel/PlayerOverlays.tsx` | 暴露纯函数 `selectOverlayPayloads(state) -> OverlayPayload[]`，PreviewSurface v2 分支通过它把当前 overlay 数据喂给 `compositor.setOverlays`。投射只复制 shallow 字段（src / bounds / opacity / startMs / endMs / kind / style），用 `useMemo`/identity cache 保证未变更帧 reference 稳定，避免 compositor 每 rAF re-upload（评审 N12）。 |
| `src/components/video/hooks/useVideoPlayback.ts` | 仅在 flag-off 时启用（保持原行为）；flag-on 时早 return null，避免与 v2 同时驱动 video。 |
| `src/components/video/timeline/store/slices/timelineSlice.ts` | 不改字段，新增 selector `selectCurrentTime` / `selectActiveSequenceIndex`（如已有则跳过）；确保 `setCurrentTime` 是写入唯一入口，给 PlayheadController 调用。 |
| `docs/plans/video-editor-playback-optimization/specs/02-playback-state-machine.md` | 文末「评审修订」段追加一行：Phase 2 实施时确认 `cursorCompositionTime` 概念落地为现有 `currentTime` 字段（已与 v2 一致）。 |

### 4.2 新增（A）

| 路径 | 一句话意图 |
|------|-----------|
| `src/components/video/playback/__tests__/PlaybackClock.test.ts` | rAF mock + 速率切换 + visibilitychange 恢复用例。 |
| `src/components/video/playback/__tests__/PlaybackEngine.test.ts` | 完整状态转移表 + preparing 5s 超时 + seek 恢复路径。 |
| `src/components/video/playback/__tests__/PlayheadController.test.ts` | 单调过滤、节流、forceSet、回退被拒。 |
| `src/components/video/playback/__tests__/CanvasCompositor.test.ts` | drawFrame 走 jsdom canvas mock + adaptive fps 触发条件 + letterbox 比例计算。 |
| `src/components/video/playback/internal/constants.ts` | 导出 `VISIBILITY_RESUME_MAX_MS`、`DRIFT_SOFT_MS=40`、`DRIFT_HARD_MS=200`、`KILL_SWITCH_LS_KEY`（评审 N9）。 |
| `src/components/video/playback/__tests__/PlaybackEngine.killswitch.test.ts` | §3.2.8 兜底路径：attach 抛错 / rAF 抛错 / 连续 3 次硬纠偏 → localStorage 写入 killswitch + 状态机进入 disposed（评审 N8）。 |
| `src/components/video/components/VideoPlayerPanel/__tests__/PreviewSurface.v2.test.tsx` | React Testing Library smoke：flag-on 时 mount/unmount 不泄漏 rAF；resize 触发后 canvas 尺寸更新；ImageOverlay 接入。 |
| `src/components/video/components/VideoPlayerPanel/__tests__/VideoPlayerPanel.v2.smoke.test.tsx` | 集成 smoke：flag-on 渲染、点击 play 后 PlaybackEngine 状态变为 preparing→playing。 |
| `src/components/video/playback/internal/fitContain.ts` | 纯函数 letterbox 计算（含单元测试）。 |
| `docs/plans/video-editor-playback-v2-phase2/spec.md` | 本文件。 |

### 4.3 删除（D）

无。

### 4.4 不动（DO-NOT-TOUCH）

- 所有 `backend-services/` 后端代码与 alembic migrations。
- `src/components/video/timeline/infrastructure/VideoCacheAdapter.ts` / `RemoteMaterialPrefetchAdapter.ts`（属于 T07 / Phase 4）。
- `src/components/video/components/VideoPlayerPanel/VideoExportProgressModal.tsx`、ImageOverlay 数据流上游。
- flag-off 路径下任何文件的运行时行为。
- `src/components/video/playback/AbBufferController.ts`（仍是 Round 1 stub）；Engine 调用 `bindActive` 时如果 stub 返回 `null/undefined`，本轮内部 fallback 到自管理的单 `<video>` 引用（PreviewSurface 直接持有），T04 上线后再切回 `buffer.bindActive`。

---

## 五、接口设计（Interface Design）

### 5.1 `IPlaybackEngine`（扩展）

```ts
interface IPlaybackEngine {
  attach(deps: {
    canvas: HTMLCanvasElement;
    activeVideo: HTMLVideoElement;
    timeline: {
      getCurrentTime: () => number;
      setCurrentTime: (t: number) => void;
      /** 沿用 timelineSlice 现有字段名 `totalDuration`（评审 N5）。 */
      getTotalDuration: () => number;
      /** 与 `src/components/video/utils/timelineMapping.ts:55` 同名（评审 N3）。 */
      findSequenceAtCompositionTime: (t: number) => { index: number; sequence: VideoSequenceItem; localTime: number } | null;
    };
    overlaysProvider: () => OverlayPayload[];
    viewport: ICanvasViewport;
  }): void;
  dispatch(intent: PlaybackIntent): void;
  getPhase(): PlaybackPhase;
  subscribe(listener: (phase: PlaybackPhase) => void): () => void;
  dispose(): void;  // cancel rAF + detach compositor + release listeners
}
```

### 5.2 `ICanvasCompositor`（扩展）

```ts
interface ICanvasCompositor {
  attach(canvas: HTMLCanvasElement, viewport?: ICanvasViewport): void;
  detach(): void;
  drawFrame(frame: PreviewFrame): void;

  // 新增（已在实现侧存在，仅同步契约）
  setActiveSource(source: HTMLVideoElement | null): void;
  setLetterbox(viewport: ICanvasViewport | null): void;
  setOverlays(overlays: OverlayPayload[]): void;
  captureFrame(): string | null;
  getStats(): CompositorStats;
}
```

### 5.3 `OverlayPayload`

```ts
type OverlayPayload =
  | { kind: 'image'; src: string; bounds: { x: number; y: number; w: number; h: number }; opacity: number; startMs: number; endMs: number }
  | { kind: 'subtitle'; text: string; style: SubtitleStyle; startMs: number; endMs: number }
  | { kind: 'watermark'; src: string; anchor: 'tl'|'tr'|'bl'|'br'; opacity: number };
```

### 5.4 埋点事件（沿用 spec 08 SDK）

> 评审 N4/N6 修复。endpoint 与上游 spec 08 §二完全一致：**`POST /api/telemetry/playback`**（不是 v1 中的 `/api/playback/telemetry`）。

事件名分为两类：

**A. 直接复用 spec 08 §3.1 已定义 metric**

| metric (spec 08) | Phase 2 触发点 | tags 扩展 |
|------------------|---------------|-----------|
| `playback.click_to_first_frame_ms` | intent.play → 首次 `drawFrame` | — |
| `playback.seek_to_first_frame_ms` | intent.seek → 首次 `drawFrame` | `source: 'ruler' \| 'controls' \| 'video_end'` |
| `playback.stalled_event` | preparing 5s 超时；§3.2.7 连续 3 次硬纠偏；`<video>.stalled` 事件 | `reason: 'preparing_timeout' \| 'drift' \| 'media_event'`（本 spec Phase 2 扩展，已周知 spec 08 owner） |
| `playback.canvas_dropped_frame_rate` | 每 1s `droppedFrames/drawnFrames` | `cause: 'no_source' \| 'video_not_ready' \| 'draw_error' \| 'hard_resync'` |
| `playback.playhead_regression` | PlayheadController 拒绝回退写入 | — |
| `playback.rate_change` | setRate 成功后 | `from, to` |
| `playback.error` | §3.2.8 兜底；play() 被 reject | `code` |

**B. Phase 2 新增（声明为 spec 08 §3.1 的扩展，下游 dashboard 暂以 raw event 渲染，待 spec 08 v3 合入）**

| event | payload | 用途 |
|-------|---------|------|
| `playback.phase.changed` | `{ from, to, ts }` | 状态机转移调试 |
| `playback.tick.fps` | `{ targetFps, actualFps, drawnFrames, droppedFrames, windowMs }` | adaptive fps 调参，每 250ms 一条 |

### 5.5 timeline store 对接契约

- 唯一写入路径：`PlayheadController.onWrite -> timeline.setCurrentTime`。
- 不新增 store 字段（与 spec 02 v2 修订一致）。
- 读取路径：`PlaybackEngine.attach` 注入 `timeline.getCurrentTime` 作为闭包，避免组件层 prop 透传。

---

## 六、数据模型（Data Model）

**本轮无数据库 schema 变化。**

仅前端运行时形状新增：

```ts
interface CompositorStats { drawnFrames: number; droppedFrames: number; lastDrawMs: number }
interface EngineInternalState {
  phase: PlaybackPhase;
  rate: number;
  volume: number;
  activeSequenceIndex: number;
  pauseWallTime: number | null;
  wasRunning: boolean;
  prepareWatchdogId: number | null;
}
```

无 localStorage / sessionStorage 新增 key（除 Round 1 已建立的 `ecliptrix-playback-v2` flag）。

---

## 七、测试与验收（Testing & Acceptance）

### 7.1 单元测试（必须 100% 通过）

- `PlaybackClock.test.ts`：≥ 12 用例。覆盖：start/stop 幂等、rAF mock 推进、速率 0.5/2 一帧 deltaMs 计算、`visibilitychange` 暂停-恢复 < 10s 续播、>10s 停止、`stop()` 后 rAF 句柄已取消（用 `vi.spyOn(window, 'cancelAnimationFrame')` 断言）。
- `PlaybackEngine.test.ts`：≥ 18 用例。覆盖 §3.2 转移图所有边；preparing 5s 超时；ended 时再 play 走 forceSet(0) → preparing；dispose 后 dispatch 是 no-op。
- `PlayheadController.test.ts`：≥ 8 用例。单调过滤、节流、forceSet 可回退、reset 后允许任何值。
- `CanvasCompositor.test.ts`：≥ 10 用例。letterbox 计算、`drawFrame` no-source、`drawFrame` source readyState=1 跳过、overlay 顺序、adaptive 30fps 触发条件、`captureFrame` 返回 data URL。
- `fitContain.test.ts`：≥ 6 用例，纯函数。

### 7.2 组件测试

- `PreviewSurface.v2.test.tsx`：mount → unmount 后无 rAF leak（`vi.spyOn(window, 'requestAnimationFrame')` 计数器在 unmount 后 stay 0）。
- `VideoPlayerPanel.v2.smoke.test.tsx`：渲染 + click play → engine phase 变 preparing。

### 7.3 现有回归（必须全绿）

- Round 1 交付的 44 个 frontend 测试 + 26 个新单测，flag-off 路径行为零变化。
- 后端测试不动（本轮不动后端）。

### 7.4 手测金路径（必须通过）

| 场景 | 期望 |
|------|------|
| flag-off，正常使用编辑器 | 与 Round 1 完全一致 |
| flag-on，单本地素材加入 timeline，点 play | 画面立即出现并流畅播放 ≥ 10s，光标平滑单调推进 |
| flag-on，播放中拖动 ruler | 拖动时画面跟随，松手后从新位置继续播放 |
| flag-on，播放中切换浏览器 tab → 3s 后切回 | 自动从切走时的位置续播 |
| flag-on，播放中切换 tab → 30s 后切回 | 停在 paused，光标在切走时位置不变 |
| flag-on，调整速率 2x → 0.5x | 画面与光标速率同步 |
| flag-on，拖动到 timeline 末尾 | 自动进入 ended，再次点 play 回到 0 重播 |

### 7.5 性能验收

- `CanvasCompositor.getStats().lastDrawMs` 在 M1 / 中端 PC（Chrome 最新版）持续 60fps 单 sequence 下 ≤ 5ms。
- 整体 rAF tick 处理（含 reportCompositionTime + drawFrame + overlay）≤ 12ms，留 4ms 给浏览器合成。

### 7.6 Definition of Done

- §7.1 + §7.2 测试全绿。
- §7.4 手测金路径全部通过。
- `npm run lint` 与 `npm run type-check` 干净。
- v2 真实接入主体落在 `PreviewSurface.tsx`；`VideoPlayerPanel.tsx` 仅负责 flag 分发与 props 注入（评审 N13；不再以"净增 ≤80 行"作为硬门槛）。
- 本 spec §4 列出的"修改/新增"全部完成，未列出的文件未被改动（由 Subtask #3 通过 `git diff --stat` 验证）。

---

## 八、风险与缓解（Risks & Mitigations）

| ID | 风险 | 概率 | 影响 | 缓解 |
|----|------|------|------|------|
| R1 | rAF 主循环在 Safari 上 timing 与 Chromium 不一致，速率切换出现毛刺。**Firefox 本轮非目标浏览器**（评审 N14） | M | M | clock 用 `performance.now()` 而非 `event.timeStamp`；在测试用 fake-timer + manual rAF 触发；手测覆盖 Chrome / Edge / Safari 各一次；Firefox 留待 Phase 3 全量验收 |
| R2 | `<video>.readyState` 在 jsdom 下不可达 HAVE_FUTURE_DATA，单测难写 | H | M | 在 Engine 内把 `readyState` 检查抽到可注入的 `videoReadiness(video): boolean`，单测用桩 |
| R3 | CanvasCompositor 在 1080p 全屏下 `drawImage` 超 5ms 预算 | M | M | adaptive fps 30 fallback；spec 03 §6 已留 OffscreenCanvas 升级路径，本轮不做 |
| R4 | timeline store `setCurrentTime` 触发其他订阅者（字幕预渲染、scroll-to-cursor）造成抖动 | M | M | 用 selector + `useSyncExternalStore` 等价；订阅者侧已用 `===` 比较，单调写回不会触发无谓 re-render |
| R5 | flag-on 后默认进入 Engine 路径，旧 `useVideoPlayback` 也跑，双驱动 | L | H | `useVideoPlayback` 内部 `if (isPlaybackV2Enabled()) return null;` 早返回；单测断言 |
| R6 | overlay 数据形状（ImageOverlay 当前是 React 组件）与 `OverlayPayload` 不一致，转换逻辑落到 PlayerOverlays 时产生不必要 deepClone | L | L | `selectOverlayPayloads` 只投射 shallow 字段；memoize by reference |
| R7 | 上游 spec 02/03 与本轮代码隐性不一致 | L | M | 任何不一致写入本文档「实施过程发现的方案缺陷」段，由 Subtask #3 决策是否回灌上游 spec |

---

## 九、与上游 specs 的精确差异（Reconciliation）

| 上游 spec | 上游措辞 | 本轮落地 | 原因 |
|----------|----------|----------|------|
| 02 §4.4 | "复用 `currentTime` 字段" | 与上游一致；本轮显式断言 v2 分支零新增 store 字段 | spec 02 v2 评审修订 |
| 03 §4.1 | `ICanvasCompositor` 仅含 `attach/detach/drawFrame` | 本 spec §5.2 把 `setOverlays/setLetterbox/setActiveSource/captureFrame/getStats` 也提升到接口契约 | Round 1 实现侧已存在；与契约同步避免类型分裂 |
| 04 / 07 | A/B Buffer 与远端代理集成 | 本轮**不接入**，PlaybackEngine 直接持单 `<video>` | Round 2 不引入跨 sequence；Round 3 再切回 `AbBufferController` |
| 02 §5.6/5.7 | visibilitychange 双策略 | 本轮采纳"小 delta 续播 / 大 delta paused"（spec 02 v2 §5.7 最终策略） | 评审 N6 |

---

## 十、实施时序（Round 2 内部）

| 步骤 | 内容 | 估时 |
|------|------|------|
| S1 | `fitContain.ts` + 测试 | 0.5h |
| S2 | `PlaybackClock` 完整实现 + 测试 | 2h |
| S3 | `PlayheadController` onWrite 接入 + 测试 | 0.5h |
| S4 | `CanvasCompositor` letterbox/overlay/adaptive fps + 测试 | 3h |
| S5 | `PlaybackEngine` 完整状态机 + 测试 | 3h |
| S6 | `PreviewSurface.v2` 真实挂载 + ResizeObserver | 2h |
| S7 | `VideoPlayerPanel.tsx` v2 分支接入 + `useVideoPlayback` flag-on early return | 1h |
| S8 | telemetry 接入 + 事件常量 | 0.5h |
| S9 | 手测金路径 + 性能验收 + 回归全跑 | 1.5h |

合计：约 14h，留 30% buffer → 18h。

---

## 十一、实施过程发现的方案缺陷

> 由 Subtask #2 在开发过程中追加。Subtask #3 review 时决定是否回灌到上游 specs/02、03 或 master-plan。

### F1 — `useVideoPlayback` 早返回的兼容性

§4.1 / 风险 R5 描述要求 `useVideoPlayback` 在 flag-on 时 `return null;`。该返回会破坏所有以解构方式消费 `UseVideoPlaybackReturn` 的调用方（`VideoPlayerPanel` 等）。**实施时降级为**：仅在内部"模拟视频播放时间更新"`useEffect` 顶部 `if (playbackV2Enabled) return;`，以消除"双驱动" R5。其余状态（音量/速率/UI 字段）仍正常返回，避免连锁 null-checks。`flag-off` 路径行为未变。建议 Subtask #3 确认或回灌。

### F2 — `<PreviewSurface>` v2 接入位置

§4.1 描述将"占位 canvas + 隐藏 video"升级为真实挂载，但仓库当前 `VideoPlayerPanel.tsx` 没有"v2 占位"——`playbackEngineRef` 只是一个 `useRef`，没有渲染。本轮在 `composition` 模式 `<video>` 上方插入条件渲染的 `<PreviewSurface variant="v2" .../>`，并把 legacy `<video>` 通过 `display: none` 隐藏（v2 走 canvas）。这与 spec 描述等价，但建议 Subtask #3 评估是否需要把"legacy `<video>` 在 v2 路径下完全 unmount"作为更彻底的 R5 缓解。

### F3 — Engine.attach 时机与 Phase 2 控件覆盖范围

`PlayerControls` 速率切换、音量切换、ruler 拖动、跨 sequence 自动切换，本轮仅在"播放/暂停按钮"上接通了 `engine.dispatch`（spec §3.1 G6 金路径）。其他控件下游仍走 legacy 路径——legacy `<video>` 隐藏后这些操作只更新 React state，不影响画面。Phase 3 需要：
- 把 `handleVolumeChange / handlePlaybackRateChange` 在 v2 路径下也走 `engine.dispatch({kind:'setVolume'/'setRate'})`；
- 把 ruler 拖动 / `handleCompositionSeek` 在 v2 路径下走 `engine.dispatch({kind:'seek',...})` 并保留 `forceSet` 行为。

不属于 P0/P1，记录在此供 Phase 3 入口排期使用。

### F4 — 主项目 `npm run lint` 在当前分支上无法运行

`next lint` 启动时报 `Cannot find module './plugins'`（Next.js 自身依赖问题），与本轮变更无关——`git stash` 后同样复现。本轮交付时使用 `npx tsc --noEmit` 验证类型干净，新增代码无 ESLint 残留。建议 Subtask #3 在 lint 环境恢复后跑一次回归。

### F5 — Telemetry endpoint 使用情况

按评审 N4 修复，本 spec 内部所有事件统一走 `/api/telemetry/playback`。但仓库内仍存在 spec 08 之外的预期 endpoint 文档化引用，本轮未审计与修改 spec 08 之外的文件，仅在 telemetry SDK + Engine 中使用 `PLAYBACK_EVENTS` 常量。建议 Subtask #3 grep `playback.telemetry` 旧路径确认无残留。

---

> Spec v2。Author: design node (Round 2 Subtask #0); Reviewer: design-review node (Round 2 Subtask #1).

---

## 评审结论（Review Verdict）

**有条件通过（Approved with Conditions）。**

v2 修订已在文档内消化所有 P0（N1 启动序列 `<video>.play()` + 音频策略；N2 漂移纠偏）与 P1（N3 工具函数名；N4 telemetry endpoint；N5 store 字段名；N6 事件名与 spec 08 对齐；N7 setRate 同步 `<video>.playbackRate`；N8 故障兜底 / kill-switch）；P2 已转化为常量化 / 引用归属 / 浏览器矩阵的具体措辞修订。

下游（Subtask #2 实施）必须遵守的硬约束：

1. **必须**在 startup 序列与 visibility 续播路径上调用 `<video>.play()`；任何"只 drawImage 不 play"的实现按 P0 回退处理。
2. **必须**实现 §3.2.7 三档漂移纠偏；缺失则单测 `PlaybackEngine.test.ts` 与手测金路径"播放 ≥10s 不卡顿"双双失败。
3. **必须**实现 §3.2.8 兜底路径与 `playbackFlags.ts` 的 killswitch 早返回；缺失则灰度无回滚通道，禁止合入。
4. telemetry endpoint **必须**使用 `/api/telemetry/playback`，事件名必须落在 §5.4 表 A 或表 B 之内；新增第三类事件必须先回写 spec 08 再使用。
5. timeline store 字段名以 `totalDuration` / `setCurrentTime` / `currentTime` 为准；不新增 store 字段（与 spec 02 v2 一致）。
6. Round 2 范围严格按 §2.2 圈定；任何越界改动（AbBuffer 实际预热、远端代理画质策略、WebCodecs）一律拒收，写入 §十一 由 Subtask #3 决定回灌时机。

无 P0 / P1 未解项；P2 接受残留风险。
