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
