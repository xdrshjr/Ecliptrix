# TODO 03 — 本地缩略图（poster + filmstrip）

> 对应 spec：[`specs/03-local-thumbnails.md`](../specs/03-local-thumbnails.md)

## Dependencies

- `depends_on: []` — 与 01 弱关联（filmstrip 帧时刻用 clip 区间概念），可独立开工。
- `blocks: [06]` — 06 的删除联动清理与孤儿回收需 03 暴露的 `delete_by_material`/目录约定。
- `parallel_group: A` — 第一批（与 01、04 并行；不同领域）。
- 理由：缩略图后端 poster + 前端 filmstrip 自成一体；仅向 06 提供清理钩子与目录约定。
- **同文件协调**：与 04 同改 `storage_router.py`/`storage_models.py`/`config.py`（端点/模型不重叠：thumbnail-frame vs waveform）。

## Tasks（按实现顺序）

### 后端 poster 落点统一 + filmstrip 持久化
- [ ] 写失败用例 `tests/test_thumbnail_service.py`：poster 落点、filmstrip 写入/列举/删除、materialId 归集
- [ ] `config.py`：`ThumbnailConfig` 增 filmstrip 参数（slot 宽、最大帧数、质量、容量上限）
- [ ] `storage_service.py`：poster 统一落到 `static/video/thumbnails/{materialId}/poster.jpg`（兼容读旧 `thumb_{stem}.jpg`）
- [ ] 新建 `services/thumbnail_service.py`：filmstrip 帧写入 + 路径规范 + 按 materialId 列举 + `delete_by_material`（暴露给 06 删除联动/孤儿回收）
- [ ] `storage_models.py`：thumbnail-frame 上传/响应模型
- [ ] `storage_router.py`：`POST /storage/thumbnail-frame`（+ 可选 `GET /storage/thumbnails/{materialId}` 列举）

### 前端 filmstrip 生成 + 渲染
- [ ] 写失败用例 `filmstripCache.test.ts`：密度公式、zoom 档位量化、命中复用、降级
- [ ] `utils/extractVideoThumbnail.ts`：为 `extractVideoFrameAt`（任意时刻）增 blob 产出变体（保留 data URL 变体）
- [ ] 新建 `lib/filmstrip/filmstripCache.ts`：zoom-aware 帧时刻计算（pxPerSec=ZoomLevel.toPixelsPerSecond）+ URL 缓存 + 抽取/持久化编排
- [ ] 新建 `lib/api/thumbnailClient.ts`：调 `POST /storage/thumbnail-frame`
- [ ] 写失败用例 `TimelineItem.filmstrip.test.tsx`：多帧平铺、窄 clip 退化单张、可见区间裁剪、降级 poster
- [ ] `TimelineItem.tsx`：多帧平铺渲染（增量、节流、降级）；直接本地素材抽帧用同源 `/api/storage/files`（不走 video-proxy）

### 验收
- [ ] `npm run type-check` + 上述 vitest + `pytest test_thumbnail_service.py` 全绿
- [ ] 桌面走查：导入 → poster → 拉宽/缩放出 filmstrip → 重载命中持久化不重抽；Network 仅同源
