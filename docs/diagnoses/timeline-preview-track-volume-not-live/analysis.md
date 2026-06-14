# 诊断报告：组合播放预览中实时调整「轨道音量」不生效（视频轨 + 音频轨）

> Bug slug: `timeline-preview-track-volume-not-live`
> 节点：Subtask #0（问题定位与分析）
> 性质：本节点**仅做定位与分析**，不写修复代码、不提交。
> 关联前序轮次：
> - 第 1 轮 `docs/diagnoses/timeline-preview-audio-track-silent/`（音频元素无 `src` 全程静音）→ 提交 `fdbd725` 已修。
> - 第 2 轮 `docs/diagnoses/timeline-preview-audio-silent-and-volume-not-live/`（**音频轨**实时音量 + 中部起播健壮性）→ 提交 `9a9ea10` 已修（A1 live 音量 + B1 在途 seek 守卫）。
> 本轮（第 3 轮）针对用户**重测后仍报「音量不实时变化」**，并且**明确点名「视频轨道的素材的音量还是之前的音量」**。结论：**第 2 轮把「视频轨预览音量从不施加」显式列为「另一保真度议题」搁置了**（见该报告 §5 第 175 行），本轮正是这块**至今未修**的缺口浮到了台面。

---

## 1. 问题描述（Problem description）

用户在「视频编辑」下方的剪辑区：

1. 把视频素材拖到视频轨道、把音频素材拖到独立音频轨道；
2. 点击「播放组合（合成预览）」面板进行播放预览；
3. 播放过程中，去调整**视频轨道**与**音频轨道**对应的**轨道音量**（轨道头部音量按钮 → `VolumeSlider` 弹层）。

**现象**：实时播放预览里，**音量没有随调整发生变化**——

- **视频轨**：素材内嵌音频的响度**始终是原来的音量**，怎么调都不变；
- **音频轨**：用户描述「也同理」。

**期望**：用户实时调整任一轨道音量时，正在播放的预览音量应**同步跟手变化**。

---

## 2. 关键结论速览（先给出，证据见 §4）

| 轨道 | 预览实时音量当前状态 | 根因 |
|---|---|---|
| **视频轨（内嵌音频）** | **完全不生效**（不止拖动期；松手后也不变） | **预览视频路径自始至终不施加音量**：`VideoSourcePool` 每帧只设 `el.muted`、**从不设 `el.volume`**；`VideoTrackGroup` 类型里**根本没有 volume 字段**，引擎也没把音量传给视频池。视频解码 `<video>` 永远以原生 1.0 出声。**这是本轮主根因、至今未修。** |
| **音频轨（独立音频）** | **已可实时跟手**（构建含 `9a9ea10` 时） | 第 2 轮 A1 修复后，链路 `VolumeSlider 拖动 → setTrackVolumePreviewAction → store → useTimelineComposition 重建 → AudioSyncPool 每帧写 el.volume` 已通。若用户仍觉「音频也不变」，最可能是 **(a) 跑了不含 `9a9ea10` 的旧产物**，或 **(b) 把音量往 >100% 拖**（`HTMLMediaElement.volume` 被规范钳在 [0,1]，预览无法增益，属浏览器硬限制）。 |

> 因此：**本轮真正需要落代码修的，是「视频轨预览音量从不施加」这一项**；音频轨的 [0,100%] 实时音量已由 `9a9ea10` 解决，需要的是「确认构建 + 澄清 >100% 天花板」。

---

## 3. 复现步骤（Reproduction steps）

前置：按 `CLAUDE.md` 启动（前端 `npm run dev`，后端 `uvicorn app.main:app --reload`），或运行打包桌面端。**务必确认运行的构建包含提交 `9a9ea10`**（否则音频轨也会复现「拖动不跟手」，属另一已修问题的误判，见 §4.2）。

### 3.A 复现「视频轨音量调了不变」（当前 100% 可复现、本轮主问题）

1. 进入视频编辑，上传 1 个**带声音的视频**素材，拖到视频轨道（可见、未锁）。
2. 点击「播放组合」开始播放，确认能听到该视频自带的声音。
3. 打开**该视频轨**的音量滑块（视频轨道头部音量按钮 → `VolumeSlider`）。
4. 把滑块从 100% 拖到 30%、再拖到 0%（**拖动中**与**松手后**都观察）。
5. **观察**：预览中视频自带音频的响度**全程不变**——
   - 拖动期间不变；
   - **松手后也不变**（与音频轨不同，音频轨松手会变；这正是「视频路径根本不读音量」与「仅拖动期不提交」两类问题的判别点）；
   - 即便拖到 **0%**，视频声音**依旧照常播放**（因为视频路径只在「片段 detached」时才 `muted`，纯粹的「音量=0」不会让它 `muted`）。

### 3.B 复现「音频轨音量是否实时」（用于区分构建新旧）

1. 上传 1 个音频素材，拖到独立音频轨（可见、未锁、未静音）。
2. 点击「播放组合」，确认能听到。
3. 打开该音频轨音量滑块，在 **0%–100%** 区间缓慢拖动。
4. **观察**：
   - 构建**含 `9a9ea10`** → 拖动中预览音量**跟手变化**（符合期望）；
   - 构建**不含 `9a9ea10`** → 拖动中不变、松手才跳变（= 第 2 轮 §3.A 的旧现象，属已修问题）。
5. 再把同一滑块拖到 **150%**：预览响度**不再增大**（停在 100% 等效）——这是 `HTMLMediaElement.volume ∈ [0,1]` 的浏览器硬限制，非本 bug。

### 3.C 最小复现（单元级，任何人可跑，证明「视频路径不写 volume」）

下列片段把一个**记录 `volume` 写入**的假元素喂给 `VideoSourcePool`，运行一帧 `sync`，断言 `el.volume` **从未被写**。可作为本轮根因的可执行佐证（**仅为复现验证，不是修复代码**）：

```ts
// repro.video-volume.spec.ts —— 证明视频池从不施加 volume
import { describe, it, expect } from 'vitest';
import { VideoSourcePool } from '@/components/video/playback/VideoSourcePool';

function fakeVideoEl() {
  let _vol = 1;
  const writes: number[] = [];
  return {
    src: '', currentTime: 0, readyState: 4, paused: false, muted: false, seeking: false,
    get volume() { return _vol; },
    set volume(v: number) { _vol = v; writes.push(v); }, // 记录所有 volume 写入
    play() {}, pause() {},
    __volumeWrites: writes,
  } as any;
}

describe('repro: VideoSourcePool never applies track/item volume', () => {
  it('plays a non-detached clip at full volume regardless of seq.volume', () => {
    const el = fakeVideoEl();
    const pool = new VideoSourcePool(
      () => ({ active: el, prewarm: null }),
      () => 'http://x/clip.mp4', // 任意可解析 url
    );
    const groups = [{
      trackId: 'video-track-1', z: 0,
      items: [{
        id: 'c1', trackId: 'video-track-1',
        startTime: 0, duration: 10, clipStart: 0, clipEnd: 10,
        volume: 0.2,            // ← 用户把视频轨音量调到 20%
        audioDetached: false,   // 非 detached → 走自身音轨
      }],
    }] as any;

    pool.sync(groups, /*t*/1, /*isPlaying*/ true);

    // 期望（修复后）：el.volume 被写成 0.2；实际（当前）：从未写过 volume。
    expect(el.__volumeWrites).toEqual([]); // ← 当前代码下通过：证明音量从不施加
    expect(el.volume).toBe(1);             // ← 仍是原生 1.0
  });
});
```

> 运行 `npx vitest run repro.video-volume.spec.ts`，当前代码下两条断言均**通过**，即「视频池一帧也没碰过 `volume`」。修复后这两条断言应**反转**（`__volumeWrites` 含 `0.2`、`el.volume===0.2`）。

---

## 4. 根因分析（Root cause analysis）

### 4.1 视频轨主根因：多轨预览的**视频路径从不施加音量**（本轮核心、未修）

预览只有一条路径（v1 与 playback-v2 flag 均已删，见 `CLAUDE.md`「Preview compositor（single path）」）。每帧由 `MultiTrackPlaybackEngine._renderAt` 驱动：先 `VideoSourcePool.sync` 同步各视频轨解码元素，再 `AudioSyncPool.tick` 同步独立音频轨。

**视频轨的内嵌音频走 `VideoSourcePool` 的解码 `<video>`，不经 `AudioSyncPool`**（架构决策 RISK 2，避免双份音频）。证据：

`src/components/video/hooks/useCompositionPlayback.ts:99-107`（注释明确：视频轨内嵌音频「plays from the track's own decode `<video>` element」，`AudioSyncPool` 只管独立音频轨）。

而 `VideoSourcePool` **每帧只决定「静音/不静音」，从不设音量**：

`src/components/video/playback/VideoSourcePool.ts:333-354`（`_apply` 的播放分支）：

```ts
if (isPlaying) {
  if (el.paused === true) {
    el.muted = true;            // 预热：muted autoplay
    this._kickPlay(el);
  } else {
    el.muted = plan.muteAudio;  // ← 只切 muted（detached→true / 否则 false）
  }                              //    从头到尾没有 el.volume = ...
} else {
  el.muted = plan.muteAudio;
  this._pauseQuietly(el);
}
```

整文件搜不到任何 `el.volume =`（全仓 `\.volume\s*=` 命中仅 `AudioSyncPool.ts:307/313/317` 与适配器 `MultiTrackPlaybackEngine.ts:662`，**视频解码元素一处都没有**）。

更上游，**音量信息根本没有传进视频池**——`VideoTrackGroup` 类型里**没有 volume 字段**：

`src/components/video/playback/types.ts:136-141`：

```ts
export interface VideoTrackGroup {
  trackId: string;
  z: number;                                  // ← 仅 trackId / z / items，无 volume
  items: import('../types').VideoSequenceItem[];
}
```

`src/components/video/hooks/useCompositionPlayback.ts:73-96`（`buildVideoTrackGroups` 只产出 `{ trackId, z, items }`，把序列上的 `volume` 丢弃）。

**讽刺的是音量其实已经算好了**：`CompositionAdapter.extractVideoSequences` 早就把 `videoSequence.volume = clamp((item.volume??1) * (track.volume/100), 0, 2)` 算出并挂在序列上（`src/components/video/timeline/infrastructure/CompositionAdapter.ts:152-173`），导出路径（ffmpeg）也用它混音；**唯独预览的视频播放路径把它整段忽略**——既没进 `VideoTrackGroup`，`VideoSourcePool` 也从不读 `seq.volume`、从不写 `el.volume`。

**后果（解释用户现象，排他性）**：

- 视频解码 `<video>` 由 `PreviewCanvas` 以 `el.muted=true` 创建（`src/components/video/components/VideoPlayerPanel/PreviewCanvas.tsx:121-128`），`volume` 默认 `1.0` 且无人改写；
- 非 detached 片段播放时 `el.muted=false`，于是**永远以原生满音量 1.0 出声**；
- 调整视频轨音量 → `track.volume` 变 → 组合体 `seq.volume` 重算 → 但视频池**根本不读它** → 预览响度**纹丝不动**；
- 即便调到 0%，`plan.muteAudio = (clip.audioDetached === true)`（`VideoSourcePool.ts:204`）与音量无关，所以**不会**变成 `muted`，声音照旧。

这是「不止拖动期、松手后也不变」的根因——**与音频轨「拖动期不提交 store」是完全不同的一类问题**：视频轨是「整条音量链在播放侧断了」，音频轨当年只是「链路最前端拖动期不提交」。

### 4.2 音频轨：实时音量已由 `9a9ea10` 修好（[0,100%] 区间），残留为构建/天花板问题

音频轨的预览音量链路在第 2 轮被打通并已合入：

1. **拖动中提交 store（A1 修复）**：`VolumeSlider` 拖动 `handleMouseMove`/`handleTouchMove`/键盘步进经 rAF 节流调 `setTrackVolumePreviewAction`（no-history）写 `track.volume`，松手再 `commitTrackVolumeAction` 落单条 undo。
   - 证据：`src/components/video/timeline/VolumeSlider.tsx:144-162`（`scheduleLivePreview` rAF 节流）、`:301-325`（mousemove→`scheduleLivePreview`，mouseup→`commitTrackVolumeAction`）；`src/components/video/timeline/store/actions/trackActions.ts:79-112`（`setTrackVolumePreviewAction` no-history / `commitTrackVolumeAction`）。

2. **store → 组合体重建的桥接会在音量变化时触发**：`setTrackVolume`（`timelineSlice.ts:402-415`，经 `Volume.fromPercentage` 0-200%→0-2.0 并 `_syncDerivedState`）改 store → `TimelinePanel` 的 `useTimelineStore.subscribe` 每次都跑，**`computeShapeJson` 把整段 `tracks`（含 `track.volume`）纳入比对**（`src/components/video/timeline/TimelinePanel.tsx:146-158`），故音量一变 shapeJson 即变 → **不被去重抑制** → `onTimelineCompositionChange(ts)`（`:275-276`）。

3. **组合体签名含音量 → 重建 → 引擎反应式读取**：`rebuildCompositionPlayback` 的签名含 `seq.volume`（`src/components/video/hooks/useTimelineComposition.ts:74`，音频段 `:109-111`），变化即 `setCompositionPlayback`；引擎 facade 每 tick 读 `compositionRef.current.audioSequences`（`useCompositionPlayback.ts:358-359`，`compositionRef` 每 render 重赋 `:311`），`AudioSyncPool` 每帧（含 `hold`）写 `el.volume = computeEffectiveVolume(...)`（`src/components/video/playback/AudioSyncPool.ts:158-205, 307/313/317`）。

   单测佐证（第 2 轮实跑）：`AudioSyncPool.test.ts` 含「applies a live volume change to the playing element on the next tick」（26 passed）。

**因此音频轨 [0,100%] 区间实时音量在含 `9a9ea10` 的构建里是生效的。** 用户若仍觉「音频也不变」，按概率排序：

- **(a) 旧产物**：桌面端未重打包 / 前端未硬刷新，跑的是 `9a9ea10` 之前的代码 → 复现第 2 轮旧现象。最廉价、最先排查。
- **(b) >100% 增益天花板**：`HTMLMediaElement.volume` 被规范钳制在 **[0,1]**，`AudioSyncPool.clampVolume` 亦钳到 1.0（`AudioSyncPool.ts:102-107, 134-140`）。把音量往 100% 以上拖，预览响度**不再增大**（视频轨同理）。这是浏览器硬限制，非本 bug；真要预览增益须上 WebAudio `GainNode`，超出本诉求。
- **(c) 视频轨误判**：用户面板上调的是「视频轨」音量却期待声音变化（视频轨声音来自 4.1 的视频路径，不归音频池管），把 4.1 的现象误当成「音频也不变」。这进一步指向 4.1 才是主修目标。

> 关键鉴别法（复现 §3.A 第 5 步已含）：**松手后是否变化**。视频轨「松手也不变」=4.1（视频路径不读音量，未修）；音频轨「拖动不变、松手才变」=旧构建（已修，重打包即可）。

---

## 5. 影响面（Impact surface）

- **视频轨预览音量（4.1，本轮主项）**：影响**所有**视频轨内嵌音频的预览响度——无论拖动期还是松手后，调视频轨音量在预览里**完全无效**，调到 0% 也照常出声。100% 复现，与素材无关。直命用户「视频轨道音量还是之前的音量」。**仅影响预览**；**导出不受影响**（ffmpeg filtergraph 用 `seq.volume` 正常混音，`CompositionAdapter.ts:152-173` / `buildCompositionRequest` `:321-338`）。
- **音频轨预览音量（4.2）**：[0,100%] 区间在含 `9a9ea10` 的构建里**已生效**；>100% 受浏览器 [0,1] 天花板限制（已知限制，非缺陷）。
- **不受影响**：导出路径、字幕/图片叠加、视频画面合成与 seek、detached 音轨的「无双份音频」路由。

---

## 6. 候选修复方案（Candidate fixes）

> 主修对象 = 4.1 视频轨预览音量。复用 4.2 已验证可用的反应式回路（store → useTimelineComposition 签名含 volume → compositionRef → 引擎每帧读），仅需「把音量从序列搬进 `VideoTrackGroup`」+「视频池每帧写 `el.volume`」两步。

### 6.A 视频轨预览音量（解决 4.1）

| 方案 | 做法 | 侵入性 | 风险 | 备注 |
|---|---|---|---|---|
| **V1（推荐）在 `VideoSourcePool` 施加 per-clip 有效音量** | ① 让活动片段的有效音量可被池读到：最稳是**在 `VideoElementLike` 不变的前提下，由 `TrackSourcePlan` 增携 `desiredVolume`**（活动 clip 的 `seq.volume`，缺省 1，clamp [0,1]）；`computeSourcePlan` 从 `hit.clip.volume` 取值。② `_apply` 在「确认播放」「暂停保持」两分支里写 `el.volume = clamp(desiredVolume,[0,1])`（detached/idle 仍交由 `muted` 处理，音量随意）。镜像 `AudioSyncPool` 的 `computeEffectiveVolume`+clamp。 | 中（`VideoSourcePool` + `TrackSourcePlan` 类型 + 测试） | 低 | 与现有 `muted` 路由正交；`<video>` 实例稳定（`PreviewCanvas` 懒建缓存），写 `volume` 无副作用 |
| **V2 在引擎 `_renderAt` 里对 `sync` 返回的活动元素补写音量** | 不动 `VideoSourcePool` 决策，改在 `MultiTrackPlaybackEngine._renderAt` 拿到 `synced[].element` 后，按活动 clip 的 `seq.volume` 写 `el.volume` | 低–中 | 中 | 把音量逻辑漏到编排层，破坏「决策在纯 planner、DOM 写在池」分层；活动 clip 查找要再算一次，易与池内不一致 |
| **V3 视频轨内嵌音频也改走 `AudioSyncPool`** | 为非 detached 视频轨派生独立音频组 | 高 | 高（双份音频/同步回归风险） | 与 RISK 2「无双份音频」决策冲突，过度工程 |

补充（与音量字段流向相关，V1 任选其一承载音量）：

- **载体 A（推荐）**：`TrackSourcePlan` 增 `desiredVolume`，`VideoTrackGroup` 不动——音量本就挂在 `seq.volume`（`items[]`），池在 `computeSourcePlan` 里从活动 clip 直接取，零额外装配改动。
- **载体 B**：给 `VideoTrackGroup` 增 `volume` 并在 `buildVideoTrackGroups` 折算——但视频是 per-clip 音量（不同 clip 可不同），按轨道粒度反而粗，故优先载体 A。

### 6.B 音频轨（4.2，多为「确认/澄清」而非改码）

| 方案 | 做法 | 侵入性 | 风险 |
|---|---|---|---|
| **Au1（推荐）确认构建含 `9a9ea10` + 文档化 >100% 天花板** | 重打包桌面端 / 硬刷新前端；在 UI 或文档注明「预览音量上限 100%，>100% 仅导出生效」 | 无/极低 | 无 |
| **Au2（可选，超出本诉求）WebAudio GainNode 支持 >100% 预览增益** | 预览音频接 `GainNode` 实现 >1.0 增益 | 高 | 中 | 仅当产品确需「预览也能听到增益」时再做 |

---

## 7. 推荐方案（Recommended fix）

**推荐 = 6.A 的 V1（载体 A）为主修；6.B 的 Au1 作为音频轨的确认/澄清。Au2 不默认做。**

**理由：**

1. **V1 精准命中「视频轨音量预览无效」这一排他根因**：§4.1 证明断点在「视频路径从不读 `seq.volume`、从不写 `el.volume`」。V1 在已算好音量的 `seq.volume` 与现成稳定 `<video>` 之间补上「每帧写 `el.volume`」一步即可，**复用 4.2 已验证的整条反应式回路**（调音量→签名变→组合体重建→引擎下一帧读），破坏面收敛在 `VideoSourcePool` + `TrackSourcePlan` 类型 + 测试。
2. **载体 A 比给 `VideoTrackGroup` 加字段更贴语义**：视频是 per-clip 音量，挂在 `items[].volume` 上，池在 `computeSourcePlan` 顺手取活动 clip 的 `volume` 即可，免动装配层 `buildVideoTrackGroups`。
3. **与 `muted` 路由正交、不碰导出/同步**：`el.muted` 仍按 detached/idle 决策；`el.volume` 只控响度。clamp [0,1] 对齐 `AudioSyncPool`，>100% 预览天花板与音频轨保持一致行为。导出仍走 ffmpeg，完全不动。
4. **V2/V3 否决**：V2 破坏分层且易与池内活动 clip 判定不一致；V3 与「无双份音频」决策冲突、回归风险高。
5. **音频轨无需改码（[0,100%]）**：4.2 已证链路通；用户若仍报「音频不变」，Au1 先排「旧产物」与「>100% 天花板」两个最廉价误判，避免在已修链路里重复定位。

**交给 Subtask #2 的落地清单：**

- **V1（视频轨，必做）**：
  - `TrackSourcePlan` 增 `desiredVolume: number`（活动 clip 的 `seq.volume`，缺省 1）；`computeSourcePlan` 非 idle 分支从 `hit.clip.volume ?? 1` 取，clamp [0,1]；idle 分支可省略/置 1。
  - `VideoSourcePool._apply` 在「确认播放」与「暂停保持」分支写 `el.volume = clamp(plan.desiredVolume, 0, 1)`（`VideoElementLike` 增可选 `volume?: number`；真实 `<video>` 天然有，纯对象 fake 可选，避免破坏既有无 volume 的测试 fake）。
  - 补测：非 detached 活动 clip `volume=0.2` → `el.volume===0.2`；`track.volume` 改变后下一帧 `el.volume` 跟随；detached/idle 仍 `muted` 且不因音量出声；>100% 折算后被 clamp 到 1.0。可将 §3.C 最小复现的断言**反转**为回归测试。
- **Au1（音频轨，确认/澄清）**：确认运行构建含 `9a9ea10`（重打包/硬刷新）；在已知限制中写明「预览音量 [0,100%]，>100% 仅导出生效」。
- **不动**：导出 ffmpeg 路径、`AudioSyncPool` 决策、字幕/图片/转场、detached「无双份音频」路由。

---

## 8. 证据索引（关键 file:line）

- **视频路径不施加音量（主根因）**：
  - `src/components/video/playback/VideoSourcePool.ts:333-354`（`_apply` 只切 `el.muted`，无 `el.volume`）、`:204`（`muteAudio = (clip.audioDetached===true)`，与音量无关）。
  - `src/components/video/playback/types.ts:136-141`（`VideoTrackGroup` 无 volume 字段）。
  - `src/components/video/hooks/useCompositionPlayback.ts:73-96`（`buildVideoTrackGroups` 丢弃 `seq.volume`）、`:99-107`（视频内嵌音频不经 `AudioSyncPool` 的架构注释）。
  - 全仓 `\.volume\s*=` 命中仅 `AudioSyncPool.ts:307/313/317` + 适配器 `MultiTrackPlaybackEngine.ts:662`；**视频解码元素零命中**。
  - `src/components/video/components/VideoPlayerPanel/PreviewCanvas.tsx:121-128`（解码 `<video>` 建时 `muted=true`，`volume` 默认 1.0 无人改）。
  - `src/components/video/playback/__tests__/VideoSourcePool.test.ts`：搜 `volume` **0 命中**（视频路径无音量测试覆盖，印证从不施加）。
- **音量其实已算好、仅预览视频侧忽略**：`CompositionAdapter.ts:152-173`（`extractVideoSequences` 折算 `volume`）、`:321-338`（导出请求带 `volume`）。
- **音频轨链路已通（4.2）**：
  - `VolumeSlider.tsx:144-162`（rAF live 预览）、`:301-325`（mousemove→live、mouseup→commit）；`trackActions.ts:79-112`（no-history setter + commit）。
  - `timelineSlice.ts:402-415`（`setTrackVolume` + `_syncDerivedState`）；`TimelinePanel.tsx:146-158`（`computeShapeJson` 含整段 `tracks`）、`:251-279`（subscribe→`onTimelineCompositionChange`）。
  - `useTimelineComposition.ts:74, 109-111`（签名含 `seq.volume`）；`useCompositionPlayback.ts:311, 358-359`（`compositionRef` 反应式读取）；`MultiTrackPlaybackEngine.ts:348`（每 tick 调 `getAudioSyncGroups`）。
  - `AudioSyncPool.ts:102-107, 134-140, 158-205, 307/313/317`（clamp[0,1] + 每帧写 `el.volume`，含 `hold`）。
- **>100% 预览天花板（浏览器硬限制）**：`AudioSyncPool.ts:102-107`（`clampVolume` 钳到 1.0）；`HTMLMediaElement.volume ∈ [0,1]`（规范）。
- **前序修复定位**：`9a9ea10`（A1 live 音量 + B1 在途 seek 守卫）、`fdbd725`（音频 src 修复）。

---

## 评审结论（Review Verdict）

> 节点：Subtask #1（分析报告评审与修复）。本节逐条复核了 §4 引用的**每一处 `file:line`**（在当前工作树实读核对，非转述），独立验证了「推荐方案 V1 依赖的反应式回路对**视频轨**同样成立」，并逐一排除了反例。结论：**根因证据成立（airtight），推荐方案 V1 成立且为最小修改**。下含三处证据补强 / 一处事实订正，使后续 Subtask #2 不致走弯路。

### 一、根因证据复核：成立

逐条复核结果（✅=已实读核对，与报告一致）：

- ✅ **视频路径从不写 `el.volume`**：`VideoSourcePool._apply`（`VideoSourcePool.ts:314-360`）四个会触达活动元素的分支——idle（:322 `el.muted=true`）、kick-muted（:340-341 `el.muted=true`+`_kickPlay`）、确认播放（:348 `el.muted=plan.muteAudio`）、暂停保持（:352 `el.muted=plan.muteAudio`）——**全部只写 `el.muted`，无一处写 `el.volume`**。`TrackSourcePlan`（`VideoSourcePool.ts:111-138`）确实无音量字段。
- ✅ **音量信息根本没传进视频池的「消费侧」**：`VideoTrackGroup`（`types.ts:136-141`）无顶层 `volume`；对照 `AudioTrackGroup`（`types.ts:143-150`）**有** `volume`——这条「视频/音频结构不对称」正是漏修的结构性指纹。
- ✅ **音量其实已算好、仅预览视频侧不读**：`CompositionAdapter.ts:152-155` 计算 `volume = max(0, min((item.volume??1)*(track.volume/100), 2))`，:173 赋给 `videoSequence.volume`；导出 filtergraph 用它，预览视频侧忽略它。
- ✅ **引擎每帧的视频路径只画不发声**：`MultiTrackPlaybackEngine._renderAt`（`MultiTrackPlaybackEngine.ts:343-348`）= `videoPool.sync`（仅 muted）→ `_buildVideoEntries`（仅配对 clip 供图层装配）→ `compositor.renderFrame`（**纯像素合成，不碰音频**）→ `audioPool.tick`（**仅独立音频轨**）。视频轨内嵌音频的音量在这条链上**无任何落点**。

**反例 / 替代解释——已逐一排除（这是「airtight」的关键）：**

1. **`MultiTrackPlaybackEngine.ts:662` 的 `withMedia.volume = v`**：实读核对，它在 `toAudioElement(el)`（:643-679）**适配器内部**——把元素包装成 `AudioElementLike` 供 **`AudioSyncPool`（独立音频轨）** 写入，由 `attach` 处 `resolveAudioElement` 注入（:195-197）。它**不作用于视频解码 `<video>` 的自有音轨**。故不构成「视频路径其实写了音量」的反例。
2. **补强报告的全仓 `\.volume\s*=` 主张**：报告称「视频解码元素零命中」。复核 `src/components/video` 全量命中为：`AudioSyncPool.ts:307/313/317`（音频池，预期内）、`MultiTrackPlaybackEngine.ts:662`（上述适配器）、外加报告**未列**的 `AudioPlayer.tsx:146`（AudioSearchModal 试听器）与 `MediaPreviewModal.tsx:189`（素材预览弹窗）。后两者是**独立模态组件，不在预览合成路径**；`Track.tsx:359`/`TimelineItem.ts:470` 为比较/序列化，非媒体元素赋值。**补全这两处后，「预览合成路径的视频解码元素零 `volume` 写入」的结论依然成立且更完整。**
3. **「会不会是默认音量就不是 1.0」**：`PreviewCanvas.createHiddenVideo`（`PreviewCanvas.tsx:120-132`）建元素只设 `muted=true`，**从不设 `volume`** → 依规范默认 `1.0`。非 detached 片段 `muted=false` → 永远满音量 1.0 出声。与症状「调了不变、调 0% 仍出声」自洽。

**症状归因排他性**：调视频轨音量 → `track.volume` 变 → 组合体 `seq.volume` 重算（已验证会重算，见下「二」）→ **但视频池消费侧不读它** → 预览响度纹丝不动；调 0% 亦不触发 `muted`（`muteAudio = (clip.audioDetached===true)`，`VideoSourcePool.ts:204`，与音量无关）→ 仍出声。证据链与现象**逐项对应、无缺口**。

### 二、补强：推荐方案 V1 依赖的反应式回路，对「视频轨」确成立

报告 §6/§7 称 V1「复用 4.2 已验证的反应式回路」。该回路在 §4.2 主要以**音频轨**举证；本节**独立验证它对视频轨同样触发**（否则 V1 不成立）：

- ✅ **滑块对视频轨可用**：`Track.tsx:335` 音量按钮渲染条件为 `track.type==='audio' || (track.type==='video' && !id.startsWith('image-track'))`——**视频轨（非图片轨）确实显示音量滑块**，用户能拖。
- ✅ **store 写入与轨类型无关**：`setTrackVolumePreviewAction`（`trackActions.ts:79-85`）直接 `setTrackVolume`，不分轨型；其 JSDoc（:70-75）自陈反应式链「→ AudioSyncPool」——恰好印证视频侧从未接入。
- ✅ **视频轨音量变化不会被去重抑制**：`TimelinePanel.computeShapeJson`（`TimelinePanel.tsx:146-158`）把整段 `ts.tracks`（含每轨 `volume`，:149）纳入比对 → 视频轨音量一变 shapeJson 即变 → `onTimelineCompositionChange` 必发（:270-276）。
- ✅ **组合体签名含「视频」段音量**：`sequencePlaybackSignature` 含 `seq.volume`（`useTimelineComposition.ts:75`），且 `computeCompositionSignature` 同时拼 `videoPart`（:106-108）与 `audioPart` → **视频 clip 的 volume 变化即改签名 → 触发重建**。

故：视频轨音量变化**已经**能一路驱动到「组合体重建 → 引擎下一帧拿到新 `group.items[].volume`」。**唯一缺的就是视频池在最后一步读取并写入 `el.volume`**——这正是 V1 要补的那一步，回路其余部分皆已通。

### 三、事实订正（影响 Subtask #2 的落地最小面，务必采纳）

报告 §2/§4.1/§6 多处表述「`buildVideoTrackGroups` 丢弃 `seq.volume` / 音量没进 `VideoTrackGroup`」。**经实读核对需订正**：

- `buildVideoTrackGroups`（`useCompositionPlayback.ts:88-92`）产出 `{ trackId, z, items }`，其中 `items` 是**完整的 `VideoSequenceItem[]`，逐项携带 `.volume`**——音量**并未被丢弃**，它随 `group.items[i].volume` 进入了 group。
- `computeSourcePlan`（`VideoSourcePool.ts:172-206`）已对每轨调用 `activeClipAt(group.items, t)`，其返回 `hit.clip` 即该完整 `VideoSequenceItem`（`TrackScheduler.activeClipAt` 返回 `{ clip: items[i], index, sourceTime }`）。**因此 `hit.clip.volume` 在 `computeSourcePlan` 中当下即可读**（与已在用的 `hit.clip.id`、`hit.clip.audioDetached` 同源）。

**结论**：断点纯在**「读 / 写」消费侧**，不在**「装配」侧**。这使 **载体 A 比报告所述更小——无需改动 `buildVideoTrackGroups`，也无需给 `VideoTrackGroup` 加字段**。报告 §6 引子「把音量从序列搬进 `VideoTrackGroup`」一语应作废；§6.A 的**载体 B 一并否决**（多余且粒度偏粗）。

### 四、候选修复审计（边界 / 最小性 / 回归）

- **V1 边界覆盖**（已逐项推演，均安全）：
  - *idle*：`_apply` 提前返回 + `muted=true`，音量被 muted 覆盖，写不写无所谓。
  - *detached*：`muteAudio=true → muted=true`，写音量无害。
  - *prewarm*：B 元素 parked/paused 不发声，音量无关。
  - *kick-muted（el.paused===true）*：本帧 muted 自启动，音量写入被 muted 覆盖；真正生效在**下一帧「确认播放」分支**——故 V1 必须把 `el.volume` 写在「确认播放」与「暂停保持」两分支（与 `el.muted=plan.muteAudio` 紧邻），**不能只写 kick 分支**。
  - *每帧幂等*：每帧写相同值，浏览器仅在值变化时派发 `volumechange`，写同值近似 no-op；`AudioSyncPool` 已每帧这么做（:307/313/317），是**已验证安全**的成例。
  - *>100% 天花板*：`seq.volume` 经 `CompositionAdapter` 已是 item×track 合成值且 clamp 到 [0,2]；视频元素只能 [0,1]，故 V1 须 **单次 clamp 到 [0,1]，绝不可再乘 `track.volume`**（否则二次叠乘）。这与 `AudioSyncPool.clampVolume`（:102-107，`>=1 → 1`）行为一致，>100% 预览不增益属浏览器硬限制，非缺陷。
  - *导出无影响*：导出走 ffmpeg 独立读 `seq.volume`，V1 不碰。
- **最小性**：经「三」订正后，V1（载体 A）改动面 = `TrackSourcePlan` 增 `desiredVolume` + `computeSourcePlan` 计算它 + `_apply` 两分支各写一行 + `VideoElementLike` 增可选 `volume?` + 测试。**这是解决该 bug 的最小变更**，且与既有 `muteAudio` 路由**对称同构**（planner 算决策、applier 写 DOM），不破坏分层。
- **回归风险：低**。新增行为仅「视频预览响度随音量变化」；`muted` 路由、seek 守卫、detached「无双份音频」、导出、字幕/图片/转场均不受影响。
- **V2 否决复核：成立**。V2 把音量写到编排层会割裂音频路由（muted 在池、volume 在引擎），破坏「DOM 写集中在池」的分层；即便 `_buildVideoEntries` 已有 `activeClipAt`，分散写仍更难维护。**V3 否决复核：成立**（与 RISK 2「无双份音频」冲突、回归面大）。

### 五、最终推荐修复（单一方案）

**采纳 §7：以 §6.A 的 V1（载体 A）为唯一主修；音频轨不改码（§6.B Au1 仅作确认 / 澄清，Au2 不做）。**

精确落地清单（经本评审订正，交 Subtask #2 直接执行）：

1. `TrackSourcePlan` 增 `desiredVolume: number`（`VideoSourcePool.ts:111-138`）。
2. `computeSourcePlan` 非 idle 分支：`desiredVolume = clampVolume(hit.clip.volume ?? 1)`（单次 clamp 到 [0,1]；idle/detached 置 1 或任意，被 muted 覆盖）。**不改 `buildVideoTrackGroups`、不改 `VideoTrackGroup`。**
3. `VideoSourcePool._apply`：在「确认播放」（`el.paused===false`，:348 旁）与「暂停保持」（:352 旁）两分支写 `el.volume = plan.desiredVolume`，紧邻现有 `el.muted = plan.muteAudio`；kick-muted 分支不必写。
4. `VideoElementLike` 增可选 `volume?: number`（`VideoSourcePool.ts:46-83`）——真实 `<video>` 天然具备；保持**可选**以兼容现存无 `volume` 的结构化测试 fake。
5. clamp 行为对齐音频侧：建议复用 `AudioSyncPool` 的 `clampVolume` 语义（`>=1→1`、`<=0→0`、`NaN→0`）。
6. 回归测试：把 §3.C 最小复现的两条断言**反转**（非 detached 活动 clip `volume=0.2 → el.volume===0.2`）；补「`track.volume` 改变后下一帧 `el.volume` 跟随」「detached/idle 仍 muted 不出声」「>100% 折算后被 clamp 到 1.0」。
7. 文档同步（**非阻断**，但建议顺手）：`trackActions.ts:72` JSDoc 与 `PreviewCanvas.tsx:124` 注释当前称音量/路由由 `AudioSyncPool`/`VideoSourcePool` 仅以 `muted` 处理——修复后应补「`el.volume` 亦由 `VideoSourcePool` 每帧施加」。

### 六、给 Subtask #2 的硬约束（防返工）

- **不要**在 `AudioSyncPool` 内重复定位音频轨：[0,100%] 实时音量已由 `9a9ea10` 通（§4.2 已证），先做 Au1「确认构建含 `9a9ea10`（重打包/硬刷新）+ 文档化 >100% 天花板」。
- **不要**给 `VideoTrackGroup` 加 `volume` 字段（载体 B 已否决）；用载体 A，从 `hit.clip.volume` 直取。
- **不要**在 `_apply` 里二次乘 `track.volume`——`seq.volume` 已是合成值；只做单次 clamp [0,1]。
- **不动**导出 ffmpeg 路径、字幕/图片/转场、detached「无双份音频」路由。
- 验收判别钥匙：§3.A 第 5 步「松手后是否变化」——视频轨「松手仍不变」=未修；修复后应「拖动中即跟手、松手保持新值、调 0% 静音」。

**一句话裁决**：根因（视频预览路径从不消费 `seq.volume`/从不写 `el.volume`）证据充分且排他；唯一推荐修复 = **在 `VideoSourcePool` 的 planner 计算 per-clip `desiredVolume`、applier 每帧把它 clamp[0,1] 后写入活动视频元素的 `el.volume`**，复用业已验证对视频轨成立的反应式回路，零装配层改动、与 `muted` 路由对称、不触碰导出与音频池。
