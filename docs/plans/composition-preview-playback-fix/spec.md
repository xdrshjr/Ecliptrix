# 组合预览播放无画面修复方案（Composition Preview Playback Fix）

- **Feature slug**: `composition-preview-playback-fix`
- **文档版本**: **v2**（评审节点已完成逐节评审与就地修复；详见下方「评审记录」与文末「评审结论」）
- **作者**: 方案设计节点（solution architect）
- **评审**: 方案评审节点（senior reviewer）——已对照真实代码核验全部 file:line 锚点，修复全部 P0/P1
- **关联需求**: 大规模本地化重构后，用户上传视频并加入下方轨道，点击「播放组合」面板的播放按钮时，预览显示区不渲染实时画面。
- **关联历史**: `docs/plans/local-video-editing-refactor/`（Phase 2 统一预览合成器，删 v1 player）、`docs/plans/timeline-material-preview-fix/spec.md`（旧快照过期黑屏）、`docs/plans/video-reentry-play-no-source-fix/spec.md`（RC-B「比对键==赋值」）。

---

## 评审记录（Review Notes，v2）

> 评审方法：逐节对照 `feat/local-video-editing-refactor` 分支**真实代码**核验，而非仅读文档。结论：方案的「数据/URL/就绪门/序列提取链路成立、断点收敛于 v2 合成器运行期、采用纵深防御 + 诊断浮层」整体方向**正确且工程上稳妥**；但**首要根因 H1 的关键前提被代码证伪**，且文件清单存在两处会误导落地节点的路径/归属错误，监听器方案与现有测试桩不兼容。以下逐条列出，P0/P1 已在 v2 正文就地修复。

### 已核验为准确的锚点（无需改动）
- `VideoSourcePool.ts`：`el.muted = plan.muteAudio`（:311）、`muteAudio = audioDetached===true`（:181）、`_ensurePlaying` 吞掉 `play()` rejection（:355-362）、逐帧 `_ensureSeeked`（:331-346）—— 与 §3/§4 描述一致。
- `CanvasCompositor.ts`：`_drawVideoLayer` 在 `source.readyState < 2` 时 `return false` 不绘制（:258）—— §3/§4 据此成立。
- `MultiTrackPlaybackEngine.ts`：attach 末尾 `_renderAt(getCurrentTime(), false)` 画首帧（:136）、`_onTick → _renderAt(comp, true)`（:233-262）。
- `useCompositionPlayback.ts`：attach effect（:350-395）、prop-driven 播放 effect（:418-427）。
- `PreviewCanvas.tsx`：隐藏 1×1 解码元素（:37-45）、`createHiddenVideo` 初值 `muted=true`（:109-121）、`PreviewCanvasHandle`（:59-75）、ResizeObserver 尺寸同步（:192-215）。
- `useCompositionTransport.ts`：`computeMediaReadiness`（:49-91）、`gatePlay`（:178-182）。
- `selectPlaybackUrl.ts`：`toAbsolutePlaybackUrl` 用 `window.location.origin`（:71-82，且对 `http(s)://` 原样透传）。

### 问题清单

| # | 维度 | 严重度 | 问题 | 处置 |
|---|---|---|---|---|
| R-1 | 可行性/根因正确性 | **P1** | **H1「内嵌 webview 默认 autoplayPolicy 拒绝非静音自动播放」的前提与本项目实际配置矛盾**：`desktop/main/window.js` 用 `win.loadURL(http://127.0.0.1:PORT)` 创建 BrowserWindow，`webPreferences` **未设 `autoplayPolicy`**；`desktop/main/index.js` 亦**无 `app.commandLine.appendSwitch('autoplay-policy', …)`**。Electron 默认 `autoplayPolicy='no-user-gesture-required'`，即**允许**非静音自动播放；叠加用户点击「播放」已授予 sticky activation。故 `el.play()` 大概率**成功**，H1 的「play 被拒→逐帧 seek 抖动→黑屏」链条在本环境难以成立，将其列为「最可能根因」属**过度自信**，可能误导落地节点在仅做「静音优先」后即收工。 | 已修复：§4 将 H1 从「最可能」降为「与 H6 并列、待诊断浮层证据裁决」；新增 **H6=源加载失败/`readyState` 长期为 0**（play 成功时最可能的黑屏成因）作并列假设并给探针；§5 将**诊断浮层（§5.4）提升为强制「第一步」**，必须先用它定位真正失效字段再判定哪个修复是承重项。静音优先仍作低风险加固保留。 |
| R-2 | 一致性/可行性 | **P1** | **§6 文件清单路径错误**：列为 `src/lib/selectPlaybackUrl.ts`，实际为 `src/components/video/lib/selectPlaybackUrl.ts`（`src/lib/` 下无此文件）。同理 `localMaterial.ts`、`resolveSequencePlaybackUrl.ts` 真实根为 `src/components/video/lib/`。落地节点照此会找不到文件或新建错位文件。 | 已修复：§6 表与 §5.5/§8 路径更正为 `src/components/video/lib/…`；§3/§5/§7/§8 的短写模块路径（`lib/…`、`playback/…`）统一加注「仓库根为 `src/components/video/…`」。 |
| R-3 | 一致性 | **P1** | **§6 把 `TrackSourcePlan` 归到 `types.ts`**，但该接口实际定义在 `VideoSourcePool.ts:89-115`（`types.ts` 无此类型）。且 §8 默认决策为「不新增字段、用 `_apply` 局部状态机」，则该行多半**无需任何改动**。 | 已修复：§6 该行更正归属为 `VideoSourcePool.ts`，并标注为「条件性、默认无需改动」。 |
| R-4 | 可行性 | **P1** | **§5.2/§7 提议在 `VideoSourcePool._apply` 内为元素绑定 `playing`/`canplay`/`loadeddata` 监听**，但 `VideoElementLike` 是结构化接口、**无 `addEventListener`**，现有 applier 测试桩是无 `addEventListener` 的纯对象——在 `_apply` 里绑定监听会让**现有整套测试抛错**。此外，在 `playing` 闭包里按**捕获时**的 `plan` 恢复静音，跨「轨道切换到分离 clip」会**用旧 plan 误恢复内嵌音频**（陈旧闭包 bug）。 | 已修复：§5.1/§5.2/§7/§8 改为**优先用按帧轮询 `el.paused` 的状态机**在 `_apply` 内做「playing 后恢复音频路由」（测试桩已暴露 `paused`，只需给 `VideoElementLike` 增 `paused?: boolean`），彻底规避监听器生命周期与陈旧闭包；仅 `play()` 被拒后的**一次性 `canplay` 重试**用监听，且统一加 `typeof el.addEventListener === 'function'` 守卫 + `__ecliptrixPlayKick` 去重，确保纯对象桩不被破坏。 |
| R-5 | 完整性/可行性 | **P1** | **§5.3 就绪重绘**在引擎侧绑定 `loadeddata/seeked/canplay` 同样依赖元素为真实 `EventTarget`，且引擎对解码元素是**懒解析**（`resolveTrackElements` 每帧取），需在「首次解析到元素」处捕获并去重绑定、`dispose` 时解绑；文档未点明守卫与解绑，存在落地即崩或泄漏监听的风险。 | 已修复：§5.3/§7 补充 `addEventListener` 守卫、首解析去重打标、`dispose` 解绑三项硬约束，并明确「仅非播放态触发一次 `_renderAt`」。 |
| R-6 | 右尺寸 | **P2** | **§5.1 备选 / R2 回退**（解码元素永久静音 + 内嵌音频改走 `AudioSyncPool`）比文档暗示的「翻一下」重得多：`buildAudioSyncGroups`（已核验）只从 `audioSequences` 建组，要让**非分离视频轨的内嵌音频**走音频池，等于对同一文件**二次解码**（双重网络/解码开销 + A/V 失步风险）。 | 已就地标注：§5.1 备选与 §10 R2 注明其为「非平凡子工程，仅作最后手段」。 |
| R-7 | 完整性 | **P2** | **H3（`file://` origin 致绝对化失败）实可被证伪而非仅「条件性」**：`desktop/main/window.js`/`index.js` 明确以 `http://127.0.0.1:PORT` 承载前端，`toAbsolutePlaybackUrl` 对此产出合法绝对 URL。 | 已就地强化：§4 H3 标注「经 desktop 主进程代码确认 origin 为 http://127.0.0.1，几乎可排除」，§5.5 维持「默认不实施」。 |

### 不阻断、供落地节点注意（非缺陷）
- 诊断浮层须可被生产构建摇树/默认关闭（§5.4 已默认关闭，R5 风险已覆盖）。
- §9.1 新增的 `retry_on_canplay`/`rejects_unmuted_autoplay…` 用例需要带 `addEventListener`/`dispatchEvent` 的增强桩；现有纯对象桩仅用于不涉监听的路径，二者并存即可。

---

## 1. Overview（概述）

本项目最近完成了「本地桌面端视频剪辑」大规模重构（分支 `feat/local-video-editing-refactor`）。其中 Phase 2 把视频编辑器的预览路径从 v1 的**可见 `<video>` 播放器**整体替换为 v2 的**多轨 Canvas 合成器**：`PreviewCanvas`（宿主）+ `useCompositionPlayback`（编排 Hook）驱动 `MultiTrackPlaybackEngine`，后者每帧通过 `VideoSourcePool` 把每条可见视频轨的活动 clip 解析到一组**隐藏的解码 `<video>` 元素**上，再用 `CanvasCompositor.renderFrame` 把这些解码源 + 字幕/图片叠加合成到一张用户可见的 `<canvas>` 上。v1 player 与 `isPlaybackV2Enabled()` 特性开关均已删除，新合成器是**唯一**预览路径，没有回退。

问题现象：用户上传本地视频 → 加入下方轨道 → 点击组合预览面板的播放按钮 → 画面区域不显示任何实时预览（黑屏/空白）。本方案的目标是**定位根因并给出可逐行落地的修复设计**。经过对完整数据链路的审读（见 §3），数据层（素材形态、URL 解析、就绪门、序列提取、签名刷新、同源静态服务）全部成立；断点收敛在 **v2 合成器的运行期行为**——这是整个重构中唯一从未被真实环境验证过的面（Phase 2 摘要明确写明 canvas/音频运行行为无法用 jsdom 验证、v1 safe-mode 已删，「用户桌面走查」是强制门但尚未清账）。

本方案据此给出一个**差分诊断**（§4）与一套**纵深防御式修复**（§5）。原稿曾以「隐藏解码 `<video>` 因非静音自动播放策略无法进入原生 `playing`、退化为逐帧 seek 抖动、`readyState` 不足以 `drawImage`」为**首要根因（H1）**；**v2 评审已将 H1 降为与新增 H6（源加载失败 / `readyState` 长期为 0）并列的待证候选**——因为 H1 的自动播放前提被本项目 Electron 配置证伪（`desktop/main/*.js`：`http://127.0.0.1` 源 + 无 `autoplayPolicy` 覆盖；详见 §4）。修复仍采纵深防御：H1 侧「静音优先」作零风险加固、「就绪事件驱动重绘（H2/H6）」、「同源 URL 绝对化回退（H3，附条件）」与**升为落地第一步的运行期诊断浮层**——使得无论真实根因落在 H1/H2/H6/H3 中的哪一个都能定位并修复，并由浮层在桌面端一次性确认承重项。

---

## 2. 背景与「为什么会坏」

- **v1（已删）**：预览是一个真实可见的 `<video controls>`，浏览器原生渲染画面，自动播放/静音逻辑由原生元素与用户手势直接承担。
- **v2（现状）**：预览是一张 `<canvas>`，画面来自**离屏隐藏**的解码 `<video>`（`width:1; height:1; opacity:0; left:-9999`，见 `PreviewCanvas.tsx:36-45`、`createHiddenVideo` 于 `PreviewCanvas.tsx:109-121`）。Canvas 只有在合成器「每帧 `drawImage(解码video)`」时才有画面，而 `drawImage` 要求该解码 `<video>` 的 `readyState >= 2`（`CanvasCompositor._drawVideoLayer`，`CanvasCompositor.ts:252-280`）。
- **关键差异**：v2 的画面**强依赖**隐藏 `<video>` 真正进入并维持「解码/播放」状态。一旦该隐藏元素无法进入原生 `playing`，canvas 就只剩 letterbox 黑底。
- **测试盲区**：所有 v2 单测跑在 jsdom 下——jsdom **没有**真实的 `<video>` 解码、`readyState` 跃迁、自动播放策略、rAF 真实绘制。因此「隐藏 video 是否真的会播/解码/被 `drawImage`」这一面在合并前**从未被验证**。这正是缺陷得以潜伏到桌面运行期的结构性原因。

---

## 3. 预览管线全链路（操作时序，带 file:line 锚点）

> 下游开发/评审节点应以本节为导航图。所有锚点基于当前 `feat/local-video-editing-refactor` 分支。

1. **上传**：`useMaterialUpload.uploadSingleFile`（`materialManagement/useMaterialUpload.ts:48-150`）POST `/api/storage/upload-video`，用 `createLocalMaterialFromUpload`（`lib/localMaterial.ts:99-147`）生成本地素材：`url = /api/storage/files/video/...`、`metadata.storageKind='local'`、`isLocalFile=true`、`localResolvedUrl`、`serverUrl`、`cacheUrl` 同值、`storageKey` 写入。
2. **加入轨道**：时间轴 item 写入 `materialId/trackId/startTime/duration/clipStart/clipEnd`。父级 `VideoEditingInterface` 把时间轴变化经 `onTimelineCompositionChange → timelineComposition.handleTimelineStateChange`（`VideoEditingInterface.tsx:2668`）下发。
3. **序列提取**：`CompositionAdapter.extractVideoSequences`（`timeline/infrastructure/CompositionAdapter.ts:116-191`）产出 `VideoSequenceItem`，带 `materialId/trackId/url(本地)/clipStart/clipEnd/trackZ/opacity/transition...`。
4. **签名刷新**：`useTimelineComposition`（`hooks/useTimelineComposition.ts`）用 `computeCompositionSignature`（含 `materialPlaybackFields`，`:18-32`）做变化检测；并在 `materials` 变化时以 `lastTimelineStateRef` 重建（`:252-256`）。**旧的「占位→完成」URL 翻转黑屏（RC-1）已在此修复**——本次缺陷不是它。
5. **面板编排**：`VideoPlayerPanel`（`components/VideoPlayerPanel/VideoPlayerPanel.tsx`）调用 `useCompositionPlayback`（`:151-166`，`enabled:true` 恒定）与 `useCompositionTransport`（`:186-206`）。`playbackMode` 在 `videoSequences.length>0` 时为 `'composition'`，此时挂载 `<PreviewCanvas ref={compositionPreview.hostRef} />`（`:441-450`）。
6. **就绪门**：`computeMediaReadiness`（`useCompositionTransport.ts:49-91`）。本地上传素材 `canPreviewDirectLocalMaterial=true`（`localMaterial.ts:78-83`）→ `ready`，门打开。点击播放走 `handlePlayPauseClick → gatePlay()`（`useCompositionTransport.ts:178-197`），通过后 `setIsCompositionPlaying(true)`。
7. **引擎生命周期**：`useCompositionPlayback` 的 attach effect（`hooks/useCompositionPlayback.ts:350-395`）在宿主句柄就绪（`hostVersion` 自增）时 `new MultiTrackPlaybackEngine()` 并 `engine.attach(deps)`；attach 内 `_renderAt(getCurrentTime(), false)` 画首帧（`MultiTrackPlaybackEngine.ts:117-137`）。prop-driven 播放 effect（`:418-427`）在 `isPlaying` 翻转时 `engine.play()`。
8. **时钟与每帧**：`PlaybackClock`（rAF，`playback/PlaybackClock.ts`）→ `engine._onTick → _renderAt(comp,true)`（`MultiTrackPlaybackEngine.ts:233-262`）：
   - `VideoSourcePool.sync`（`playback/VideoSourcePool.ts:257-324`）：`computeSourcePlan` 找活动 clip（`TrackScheduler.activeClipAt`），`resolveSource(seq)` 解析 URL；首次 `needsSrcSwap=true → el.src=desiredUrl`；`el.muted = plan.muteAudio`（非分离=false→**取消静音**，`VideoSourcePool.ts:308-311`）；`_ensureSeeked`；`isPlaying → _ensurePlaying(el)=el.play()`（`:355-362`，**rejection 被吞**）。
   - `assembleLayers` → `CanvasCompositor.renderFrame`（`CanvasCompositor.ts:189-214`）：`_drawVideoLayer` 当 `source.readyState < 2` **返回 false 不画**（`:258`）。
   - `AudioSyncPool.tick`：仅独立音频轨。
9. **URL 可达性**：`resolveSequencePlaybackUrl`（`lib/resolveSequencePlaybackUrl.ts:88-205`）对本地素材取 `localResolvedUrl` → `toAbsolutePlaybackUrl`（`lib/selectPlaybackUrl.ts:71-82`，用 `window.location.origin` 绝对化）。同源 `/api/storage/files/...` 由 BFF `src/app/api/storage/files/[...path]/route.ts` 转发，**支持 Range + cookie**（视频 seek 必需）。

**结论**：第 1–6、9 步均成立。断点在第 7–8 步的**运行期行为**：隐藏解码 `<video>` 是否真正进入并维持 `readyState>=2` 的播放态。

---

## 4. 差分诊断（候选假设；v2 评审后 H1 与 H6 并列为首要待证项）

> 每条给出：证据 / 运行期探针 / 判定。**v2 评审重要更新**：原稿把 H1 列为「最可能」，但其自动播放前提经 `desktop/main/*.js` 证伪（见 H1 评审证伪与新增 H6）；现 H1 与 H6 并列、由 §5.4 诊断浮层在桌面端用实测字段裁决真正承重根因。下游节点必须据「探针」在桌面端逐条证伪，**不可**仅凭文字排序定论。

### H1（原列「首要根因」，v2 降为并列候选）非静音自动播放策略导致隐藏解码 `<video>` 无法进入原生 `playing`，合成器退化为逐帧 seek 抖动 → `readyState` 持续不足 → canvas 全黑
- **证据**：
  - 活动解码元素被**取消静音**：`VideoSourcePool._apply` 设 `el.muted = plan.muteAudio`，非分离 clip 的 `muteAudio = hit.clip.audioDetached === true = false`（`VideoSourcePool.ts:181, 308-311`）。
  - `el.play()` 在 **rAF tick 内**调用，而非点击手势同步栈内（`VideoSourcePool.ts:314 → _ensurePlaying:355-362`），且 promise rejection 被 `.catch(()=>undefined)` 吞掉，无任何重试或回退。
  - 一旦原生播放被拒，元素停在某 `currentTime`；时钟仍推进 `comp`，`needsSeek` 触发逐帧 `el.currentTime = target`（`VideoSourcePool.ts:331-346`）。`<video>` 的 seek 是**异步且较慢**的；每个 rAF（~16ms）目标都在前移，seek 永远追不上、settle 不下来，`drawImage` 时刻 `readyState` 长期 < 2 → `_drawVideoLayer` 每帧返回 false（`CanvasCompositor.ts:258`）→ 画面只剩黑底。
  - 隐藏 1×1 + rAF 异步调用 `play()` 是某些自动播放策略的高发触发场景。**静音自动播放在任何策略下都被允许**——这是本缺陷防御的关键不对称（静音优先必不会更差）。
- **⚠️ 评审证伪（v2，P1=R-1）**：本前提**与本项目实际配置矛盾**。`desktop/main/window.js` 用 `win.loadURL('http://127.0.0.1:'+port)` 创建 `BrowserWindow`，`webPreferences` **未设 `autoplayPolicy`**；`desktop/main/index.js` 亦**无** `app.commandLine.appendSwitch('autoplay-policy', …)`。Electron 默认 `autoplayPolicy='no-user-gesture-required'`——**允许**非静音自动播放；再加用户点击「播放」已授予 sticky activation。因此 `el.play()` 在本环境**大概率成功**，H1 的「play 被拒→逐帧 seek 抖动→黑屏」链条**难以成立**。保留 H1 仅因「静音优先」是零风险加固，但**不得**作为「最可能根因」对待。
- **运行期探针**：DevTools 控制台对活动解码 `<video>` 读 `.paused / .readyState / .muted / .error / .networkState`；若 `paused===true && muted===false` 且 canvas 黑，才是 H1 命中。或临时把解码元素强制 `muted=true` 观察画面是否恢复。
- **判定**：**降级为「与 H6 并列的待证候选」**（v2 调整，原稿评为「最可能」）。它满足「jsdom 不可见」「由本次重构新引入」，但「确定性」一项被 Electron 配置证伪。最终承重根因须由 §5.4 诊断浮层在桌面端用实测字段裁决，**不可**仅凭静态排序就把静音优先当作唯一修复。

### H2 无就绪事件驱动的重绘：暂停态/刚 attach 的首帧黑
- **证据**：合成器仅在 attach/seek/pause/tick 时绘制（`MultiTrackPlaybackEngine.ts`）。attach 的 `_renderAt` 在 src 刚赋值、`readyState=0` 时画一次（必然黑），此后**暂停态不再重绘**，没有订阅解码元素的 `loadeddata/canplay/seeked` 来补画一帧。用户「点开就是黑」的第一印象与「暂停 scrub 不出画」由此而来。
- **运行期探针**：暂停态观察 canvas；给解码元素加 `loadeddata` 监听打印——事件到达但 canvas 不更新即 H2。
- **判定**：**很可能并存**。独立于 H1 也应修（保证暂停首帧与 scrub 可见）。

### H3 同源 URL 在内嵌 webview 下被错误绝对化 / 不可达
- **证据**：`toAbsolutePlaybackUrl` 用 `window.location.origin` 拼接（`selectPlaybackUrl.ts:80-81`）。若桌面 shell 以非 http 源（如 `file://`/`app://`）承载前端，绝对化结果非法，`<video>` 直接 load 失败、`readyState` 永 0。
- **运行期探针**：DevTools Network 看该 `<video>` 请求状态码；或控制台打印解析出的绝对 URL 与 `window.location.origin`。
- **判定**：**几乎可排除**（v2 评审强化）。`desktop/main/window.js`/`index.js` 已确认前端以 `http://127.0.0.1:PORT` 承载（默认 18320），`toAbsolutePlaybackUrl` 对此产出合法绝对 URL（`selectPlaybackUrl.ts:73` 对 `http(s)://` 原样透传）。仍在走查清单保留一次显式核对，命中才按 §5.5 处理。

### H6（与 H1 并列，v2 评审新增）源加载失败：URL 解析出来但解码 `<video>` 始终到不了 `readyState>=2`
- **背景**：一旦 H1 被证伪（play 成功，见上），「播放中仍全黑」的最可能成因就落到**源根本没解码出可绘帧**——`el.src` 被赋值后，`readyState` 长期停在 0/1（`HAVE_NOTHING`/`HAVE_METADATA`），`_drawVideoLayer` 每帧因 `readyState<2` 返回 false（`CanvasCompositor.ts:258`）→ 黑屏。
- **可能诱因**：①BFF `/api/storage/files/[...path]` 对该路径返回非 2xx / 不支持 Range（seek 必需）；②`_apply` 在 `el.src=url` 同一调用栈内立即 `el.currentTime=target`（`VideoSourcePool.ts:306-312`），元数据未就绪时该 seek 被丢弃，叠加时钟推进导致后续每帧重设 `currentTime` 而 settle 不下来；③素材 `localResolvedUrl` 为空/指向不存在文件；④元素未被正确解析（`resolveTrackElements` 返回 null 的时序竞态）。
- **运行期探针（§5.4 浮层直接给出）**：每轨 `resolvedSrc / readyState / networkState / error.code / paused / drawn`。若 `paused===false`（play 成功）且 `readyState<2` 持续、`networkState===3`(NO_SOURCE) 或 `error` 非空，即 H6 命中；配合 DevTools Network 看该 `<video>` 请求实际状态码与 Range 响应。
- **判定**：**与 H1 并列、且在本 Electron 环境下更可能**。它同样满足「jsdom 不可见」，并精确解释「play 成功但仍黑」。修复落点取决于浮层指认的具体诱因：①/③属数据/服务层（不在本方案 §5 改动面，需回退到上游节点修），②可在 `_ensureSeeked` 增加「元数据未就绪则延后首 seek 到 `loadedmetadata`」的护栏（§5.3 就绪重绘天然覆盖单帧补画），④由 §5.3 的首解析绑定 + 引擎 attach 重画兜底。

### H4 就绪门边界把播放挡掉
- **证据**：`computeMediaReadiness` 仅在 `localPreviewEnabled` 时计门（`useCompositionTransport.ts:54-55`）。本地上传素材判定为 `ready`，门应开；但若素材并非经 `createLocalMaterialFromUpload`（如某些导入/恢复路径缺 `storageKind='local'`），`canPreviewDirectLocalMaterial=false` 且 `localProxyStatus` 非 `ready/degraded` → `gating>0` → 点击播放只弹 toast、`isCompositionPlaying` 不翻转。
- **运行期探针**：点击播放后看播放图标是否变为「暂停」；若没变且出现「素材下载中」toast，则 H4 命中（但与「上传」主路径不符）。
- **判定**：**次要**。上传主路径不命中，仅作健壮性核对。

### H5 canvas 尺寸为 0 / 被遮挡
- **证据**：`PreviewCanvas` 用 ResizeObserver 同步尺寸（`PreviewCanvas.tsx:192-215`），但 canvas 尺寸变化**不触发**重绘；播放态每帧按当前尺寸重画，故仅影响暂停首帧，不解释「播放中也无画面」。
- **判定**：**低**。并入 H2 的就绪重绘一并缓解。

---

## 5. 修复技术设计（纵深防御）

设计原则：**把「解码/出画」与「音频」解耦**——画面正确性绝不依赖音频是否能播；音频在原生播放确认后再单独对齐。所有改动集中在 v2 合成器路径，不动数据/序列/就绪层，遵守 spec 01 `ClipTimeMapping` 与 RC-B「比对键==赋值」。

> **路径约定（v2 评审）**：本节及 §7/§8 的短写模块路径其仓库根均为 `src/components/video/`，即 `playback/X` = `src/components/video/playback/X`、`lib/X` = `src/components/video/lib/X`、`hooks/X` = `src/components/video/hooks/X`、`components/VideoPlayerPanel/X` = `src/components/video/components/VideoPlayerPanel/X`。

> **⚠️ 落地顺序（v2 评审强制）**：鉴于 H1 前提已被证伪（§4 R-1），**必须先落地 §5.4 诊断浮层并在桌面 App 实测**，由浮层字段（`readyState / paused / networkState / error / resolvedSrc / drawn`）指认真正失效的环节，再决定 §5.1–5.3/§5.5 中哪一项是承重修复。**严禁**仅凭静态假设排序就把「静音优先」当作唯一/最终修复。§5.1–5.3 三项均为低风险、互相独立的加固，可一并落地；但「问题是否真正解决」以浮层实测 + §9.2 走查为准。

### 5.1（加固，对应 H1）保证解码 `<video>` 进入原生播放——「静音优先启动」
> 定位（v2）：H1 在本 Electron 环境大概率不成立（§4），本节降为**零风险加固**而非承重修复；即便 play() 本就成功，静音优先也不会更差。

在 `VideoSourcePool` 的播放应用路径上，把「让元素出画/解码」与「元素是否发声」拆开：

- **播放期一律以静音启动原生播放**：进入 `isPlaying` 分支时，若 `el.paused`（尚未在播）则先 `el.muted = true` 再 `el.play()`（静音自动播放在任何策略下都被允许）；元素确认在播后再按音频路由恢复目标静音态（见 5.2）。
- **`play()` 失败重试**：`_ensurePlaying` 的 promise rejection 不再静默吞掉，而是挂**一次性** `canplay` 监听、事件到达后重发 `play()`（仍静音）。**必须**用 `typeof el.addEventListener === 'function'` 守卫——`VideoElementLike` 是结构化接口、纯对象测试桩无 `addEventListener`，无守卫会破坏现有 applier 测试套件（R-4）；并打 `__ecliptrixPlayKick` 私有标记去重，避免重复挂监听。
- **去抖 seek 仅作微调**：原生播放正常后，`needsSeek` 只在偏差 > `VIDEO_SEEK_TOLERANCE_SEC`(0.25s) 时触发（现状已是），不再承担「驱动播放」职责。

落点：`playback/VideoSourcePool.ts`（`_apply` / `_ensurePlaying` / 新增 `_kickPlay` 私有方法）。**不**新增 `TrackSourcePlan.desiredMuted` 字段——音频恢复用 §5.2 的按帧 `el.paused` 状态机表达即可（见 §8）。

> 备选（更激进、风险更高的回退方案）：解码 `<video>` **永久静音**，所有可听音频（含非分离视频轨的内嵌音频）统一改走音频元素池。该方案彻底消灭非静音自动播放面，但**代价被原稿低估（R-6）**：`buildAudioSyncGroups`（已核验）只从 `audioSequences` 建组，要让**非分离视频轨的内嵌音频**走 `AudioSyncPool`，等于对同一文件**二次解码**（双重网络/解码开销 + A/V 失步风险），并需重启 `'embeddedVideoAudio'` 组（S4 曾删该 kind）。属**非平凡子工程**，**默认不采用**，仅在 §5.2 的「确认在播后取消静音」仍听不到内嵌音频时作最后手段，由评审节点裁决。

### 5.2（对应 H1 音频侧）确认在播后再恢复音频，保「no double audio」——按帧 `el.paused` 状态机（v2 修订）
> v2 修订（R-4）：原稿用 `playing` 事件回调恢复静音，存在两个问题——(a) 依赖元素为真实 `EventTarget`，破坏纯对象桩；(b) 在 `playing` 闭包里按**捕获时**的 `plan` 恢复，跨「轨道切到分离 clip」会用旧 `plan` 误恢复内嵌音频（陈旧闭包 bug）。改为**无监听、按帧轮询 `el.paused`** 的状态机，更简单、无生命周期、且 jsdom 可测（桩已暴露 `paused`）。

在 `VideoSourcePool._apply` 的 `isPlaying` 分支内，对活动元素：
- 若 `el.paused`（尚未确认在播）：`el.muted = true` 仅用于出画，调 `_kickPlay(el)`。
- 若 `!el.paused`（已确认在播）：按本帧 `plan.muteAudio` 恢复路由——非分离 clip → `el.muted = false`（恢复内嵌音频）；分离/空闲/非活动 → `el.muted = true`（其声由配对独立音频序列经 `AudioSyncPool` 承担，`AudioSyncPool.ts:18-26`）。因为按帧读**当前** `plan.muteAudio`，轨道切到分离 clip 时下一帧即正确静音，无陈旧闭包。
- 需给 `VideoElementLike` 增 `paused?: boolean` 只读字段（真实 `HTMLVideoElement` 已有；测试桩已有）。该状态机收敛在 `_apply`，对引擎/Hook 透明。

### 5.3（对应 H2/H5/H6）就绪事件驱动的单帧重绘
让暂停态/刚加载完成也能出画，并兜底 H6 的「元数据迟到」单帧补画：

- 在 `MultiTrackPlaybackEngine` 侧，为每个解码元素订阅 `loadeddata` / `seeked` / `canplay`，回调里在**非播放态**（`getPhase() !== 'playing'`）调用一次 `this._renderAt(this.clock.getCompositionTime(), false)`（播放态由 rAF 持续重画，无需额外触发）。
- 三项硬约束（R-5）：①绑定前 `typeof el.addEventListener === 'function'` 守卫，纯对象桩跳过；②元素由 `PreviewCanvas` 懒创建，订阅点放在「**首次**解析到元素」处——在 `_buildPools` 的 `resolveTrackElements` 包装里对新元素打 `__ecliptrixReadinessBound` 标记后再 `addEventListener`，杜绝重复绑定；③把已绑定元素 + 其 handler 记入实例集合，`dispose` 时逐一 `removeEventListener`，杜绝监听泄漏。
- `PreviewCanvas` 在尺寸同步处（`PreviewCanvas.tsx:192-215`）暴露一个 `viewportVersion` 递增信号或 `subscribeViewportChange(cb)`，供 Hook 在 canvas 尺寸变化后请求一次非播放态重绘（缓解 H5 暂停首帧拉伸黑）。

### 5.4 运行期诊断浮层（dev-flag，**v2 评审定为落地第一步**）
> v2 评审（R-1）：鉴于真正承重根因未经运行期确证，本浮层**不再只是 dev 辅助，而是定位与验收的核心工具，须最先落地并最先运行**。

新增一个**默认关闭**的诊断浮层/控制台输出（受 `localStorage['ecliptrix-preview-debug']==='true'` 或 `NEXT_PUBLIC_PREVIEW_DEBUG` 控制），每秒打印/叠加每条视频轨：`trackId / resolvedSrc / readyState / networkState / paused / muted / error.code / currentTime vs desiredSourceTime / drawn / dropped`。数据源自 `CanvasCompositor.getStats()`（`CanvasCompositor.ts:351-353`，必要时按 §6 扩 per-layer drawn/dropped/lastReadyState）与解码元素只读字段。用途：让能运行 App 的开发/评审节点在 30 秒内**判别命中的是 H1 / H2 / H6 / H3 中的哪一个**，据此决定承重修复，并作为回归护栏。判读速查：`paused=true & muted=false & 黑` → H1；`paused=false & readyState<2 持续 & (networkState=3 或 error 非空)` → H6；`暂停态事件到达但 drawn 不增` → H2；`Network 请求非 http 源/失败` → H3。

### 5.5（条件性，对应 H3）同源 URL 绝对化校验
> v2 评审（R-7）：H3 经 `desktop/main/window.js`/`index.js`（前端以 `http://127.0.0.1:PORT` 承载）确认**几乎不可能命中**，本节维持「默认不实施」。仅当 §5.4 浮层显示 `<video>` 请求落到非 http 源或失败时才启用。

- 在 `toAbsolutePlaybackUrl`（`src/components/video/lib/selectPlaybackUrl.ts:71-82`）增加对 `window.location.origin` 协议的判定：当 origin 非 `http/https`（如 `file:`）时，回退到桌面已知的本地后端 origin（由 `NEXT_PUBLIC_LOCAL_MEDIA_ORIGIN` 或运行期注入提供），保证 `<video>.src` 永远是可达的 `http(s)://host:port/...`。
- 该项**不在本期默认实施**，作为附条件分支写入，避免在 origin 本就正确时引入回归。

---

## 6. 文件 / 模块变更计划

> **v2 评审更正**：原稿两处文件归属/路径会误导落地（R-2/R-3），下表已修正——标注 ✏️ 的行为本次更正项。

| 文件 | 变更意图（一句话） |
|---|---|
| `src/components/video/playback/VideoSourcePool.ts` | 核心加固：①`_apply` 内按帧 `el.paused` 状态机——未在播则静音 + `_kickPlay`，在播则按本帧 `plan.muteAudio` 恢复路由（§5.2）；②`_ensurePlaying` 不再静默吞 rejection，改挂一次性 `canplay` 重试（带 `addEventListener` 守卫 + `__ecliptrixPlayKick` 去重）；③给 `VideoElementLike` 增 `paused?: boolean` 只读字段。`TrackSourcePlan` 仍定义于本文件，**不**新增 `desiredMuted`。 |
| ✏️ `src/components/video/playback/VideoSourcePool.ts`（`TrackSourcePlan` 所在，原稿误写为 `types.ts`） | **条件性、默认无需改动**：仅当评审最终改用「显式 `desiredMuted` 字段」而非 §5.2 局部状态机时才在此（非 `types.ts`）扩字段。默认路线不动 `TrackSourcePlan`。 |
| `src/components/video/playback/MultiTrackPlaybackEngine.ts` | 为解码元素订阅 `loadeddata/seeked/canplay`，非播放态触发一次 `_renderAt`；`addEventListener` 守卫 + 首解析 `__ecliptrixReadinessBound` 去重 + `dispose` 逐一 `removeEventListener`；订阅点在 `_buildPools` 的 `resolveTrackElements` 包装内。 |
| `src/components/video/components/VideoPlayerPanel/PreviewCanvas.tsx` | 暴露 `viewportVersion` 递增信号 / `subscribeViewportChange`，供 Hook 请求非播放态重绘；解码元素创建处保留 `muted=true` 初值不变。 |
| `src/components/video/hooks/useCompositionPlayback.ts` | 接入「尺寸/就绪 → 非播放态 seek 当前 comp 重绘」；不改 attach 时机与 RC-B 锁定选项。 |
| `src/components/video/playback/CanvasCompositor.ts` | 可选：暴露更细的 per-layer 诊断（drawn/dropped/lastReadyState）供 §5.4 浮层；不改绘制语义。 |
| `src/components/video/playback/internal/previewDebug.ts`（**新增**） | §5.4 诊断浮层/日志的纯函数 + dev-flag 读取（`ecliptrix-preview-debug`）。**落地第一步**。 |
| ✏️ `src/components/video/lib/selectPlaybackUrl.ts`（原稿误写为 `src/lib/selectPlaybackUrl.ts`） | **条件性（§5.5）**：`toAbsolutePlaybackUrl` 在非 http origin 下回退到本地后端 origin。默认不启用。 |
| `src/components/video/playback/__tests__/VideoSourcePool.test.ts` | 新增用例：「未在播 → 静音 `play()`，下一帧 `paused=false` → 非分离轨 `muted=false` 恢复」「`play()` 拒绝 → `canplay` 重试且幂等」「分离轨始终 `muted=true`」「纯对象桩（无 addEventListener）不抛错」。 |
| `src/components/video/playback/__tests__/MultiTrackPlaybackEngine.test.ts` | 新增用例：`loadeddata` 在暂停态触发一次 `_renderAt`；`dispose` 解绑监听；无 addEventListener 的桩跳过绑定不抛错。 |
| `docs/plans/composition-preview-playback-fix/spec.md` | 本方案文档（已创建，评审升级至 v2）。 |

> 约束：以上仅为变更计划；**本节点不写实现代码、不改 docs 外任何源文件、不 git commit**。

---

## 7. 接口设计（内部 API；无 REST/WS 变更）

本修复不引入任何后端/HTTP 接口变更。涉及的内部接口约定：

- `VideoSourcePool`（`playback/VideoSourcePool.ts`）
  - `VideoElementLike` 增只读 `paused?: boolean`（真实 `HTMLVideoElement` 与现有测试桩均已有）。
  - 新增私有 `_kickPlay(el: VideoElementLike): void`——静音确保下 `play()`；rejection 时**仅当** `typeof el.addEventListener === 'function'` 才一次性挂 `canplay` 重试（仍静音）；`__ecliptrixPlayKick` 标记去重、幂等；无 `addEventListener` 的纯对象桩走「吞掉 rejection」旧路径不抛错。
  - `_apply(plan, isPlaying)` 行为约定（出画/音频解耦，**v2 改为按帧 `el.paused` 状态机，去掉 `playing` 监听**）：
    - 活动且 `isPlaying` 且 `el.paused`（未在播）：`el.muted = true; this._kickPlay(el)`（仅出画）。
    - 活动且 `isPlaying` 且 `!el.paused`（已在播）：`el.muted = plan.muteAudio`（按**本帧** plan 恢复路由，无陈旧闭包）。
    - 活动且 `!isPlaying`：`el.muted = plan.muteAudio; pauseQuietly`，不发声。
    - 空闲：`el.muted = true; pause`（不变）。
- `MultiTrackPlaybackEngine`（`playback/MultiTrackPlaybackEngine.ts`）
  - 新增私有 `_bindReadinessRepaint(el)`：`if (typeof el.addEventListener !== 'function' || el.__ecliptrixReadinessBound) return;` 否则对 `'loadeddata'|'seeked'|'canplay'` 绑 `() => { if (this.getPhase() !== 'playing') this._renderAt(this.clock.getCompositionTime(), false); }`，打标去重，并把 `(el, handler[])` 记入实例集合；`dispose` 时逐一 `removeEventListener`。订阅点在 `_buildPools` 的 `resolveTrackElements` 包装内（首次解析元素时调用）。
- `PreviewCanvasHandle`（`components/VideoPlayerPanel/PreviewCanvas.tsx:59-75`）
  - 可选扩展：新增 `subscribeViewportChange(cb): () => void` 或返回一个递增 `viewportVersion`，供 Hook 在 canvas 尺寸变化后请求非播放态重绘。保持 ref-backed、跨渲染稳定。
- 诊断浮层（`playback/internal/previewDebug.ts`，新增）
  - `isPreviewDebugEnabled(): boolean`（读 `localStorage['ecliptrix-preview-debug']` / `NEXT_PUBLIC_PREVIEW_DEBUG`，非浏览器返回 false）。
  - `formatTrackDiagnostics(rows): string`——纯函数，便于单测。

---

## 8. 数据模型（内存形态，无 DB 变更）

- `TrackSourcePlan`（定义于 `playback/VideoSourcePool.ts:89-115`，**非** `types.ts`——v2 更正 R-3）
  - 现状字段**全部保留、默认不改**：
    - `muteAudio: boolean`——「最终目标」音频静音态（依 `audioDetached`/空闲）。§5.2 的「出画期临时静音」由 `_apply` 内按帧 `el.paused` 状态机表达，**不**需要把它落成字段。
    - `desiredMuted`：**默认不新增**。仅当评审最终弃用局部状态机、改用显式字段时才在 `VideoSourcePool.ts`（非 `types.ts`）扩此字段。
- `VideoElementLike`（`playback/VideoSourcePool.ts:46-60`）：增只读 `paused?: boolean`（结构化最小扩展，桩已满足）。
- 解码元素私有标记（非持久、非序列化）
  - `el.__ecliptrixPlayKick?: boolean`（play 重试监听去重）、`el.__ecliptrixReadinessBound?: boolean`（就绪重绘监听去重）——挂在 DOM 元素上、随元素生命周期回收。
- 不触及：`MaterialItem`、`VideoSequenceItem`、`CompositionPlayback`、`TimelineState`、任何 ORM/迁移。RC-B 锁定的 `resolverOpts`、`ClipTimeMapping` 源时间语义均不变。

---

## 9. 测试与验收标准

### 9.1 单元测试（jsdom，必须）
- `VideoSourcePool`：
  1. `starts_muted_when_paused`：`el.paused=true` 时 sync(isPlaying=true) 后断言 `el.muted===true` 且 `play()` 被调一次（仅出画启动）。
  2. `restores_embedded_audio_once_playing`：非分离 clip，元素 `paused=false`（已在播）那一帧后 `el.muted===false`；分离 clip 同条件下 `el.muted===true`（按本帧 plan 路由，无陈旧闭包）。
  3. `retry_on_canplay`：带 `addEventListener`/`dispatchEvent` 的增强桩，`play()` reject 后挂一次 `canplay`、事件后重发；幂等不重复挂；**纯对象桩（无 addEventListener）下 sync 不抛错**（守卫生效）。
  4. RC-B 不回归：`needsSrcSwap` 比对键 == 赋值 src（沿用现有断言）。
- `MultiTrackPlaybackEngine`：
  5. `loadeddata_triggers_single_paused_repaint`：暂停态下增强桩派发 `loadeddata`，断言 `compositor.renderFrame`/`_renderAt` 多调用一次且 phase 仍非 `playing`。
  6. `dispose_unbinds_readiness_listeners`：`dispose` 后再派发 `loadeddata` 不再触发 `_renderAt`。
  7. `readiness_bind_skips_plain_fake`：无 addEventListener 的桩在 attach/解析时被跳过、不抛错。
- 纯函数：`previewDebug.formatTrackDiagnostics` 输出快照。
- 质量门（与既有基线一致）：`npm run type-check` clean；`vitest run src/components/video` 通过（允许既存 `backend-proxy.test.ts` 2 例先验失败，与本期无关）。**回归护栏**：现有 `VideoSourcePool.test.ts` 全部纯对象桩用例保持绿（守卫确保新逻辑不破坏它们）。

### 9.2 桌面走查（强制门，下游开发/评审节点在真实 Electron App 执行）
> v2 合成器的 canvas/`<video>`/自动播放/rAF 行为 jsdom 不可验证——以下为**唯一**能确证修复的手段。**第 0 步（诊断先行，v2 评审新增）必须在判定修复是否生效前完成**。

0. **诊断先行**：先只落 §5.4 浮层（或仅开 `ecliptrix-preview-debug`），复现「上传→入轨→播放黑屏」，读取浮层字段判别命中 H1/H2/H6/H3 中的哪一个（判读速查见 §5.4），据此确认承重修复；**截图原始故障态留档**。
1. 启动桌面 App，进入视频编辑器。
2. 上传一个本地 mp4，等待素材卡片完成。
3. 拖入下方视频轨。
4. 点击组合预览面板播放按钮：**画面区出现实时播放画面**（不是黑屏），播放图标变「暂停」。
5. 拖动进度条（暂停态 scrub）：画面跟随到对应帧（验证 H2/H6 重绘）。
6. 非分离轨：能听到内嵌音频（验证 5.2 恢复）；对该 clip 执行音画分离后再播放：画面正常且无双声（验证 RISK-2 不回归）。
7. 浮层显示该轨 `readyState>=2 / paused=false / error 为空`，drawn 持续增长（修复后态，对照第 0 步故障态）。
8. 关闭重开项目，恢复后重复 4：仍可播放（验证与持久化不冲突）。

### 9.3 验收（Definition of Done，针对最终实现）
- **诊断先行**：浮层已在桌面端定位真正失效环节，且原始故障态与修复后态各有截图对照（避免「碰巧不黑」式的假阴性）。
- 上传→入轨→点击播放→预览区**稳定显示实时画面**，跨「单视频轨」「多视频轨叠加」「含字幕/图片叠加」三种场景成立。
- 音频路由不回归（无双声、分离轨由独立音频承担）。
- 单测全绿（含新增 7 例 + 既有纯对象桩用例保持绿）+ type-check clean；桌面走查 0–8 项全过并截图留档于 `summaries/`。
- 若浮层指认命中 **H6 的数据/服务层诱因（①/③）**，则本方案 §5 改动不足以修复，须显式记录到「实施过程发现的方案缺陷」并回退给上游数据/服务节点，不得在前端层强行掩盖。

---

## 10. 风险与缓解

| 风险 | 说明 | 缓解 |
|---|---|---|
| R1 误判根因（H1 前提已被证伪，真因可能是 H6/H2） | 静态分析无法跑 App；H1 因 Electron 默认 `autoplayPolicy` 证伪（§4 R-1） | **诊断先行**：§9.2 第 0 步必须先用 §5.4 浮层定位真正失效字段再判定承重修复；§5.1–5.3 三项独立低风险加固全覆盖 H1/H2/H6；§5.5 作 H3 附条件分支 |
| R2 「确认在播后取消静音」仍触发自动播放限制 | 个别 webview 对「先静音播、后取消静音」也有约束 | 回退到 5.1 备选（永久静音 + 内嵌音频改走音频池）；**注意该回退非平凡（R-6）**：需对同一文件二次解码、重启 `'embeddedVideoAudio'` 组，仅作最后手段、评审节点裁决 |
| R3 就绪事件重绘引入抖动/重入 | `loadeddata/seeked` 高频触发可能与 rAF 抢绘 | 仅在**非播放态**（`getPhase()!=='playing'`）触发；播放态完全交给 rAF；重绘走同一 `_renderAt`，无并发写 canvas |
| R4 RC-B / `ClipTimeMapping` 回归 | 改 `VideoSourcePool` 易碰「比对键==赋值」与源时间映射 | 不改 `resolveSource` 注入与 `computeSourcePlan` 比对逻辑；新增行为仅在 `_apply` 的元素副作用层；保留并扩充 RC-B 断言 |
| R5 诊断浮层泄漏到生产 | dev-flag 误开 | 默认关闭；纯前端只读字段；与 `proxyHitMeter`/telemetry 的 PII 约束一致，不打 URL 之外敏感信息 |
| R6 桌面走查未被执行 | 开发节点「能编译即过」可能跳过运行验证 | 在 spec/Definition of Done 显式将「桌面走查 0–8 项 + 故障态/修复态截图」列为强制门，评审节点据此卡板 |
| R7 监听器绑定破坏 DOM-light 测试桩 / 监听泄漏（评审新增 R-4/R-5） | `VideoElementLike` 无 `addEventListener`；引擎懒解析元素 | 所有 `addEventListener` 加 `typeof === 'function'` 守卫；首解析打标去重；`dispose` 逐一 `removeEventListener`；音频恢复改按帧 `el.paused` 轮询、彻底不用 `playing` 监听 |

---

## 11. 非目标 / 范围外

- 不改后端导出（filtergraph/ffmpeg）链路——导出走 `selectPlaybackUrl(export)`，与预览静音/自动播放无关。
- 不重做就绪门/素材下载语义（除非 H4 在走查中被证实命中）。
- 不恢复 v1 `<video>` player 或 `isPlaybackV2Enabled` 开关（已删，且非目标）。
- 不动 `proxyHitMeter.ts` 与解耦的 `ecliptrix-preview-proxy`/`ecliptrix-local-preview` 默认 ON 开关。

---

### 附：评审节点裁决（原「请重点确认」三问，v2 已裁决）
1. **H1 是否充分 / 是否把永久静音提为主方案？** 裁决：H1 论证**不充分**——其「内嵌 webview 拒绝非静音自动播放」前提被 `desktop/main/{window,index}.js` 证伪（无 `autoplayPolicy` 覆盖、`http://127.0.0.1` 源 + 用户点击 sticky activation）。H1 降为并列候选并新增 H6；**不**把永久静音备选提为主方案（代价非平凡，R-6）。承重根因由 §5.4 浮层桌面实测裁决。
2. **`TrackSourcePlan` 是否新增 `desiredMuted`？** 裁决：**不新增**。用 `_apply` 内按帧 `el.paused` 状态机表达「出画期临时静音 → 在播后按本帧 `plan.muteAudio` 恢复」，更简单、无陈旧闭包、jsdom 可测（§5.2）。
3. **§5.5 URL origin 回退是否本期默认启用？** 裁决：**不启用**。前端实际为 `http://127.0.0.1:PORT`，H3 几乎不可能命中；保留为附条件分支，仅浮层证明请求落到非 http 源时才开。

---

## 评审结论（Review Verdict）

**结论：有条件通过（Approved with conditions）。**

方案整体方向正确、工程上稳妥：链路分析准确（除 H1 前提外的 file:line 锚点经逐一核验全部属实），「解码/出画与音频解耦 + 就绪重绘 + 诊断浮层」的纵深防御对「无法跑 App 静态定位」这一根本约束是恰当回应，范围克制、不触碰数据/序列/就绪层与 RC-B/`ClipTimeMapping` 不变量。已就地修复全部 P0/P1（无遗留）：H1 过度自信已降级并补 H6、诊断浮层升为落地第一步、`selectPlaybackUrl` 路径与 `TrackSourcePlan` 归属已更正、监听器方案改为按帧 `el.paused` 状态机并补 `addEventListener` 守卫/`dispose` 解绑。**P0：无。P1：6 项全部就地修复。P2：3 项已就地标注/强化。**

落地节点须满足以下**条件**方可视为完成：

1. **诊断先行（硬性）**：先实现并运行 §5.4 浮层，于桌面 App 用实测字段（`readyState/paused/networkState/error/resolvedSrc/drawn`）判定真正命中的假设（H1/H2/H6/H3），据此确认承重修复；**严禁**仅凭静态排序把「静音优先」当唯一/最终修复，并须留「故障态/修复态」对照截图。
2. **音频恢复用按帧 `el.paused` 状态机**（§5.2），不得用 `playing` 事件闭包（陈旧闭包 + 破坏纯对象桩）；所有 `addEventListener` 加 `typeof === 'function'` 守卫，`dispose` 解绑。
3. **用更正后的路径/归属**：`src/components/video/lib/selectPlaybackUrl.ts`；`TrackSourcePlan` 在 `VideoSourcePool.ts`、默认不新增字段。
4. **强制门**：§9.1 新增 7 例 + 既有纯对象桩用例全绿、`type-check` clean；§9.2 桌面走查 0–8 项全过并截图留档。
5. **诚实兜底**：若浮层指认命中 H6 的数据/服务层诱因（BFF 非 2xx/不支持 Range、`localResolvedUrl` 空等），本方案 §5 不足以修复，须记录到「实施过程发现的方案缺陷」并回退上游节点，不得在前端层强行掩盖。

满足以上条件后，本方案可进入「代码开发」节点。

---

## 实施过程发现的方案缺陷（Issues Found During Implementation）

> 本节由「代码开发」节点在落地 §5/§6 时追加。记录与 v2 设计的偏差及其理由，便于下游 Review 核对。所有改动仍严格限制在 §6 文件清单内（含 §9.1 要求的 `previewDebug` 纯函数单测文件）。

### 缺陷 1（P2，已就地修正）§5.3 就绪重绘的时间源用 `clock.getCompositionTime()` 在「暂停态 seek 后」会取到陈旧时间

- **设计原文**：§5.3 / §7 规定就绪事件回调里 `this._renderAt(this.clock.getCompositionTime(), false)`。
- **核验发现**：`MultiTrackPlaybackEngine.seek()` 的**暂停分支**只 `clock.stop()` + `playhead.forceSet(target)` + `_renderAt(target,false)`，**并不** re-anchor 时钟（仅 `play()` / seek-while-playing 才 `clock.start()` 重置 base）。`PlaybackClock.getCompositionTime()` 在非运行态返回 `_baseCompositionTime`，即上一次 `start()` 的基准，而非 `target`。因此在「暂停态 scrub 到新位置」后，若解码元素随后触发 `loadeddata/seeked/canplay`，按原文取 `clock.getCompositionTime()` 会把画面重绘到**旧时间**的帧，与用户刚 scrub 到的位置不符。
- **修正方案**：引擎新增私有 `_lastRenderComp`，在每次 `_renderAt(comp, …)` 开头记录 `comp`；就绪回调改为 `this._renderAt(this._lastRenderComp, false)`——即「用最近一次实际渲染的合成时间重绘一帧」，无论该时间来自 attach 首帧、暂停 seek、还是播放 tick 都正确。语义与设计意图（让已尝试渲染的当前帧在源就绪后真正出画）完全一致，仅更换了更可靠的时间来源。其余约束（`addEventListener` 守卫、`__ecliptrixReadinessBound` 首解析去重、`dispose` 逐一 `removeEventListener`、仅非播放态触发）均按 §5.3/§7 实现。

### 实施说明 2（非缺陷）§5.4 诊断浮层的运行期挂载点

- §6 文件清单将 `previewDebug.ts` 列为「纯函数 + dev-flag 读取」，但未指明每秒 dump 的运行期宿主。落地时把节流（`PREVIEW_DEBUG_INTERVAL_MS=1000`）的 per-track `console.debug` 收集挂在 `MultiTrackPlaybackEngine._renderAt` 末尾——这是唯一**每帧**同时持有「`VideoSourcePool` 计划 + 解码元素只读字段 + `CanvasCompositor.getLayerStats()`」三类数据的位置。开关 `isPreviewDebugEnabled()` 在 `attach` 时解析一次存入 `_debugEnabled`，**默认关闭时每帧零额外成本**（R5：不泄漏到生产）。`CanvasCompositor` 仅新增 `getLayerStats()`（per-layer `drawn/dropped/lastReadyState`，`detach` 清空），不改任何绘制语义。

### 实施说明 3（非缺陷）回归基线对齐

- 现有 `VideoSourcePool.test.ts` 中「单帧即取消静音」的断言因 §5.2 改为**两帧**语义（首帧静音出画 → 确认在播帧恢复路由）已就地更新为两帧序列；其余纯对象桩用例（RC-B、seek 去抖、prewarm、idle、rejection 吞掉）保持不变并全绿。新增用例覆盖 §9.1 第 1–7 项 + `previewDebug` 纯函数快照。
- 质量门实测：`npm run type-check` clean；`vitest run src/components/video` = 109 文件 / 901 用例全绿。
