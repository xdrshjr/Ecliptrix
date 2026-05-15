# TODO 03：Canvas 预览合成器

> Reference: [`specs/03-canvas-compositor.md`](../specs/03-canvas-compositor.md)

## Dependencies

- `depends_on`: [01]
- `blocks`: [04]
- `parallel_group`: B
- 说明：与 spec 02 并行；只依赖 spec 01 接口骨架。被 spec 04 在 swap 时调用 `setActiveSource`。

## Tasks

- [ ] 实现 `CanvasCompositor`：`attach(canvas, viewport?)`、`detach()`、`setOverlays(p)`、`setLetterbox(v)`、`setActiveSource(video)`、`drawFrame(frame)`、`captureFrame()`、`getStats()`
- [ ] attach 内创建 2D ctx：`willReadFrequently=false`、`imageSmoothingQuality='high'`
- [ ] 实现 `letterbox` 计算（按 viewport aspectRatio 居中裁切）
- [ ] 实现 ResizeObserver：父容器尺寸变化时重设 canvas 物理像素并触发 redraw
- [ ] 实现 `drawFrame` 主流程：fillBackground → drawVideoLetterboxed → drawSubtitles → drawImageOverlays → drawWatermark
- [ ] 实现 `keepLastFrame()` 路径（frame.source 不可用时不清画布）
- [ ] 实现 `captureFrame()`：`canvas.toDataURL('image/png')`，不暂停 video
- [ ] 实现自适应降级：每 1s `droppedFrames/drawnFrames > 20% → targetFps=30`；连续 3s > 50% → 触发 `onDegrade('low-fps')`
- [ ] canvas 物理像素硬上限 1920×1080；DPR > 2 按 2 截断
- [ ] 改造 `PreviewSurface.tsx`（v2 分支）：mount 时 `compositor.attach()`；`aspectRatioId` 变更 → `setLetterbox`；unmount 时 `detach()`
- [ ] 单测 `CanvasCompositor.test.ts`：mock canvas 2D context；断言 drawImage 调用顺序 fill→video→subtitles→images；`setActiveSource(null)` 不清画面（不调用 fillRect）；DPR=2 时 canvas.width/height 正确缩放
- [ ] 单测 `PreviewSurface.v2.test.tsx`：mount/unmount attach/detach 对称；aspectRatioId 变化触发 setLetterbox
- [ ] 现状 `VideoPlayerPanel.captureFrameToCanvas` 在 v2 分支由 `CanvasCompositor.captureFrame()` 替代；`VideoCoverModal` 改为通过 v2 path 取截图（兼容旧路径）
- [ ] 性能基线手测：1080p + 3 张图片叠加 + 字幕一行 → 单 tick `lastDrawMs` ≤ 4ms（dev 工具采样 100 帧）
