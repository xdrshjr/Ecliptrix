# 诊断报告：时间轴预览组合播放时听不到音频轨声音

> Bug slug: `timeline-preview-audio-track-silent`
> 节点：Subtask #0（问题定位与分析）
> 性质：本节点仅做定位与分析，不写修复代码、不提交。

---

## 1. 问题描述（Problem description）

用户在「视频编辑」功能中：

1. 在素材管理里上传了视频素材与音频素材；
2. 把视频素材添加到视频轨道、把音频素材添加到独立的音频轨道；
3. 点击「播放组合（合成预览）」的播放按钮预览。

**现象**：预览能看到视频画面正常播放，但**听不到音频轨道（独立 audio 轨）合成进来的声音**。

**期望**：

- 组合播放时能**同时**听到视频轨道（视频自带音频）的声音与音频轨道的声音；
- 用户**实时调整音频轨道音量**时，预览中该音频轨对应的音量应**同步变化**。

---

## 2. 复现步骤（Reproduction steps）

### 2.1 UI 端复现（任何人可照做）

前置：按 `CLAUDE.md` 启动前后端（`npm run dev` + 后端 `uvicorn ...`），或运行打包后的桌面端。

1. 进入视频编辑页面，打开「素材管理 / Materials」。
2. 上传 1 个视频素材（建议带声音）和 1 个音频素材（如一段 mp3/wav）。
3. 把视频素材拖到一条**视频轨道**；把音频素材拖到一条**独立音频轨道**（`track.type === 'audio'`）。
4. 确认音频轨**可见、未锁定、未静音**（`isVisible && !isLocked && !isMuted`），否则它根本不会进入合成序列（见 `CompositionAdapter.extractAudioSequences` 过滤条件）。
5. 把播放头移到两条轨道都有内容的时间点，点击「播放组合」播放按钮。
6. **观察**：画面播放正常；视频自带音频可被听到（若视频有声）；但**音频轨道的声音始终听不到**。
7. 播放中拖动该音频轨的音量滑块 —— **预览音量无任何变化**（因为该音频根本没有在播放）。

> 备注：失败是「静默」的——浏览器不会弹错。播放路径对 source-less 元素调用 `play()` 返回的 rejected promise 被吞掉了（见根因 §3.4），控制台通常看不到报错，因此很容易被误判为「没接好」。

### 2.2 代码级最小复现（类型层面即可证伪，无需起服务）

音频轨的播放完全由 `AudioSyncPool` 驱动，而它消费的数据结构里**根本没有承载音频 URL 的字段**：

- `SchedulableClip`（`src/components/video/playback/TrackScheduler.ts:23-29`）只有 `id / startTime / duration / clipStart / clipEnd`；
- `AudioSyncClip extends SchedulableClip` 仅多了一个 `volume`（`src/components/video/playback/AudioSyncPool.ts:33-36`）；
- `AudioSyncGroup`（同文件 `:38-52`）也没有 `url`。

因此，无论上游素材带不带 URL，**URL 在类型上就无法到达音频元素**。这一点不需要运行环境即可确认（`grep -n "url" src/components/video/playback/AudioSyncPool.ts` 无任何 url 字段；`AudioSyncPool.test.ts` 中也完全没有 `src`/`url` 断言）。

---

## 3. 根因分析（Root cause analysis）

### 结论先行

**多轨合成预览（当前唯一预览路径）中，独立音频轨对应的隐藏媒体元素自始至终没有被赋予 `src`。** 视频轨由 `VideoSourcePool` 负责把 `el.src = desiredUrl` 写进 `<video>`（RC-B「比对键==赋值」），而音频侧**没有任何等价机制**：音频的 URL 在数据装配阶段就被丢弃，`AudioSyncPool` 也没有 source resolver、从不写 `src`，宿主 `PreviewCanvas` 创建音频元素时同样不设 `src`。于是音频元素是一个**没有源的 `<video>`**，`play()` 等于空操作 → 音频轨全程静音。

### 3.1 数据装配阶段：URL 被丢弃

后端/适配层其实**正确地**生成了带 URL 和音量的音频序列。
`src/components/video/timeline/infrastructure/CompositionAdapter.ts:248-260`：

```ts
const finalUrl = selectCanonicalExportReference(material);
const volume = Math.max(0, Math.min((item.volume ?? 1) * (track.volume / 100), 2));
const audioSequence: AudioSequenceItem = {
  id: item.id, name: item.name,
  url: finalUrl,                 // ← URL 已就位
  startTime: item.startTime, duration: item.duration,
  materialId: item.materialId, trackId: item.trackId,
  volume,                        // ← 已把 track.volume/100 折算进来
  clipStart, clipEnd, originalDuration,
};
```

`AudioSequenceItem` 确实声明了 `url: string`（`src/components/video/types/videoEditingTypes.ts:69-83`）。

但在 orchestration 钩子把序列装配成引擎要消费的 `AudioSyncGroup` 时，**只搬运了 `volume` 等字段，唯独漏掉了 `url`**。
`src/components/video/hooks/useCompositionPlayback.ts:130-145`：

```ts
groups.push({
  trackId, muted: false, volume: 1, kind: 'audio',
  items: (audioByTrack.get(trackId) ?? []).map((seq) => ({
    id: seq.id,
    startTime: seq.startTime,
    duration: seq.duration,
    clipStart: seq.clipStart,
    clipEnd: seq.clipEnd,
    volume: seq.volume,
    // ❌ 没有 seq.url —— 音频源 URL 在这里被丢弃
  })),
});
```

### 3.2 同步池阶段：从不赋 `src`

`AudioSyncPool` 每帧只会写 `currentTime`、`volume`，并调用 `play()`/`pause()`，**没有 source resolver、也没有任何 `src` 赋值**。
`src/components/video/playback/AudioSyncPool.ts:206-228`（`_apply`）：

```ts
case 'seek':
  if (action.targetSourceTime !== undefined) el.currentTime = action.targetSourceTime;
  if (action.volume !== undefined) el.volume = action.volume;
  this._ensurePlaying(el);     // ← play() 但元素无 src
  return;
case 'play':
  if (action.volume !== undefined) el.volume = action.volume;
  this._ensurePlaying(el);
  return;
```

其依赖的 `AudioElementLike` 接口（同文件 `:153-159`）只有 `currentTime / volume / paused / play / pause`，**根本没有 `src`**。

**对照视频侧**：`VideoSourcePool._apply` 会显式赋值
`src/components/video/playback/VideoSourcePool.ts:327-329`：

```ts
if (plan.needsSrcSwap) {
  el.src = plan.desiredUrl;   // ← 视频元素的 src 在这里被写入（RC-B）
}
```

全仓 `grep '\.src\s*='` 在多轨预览路径下只命中 `VideoSourcePool.ts:329/403`（视频）与 `CanvasCompositor.ts:600`（图片），**音频路径零命中**。

### 3.3 宿主阶段：创建音频元素时也不设 `src`

宿主刻意不给元素设 `src`（视频侧是对的，因为 `VideoSourcePool` 接管了；但音频侧没有接管者）。
`src/components/video/components/VideoPlayerPanel/PreviewCanvas.tsx:134-145`（`createHiddenAudio`）：

```ts
const el = document.createElement('video');
el.playsInline = true;
el.preload = 'auto';
Object.assign(el.style, HIDDEN_MEDIA_STYLE);
sourceHostRef.current?.appendChild(el);
return el;                      // ← 自始至终没有 el.src = ...
```

`PreviewCanvas.test.tsx:65` 甚至有断言注释「No `el.src =` / `.setAttribute('src'` anywhere in the host.」——确认宿主**故意**不设 src。

### 3.4 运行期后果

引擎每帧 `this._audioPool.tick(tl.getAudioSyncGroups(), comp, isPlaying)`
（`MultiTrackPlaybackEngine.ts:348`，且 `VideoPlayerPanel.tsx:165` `enabled: true` 说明该路径是**唯一且激活**的预览路径）。
`tick` → `_apply` → `_ensurePlaying(el)` 对一个 `src===''` 的 `<video>` 调 `play()`：

`src/components/video/playback/AudioSyncPool.ts:230-240`：

```ts
private _ensurePlaying(el: AudioElementLike): void {
  if (!el.paused) return;
  const result = el.play();
  if (result && typeof (result as Promise<void>).catch === 'function') {
    (result as Promise<void>).catch(() => undefined);  // ← 无源 play() 的 rejection 被静默吞掉
  }
}
```

无源元素的 `play()` 会被浏览器拒绝（无可用源），rejection 被吞 → **静默失败、无声、无报错**。

### 3.5 这是重构引入的回归（v1 曾正确赋 src）

`AudioSyncPool.ts` 头注释自称「Lifts the v1 inline HTMLAudio pool (`VideoPlayerPanel.syncAudioPlayback`)」，但**漏掉了 v1 里关键的 src 赋值**。

v1 旧实现（在提交 `b919d71` *“make compositor the sole preview path; delete v1 player”* 中被删除）确实创建了 `Audio()` 并设置了 src：

`git show b919d71^:.../VideoPlayerPanel.tsx`：

```
722:  audioElement = new Audio();
739:  audioElement.src = audioLocalBlob ?? audioSequence.url;   // ← v1 赋了音频 src
741:  const clampedVolume = Math.max(0, Math.min(audioSequence.volume ?? 1, 1));
742:  audioElement.volume = clampedVolume;
```

**结论**：本 bug 是 Phase 2 S4 重构（`b919d71`）把预览统一到合成器时，把音频源赋值这一步整体丢失所致——规范 §2.5 的伪代码（`docs/plans/local-video-editing-refactor/specs/02-unified-local-preview-compositor.md:128-136`）直接 `audioEl = pool.audioFor(track)` 后就设 `currentTime/volume` 并 “ensure playing”，**从未规定音频 src 在何处赋值**，实现遂照此遗漏。

### 3.6 关于「实时调整音量」需求

一旦 §3.1–§3.3 的 src 问题修复，**实时音量本身已可工作**，无需额外改动：

- `CompositionAdapter` 已把 `track.volume/100` 折算进每个 `seq.volume`（§3.1）；
- 用户改音量 → 时间轴状态变化 → 合成对象重建 → 引擎每帧读最新 `compositionRef.current.audioSequences`（`useCompositionPlayback.ts:354-356` 经 refs 读取，无需重挂引擎）；
- `computeAudioSyncActions` 每帧用 `computeEffectiveVolume(clip.volume, group.volume=1)` 重算并经 `_apply` 写回 `el.volume`（`AudioSyncPool.ts:133-145, 217/221/225`）。

**注意一个保真度小坑**（供后续修复留意，非本 bug 主因）：`AudioSyncPool.clampVolume` 把有效音量钳到 **[0,1]**（`AudioSyncPool.ts:83-100`），而 `CompositionAdapter` 允许音量到 **2**（200%）。即 `>100%` 的增益在预览里会被截断到 100%（HTMLMediaElement.volume 上限本就是 1）。在 0–100% 区间内实时音量是精确同步的；若产品要求 >100% 增益，需用 Web Audio `GainNode`，属增强项、可在修复节点酌情评估。

---

## 4. 影响面（Impact surface）

- **受影响功能**：视频编辑器「播放组合（合成预览）」中的**所有独立音频轨**（包括从视频里 detach 出来的音频序列，spec 01 §2.4）。
- **受影响用户**：所有在时间轴上使用独立音频轨（背景音乐、配音、音效等）并依赖预览试听的用户——**100% 复现**，与素材内容无关。
- **连带影响「无双声」契约**：本设计本意是“detach 的视频轨静音、由配对音频轨出声”。由于音频轨整体不出声，**被 detach 的视频片段在预览里会完全没有声音**（视频轨被静音、音频轨又不响），比纯独立音频轨更严重。
- **不受影响**：
  - 视频轨**自带**音频仍可出声（`VideoSourcePool._apply` 在确认播放后 `el.muted = plan.muteAudio=false`，`VideoSourcePool.ts:333-349`）；
  - **导出**路径不走预览 `AudioSyncPool`，音频走 ffmpeg filtergraph，**不受此 bug 影响**（即“预览无声但导出有声”，所见非所得）。

---

## 5. 候选修复方案（Candidate fixes）

> 共性：必须让音频 `url` 一路流到音频元素，并在播放前把它赋给 `el.src`（参照视频侧 RC-B「比对键==赋值」，归一化去重，避免每帧重设触发 `AbortError`）。

| 方案 | 做法 | 侵入性 | 风险 | 工作量 | 正确性（多 clip 轨） |
|---|---|---|---|---|---|
| **A. 在 `AudioSyncPool` 内补 src 赋值（镜像 `VideoSourcePool`）** | ① `AudioSyncClip` 增加 `url`；② `buildAudioSyncGroups` 搬运 `seq.url`；③ `AudioElementLike` 增加 `src`；④ `computeAudioSyncActions` 在 `play/seek` 动作带上 `activeClip.url`，`_apply` 在 play 前做归一化比对、变化才 `el.src=url`。音量/seek 逻辑不变。 | 中（集中在 `AudioSyncPool.ts` + `useCompositionPlayback.buildAudioSyncGroups` + 各自测试） | 低–中（完全照搬已验证的视频侧模式，宿主不变） | 中 | ✅ 正确：每帧按 active clip 解析 url，多 clip 切换自然换源 |
| **B. 在宿主/钩子建元素时给 `el.src` 赋值** | `PreviewCanvas.resolveAudioElement` 或 hook 在解析音频元素时一次性设 `src` | 低 | 中–高 | 低 | ❌ 错误：一条音频轨可含多个不同 url 的 clip，元素创建期只能绑一个 src，多 clip 轨会播错/缺源；且把源决策塞进“纯 DOM 宿主”，破坏 `PreviewCanvas` 不含业务逻辑的约束 |
| **C. 新建独立 `AudioSourcePool`（完全镜像 `VideoSourcePool`）** | 新增一个池专管音频 src-swap+seek+play，`AudioSyncPool` 退化为只管音量/时序，或合并 | 高（新文件 + 引擎装配 + 大量新测试） | 中 | 高 | ✅ 正确，但架构改动远超必要 |

---

## 6. 推荐方案（Recommended fix）

**推荐方案 A**：在 `AudioSyncPool` 内补齐音频源赋值，使其与 `VideoSourcePool` 对称。

**理由**：

1. **最小且完备**：本 bug 的本质就是“音频侧缺了视频侧已有的 src 赋值这一环”。方案 A 精确补上该环，改动集中在 1 个纯模块（`AudioSyncPool`）+ 1 处装配（`buildAudioSyncGroups`），不动宿主、不动引擎编排、不动导出路径，破坏面最小。
2. **正确处理多 clip 轨**：源解析发生在每帧按 `activeClipAt` 命中的 clip 上（池里已有 `activeClipAt(group.items, compositionTime)`，`AudioSyncPool.ts:128`），跨 clip 切换天然换源——这是方案 B 做不到的。
3. **复用已验证模式**：直接照搬视频侧 RC-B 的「归一化比对、变化才赋值」（`VideoSourcePool.ts:140-151, 327-329`），规避“每帧重设 src 触发 play()/pause() AbortError / 黑屏”这一已知坑（v1 提交 `da056df`、spec 02 §2.6 均有记载）。
4. **顺带恢复实时音量**：src 修好后，§3.6 所述的每帧 `el.volume` 重算链路即刻生效，**无需为音量再单独改动**（0–100% 区间精确同步）。
5. **与“无双声”契约一致**：音频轨恢复出声后，detach 视频轨静音 + 配对音频轨出声的既有设计自动成立。

**实现注意（交给 Subtask #2）**：

- `el.src` 在 `play`/`seek` 动作执行**之前**赋值；用与视频侧一致的 `normalizeSrc` 归一化后比对，相同则跳过（防 AbortError）。
- 切到无 active clip（gap）或 `muted` 时仍走 `pause`，不必清空 `src`（清空反而易触发重载/抖动；保持现有 pause 行为即可）。
- `AudioElementLike` 增加 `src: string` 字段后，引擎的 `toAudioElement` 适配器（`MultiTrackPlaybackEngine.ts:640-661`）需补上 `src` 的 get/set 透传到底层 `<video>`。
- 同步补测试：`AudioSyncPool.test.ts` 增加“active clip → 元素被赋 src 且 play、url 变化才换源、gap→pause”等用例；`useCompositionPlayback.test.tsx` 增加 `buildAudioSyncGroups` 搬运 `url` 的断言。
- 可选增强（非本 bug 必须）：若要支持 >100% 音量，引入 Web Audio `GainNode`；否则维持 [0,1] 钳制并在 UI 层说明上限。

---

## 7. 证据索引（关键 file:line）

- 装配丢 url：`src/components/video/hooks/useCompositionPlayback.ts:130-145`
- 类型无 url：`src/components/video/playback/AudioSyncPool.ts:33-52`、`TrackScheduler.ts:23-29`
- 池不写 src、`AudioElementLike` 无 src：`src/components/video/playback/AudioSyncPool.ts:153-159, 206-240`
- 视频侧对照（写 src）：`src/components/video/playback/VideoSourcePool.ts:327-329`
- 宿主不设 src：`src/components/video/components/VideoPlayerPanel/PreviewCanvas.tsx:134-145`；断言注释 `PreviewCanvas.test.tsx:65`
- URL/音量在适配层已就位：`src/components/video/timeline/infrastructure/CompositionAdapter.ts:240-260`
- 唯一且激活的预览路径：`VideoPlayerPanel.tsx:151-166`（`enabled: true`）；引擎每帧 tick：`MultiTrackPlaybackEngine.ts:348`
- v1 曾正确赋 src（回归源头）：`git show b919d71^:.../VideoPlayerPanel.tsx` 第 722/739/741 行
- 规范遗漏 src 赋值步骤：`docs/plans/local-video-editing-refactor/specs/02-unified-local-preview-compositor.md:128-136`

---

## 评审结论（Review Verdict）

> 节点：Subtask #1（分析报告评审与修复）。评审人逐条独立复核了 §3 所有 file:line 证据，并补充了三条原报告未列出的佐证。**结论：根因链条成立、闭合、可证伪；推荐方案 A 正确且为最小改动。** 下面给出审计明细、补充证据，并敲定唯一推荐修复。

### A. 根因证据审计（逐条独立复核）

| 证据点 | 原报告引用 | 复核结果 |
|---|---|---|
| 装配阶段丢 `url` | `useCompositionPlayback.ts:130-145` | ✅ 属实。`buildAudioSyncGroups` 的 `.map` 只搬 `id/startTime/duration/clipStart/clipEnd/volume`（实测 :136-143），无 `url` |
| 类型层无 `url` | `AudioSyncClip` / `AudioSyncGroup` :33-52 | ✅ 属实。`AudioSyncClip` 仅扩展 `volume`；`AudioSyncGroup` 仅 `trackId/muted/volume/kind/items` |
| 池不写 `src`、`AudioElementLike` 无 `src` | `AudioSyncPool.ts:153-159, 206-240` | ✅ 属实。`AudioElementLike` 仅 `currentTime/volume/paused/play/pause`；`_apply` 的 `seek/play/hold` 只写 `currentTime/volume`，从不碰 `src` |
| 无源 `play()` rejection 被吞 | `AudioSyncPool.ts:230-240` | ✅ 属实。`_ensurePlaying` 对 `el.play()` 返回的 promise `.catch(() => undefined)`（实测 :237-238） |
| 宿主不设 `src` | `PreviewCanvas.tsx:134-145` | ✅ 属实。`createHiddenAudio` 创建 `<video>` 仅设 `playsInline/preload/style` 后 `appendChild`，无 `el.src=` |
| 视频侧对照写 `src` | `VideoSourcePool.ts:327-329` | ✅ 属实。`if (plan.needsSrcSwap) el.src = plan.desiredUrl`（RC-B「比对键==赋值」） |
| URL/音量在适配层已就位 | `CompositionAdapter.ts:240-260` | ✅ 属实。`url: selectCanonicalExportReference(material)`、`volume = clamp((item.volume??1)*(track.volume/100), 0, 2)` |
| 唯一且激活的预览路径 | `VideoPlayerPanel.tsx:151-166` | ✅ 属实。实测 `:165` `enabled: true`，无条件挂载（b919d71 已删除 v1 与 playback-v2 flag） |
| 回归源头（v1 曾赋 src） | `git show b919d71^:.../VideoPlayerPanel.tsx:739` | ✅ 实测确认：`audioElement.src = audioLocalBlob ?? audioSequence.url`（:739），并在停止时 `audioElement.src = ''`（:1374/1388）。提交标题即「make compositor the sole preview path; delete v1 player」 |

**补充证据（评审新增，原报告未列）：**

1. **第三处独立佐证——引擎适配器同样不透传 `src`。** `MultiTrackPlaybackEngine.ts:195-198` 用 `deps.resolveAudioElement(trackId)` 取到底层元素后，经 `toAudioElement(el)`（同文件 :640-661）包装成 `AudioElementLike` 再交给 `AudioSyncPool`。该适配器只暴露 `currentTime/volume/paused/play/pause` 的 get/set，**没有 `src` 的 get/set**。因此即便底层 `el` 本身是一个原生带 `.src` 的 `HTMLVideoElement`，`src` 在「`resolveAudioElement` → `toAudioElement` → `AudioSyncPool`」整条链路上**类型上不可达**。这与 §3.1（装配丢 url）、§3.2（池不写 src）构成三重独立印证。

2. **仓库级反证排除——音频路径 `.src=` 零命中。** 在 `src/components/video/playback/` 下检索 `\.src\s*=`，仅命中 `VideoSourcePool.ts:329/403`（视频 active/prewarm）、`CanvasCompositor.ts:600`（图片）、`AbBufferController.ts:150/210`（**遗留**单全局 A/B 控制器，已被 `VideoSourcePool` 取代、不在合成器引擎路径上）。音频元素 `.src=` **零命中**，排除「别处已偷偷赋源」的替代解释。

3. **回归护栏测试反向印证 §3.3。** `PreviewCanvas.test.tsx:64-67` 存在一条断言：`expect(src).not.toMatch(/\.src\s*=/)` + 不得 `setAttribute('src')`，注释为「never assigns src on the decode `<video>`s (VideoSourcePool owns src — RC-B)」。这既**独立证明**宿主刻意不设 src，又对修复方向构成硬约束（见 §C 对方案 B 的否决）。同时 `AudioSyncPool.test.ts` 全文无 `src`/`url`/`setAttribute` 断言，印证「源赋值这一环从测试到实现整体缺失」。

4. **症状—证据吻合性。** 用户「看得到视频、（视频自带音）听得到、独立音频轨听不到、且无报错」与根因完全自洽：视频元素经 `VideoSourcePool` 赋源并在确认播放后 `el.muted = false`（:329/:348）故有声；独立音频元素无源，`play()` 被拒、rejection 被吞（:237-238）故**静默无声且无控制台错误**；导出走 ffmpeg filtergraph 不经本池，故「预览无声、导出有声」。无遗漏的替代假说。

**根因结论：证据链条airtight，可证伪（类型层即可证伪，无需起服务），无反例。** 予以采信。

### B. 决定性架构发现：元素「按轨」而非「按 clip」（评审新增）

复核 v1 与新架构的元素生命周期，发现一处**对修复方案选择具有决定性**、但原报告未点明的差异：

- **v1**：`getOrCreateAudioElement` 以 `audioSequence.id`（即**每个 clip**）为 key 缓存 `new Audio()`，每个 clip 独占一个元素、创建时一次性 `el.src = ...`（:716-739）。
- **新架构**：`PreviewCanvas.resolveAudioElement(trackId)` 以 **trackId** 为 key（`audioPoolRef: Map<string, ...>`，:112/:163-174），**一条音频轨只有一个元素**，承载该轨上的多个 clip。

**推论**：在按轨复用元素的模型下，当播放头跨越同轨相邻 clip（不同 `url`）时，**必须按帧依 active clip 换源**——这正是 `VideoSourcePool` 已经在做的（`needsSrcSwap` + `normalizeSrc` 比对）。因此：
- 方案 A（在池内按 active clip 解析并换源）是新架构下**唯一**正确的镜像；
- 方案 B（建元素时定 src）在多 clip 轨上**只会播第一个 clip 的源**，且违反护栏测试 `PreviewCanvas.test.tsx:64-67`，**双重否决**。

### C. 候选修复审计（边界 / 最小性 / 回归面）

**方案 A —— 采纳。** 逐项核对边界：

- **多 clip 同轨**：`computeAudioSyncActions` 每帧 `activeClipAt(group.items, t)` 命中 active clip（:128），换源天然发生。✅
- **多条音频轨（并发）**：每轨一个元素、每帧 `tick` 全部 group（引擎 :348），各自独立 `play/seek/volume`，无并发竞争。✅
- **gap / muted → pause 不清空 src**：现有 `_apply` 的 `pause` 分支只 `el.pause()`、不动 src（:210-212）。保持此行为即可——清空 src 会触发重载抖动。✅（原报告已正确指出）
- **每帧重设 src 触发 `AbortError`（已知坑）**：**必须**复用视频侧 `normalizeSrc`（`VideoSourcePool.ts:140-151`，以 `new URL(src, base).href` 归一化）比对后变化才赋值。注意 `<video>.src` 的 IDL getter **回读永远是绝对 URL**，而 `seq.url`（本地素材）多为相对路径 `/api/storage/files/audio/...`；`normalizeSrc` 对两侧同样绝对化，故比对相等、不会每帧重设。**这是修复成败关键，不可省略。**✅
- **适配器缺口（载荷性）**：`toAudioElement`（引擎 :640-661）**必须新增 `src` 的 get/set 透传**到底层 `el`，否则池内 `el.src=` 写了个寂寞。✅（原报告已列入实现注意，评审确认其为载荷项）
- **autoplay 门（评审新增边界，原报告覆盖不足）**：视频解码元素靠「先静音播放→确认播放后再 `muted=false`」绕过 autoplay 策略（`VideoSourcePool.ts:340-348`）；独立音频元素**本就不能静音**（静音即失去意义），其首次 `play()` 受 autoplay 策略约束。实务上用户点击播放按钮即构成手势、v1 同样如此处理且可用，故**非阻断项**；但需注意 :237-238 的吞 rejection 在修复后会**掩盖真正的 autoplay 拒绝**。建议（可选增强）镜像 `VideoSourcePool` 的 `canplay` 重试一次；至少保留现有吞 rejection（对本复现流程是良性的）。
- **URL 时效性 / resolver 不对称（评审新增边界）**：视频侧每帧经 `resolveSequencePlaybackUrl(seq, liveMaterials, lockedOpts)` 读**实时素材**解析源（RC-4 防陈旧 + preview-proxy + 绝对化）；方案 A 携带的是 `buildAudioSyncGroups` 冻结的 `seq.url`（取自 `selectCanonicalExportReference`，提取期定格）。对**本 Bug 场景（用户上传的本地音频）**，本地存储引用在上传即就位且永不变化，冻结 `seq.url` 正确无虞；陈旧类问题（远端音频下载后才补 `cacheUrl`）与 preview-proxy/本地 blob 优化**均不影响本地上传**，且属既有面、非本次引入的回归。故**携带 `seq.url` 即最小且正确**；走实时 resolver 的完全对称是可延后的增强项，非修本 Bug 必需。
- **>100% 增益钳制**：`clampVolume` 钳 [0,1]（`AudioSyncPool.ts:83-88`）vs `CompositionAdapter` 允许 [0,2]（:243-246）。0–100% 区间实时音量精确；>100% 截断到 100%（`HTMLMediaElement.volume` 硬上限即 1）。Web Audio `GainNode` 属增强、可延后。
- **最小性**：方案 A 仅触及 `AudioSyncClip` 类型 + `buildAudioSyncGroups` + `AudioElementLike` 类型 + `toAudioElement` 适配器 + `AudioSyncPool._apply`，**不动宿主、不动引擎编排、不动导出**。方案 C（新建 `AudioSourcePool`）为同等效果引入新文件 + 引擎装配 + 大量新测试，**过度工程**，否决。
- **回归面**：改动收敛于 1 个纯模块 + 1 处装配 + 1 个适配器 getter，不触碰视频/图片/字幕/导出路径；唯一行为变化是音频元素「获得源并开始播放」。回归风险低。

**「实时调整音量」需求的独立确认**：链路 `CompositionAdapter` 折算 `track.volume/100` 进 `seq.volume` → `buildAudioSyncGroups` 搬运 `seq.volume` → 引擎每帧 `tl.getAudioSyncGroups()` 从 `compositionRef.current` 重建（:348 + `useCompositionPlayback.ts:355`）→ `computeEffectiveVolume(clip.volume, group.volume=1)` → `_apply` 写 `el.volume`（:217/221/225）。**逐环已验证**，src 修好后 0–100% 区间实时音量即生效，无需为音量另行改动。唯一前置假设：用户拖动音量滑块时上游会重建 `compositionPlayback.audioSequences`（`CompositionAdapter` 折算 `track.volume` 即为此）——若修源后实时音量仍失灵，缺口在上游合成重建而非本池，可据此指引 Subtask #2 定位。

### D. 最终推荐修复（唯一）

**采纳方案 A：在 `AudioSyncPool` 内补齐音频源赋值，使其与 `VideoSourcePool` 对称（按帧依 active clip 换源 + `normalizeSrc` 归一化比对）。**

判定理由（择要）：
1. **精准命中根因**：Bug 本质即「音频侧缺了视频侧已有的 src 赋值这一环」（三重证据 + v1:739 回归源头印证），方案 A 恰好补上该环。
2. **架构上唯一正确**：按轨复用元素的新模型下，多 clip 轨**必须**按帧换源（§B），方案 A 是唯一正确镜像，方案 B 被架构与护栏测试双重否决。
3. **最小且低回归**：改动收敛于 1 纯模块 + 1 装配 + 1 适配器 getter，不动宿主/引擎/导出（§C）。
4. **顺带恢复实时音量**：src 修好后每帧 `el.volume` 重算链路即生效（§C 末），无需额外改动。

**交付 Subtask #2 的强制实现清单（落地约束）：**
1. `AudioSyncClip` 增 `url: string`（或 `url?: string` + 缺省 pause）。
2. `buildAudioSyncGroups`（`useCompositionPlayback.ts:136-143）的 `.map` 补 `url: seq.url`。
3. `AudioElementLike` 增 `src: string`；`toAudioElement`（`MultiTrackPlaybackEngine.ts:640-661`）补 `src` 的 get/set 透传到底层 `el`（**载荷项，不可漏**）。
4. `computeAudioSyncActions` 的 `play`/`seek` 动作带上 `activeClip.url`；`AudioSyncPool._apply` 在 `_ensurePlaying` **之前**，用与视频侧一致的 `normalizeSrc` 比对，**仅当变化才** `el.src = url`（防 `AbortError`/每帧churn——**关键**）。
5. `pause`/gap/muted 分支保持现状，**不清空 src**。
6. 补测试：`AudioSyncPool.test.ts` 增「active clip→元素被赋 src 且 play」「url 变化才换源」「gap/muted→pause 不动 src」用例；`useCompositionPlayback.test.tsx` 增 `buildAudioSyncGroups` 搬运 `url` 的断言；保持 `PreviewCanvas.test.tsx:64-67`（宿主不设 src）继续通过。
7. 增强项（**非本 Bug 必需，可延后**）：>100% 增益走 Web Audio `GainNode`；远端音频的 preview-proxy/本地 blob/`crossOrigin` 对齐；autoplay 的 `canplay` 重试。

**评审签字：根因链条airtight，唯一推荐修复 = 方案 A。准予进入 Subtask #2 落代码。**
