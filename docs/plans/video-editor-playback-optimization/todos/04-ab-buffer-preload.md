# TODO 04：A/B 双缓冲与预加载策略

> Reference: [`specs/04-ab-buffer-preload.md`](../specs/04-ab-buffer-preload.md)

## Dependencies

- `depends_on`: [02, 03]
- `blocks`: [07]
- `parallel_group`: C
- 说明：需要 PlaybackEngine（02）与 CanvasCompositor（03）的真实实现已落地。可在 spec 05/06 未上线时使用原始 URL 测试（fallback）。

## Tasks

- [ ] 实现 `AbBufferController`：`bindActive`、`prewarmNext`、`swapActive`、`getActiveElement`、`getPrewarmElement`、`releaseAll`
- [ ] `bindActive` 实现：pickBufferForActive → set src（如 mismatch）→ wait `loadedmetadata` → set currentTime → wait `seeked`（超时 `maxSeekMsBeforeForceRebind=500`，超时则重建一次）
- [ ] `prewarmNext` 实现：duration < `shortClipThresholdSec`（1.5s）短路；set src → wait loadedmetadata → seek 0 → wait seeked → pause；同时 `videoCache.preloadVideo(...)`
- [ ] `swapActive` 实现：检查 prewarm 元素 `readyState ≥ HAVE_FUTURE_DATA(3)`；未就绪 fallback 到串行 `bindActive`；prewarm.play() → compositor.setActiveSource(prewarm) → active.pause() → swap roles
- [ ] 在 `PreviewSurface.tsx` v2 分支挂载两个隐藏 `<video>` 元素：`muted playsInline preload="auto"`，CSS 隐藏
- [ ] 元素 `error` 事件：标记失败 → 重建（remove src + load + reassign）一次；二次失败 → 抛 BufferError
- [ ] 在 PlaybackEngine 主 tick 内集成 prewarm 触发：`compositionTime ≥ S_k.end - PREWARM_LEAD(1.0s)` → `prewarmNext(S_{k+1}.id)`
- [ ] 在 PlaybackEngine 中实现 boundary 切换：`compositionTime ≥ S_k.end` → `swapActive()`；active_sequence_index++
- [ ] 音频策略：A/B 元素 muted；active 元素取消 muted；swap 时新 active 先 muted 接管画面，1 帧后取消 muted；旧 active 立即 muted
- [ ] 单测 `AbBufferController.test.ts`：bindActive 正常路径 / prewarmNext 正常路径 / swapActive 在 prewarm ready 时 < 1 tick 完成 / swapActive 在 prewarm 未就绪时 fallback / 短 clip 跳过 prewarm / error 重建一次后成功 / 二次失败抛错
- [ ] 集成测试 `abBuffer.integration.test.ts`：与 mock VideoCacheAdapter 协作，windowed prefetch 调用次数正确
- [ ] 手动性能基准：10 sequence 拼接 10s 视频，boundary 闪屏目视不可见（开发工具录屏对比）
- [ ] 退役/弃用现状代码：`transitionIdRef`、`isSeekingRef`、`pendingCompositionSeekRef`、`releaseSeekLock`（仅 v2 path；legacy path 保留）
