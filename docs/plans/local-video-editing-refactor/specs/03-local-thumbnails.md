# Spec 03 — 本地缩略图（poster + filmstrip）

> 所属：`local-video-editing-refactor`　|　依赖：master-plan、（弱）spec 01/02
> 被依赖：06 持久化与缓存治理（追踪派生文件）
> 覆盖目标：G4（缩略图本地化）

## 1. 概述 (Overview)

把轨道 clip 的缩略图做成**纯本地生成 + 本地持久化**，采用混合策略：

- **单张 poster**：素材上传/导入时由**后端 FFmpeg** 抽取（现已存在，单帧中点），作为素材卡片与
  clip 缺省封面。
- **轨道 filmstrip（多帧条）**：由**前端 canvas 按需抽帧**生成，覆盖 clip 在轨道上的可视区间；
  生成结果**持久化**到本地存储，避免重复抽帧与重启重抽。

二者均落到 `STORAGE_ROOT/static/video/thumbnails`，经现有 `/api/storage/files` 鉴权静态服务。
不再使用临时 data URL（现状 `extractVideoThumbnail` 返回的 data URL 不持久、重载即丢）。

现状（已勘察）：
- 后端 `storage_service.upload_video_file()` 在上传时用 ffmpeg 抽**单张中点帧** `thumb_{stem}.jpg`，
  与视频同目录，返回 `/api/storage/files/...` 的 `thumbnail_url`；持久但**单帧、删素材不清理**。
- 前端 `utils/extractVideoThumbnail.ts` 用 canvas 抽帧返回**临时 data URL**（跨源走 `/api/video-proxy`）；
  `TimelineItem.tsx` 仅渲染单张 `item.thumbnailUrl`（`<img>`）。**无 filmstrip**。

## 2. 技术设计 (Technical Design)

### 2.1 生成与存储总览

```mermaid
graph LR
  Up[上传/导入视频] --> P[后端 FFmpeg<br/>单张 poster 中点帧]
  P --> TDir[(STORAGE_ROOT/static/video/thumbnails/<br/>{materialId}/poster.jpg)]
  ZR[轨道渲染/缩放<br/>可见 clip 区间] --> Need[计算所需帧时刻集合<br/>zoom-aware]
  Need --> Have{本地已存?}
  Have -- 是 --> Use[直接用 /api/storage/files URL]
  Have -- 否 --> Gen[前端 canvas 抽帧<br/>同源 video 解码]
  Gen --> Persist[POST 持久化帧到本地]
  Persist --> SDir[(STORAGE_ROOT/static/video/thumbnails/<br/>{materialId}/strip_{zoomTier}_{t_ms}.jpg)]
  TDir --> Item[TimelineItem / 素材卡片]
  SDir --> Item
```

### 2.2 后端 poster（巩固既有）

- 维持上传时生成单张中点 poster；**统一落点**到 `static/video/thumbnails/{materialId}/poster.jpg`
  （而非与视频同目录的 `thumb_{stem}.jpg`），便于 06 按 materialId 统一清理与孤儿回收。
- 返回 `thumbnail_url = /api/storage/files/static/video/thumbnails/{materialId}/poster.jpg`。
- 兼容：旧的 `thumb_{stem}.jpg` 仍可读；新素材一律走新落点。

### 2.3 前端 filmstrip 按需生成 + 持久化

**抽帧密度（zoom-aware，推荐策略 — 用户已授权由本方案判定）**：

```
计算 clip 在当前 zoom 下的像素宽度 W = clip.duration * pxPerSec
  其中 pxPerSec = ZoomLevel.toPixelsPerSecond()（既有 = zoom.value * PIXELS_PER_SECOND_BASE(=50)）
目标帧数 N = clamp(round(W / THUMB_SLOT_PX), 1, MAX_FRAMES_PER_CLIP)   # THUMB_SLOT_PX≈80
帧时刻集合（源时间）= 在 [clipStart, clipEnd] 上等距取 N 个点（用 spec 01 ClipTimeMapping 概念）
按"档位量化"：把 zoom.value 归一到有限档（如 0.25/0.5/1/2/4），同档复用，避免每次缩放都重抽
  zoomTier = 量化后的档位标识（如 "1x"），写入帧文件名 strip_{zoomTier}_{tMs}.jpg
```

- **生成**：用同源 `/api/storage/files/...` 作为 `<video>` 源（直接本地素材无需 `/api/video-proxy`），
  canvas 抽帧为 JPEG blob（宽度 ≈ slot 像素，质量 0.7）。
- **持久化**：抽到的帧 `POST` 到后端写入 `static/video/thumbnails/{materialId}/strip_{zoomTier}_{tMs}.jpg`，
  返回同源 URL；前端缓存 URL 映射（内存 + 可选 CacheStorage），下次命中直接用。
- **降级**：抽帧失败（解码错误/超时）→ 回退用 poster 平铺；不阻塞轨道渲染。
- **复用 `extractVideoFrameAt`**：filmstrip 需在**任意源时刻**抽帧，应基于既有的
  `extractVideoFrameAt(videoUrl, timeSec, opts)`（已支持 `timeSec` 定位与 `maxWidth/quality`），
  而非只抽固定中点帧的 `extractVideoThumbnail`。保留其 canvas 抽帧核心，但新增 blob 产出变体
  （现产出 data URL）→ 上传持久化；跨源路径仅对 legacy remote 素材保留 `/api/video-proxy`。

### 2.4 TimelineItem filmstrip 渲染

```
renderClipThumbnails(item, trackHeight, zoom):
  slots = 计算可见槽位（按 2.3 帧时刻集合）
  for slot in slots:
     url = filmstripCache.get(materialId, zoomTier, tMs) ?? poster ?? placeholder
     绘制 <img> 平铺在 clip 条内对应像素位置
```

- 从现状"单张 `item.thumbnailUrl`"升级为**多帧平铺**；窄 clip（N=1）退化为单张，与现状一致。
- 仅渲染可见区间帧；滚动/缩放时增量补抽（节流），不卡 UI。

### 2.5 与缓存治理（06）衔接

- 派生帧统一在 `static/video/thumbnails/{materialId}/` 下，便于 06 按 materialId 清理与孤儿回收。
- filmstrip 帧可设**容量上限**（每素材/全局），超限淘汰最久未用 zoomTier；poster 不淘汰。

## 3. 文件 / 模块变更计划 (File / Module Change Plan)

| 文件 | 动作 | 意图 |
| --- | --- | --- |
| `backend-services/basic-service/app/services/storage_service.py` | 修改 | poster 落点统一到 `static/video/thumbnails/{materialId}/poster.jpg`；保留中点抽帧 |
| `backend-services/basic-service/app/services/thumbnail_service.py` | 新建 | filmstrip 帧持久化写入 + 路径规范 + 按 materialId 列举/删除（供 06 复用） |
| `backend-services/basic-service/app/routers/storage_router.py` | 修改 | 新增 `POST /storage/thumbnail-frame`（保存前端抽帧）与（可选）`GET /storage/thumbnails/{materialId}` 列举 |
| `backend-services/basic-service/app/models/storage_models.py` | 修改 | 新增 thumbnail-frame 上传/响应模型 |
| `backend-services/basic-service/app/config.py` | 修改 | `ThumbnailConfig` 增 filmstrip 参数（slot 宽、最大帧数、质量、容量上限） |
| `backend-services/basic-service/tests/test_thumbnail_service.py` | 新建 | poster 落点、filmstrip 写入/列举/删除、materialId 归集 |
| `src/components/video/utils/extractVideoThumbnail.ts` | 修改 | 为 `extractVideoFrameAt`（任意时刻抽帧）增 blob 产出变体（供持久化）；保留既有 data URL 变体兼容其他调用方 |
| `src/components/video/lib/filmstrip/filmstripCache.ts` | 新建 | zoom-aware 帧时刻计算 + URL 缓存（内存 + 可选 CacheStorage）+ 命中/抽取/持久化编排 |
| `src/components/video/lib/api/thumbnailClient.ts` | 新建 | 调 `POST /storage/thumbnail-frame` 持久化帧 |
| `src/components/video/timeline/TimelineItem.tsx` | 修改 | 多帧平铺渲染（增量、节流、降级 poster） |
| `src/components/video/lib/filmstrip/__tests__/filmstripCache.test.ts` | 新建 | 密度计算、档位量化、命中复用、降级 |
| `src/components/video/timeline/__tests__/TimelineItem.filmstrip.test.tsx` | 新建 | 多帧渲染、窄 clip 退化单张、可见区间裁剪 |

## 4. 接口设计 (Interface Design)

新增后端 REST（同源本地）：

```http
POST /api/storage/thumbnail-frame
  multipart: { material_id, zoom_tier, t_ms, frame: <jpeg blob> }
  → { url: "/api/storage/files/static/video/thumbnails/{material_id}/strip_{zoom_tier}_{t_ms}.jpg" }

GET  /api/storage/thumbnails/{material_id}        # 可选：列举已存帧（供缓存预热/06 清理）
  → { poster?: url, frames: [{ zoom_tier, t_ms, url }] }
```

前端内存契约：

```
filmstripCache.framesFor(item, zoom): Array<{ tMs, url|null }>   // url=null 表示需抽取
filmstripCache.ensure(item, zoom): Promise<void>                  // 抽取缺失帧并持久化
```

## 5. 数据模型 (Data Model)

无 DB 迁移（缩略图为文件，不入库；归属由目录 `{materialId}/` 表达）。可选：06 若需登记派生文件以
便孤儿回收，可在 `cached_materials` 增 `thumbnail_dir` 字段（由 06 决定，本 spec 不强制）。

持久化（06）：项目保存时 clip 仅需保留 `materialId`（poster/filmstrip 由 materialId 重新解析），
无需把帧 URL 写进项目 JSON；窄 clip 的单 `thumbnailUrl` 仍可作快照兜底。

落盘约定：
```
STORAGE_ROOT/static/video/thumbnails/{materialId}/
    poster.jpg
    strip_{zoomTier}_{tMs}.jpg ...
```

## 6. 测试与验收 (Testing & Acceptance)

先写失败用例。

后端：
1. 上传视频 → poster 落到 `static/video/thumbnails/{materialId}/poster.jpg`，`thumbnail_url` 同源可取。
2. `POST /storage/thumbnail-frame` → 帧落到规范路径，返回同源 URL，可二次 GET。
3. `thumbnail_service` 按 materialId 列举/删除全部派生帧（供 06）。

前端：
4. `filmstripCache`：给定 clip + zoom → 帧时刻集合数量符合密度公式；档位量化命中复用；缺失触发抽取。
5. `TimelineItem`：宽 clip 渲染多帧平铺、窄 clip 退化单张、仅渲染可见区间；抽帧失败降级 poster。
6. 直接本地素材抽帧用同源 `/api/storage/files`，不走 `/api/video-proxy`。

命令：
```bash
npm run type-check
npm run test -- src/components/video/lib/filmstrip/__tests__/filmstripCache.test.ts
npm run test -- src/components/video/timeline/__tests__/TimelineItem.filmstrip.test.tsx
pytest backend-services/basic-service/tests/test_thumbnail_service.py -v
```

桌面手动走查：导入视频 → 轨道上看到 poster → 拉宽/缩放 clip 出现 filmstrip 多帧 → 重载项目后
filmstrip 仍在（持久化命中，不重抽）；Network 仅同源 `/api/storage/files` 与 `/storage/thumbnail-frame`。

## 7. 风险与缓解 (Risks & Mitigations)

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 前端大量抽帧阻塞主线程/解码竞争（中等性能、20–50 clip） | 轨道卡顿 | 仅可见区间 + 增量补抽 + 节流；档位量化复用；离屏 video 解码池上限；失败降级 poster |
| filmstrip 帧持久化导致存储膨胀 | 占用增长 | 容量上限 + LRU 淘汰旧 zoomTier；06 删素材联动清理 + 孤儿回收 |
| poster 落点变更影响既有 `thumbnail_url` 消费方 | 旧引用失效 | 兼容读旧 `thumb_{stem}.jpg`；新素材走新落点；不回删旧文件（由 06 孤儿回收处理） |
| 大量小文件（每 clip 多帧多档）拖慢文件系统 | IO 变慢 | 可选 sprite 合并（同 clip 同档多帧拼一张 sprite）作为后续优化，本期先单帧文件，路径预留 |
| 抽帧时序与 spec 01 clip 区间不一致 | 帧与 clip 内容错位 | 帧时刻在 [clipStart, clipEnd] 内取点，复用 spec 01 区间语义 |
