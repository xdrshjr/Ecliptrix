# Global Execution Context: local-video-editing-refactor

Accumulated context from all execution phases. Each agent MUST read this
file before starting work to understand the full project history.

治理：三权分立 + Token 经济。本地桌面端（Electron + 内置 FastAPI + Next.js，同源
`/api/storage/files`，内置 ffmpeg，无云、无新增 IPC）。验收 = vitest/pytest + 真实
Electron 桌面壳层手动走查。

执行阶段：Phase1 {TODO01 剪辑核心+clip契约, TODO03 缩略图, TODO04 波形} →
Phase2 {TODO02 统一预览合成器} → Phase3 {TODO05 导出对齐, TODO06 持久化+缓存GC}。

关键不变量（贯穿全程）：
- clip 语义契约（spec01 `ClipTimeMapping`，`TIME_EPSILON=0.001`，INV-1..INV-5）被 02 预览与
  05 导出共用，禁止下游各自换算。
- 播放 URL 唯一权威 = live `MaterialItem`（`resolveSequencePlaybackUrl` 按 materialId），
  比对键==赋值（症状①根因）。
- 预览(02 canvas 合成器)与导出(05 ffmpeg filtergraph)共享转场/z-order/opacity 语义（对拍）。
- 派生文件（缩略图/波形）按 `{materialId}` 目录约定归集，供 06 删除联动 + 孤儿回收。

---

## Phase 1 — completed (todo-01/03/04)

已交付且整合通过（type-check clean；前端 vitest 93 文件/739；后端 28）。无淘汰。

**已建立、供下游消费的契约**：
- `ClipTimeMapping`（domain barrel）：`mapTimelineTimeToSourceTime`/`mapSourceTimeToTimelineTime`，`TIME_EPSILON=0.001`。**02 预览 + 05 导出必须调用，禁止各自换算**。
- `TimelineItem.audioDetached?` + 序列透传（02 音频同步、05 导出消费：视频轨 detach 后静音、音频轨出声，不重复）。
- 缩略图：`POST /api/storage/thumbnail-frame`、`GET /api/storage/thumbnails/{id}`；`thumbnail_service.delete_by_material`/`list_material_dirs`（06 GC）。
- 波形：`POST /api/storage/waveform/generate`、`GET /api/storage/waveform/{id}`；`waveform_service.delete_by_material`/`list_material_files`（06 GC）。
- BFF passthrough 路由模式：每个后端端点须在 `src/app/api/.../route.ts` 用 `createPassthroughRoute` 显式建（Next.js 无 catch-all）。

**Phase 2 (TODO02) 必读**：
- RC-A/RC-B 在当前分支**已部分落地于 v1**；02 须把「签名重建 / 比对键==赋值」不变量带入新合成器并随 G3 删 v1，**勿重做、勿回退**。`CanvasCompositor._drawOverlays` 已实现 overlay 绘制，缺**多视频源同帧叠加**与**真实 overlay 数据注入**。
- 删除时**勿删** `proxyHitMeter.ts` 及解耦的 preview-proxy/local-preview flag。
- **latent bug**：`TimelineAggregate.moveItem` 跨轨被拒非原子（item 丢失）——涉及移动路径需留意。
- 债：`TimelineItem.tsx` 859 行（>800），D10 拆分单独排期（与 `VideoPlayerPanel.tsx` 拆分一并规划）。

---

## Phase 2 — completed (todo-02 统一本地预览合成器)

4 子阶段（S1 数据层 / S2 合成器核心 / S3 宿主+钩子+接线 / S4 删 v1+拆分）顺序推进，
均过三权审/测。集成验证通过：type-check clean；全量 `vitest run src` 1213 passed / 2 failed
（2 个均为 `backend-proxy.test.ts` BFF query-string，`git diff main...HEAD` 证实先于本期、与
预览无关）；`src/components/video` 825/0；`grep isPlaybackV2Enabled src/` 运行时零引用。
无淘汰。详见 `summaries/phase-2/phase-digest.md`。

**新建立、供 Phase 3 消费的契约**：
- `CompositorLayer[]`（video/subtitle/image 判别联合）= `CanvasCompositor.renderFrame` 逐帧入口；
  **05 导出须用 ffmpeg filtergraph 复现其 z-order/opacity/transition alpha 语义并与预览对拍**。
- `MultiTrackPlaybackEngine` 挂载 API（attach/play/pause/seek/dispose + `MultiTrackAttachDeps`）
  现为唯一预览路径（`PreviewCanvas` + `useCompositionPlayback` 无条件挂载）。
- RC-B「比对键==赋值」黑屏根因修复落于 `VideoSourcePool`（有 mutation 回归守卫）。
- 音频路由：非 detach 视频轨由解码 `<video>`(unmute) 出声；detach/idle → mute，独立音频轨出声
  （不重复）。`AudioSyncPool` 只管独立音频轨。
- 序列透传 `trackZ/opacity/transitionIn/transitionOut/audioDetached` + `subtitleSequences`
  已在 `compositionPlayback`；**06 持久化须保存这些字段并验证重载可预览**。

**Phase 3 必读 / 风险**：
- ⚠️ **canvas/音频实际运行无法在 jsdom 验证，且 v1 safe-mode 已删 → 用户桌面走查为强制门**
  （8 项清单见 `summaries/phase-2/dev--google-dev-01--todo-02-s4.md`）。单测钉死接线，不钉像素/声音。
- 死常量残留（非阻断，06 清理）：`playback/internal/constants.ts` 中 `KILL_SWITCH_LS_KEY` 等 ~8 个
  v1/v2 死常量 + `types.ts`/`index.ts` 4 个 type-only 孤儿，零运行时引用。
- latent bug 仍在：`TimelineAggregate.moveItem` 跨轨非原子（item 丢失）。
- **KEEP（勿删）**：`proxyHitMeter.ts`、`PREVIEW_PROXY_FLAG_KEY`/`LOCAL_PREVIEW_FLAG_KEY`、
  `resolveSequencePlaybackUrl`/`selectPlaybackUrl`/`useTimelineComposition`/`CompositionAdapter`。

---

## Phase 3 — completed (todo-05 导出对齐 + todo-06 持久化+缓存GC) — 项目代码层收尾

05、06 并行（disjoint 文件），均过三权审/测。集成验证通过：type-check clean；全量 `vitest run src`
**1240/2**（2 = `backend-proxy.test.ts` BFF query-string，先于本期、零关联）；后端 touched-area pytest
**78/0**。无淘汰。详见 `summaries/phase-3/phase-digest.md`。Token 终榜：dev-01 335 / tester-01 260 /
reviewer-01 215 / dev-02 167 / dev-03 135。

**本期建立的契约/能力**：
- 导出：`VideoCompositionRequest.video_items` 增 `track_z/transition_in/transition_out/audio_detached`；
  后端 `composition/filtergraph_builder` 多轨叠加+转场（z-order/opacity/xfade 对齐 spec-02 预览，
  parity oracle mutation-proven）；去云下载（`NonLocalMediaError`）；`audio_mix` 已 wired（等价证明）。
- 持久化：`TimelineRepository` 存 split/trim/转场/audioDetached/轨序，停内联 waveformData；
  `projectHydration` 按 materialId 解 live 素材（黑屏守卫）；INV-3 加载规整。
- 清理：`DELETE /api/storage/material/{id}` 联动删派生 + `derived_gc_service.reclaim`（三层安全：空集→删0、
  启动 dry-run、POST 端点 dormant 无调用方）+ 4-cache eviction。

**⚠️ 强制门（无回退）**：预览 canvas、真实 ffmpeg 导出像素、关闭重开恢复、删除联动磁盘消失、重启无孤儿——
**只能桌面走查**；单测钉的是接线/参数语义。05/06 桌面清单见各自 dev summary。

**仍待清理（非阻断）**：`video_composition_service.py`(2744) 与 `useMaterialManagement.ts`(1295) D10 服务级拆分；
Phase 2 `playback/internal/constants.ts` 死常量；后端 `test_video_composition*`/`_sanitize_filename` 先验失败
+ anaconda `cv2` 二进制损坏致 `app.main` 整体 boot 不能（pytest 直 import service 不受影响）。
