# TODO 07：前端缓存与代理 URL 集成

> Reference: [`specs/07-frontend-cache-integration.md`](../specs/07-frontend-cache-integration.md)

## Dependencies

- `depends_on`: [04, 05, 06]
- `blocks`: []
- `parallel_group`: D
- 说明：把前端 v2 栈与后端代理 / 转码端点对接的最后一步。需要 spec 04 的 AbBufferController 已能消费 `effectivePreviewUrl`，以及 spec 05/06 端点上线。Spec 06 未上线时本 spec 仍可工作（preview-proxy 路径自动 fallback 到 spec 05 原片代理）。

## Tasks

- [ ] 扩展 `src/components/video/lib/selectPlaybackUrl.ts`：新增 `preferPreviewProxy` / `previewFallback` 选项；实现 P1-P5 优先级（spec 07 §3.2）
- [ ] 同文件新增 `effectivePreviewUrl(material, opts?)` 薄包装，供 AbBufferController / Engine 使用
- [ ] 单测 `selectPlaybackUrl.previewProxy.test.ts`：覆盖所有 P1-P5 优先级、failed 降级、export purpose 不受影响
- [ ] 新增 `src/components/video/timeline/infrastructure/MediaProxyClient.ts`：`buildProxyUrl` / `requestPreviewProxy` / `getPreviewProxyStatus` / `watchPreviewProxy`
- [ ] MediaProxyClient 解包后端 `{success, data}` 信封；轮询 2s 一次，累计 10 分钟超时
- [ ] 单测 `MediaProxyClient.test.ts`：buildProxyUrl 重写正确、requestPreviewProxy 幂等、watchPreviewProxy 到 cached 后 unsubscribe
- [ ] 修改 `VideoCacheAdapter`：`maxCacheSize` 默认 32；新增 `proxyOriginPrefix: '/api/media/proxy?'`；扩展 `isSameOrigin` 接受该前缀；新增 `markUsed(id)` 与 `preloadSequenceWindow(items)` 与 `getMemoryStats()`
- [ ] `preloadSequenceWindow` 内并发上限 3、去重、跨调用 abortable
- [ ] 单测 `VideoCacheAdapter.window.test.ts`：LRU=32、proxy URL 视为同源、并发上限、abort
- [ ] 改造 `useVideoCache.ts`：导出 `preloadSequenceWindow` / `markUsed`
- [ ] 改造 `useRemoteMaterialPrefetch.ts`：监听 `compositionPlayback` 变化 → 计算 `[k-1..k+2]` 窗口 → 调用 `preloadSequenceWindow`
- [ ] 在 `useMaterialManagement.addMaterials`（既有）回调或"素材首次加入 timeline"的入口实现：若 material 为远端 / 高码率（`bytes > 50MB` 或 `bitrate > 8Mbps` 或 source ∈ {ark, pexels}）→ `mediaProxyClient.requestPreviewProxy(materialId)` + `watchPreviewProxy(...)`
- [ ] watchPreviewProxy 回调把 status / progress 写回 timeline store 内 material 的 `preview_proxy_*` 字段（camelCase）；用 `/api/material/lookup` 拿到 `preview_proxy_local_url` / `preview_proxy_oss_url` 真值
- [ ] 单测 `useRemoteMaterialPrefetch.test.ts`：timeline 变化 → preloadSequenceWindow 被调用；启发式触发 requestPreviewProxy；watch 回写 store
- [ ] PlaybackEngine 在 bindActive 时调用 `effectivePreviewUrl(seq)`；preview-proxy 期间 cached 不强制热替换 src（自然在下次 bindActive 升级）
- [ ] 端到端手测：添加 Pexels 视频 + 高码率本地视频 + ARK 视频 → 播放流畅 + DevTools Network 显示 `/api/media/proxy?u=...` 请求 + `cached_materials.preview_proxy_status` 在数据库内最终变 `cached`
