# 诊断报告：组合播放预览听不到音频轨声音 + 拖动音量滑块预览音量不实时变化

> Bug slug: `timeline-preview-audio-silent-and-volume-not-live`
> 节点：Subtask #0（问题定位与分析）
> 性质：本节点仅做定位与分析，**不写修复代码、不提交**。
> 这是同一现象的**第 2 轮**诊断（第 1 轮见 `docs/diagnoses/timeline-preview-audio-track-silent/analysis.md`）。第 1 轮的根因（音频元素始终没有 `src`）已在提交 `fdbd725` 修复并合入 `main`，本轮在该修复之上重新核查现象，定位「修复后仍可能复现」的剩余根因与「实时音量」这一独立缺陷。

---

## 1. 问题描述（Problem description）

用户在「视频编辑」功能中：

1. 在素材管理里上传视频素材与音频素材；
2. 把视频素材加到视频轨道、把音频素材加到独立音频轨道；
3. 点击「播放组合（合成预览）」播放按钮预览。

**现象**：

- （A）预览能看到视频画面，但**听不到独立音频轨道合成进来的声音**；
- （B）播放时**实时拖动音频轨音量滑块，预览中的音量不随拖动变化**。

**期望**：组合播放时能**同时**听到视频轨与音频轨的声音；用户**实时**调整音频轨音量时，预览音量应**同步**变化。

---

## 2. 关键前置结论：第 1 轮根因已修复（避免重复定位）

第 1 轮诊断结论是「多轨合成预览中，独立音频轨对应的隐藏媒体元素自始至终没有被赋 `src`，导致对无源元素 `play()`，全程静音」。该修复（提交 `fdbd725 fix: route audio-track source url to el.src so timeline preview audio plays`）**已落地并存在于当前 `main`**，逐条复核如下（均为当前代码实测）：

| 修复点 | 当前代码证据 | 状态 |
|---|---|---|
| 装配阶段搬运 `url` | `src/components/video/hooks/useCompositionPlayback.ts:136-147`（`.map` 内含 `url: seq.url`，:145-146） | ✅ 已修 |
| `AudioSyncClip` 承载 `url` | `src/components/video/playback/AudioSyncPool.ts:33-43`（新增 `url?: string`） | ✅ 已修 |
| 池内 `play/seek` 前赋 `src`（归一化比对防 churn） | `AudioSyncPool.ts:274-313`（`_apply` 的 `seek`/`play` 走 `_ensureSrc`；`_ensureSrc` :309-313 用 `normalizeSrc` 比对，变化才 `el.src=`） | ✅ 已修 |
| `AudioElementLike` 增 `src` + 适配器透传 | `AudioSyncPool.ts:211-224`（接口含 `src`）、`MultiTrackPlaybackEngine.ts:643-669`（`toAudioElement` 的 `src` get/set 透传到底层 `<video>`） | ✅ 已修 |
| 实时音量链路 | `computeEffectiveVolume` + 每帧 `_apply` 写 `el.volume`（`AudioSyncPool.ts:134-140, 289/298`） | ✅ 已修 |

**单元测试佐证**：`npx vitest run src/components/video/playback/__tests__/AudioSyncPool.test.ts` → **26 passed**，其中含「assigns the active clip src before playing（核心修复）」「swaps src when the playhead crosses into a clip of a different file」「applies a live volume change to the playing element on the next tick（实时音量）」等（`AudioSyncPool.test.ts:318, 343, 375`）。

> 因此：**「无源 → 全程静音」这一根因不应再作为本轮根因重复提出。** 对「从 0 开始播放、音频 clip 自源 0 起」的基础用例，逐帧推演（见 §3.1）显示音频现在应能出声。本轮聚焦两件事：①「实时音量」这一**独立且当前确实存在**的缺陷（§3.A）；②修复后**仍可能让音频静音**的剩余健壮性缺口（§3.B），它们解释「为何用户重测仍可能听不到」。

---

## 3. 复现步骤（Reproduction steps）

前置：按 `CLAUDE.md` 启动前后端（`npm run dev` + 后端 `uvicorn ...`），或运行打包桌面端。**务必确认运行的构建包含提交 `fdbd725`**（见 §6「验证 0」——旧构建会重现已修复的全程静音，属误判）。

### 3.A 复现「实时音量不生效」（当前确定可复现）

1. 进入视频编辑，上传 1 个音频素材，拖到一条独立音频轨（可见、未锁、未静音）。
2. 点击「播放组合」开始播放，确认能听到该音频。
3. 打开该音频轨的音量滑块（轨道头部音量按钮 → `VolumeSlider` 弹层）。
4. **按住并缓慢拖动**滑块（不要松手），同时注意预览音量。
5. **观察**：拖动过程中预览音量**毫无变化**；只有**松开鼠标后**音量才一次性跳变到新值。
   - 这与「实时调整音量、预览同步变化」的期望不符。

### 3.B 复现/排查「修复后仍静音」（条件性，取决于运行环境与播放起点）

1. 上传带声音的视频 + 一个音频素材，分别加到视频轨与独立音频轨。
2. **把播放头移动到片段中部**（非 0 起点；或音频 clip 设了 `clipStart` 裁剪偏移），再点击播放。
3. **观察**：若音频元素在「冷加载 + 边加载边被逐帧改写 `currentTime`」的相互打断下迟迟无法进入稳定播放，则该音频轨听不到声音或断续。原因见 §3.B（缺少视频侧已具备的「在途 seek 守卫」与「autoplay 重试」）。

> 失败仍是「静默」的：无源/被打断的 `play()` 的 rejection 被 `.catch(() => undefined)` 吞掉（`AudioSyncPool.ts:315-325`），控制台通常无报错。

---

## 4. 根因分析（Root cause analysis）

### 3.A 实时音量缺陷：音量只在「松手」时提交，拖动过程中不入 store（当前确定存在）

预览音量的数据链是：滑块 → `track.volume`（timeline store）→ `useTimelineComposition` 重建 `compositionPlayback.audioSequences[].volume` → 引擎每帧读 `compositionRef.current` → `AudioSyncPool` 写 `el.volume`。这条链**后半段是通的**（§2 已验证，且签名含 `seq.volume`：`useTimelineComposition.ts:73`，音频段 :109-111）。问题出在**链路最前端**：

`VolumeSlider` 在**拖动过程中只更新组件本地状态**，**不写 store**；只有在**松手 / 结束**时才调用 `setTrackVolumeAction` 把音量提交到 store。

`src/components/video/timeline/VolumeSlider.tsx:109-112`（拖动只改本地）：

```ts
const updateVolume = useCallback((newVolume: number) => {
  localVolumeRef.current = newVolume;   // 仅本地
  setDisplayVolume(newVolume);          // 仅本地（弹层显示）
}, []);
```

`VolumeSlider.tsx:242-259`（鼠标：move 只 `updateVolume`，**仅 mouseup 才提交 store**）：

```ts
const handleMouseMove = (moveEvent: MouseEvent) => {
  const vol = calculateVolume(moveEvent.clientX);
  updateVolume(vol);                    // ← 拖动中：不写 store
};
const handleMouseUp = () => {
  isDraggingRef.current = false;
  if (trackId) {
    setTrackVolumeAction(() => useTimelineStore.getState(), trackId, localVolumeRef.current); // ← 仅松手提交
  }
  ...
};
```

触摸路径同理（`VolumeSlider.tsx:274-288`，仅 `handleTouchEnd` 提交）；键盘步进则是 300ms 防抖尾提交（`scheduleKeyCommit`，:131-144）。

**后果**：拖动期间 `track.volume` 不变 → `compositionPlayback.audioSequences` 不重建 → 引擎读到的仍是旧 `volume` → 预览 `el.volume` 不变。**只有松手后**音量才一次性更新。这与用户「**实时**调整、预览同步变化」的期望直接冲突——这是「实时音量」这半个诉求**当前确实未被满足**的根因，且**独立于** §2 的 src 修复（src 修好也不会让拖动期间实时生效）。

> 设计动机可理解（松手才提交是为「一次拖动 = 一条 undo」，避免每像素刷 undo 历史）。但「干净的 undo」与「预览实时跟手」并不矛盾：可在拖动中走一条**轻量 live 预览通道**（只驱动预览音量、不入 undo），松手时再落一条 undo（见 §5 方案）。

### 3.B 剩余静音风险：音频路径缺少视频路径已验证的两道健壮性保护

§2 证明音频**逻辑**已正确，但**单元测试用的是 fake 元素**（手动翻转 `paused` 的纯对象），无法覆盖真实 `<video>` 的「加载延迟 / readyState 演进 / autoplay 策略 / seek-边加载-边打断」等运行期行为。把音频路径与**已被验证可用的视频路径**逐条对比，发现两处**结构性不对称**，正是视频侧当年踩坑后补上、而音频侧至今缺失的保护：

#### 3.B-1 缺「在途 seek 守卫」（视频侧 方案 B 的对等保护）

视频侧 `VideoSourcePool._ensureSeeked` 明确规定：元素正在 seek 或尚未到达 `HAVE_CURRENT_DATA` 时，**不要再改写 `currentTime`**——否则自由运行的合成时钟每帧把 `currentTime` 往前拽，反复打断冷 seek，元素永远到不了可绘制态（这正是 `timeline-preview-midclip-play-black-screen` 的黑屏根因）。

`src/components/video/playback/VideoSourcePool.ts:377-391`：

```ts
private _ensureSeeked(el, targetSourceTime, srcJustSwapped): void {
  if (srcJustSwapped) { this._assignCurrentTime(el, targetSourceTime); return; }
  // 永不打断在途 / 缓冲中的 seek（方案 B）
  if (el.seeking === true || el.readyState < 2) return;     // ← 关键守卫
  if (Math.abs(el.currentTime - targetSourceTime) > this._seekTolerance) {
    this._assignCurrentTime(el, targetSourceTime);
  }
}
```

**音频侧没有任何等价守卫**：`AudioSyncPool` 每帧只要 `srcChanged || |current - target| > AUDIO_DRIFT_EPSILON_SEC(0.5)`（`AudioSyncPool.ts:194`、阈值 `constants.ts:82`）就发 `seek` 动作并写 `el.currentTime`，**完全不看元素是否还在 seek / 是否 readyState<2**。而且 `AudioElementLike` 接口**根本没有暴露 `readyState`/`seeking`**（`AudioSyncPool.ts:211-224` 只有 `src/currentTime/volume/paused/play/pause`），所以即使想守卫也**无字段可读**——这是该缺口在类型层的硬证据。

**触发条件与后果**：从**片段中部起播**或音频 clip 有 **`clipStart` 偏移**时，目标源时间较大；冷加载阶段真实 `<video>.currentTime` 回读 0，`|0 - target| > 0.5` 每帧成立 → 每帧改写 `currentTime` 去追一个移动目标，反复打断自身加载/seek → 元素迟迟无法进入稳定播放 → **该音频轨听不到声音或严重断续**。对「从 0 起播、clip 自源 0 起」的基础用例此缺口不触发（§3.1 推演音量正常出声），故表现为「时灵时不灵」，极易被误判为「没修好」。

#### 3.B-2 缺「autoplay 韧性」（muted 预热 + canplay 重试）

视频解码元素用「**先静音播放**（muted autoplay 任何策略都放行，保证解码出画）→ **确认播放后再恢复音轨**」绕过 autoplay 门，并在 `play()` 被拒时**监听 `canplay` 重试一次**：

`VideoSourcePool.ts:333-349`（muted 预热 + 确认后恢复音轨）、`:420-458`（`_kickPlay` / `_scheduleCanplayRetry` 的 canplay 重试）。

**音频侧不能静音**（静音即失去意义），其首次 `play()` 直接以非静音元素发起，且 `_ensurePlaying` 对 rejection **只吞不重试**：

`src/components/video/playback/AudioSyncPool.ts:315-325`：

```ts
private _ensurePlaying(el: AudioElementLike): void {
  if (!el.paused) return;
  const result = el.play();
  if (result && typeof (result as Promise<void>).catch === 'function') {
    (result as Promise<void>).catch(() => undefined);   // ← rejection 只吞，无 canplay 重试
  }
}
```

虽然「下一帧元素仍 paused → 自然重发 play」提供了某种隐式重试，但它与 §3.B-1 的「每帧改写 currentTime」叠加时会互相打断（每次 seek 又打断 play），可能形成「seek→打断 play→仍 paused→再 seek」的拉锯，使元素始终无法稳定出声。视频侧正是用「muted 预热 + 显式 canplay 重试 + 在途 seek 守卫」三件套打破这一拉锯，音频侧三件套**全缺**。

> 关于 autoplay 门本身：桌面端 Electron 默认 `autoplayPolicy: 'no-user-gesture-required'`（窗口 `webPreferences` 未改，`desktop/main/window.js:132-141`），浏览器端点击播放按钮构成 sticky activation，二者**通常都放行**非静音 `play()`。故 autoplay 拒绝**一般不是基础用例的主因**；但一旦发生（如非手势触发的程序化起播、或被 §3.B-1 的 seek 拉锯反复打断），音频侧**没有任何兜底**，直接静默。

### 3.1 基础用例逐帧推演（证明 src 修复后基础场景应出声，缩小 §3.B 触发面）

从 0 起播、音频 clip `startTime=0/clipStart=0`：

- Tick1（comp≈0）：el `src=''/currentTime=0/paused=true` → `srcChanged=true` → `seek`，`target=map(clip,0)=0`。`_apply`：`el.src=url`（开始加载），`el.currentTime=0`（无变化），`el.volume=1`，`play()`（paused→false）。
- Tick2（comp≈0.016）：`src` 归一化相等 → `srcChanged=false`；`|0-0.016|=0.016 < 0.5` → 不 seek；`paused=false` → `hold`，写 `el.volume=1`。`play()` 不被打断，加载完成即出声。✅

即基础用例不触发 §3.B 的拉锯，音量默认 100%（轨道默认 `clampVolume(100)`，`trackActions.ts:168`；`(item.volume??1)*(track.volume/100)=1`，`CompositionAdapter.ts:243-246`），有效音量 `computeEffectiveVolume(1,1)=1`，全音量出声。**故 §3.B 的静音只在「中部起播 / clipStart 偏移 / autoplay 被拒」等条件下显现。**

---

## 5. 影响面（Impact surface）

- **§3.A 实时音量**：影响**所有**音频轨（及视频轨）音量滑块的**拖动过程**——拖动期间预览不跟手，松手才更新。100% 复现，与素材无关。直接命中用户「实时调整音量、预览同步变化」的诉求。
- **§3.B 剩余静音**：影响**从片段中部起播 / 含 `clipStart` 裁剪偏移**的独立音频轨；以及任何首帧 `play()` 被 autoplay 拒绝的环境。表现为「有时听不到 / 断续」，难以稳定复现，易被误判为「上一轮没修好」。
- **不受影响**：
  - 「从 0 起播、clip 自源 0」的基础用例（§3.1，src 修复后已出声）；
  - 视频轨**自带**音频（走 `VideoSourcePool`，muted 预热 + 确认后 `el.muted=plan.muteAudio`，`VideoSourcePool.ts:340-349`）；
  - **导出**路径（走 ffmpeg filtergraph，不经 `AudioSyncPool`，不受本报告任何缺口影响）。
- **相关观察（非本诉求，列出供参考）**：`VideoSourcePool` 全程**只设 `el.muted`、从不设 `el.volume`**，故视频轨的**逐项音量**（item.volume × track.volume）在**预览**里其实未被施加（仅静音/非静音）；导出仍按音量混音。与「音频轨听不到」无关，属另一保真度议题。

---

## 6. 候选修复方案（Candidate fixes）

> 拆成两组：实时音量（§3.A，必做、确定缺陷）与剩余静音健壮性（§3.B，按需补齐）。

### 6.A 实时音量（解决 §3.A）

| 方案 | 做法 | 侵入性 | 风险 | undo 干净度 | 实时性 |
|---|---|---|---|---|---|
| **A1（推荐）拖动中走 live 预览通道，松手落 undo** | 拖动 `handleMouseMove`/`handleTouchMove`/键盘步进时，**额外**把当前音量喂给一条**只驱动预览、不入历史**的轻量通道（如 `setTrackVolumeAction` 的 `{ history:false }` 变体，或单独的 `previewTrackVolume` 通路驱动引擎）；松手/结束时按现状落**一条** undo。 | 中（仅 `VolumeSlider` + store 一个 no-history setter） | 低 | ✅ 仍一次拖动一条 undo | ✅ 跟手 |
| **A2 拖动中直接每次 `setTrackVolumeAction`** | move 里直接提交 store | 低 | 中（每像素一条 undo，污染历史；高频 setState 抖动） | ❌ | ✅ |
| **A3 不改交互，仅文档说明「松手生效」** | 不改代码 | 无 | —— | —— | ❌ 不满足「实时」 |

### 6.B 剩余静音健壮性（解决 §3.B，使音频路径与视频路径对称）

| 方案 | 做法 | 侵入性 | 风险 | 正确性 |
|---|---|---|---|---|
| **B1（推荐）补齐「在途 seek 守卫 + autoplay 重试」** | ① `AudioElementLike` 增 `readonly readyState?` / `readonly seeking?`，`toAudioElement` 透传；② `AudioSyncPool` 在改写 `currentTime` 前加 `if (el.seeking || el.readyState<2) return;`（src 刚换的首 seek 例外，对齐视频侧 `_ensureSeeked`）；③ `_ensurePlaying` 在真实 EventTarget 上做一次 `canplay` 重试（镜像 `_scheduleCanplayRetry`）。 | 中（集中在 `AudioSyncPool` + 适配器 + 测试） | 低（照搬已验证的视频侧模式） | ✅ 中部起播/偏移均稳定 |
| **B2 仅加在途 seek 守卫** | 只做 B1 的 ①②，不加 canplay 重试 | 低–中 | 低 | 多数场景可解；autoplay 被拒场景仍可能哑 |
| **B3 新建独立 `AudioSourcePool`（完全镜像 VideoSourcePool）** | 新池专管 src-swap+seek+play+autoplay | 高 | 中 | ✅ 但架构改动超出必要 |

---

## 7. 推荐方案（Recommended fix）

**推荐 = 6.A 的 A1 + 6.B 的 B1，两者并做（分别对应用户两半诉求）。**

**理由：**

1. **A1 精准命中「实时音量」诉求且不牺牲 undo**：§3.A 证明拖动期间音量根本没进 store 是预览不跟手的唯一原因；A1 在拖动中额外驱动一条 no-history 预览通道即可跟手，松手仍落单条 undo，破坏面最小（只动 `VolumeSlider` + 一个 store no-history setter）。A2 会污染 undo 历史并引发高频 setState 抖动（与 `REACT_PLAYHEAD_THROTTLE_MS` 同源的性能坑），否决；A3 不满足「实时」，否决。
2. **B1 是修复后「仍静音」的对症解，且为已验证模式的对称补全**：§3.B 的两道缺口都是视频侧**踩坑后已修、音频侧至今缺失**的保护（`VideoSourcePool.ts:387` 在途 seek 守卫、:420-458 canplay 重试）。B1 直接镜像这两段成熟代码，使「中部起播 / clipStart 偏移 / autoplay 被拒」不再让音频静默。B3 为同等效果新建整池，过度工程，否决；B2 可作为最小子集，但留 autoplay 被拒的尾巴。
3. **两者正交、可独立验证**：A1 解决「拖动不跟手」，B1 解决「条件性静音」；互不依赖，便于 Subtask #2 分别落地、Subtask #3 分别回归。
4. **不动导出、不动视频/字幕/图片路径**：改动收敛在 `VolumeSlider` + store no-history setter（A1）与 `AudioSyncPool` + 适配器（B1），回归面低。

**交给 Subtask #2 的落地清单：**

- **A1**：在 store 增一个 `setTrackVolume` 的 **no-history** 变体（或 `previewVolume` 通路）；`VolumeSlider` 的 `handleMouseMove`/`handleTouchMove`/键盘步进在 `updateVolume` 后**追加**调用该 no-history 通路；`handleMouseUp`/`handleTouchEnd`/`flushPendingKeyCommit` 维持现状落**一条** undo。补测试：拖动中预览音量随 `displayVolume` 同步、松手只产生一条 history。
- **B1**：`AudioElementLike` 增 `readonly readyState?: number` / `readonly seeking?: boolean`；`toAudioElement`（`MultiTrackPlaybackEngine.ts:643-669`）透传二者；`AudioSyncPool._apply` 改写 `el.currentTime` 前加在途 seek 守卫（src 刚换例外）；`_ensurePlaying` 在真实 EventTarget 上做一次 `canplay` 重试。补测试：`seeking===true`/`readyState<2` 时不改 `currentTime`；中部起播能稳定进入播放；保留现有 26 条用例全绿。
- **验证 0（先做）**：确认用户实际运行的构建**包含 `fdbd725`**（重建桌面端 / 硬刷新前端）。若仍全程静音且非中部起播，应先排除「运行旧产物」这一最廉价误判。

---

## 8. 证据索引（关键 file:line）

- 第 1 轮修复已落地：`useCompositionPlayback.ts:136-147`（搬运 url）、`AudioSyncPool.ts:33-43, 274-313, 211-224`（src 赋值/接口）、`MultiTrackPlaybackEngine.ts:643-669`（适配器透传）；测试 `AudioSyncPool.test.ts:318, 343, 375`（26 passed）。
- §3.A 实时音量缺陷：`VolumeSlider.tsx:109-112`（拖动只改本地）、`:242-259`（鼠标仅 mouseup 提交）、`:274-288`（触摸仅 touchend 提交）、`:131-144`（键盘 300ms 尾提交）。
- 音量后半段链路通：`useTimelineComposition.ts:73, 109-111`（签名含 volume）、`CompositionAdapter.ts:243-246`（折算 track.volume/100）、`AudioSyncPool.ts:134-140, 289/298`（每帧写 el.volume）。
- §3.B-1 在途 seek 守卫缺失：视频侧 `VideoSourcePool.ts:377-391`（:387 守卫）；音频侧 `AudioSyncPool.ts:194`（每帧 seek 判据，无守卫）、`:211-224`（接口无 readyState/seeking）、阈值 `constants.ts:82`。
- §3.B-2 autoplay 韧性缺失：视频侧 `VideoSourcePool.ts:333-349, 420-458`；音频侧 `AudioSyncPool.ts:315-325`（只吞不重试）。
- autoplay 默认放行：`desktop/main/window.js:132-141`（未设 autoplayPolicy → Electron 默认 no-user-gesture-required）。
- 轨道默认音量：`trackActions.ts:168`（`clampVolume(100)`）、`Volume.ts:49-57`（百分比/100）。
- 唯一且激活的预览路径：`VideoPlayerPanel.tsx:151-166`（`enabled: true`）；引擎每帧 `MultiTrackPlaybackEngine.ts:348` tick 音频池。

---

## 评审结论（Review Verdict）

> 评审人：Subtask #1（资深评审）。已逐条复核 §2/§3/§6 的全部 file:line 引用并实跑测试，结论：**证据链整体成立，根因与推荐方案方向正确**；本节补全两处缺失证据、修正一处推荐方案的范围与一处落地隐患，给出**单一最终推荐修复**。

### A. 证据复核结果（逐条核对，均为当前代码实测）

| 报告论点 | 复核结论 | 复核证据（本轮新核 / 修正） |
|---|---|---|
| 第 1 轮 src 根因已修、26 测试绿 | ✅ 成立 | 本轮实跑 `npx vitest run …/AudioSyncPool.test.ts` → **26 passed**；`AudioSyncPool.test.ts:318/343/375` 三条核心用例名与报告一致 |
| §3.A 拖动只改本地、仅松手提交 | ✅ 成立 | `VolumeSlider.tsx:109-112`（`updateVolume` 仅写 ref+state）、`:242-259`（`handleMouseMove`→`updateVolume`；`handleMouseUp`→`setTrackVolumeAction`）、`:274-288`（触摸同构）逐字符吻合 |
| §3.A 音量后半段链路反应式（关键） | ✅ 成立，**证据加固** | 报告仅举到「引擎每帧读」。本轮补链：`useCompositionPlayback.ts:311`（`compositionRef.current = compositionPlayback` **每次 render 重赋**）→ `:358-359`（`getAudioSyncGroups` 读 `compositionRef.current.audioSequences`，非快照）→ `MultiTrackPlaybackEngine.ts:348`（每 tick 调 `getAudioSyncGroups()`）。即 `track.volume` 变化必经 `useTimelineComposition` 签名（`:75` 含 `seq.volume`）→ rebuild → ref 重赋 → 下一帧生效。**故拖动期间不出声的唯一阻塞确为前端 `VolumeSlider` 不提交 store**，根因排他性成立 |
| §3.B-1 视频有守卫 / 音频无守卫且接口无字段 | ✅ 成立 | `VideoSourcePool.ts:387`（`if (el.seeking===true \|\| el.readyState<2) return;`）；`AudioSyncPool.ts:194`（每帧 `srcChanged\|\|drift>0.5` 即 seek，无守卫）、`:211-224`（`AudioElementLike` 仅 src/currentTime/volume/paused/play/pause）、适配器 `MultiTrackPlaybackEngine.ts:643-669` 亦**未透传** readyState/seeking |
| §3.B-2 视频有 muted 预热+canplay 重试 / 音频只吞 | ✅ 成立 | `VideoSourcePool.ts:333-349, 420-458`；`AudioSyncPool.ts:315-325`（`.catch(()=>undefined)`，无重试） |
| autoplay 默认放行 | ✅ 成立 | `desktop/main/window.js:132-141` 未设 `autoplayPolicy` |

**新增已排除的替代根因（reviewer goal #1）**：「独立音频轨没有挂载媒体元素 → 池拿到 null → 全程静音」**不成立**。`PreviewCanvas.tsx:163-172` 的 `resolveAudioElement` 对每条音频轨**懒创建并缓存**一个隐藏 `<audio>/<video>`（`audioPoolRef`），底层元素跨 tick 稳定存在。故「从 0 起播仍全程静音」只可能源于**运行了不含 `fdbd725` 的旧构建**（= 报告「验证 0」），而非新的代码缺口。**这把「验证 0」从一句提醒升格为「排他性结论」：基础用例若仍全静音，先判旧构建，不要在代码里再找 src 类根因。**

> 引用行号微漂（不影响结论，供 Subtask #2 对位）：`useTimelineComposition.ts` 的 `seq.volume` 实为 **:75**（报告记 :73）；`trackActions.ts` 的 `clampVolume(100)` 实为 **:167**（报告记 :168）；`CompositionAdapter.ts` 全路径为 `src/components/video/timeline/infrastructure/CompositionAdapter.ts`（行号 243-246 准确）。

### B. 候选方案审计（边界 / 最小化 / 回归）

**1) §3.A 与 §3.B 的置信度不对等，须在交付时分级**
- §3.A：**已确证、100% 可复现、直命用户第②诉求**（实时音量）。必做。
- §3.B：**结构性缺口属实，但「确会致哑」仅为推断，无捕获到的复现/日志**，且只在「中部起播 / `clipStart` 偏移 / autoplay 被拒」条件下显现。属**对齐视频侧的防御性加固**，价值真实但优先级低于 §3.A。

**2) A1 的两点边界（不改变推荐，但 Subtask #2 必须处理）**
- **高频重建**：A1 的 no-history 通道若仍写 `track.volume`（只是跳过 `recordAction`），则**每次 `mousemove` 都触发 `useTimelineComposition` 全量签名重算 + 组合体 rebuild**（签名遍历所有视/音/字幕序列）。`mousemove` 可达 ~60–120Hz，需用 **rAF / 节流**收敛（报告自己提到的 `REACT_PLAYHEAD_THROTTLE_MS` 同源坑），否则在多片段时间线上引入卡顿——这是 A1 相对 A2 **仍残留**的性能面，报告把抖动只记在 A2 名下，需补记。
- **无反馈环**：`VolumeSlider.tsx:55-61` 的「非拖动才从 store 同步 `displayVolume`」守卫，已天然阻断拖动期 store 回灌与本地显示打架，A1 可安全复用，无需额外处理。
- **100–200% 增益的预览天花板（非缺陷，须写入已知限制）**：`HTMLMediaElement.volume` 受规范钳制在 **[0,1]**，`AudioSyncPool.clampVolume` 同样钳到 1.0。故拖动到 100% 以上时，**预览响度无法再增大**（与视频轨现状一致）。这是浏览器硬限制、非 A1 缺陷；用户「实时调音量」诉求在 **[0,100%]** 区间被 A1 完整满足，>100% 全部映射到 1.0。Subtask #2 不应为「>100% 不变大」误判 A1 未修好（真要支持增益须上 WebAudio GainNode，超出本诉求范围）。

**3) B1 必须拆为「守卫(①②)」与「canplay 重试(③)」，二者价值/风险显著不同**
- **①② 在途 seek 守卫 —— 高价值、低风险、推荐采纳**。但有一处**会引入新回归**的实现细节须钉死：守卫 `if (el.seeking||el.readyState<2) return;` **必须保留 `srcJustSwapped` 例外**（对齐 `VideoSourcePool._ensureSeeked` `:382-385`）。当前 `_apply` 并未把「本 tick 是否刚换 src」传出 `_ensureSrc`，Subtask #2 须像视频侧 `plan.needsSrcSwap` 一样**把 `srcJustSwapped` 信号线程出来**；否则 src 刚换、`readyState<2` 时初始 seek 被守卫挡掉，**中部起播的 clip 会从源 0 播放（音画错位）**——把「静音」换成「错位」，是更隐蔽的回归。另：接口用**可选** `readonly readyState?` / `readonly seeking?`，对现有 26 个 fake（无此字段）`undefined<2 === false`，守卫不误触发，旧用例保持绿。
- **③ canplay 重试 —— 本工程内价值低、且有 listener 泄漏隐患，建议降级为「按需」**：
  - **价值低**：一旦 ①② 止住「每帧改写 currentTime」的 churn，`play()` 不再被 seek 反复打断；而 Electron（`no-user-gesture-required`）与浏览器（点击播放=sticky activation）**通常都放行非静音 play**；即便偶发 transient 拒绝，`_ensurePlaying` 现有的「下一帧仍 paused→再发 play」本就是**每帧隐式重试**，已覆盖。显式 canplay 重试在此仅多抢约 16ms，边际收益极小。
  - **有泄漏隐患**：`toAudioElement(el)` 在**每次 `_resolve` 调用都新建一个包装对象**（`MultiTrackPlaybackEngine.ts:197`，且 `tick` 读 + 每个 `_apply` 各调一次）。若照搬视频侧把去重标志 `__ecliptrixPlayKick` 挂在**包装对象**上，标志每 tick 即丢 → 每次 play 拒绝都 `addEventListener('canplay')` → **监听器堆叠泄漏**。如确需 ③，监听器与去重标志**必须挂到底层稳定元素**（`audioPoolRef` 缓存的真实 `<audio>/<video>`，`PreviewCanvas.tsx:167-171`），不能挂包装层。

### C. 最终推荐修复（单一方案）

**推荐 = A1（节流版）+ B1 的①②在途 seek 守卫；B1 的③canplay 重试降级为「条件性、按需」。前置「验证 0」。**

1. **A1（必做，命中用户第②诉求）**：在 store 增 `setTrackVolume` 的 **no-history** 变体；`VolumeSlider` 的 `handleMouseMove`/`handleTouchMove`/键盘步进在 `updateVolume` 后**追加**调用该 no-history 通路，并以 **rAF/节流**收敛写入频率；`handleMouseUp`/`handleTouchEnd`/`flushPendingKeyCommit` 维持现状落**一条** undo。补测：拖动中预览音量随 `displayVolume` 同步、松手仅产生一条 history。**理由**：§A 已证实「拖动不入 store」是预览不跟手的**排他**根因，且后半段链路反应式（`useCompositionPlayback.ts:311/358-359` + 引擎 `:348`）已通，A1 复用整条反应式回路、仅跳过 undo 记录，破坏面最小。

2. **B1①②（推荐，对齐视频侧的对症加固）**：`AudioElementLike` 增可选 `readonly readyState?` / `readonly seeking?`；`toAudioElement`（`:643-669`）从底层真实元素透传二者；`AudioSyncPool._apply` 在改写 `currentTime` 前加在途 seek 守卫，**保留 `srcJustSwapped` 例外**。补测：`seeking===true`/`readyState<2` 时不改 `currentTime`；src 刚换时初始 seek 仍落地；现有 26 用例全绿。**理由**：这是「中部起播/`clipStart` 偏移」条件性致哑的对症解，直接镜像已验证的 `VideoSourcePool.ts:387`，风险低。

3. **B1③（条件性、按需，不默认做）**：仅当 ①② 落地后实测仍出现「autoplay 被拒导致的静音」时再加；且监听器/去重标志**必挂底层稳定元素**。**理由**：见 §B-3，本工程内收益低、隐患高，默认不做以保持最小改动面。

4. **验证 0（前置，最廉价排错）**：确认用户实际运行的构建**包含 `fdbd725`**。结合本轮新证（`resolveAudioElement` 必有元素），**基础「从 0 起播仍全程静音」即等价于「跑了旧产物」**，不应据此在代码内再找 src 类根因。

**与原报告的差异（小结）**：完全采纳 A1，但**追加 rAF 节流要求**并**澄清 100–200% 预览天花板为浏览器硬限制（非缺陷）**；完全采纳 B1 的**守卫①②**并**钉死 `srcJustSwapped` 例外以防错位回归**；将 B1 的**canplay 重试③降级为按需**并**指出包装对象重建导致的 listener 泄漏隐患**；把「验证 0」由提醒**升格为排他性结论**。据此，§3.A 与 §3.B 仍正交、可独立落地与回归。
