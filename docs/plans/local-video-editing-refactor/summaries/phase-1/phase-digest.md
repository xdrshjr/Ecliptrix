# Phase 1 Digest

## Completed Tasks
| Task | Dev Agent | Review Verdict | Test Verdict | Key Output |
|------|-----------|---------------|-------------|------------|
| todo-01 剪辑核心+clip契约 | google-dev-01 | PASS | ALL PASS | `ClipTimeMapping`(共享契约)、`SplitService`、split/detach action、resize INV-3 强约束、`audioDetached` 透传 |
| todo-03 本地缩略图 | google-dev-02 | PASS WITH FIXES | ALL PASS (fix 后) | 后端 `thumbnail_service`(poster 落点统一+filmstrip 持久化)、`POST /storage/thumbnail-frame`、前端 `filmstripCache`(zoom-aware+pre-warm)、多帧平铺 |
| todo-04 本地波形 | google-dev-03 | PASS WITH FIXES | ALL PASS | 后端 `waveform_service`(ffmpeg peaks+持久化 JSON)、`/storage/waveform/*`、前端 `drawWaveform`/`waveformCache`/`AudioWaveformCanvas` |

## Key Decisions
- **clip 语义唯一契约**：`ClipTimeMapping.ts`（`mapTimelineTimeToSourceTime`/`mapSourceTimeToTimelineTime`，`TIME_EPSILON=0.001`）以最小 `ClipTimeRef` 结构化类型服务实体 DTO 与两类序列 DTO，无适配器。**02 预览与 05 导出必须调用它，禁止下游各自换算**（症状②根因在数据层中和）。
- **resize = 精确 trim**：INV-3（`duration==clipEnd-clipStart`）在实体层强制，resize 与 drag-commit 均经此。
- **split**：左段保留原 id、右段新 id，`left.clipEnd===right.clipStart` 无缝；边界/越界 no-op；多选/播放头批量切记一条历史。
- **audio detach**：domain 纯函数（has-audio 判定在 action 用 live material），`audioDetached` 透传到 `VideoSequenceItem` + wire `audio_detached`，不改 URL 选择。
- **缩略图**：poster 落 `static/video/thumbnails/{stem}/poster.jpg`（兼容旧 `thumb_{stem}.jpg`）；filmstrip 帧 `strip_{zoomTier}_{tMs}.jpg`，zoomTier 标签限 `[A-Za-z0-9]+`（满足后端 `_FRAME_RE`）；前端直接本地素材抽帧走同源 `/api/storage/files`，不走 `/api/video-proxy`；**pre-warm 经 `FilmstripCache.ensure` 接入，重载命中持久化帧零重抽**。
- **波形**：on-disk camelCase JSON `{version,materialId,durationSec,peaksPerSecond,peaks[]}` vs REST snake_case 严格分离；幂等生成、QueueManager 限流；`drawWaveform` 纯 canvas 无解码；`waveformCache` 按 `[clipStart,clipEnd)` 切片。

## Interfaces Established
- domain barrel → `mapTimelineTimeToSourceTime`/`mapSourceTimeToTimelineTime`（**02/05 消费**）。
- `TimelineItem.audioDetached?: boolean` + 序列透传（**02 音频同步、05 导出消费**）。
- `POST /api/storage/thumbnail-frame`、`GET /api/storage/thumbnails/{id}`（BFF 路由已建）；`thumbnail_service.delete_by_material`/`list_material_dirs`（**06 GC 消费**）。
- `POST /api/storage/waveform/generate`、`GET /api/storage/waveform/{id}`（BFF 路由已建）；`waveform_service.delete_by_material`/`list_material_files`（**06 GC 消费**）。

## Issues Resolved
- **BFF passthrough 缺失**（运行时 404）：补建 `src/app/api/storage/{thumbnail-frame,thumbnails/[material_id],waveform/generate,waveform/[material_id]}/route.ts`（Next.js 无 catch-all，每个后端端点须显式 passthrough）。
- **filmstrip pre-warm 未接入**（重载重抽）：经 `FilmstripCache.ensure` 先 `prewarm`(listMaterialThumbnails+seed) 再 extract，零重抽零 POST。
- **波形 ffmpeg 非确定性**：固定 `-ar 44100`。
- **跨轨类型兼容**：补专测（video→subtitle/audio 被拒）。

## Context for Next Phase (Phase 2 = TODO 02 统一预览合成器)
- 合成器逐帧调度**必须**用 `ClipTimeMapping`（已就绪、barrel 导出），不要重造 clip 换算。音频同步**必须**读 `audioDetached`（视频轨 detach 后静音、由音频轨出声，不重复）。
- 现状核对（实现前必读）：RC-A（`useTimelineComposition` 签名重建+materials-change effect）与 RC-B（比对键==赋值）在当前分支**已部分落地于 v1**；02 的职责是把这两个不变量带入新合成器并随 G3 删除 v1，**勿在 v1 上重做、勿回退已修复点**。`CanvasCompositor._drawOverlays` 已能绘制 overlay，缺的是**多视频源同帧叠加**与**真实 overlay 数据注入**。
- 删除时**勿删** `proxyHitMeter.ts`（被 selectPlaybackUrl/PlaybackEngine 引用）与解耦的 preview-proxy/local-preview flag。
- **latent bug（记录待修）**：`TimelineAggregate.moveItem` 跨轨被拒时非原子（先从源轨移除再 target.addItem 抛错 → item 丢失）。02 若涉及移动路径需留意；否则留待后续专修。
- **已知债**：`TimelineItem.tsx` 859 行（>800），三方并发增长所致；D10 大文件拆分单独排期（02 会拆 `VideoPlayerPanel.tsx`，可一并规划）。
- 测试基线：`npm run type-check` clean；`npx vitest run src/components/video` = 93 文件 / 739 测试；后端 `pytest tests/test_thumbnail_service.py tests/test_waveform_service.py` = 28 通过。Phase 2 不得回退此基线。
