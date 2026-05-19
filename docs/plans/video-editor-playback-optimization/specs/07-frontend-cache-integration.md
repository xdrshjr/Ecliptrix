# Spec 07：前端缓存与代理 URL 集成

> 关联：[`master-plan.md`](../master-plan.md)、[`04-ab-buffer-preload.md`](04-ab-buffer-preload.md)、[`05-backend-media-proxy.md`](05-backend-media-proxy.md)、[`06-backend-preview-proxy-transcode.md`](06-backend-preview-proxy-transcode.md)
> 阶段：Phase 1（必做，除 preview proxy 部分外）
> 状态：**v2（评审修订，2026-05-15）**

## 一、目的（Purpose）

把前端"取得一个可在 `<video>.src` 上播的 URL"这件事，统一收敛到单点决策器 **`selectPlaybackUrl`**，并与 spec 05 同源代理、spec 06 预览代理打通，同时扩展 `VideoCacheAdapter` 支持窗口式预取。最终：

- A/B Buffer（spec 04）调用 `effectivePreviewUrl(seq)` 即可拿到最佳预览 URL（preview proxy > 同源代理 > 本地 cacheUrl > 原 URL）。
- 导出路径仍取 `purpose='export'`，原片 URL 不变（master-plan D7）。
- `VideoCacheAdapter` 把窗口内 `[k-1, k, k+1, k+2]` sequence 自动预拉、LRU 容量从 20 提到 32。
- 用户首次把素材加入 timeline 时触发后端 preview-proxy 转码请求（spec 06）。

## 二、范围

### 范围内

- 扩展 `src/components/video/lib/selectPlaybackUrl.ts`（现有），增加 preview-proxy / proxy-rewrite 分支。
- 新增 `src/components/video/timeline/infrastructure/MediaProxyClient.ts`：封装 `/api/media/proxy` 与 `/api/media/preview-proxy` 客户端。
- 扩展 `src/components/video/timeline/infrastructure/VideoCacheAdapter.ts`：
  - LRU 容量从 20 提到 32。
  - sameOriginOnly 仍生效，但同源判断包含 `/api/media/proxy?` 重写后的 URL。
  - 新增 `markUsed` 与 `preloadSequenceWindow` 接口。
- 扩展 `src/components/video/hooks/useVideoCache.ts`、`useRemoteMaterialPrefetch.ts`：调用新接口。
- 在 timeline 添加素材到 timeline 的入口（`addItem` action）触发 preview-proxy 异步请求。
- 前端 react 客户端不阻塞渲染：preview-proxy 在 `cached` 前继续用代理原片，`cached` 后下一次 `bindActive` 升级到 preview。

### 范围外

- 后端实现细节（spec 05 / 06）。
- A/B Buffer 行为（spec 04 调用本 spec 的 `effectivePreviewUrl`）。

## 三、决策器：`selectPlaybackUrl`（扩展）

本 spec 不引入新函数，**直接在现有 `selectPlaybackUrl` 内扩展 `purpose='preview'` 分支**，复用调用点。`effectivePreviewUrl` 仅作为 §6.3 中 A/B Buffer 调用方便的语义别名，可选实现为薄包装：

```ts
// 可选别名（建议放在同文件）
export const effectivePreviewUrl = (
  material: MaterialItem | PlaybackInput,
  opts?: { preferPreviewProxy?: boolean; fallback?: 'proxy' | 'origin' },
): string =>
  selectPlaybackUrl(material, {
    purpose: 'preview',
    preferPreviewProxy: opts?.preferPreviewProxy ?? true,
    previewFallback: opts?.fallback ?? 'proxy',
  });
```

### 3.1 输入 / 输出

扩展后的 `selectPlaybackUrl` 选项（向后兼容现有签名）：

```ts
interface SelectPlaybackUrlOptions {
  purpose?: 'preview' | 'export';        // 既有
  preferPreviewProxy?: boolean;          // 新增，默认 true（仅 preview 生效）
  previewFallback?: 'proxy' | 'origin';  // 新增，默认 'proxy'（仅 preview 生效）
}
```

返回值仍为 `string`（空字符串表示无 URL），**保持与现有签名一致**，不改为 `string | null`。

### 3.2 优先级（自上而下）

| 优先级 | 来源 | 条件 | 产生 URL |
|--------|------|------|----------|
| P1 | `material.preview_proxy_local_url` | preferPreviewProxy && previewProxyStatus='cached' | 同源 `/api/storage/files/preview-proxies/...` |
| P2 | `proxyRewrite(material.preview_proxy_oss_url)` | preferPreviewProxy && previewProxyStatus='cached' && 无 local | 同源 `/api/media/proxy?u=<encoded oss>`（避免 OSS 跨域被 VideoCacheAdapter 拒绝） |
| P3 | `material.cacheUrl` / `local_url` | 已有同源缓存（cached_materials） | 同源 `/api/storage/files/cached_materials/...`（沿用现有 selectPlaybackUrl 的 'preview' 逻辑） |
| P4 | `proxyRewrite(material.url)` | url 跨域且 in 白名单（见 spec 05 §4.3）| 同源 `/api/media/proxy?u=<encoded>` |
| P5 | `material.url` | 兜底（previewFallback='origin' 或不在代理白名单）| 原始 URL（可能跨域，绕过 VideoCacheAdapter） |

> 注：P2 选择走同源代理而非直连 OSS，是因为 `VideoCacheAdapter.sameOriginOnly=true` 会丢弃跨域 URL（见 §5.1）。如果未来允许直连 OSS，需要同步放宽 `isSameOrigin` 对 OSS host 的判定。

### 3.3 导出路径

`selectPlaybackUrl(seq, { purpose: 'export' })`：保持现有行为，跳过 P1/P2/P4，直接走 `serverUrl || url`。本 spec 不改导出。

### 3.4 单测

- `previewProxyStatus='cached'` + `previewProxyLocalUrl` → P1
- `previewProxyStatus='cached'` + 仅 `previewProxyOssUrl` → P2（经 proxy 重写）
- `previewProxyStatus='failed'` → 跳过 P1/P2，落 P3/P4/P5
- 同源 `cacheUrl` 存在 → P3
- 跨域 url + 在白名单 + `previewFallback='proxy'` → P4 重写
- 跨域 url + `previewFallback='origin'` → P5（前端 console.warn）
- `purpose='export'`：忽略所有 preview-proxy / proxy 重写，仅取 `serverUrl || url`

## 四、`MediaProxyClient`

### 4.1 API

```
class MediaProxyClient {
  buildProxyUrl(rawUrl: string): string
    // 返回 '/api/media/proxy?u=' + encodeURIComponent(rawUrl)
    // 校验：rawUrl 必须是合法 https://...；返回值是同源相对路径

  requestPreviewProxy(materialId: string, opts?: {
    sourceUrl?: string
    profile?: 'preview-480p'
    priority?: 'normal' | 'high'
  }): Promise<PreviewProxyTask>
    // 内部解包 spec 06 §3.1 的 { success, data } 信封后返回 data

  getPreviewProxyStatus(materialId: string): Promise<PreviewProxyStatus>
    // 内部解包 spec 06 §3.2 的 { success, data } 信封后返回 data

  // 订阅：每 2s 轮询 status 直到 'cached' / 'failed'
  watchPreviewProxy(materialId: string, onUpdate: (s: PreviewProxyStatus) => void): () => void
}
```

类型：

```
interface PreviewProxyTask {
  task_id: string
  material_id: string
  status: 'queued' | 'running' | 'cached' | 'failed'
  preview_proxy_url: string | null
}

interface PreviewProxyStatus extends PreviewProxyTask {
  profile: string
  progress_percent: number              // 与 spec 06 §3.2 一致
  last_error: string | null
  preview_proxy_url: string | null      // OSS 公网 URL 或同源 /api/media/proxy?u=...（spec 06 §3.2 单字段返回）
  transcoded_at: string | null
  duration_sec: number | null
  bytes: number | null
}
```

> 说明：spec 06 §3.2 仅返回 `preview_proxy_url`（聚合后的"最佳 URL"），并不区分 `local_url` / `oss_url`。前端在 store 中拆分为 `previewProxyLocalUrl` / `previewProxyOssUrl` 字段，需要通过 `/api/material/lookup`（既有接口）拿到 DB 原始字段，**而非**从 `preview-proxy/status` 解析。`MediaProxyClient.watchPreviewProxy` 仅负责状态与进度推送，URL 真值由 material lookup 提供。

### 4.2 错误处理

- 网络失败 / 403 → 抛 `PreviewProxyError(code)`；上游消费方应吞错并退回原片代理。
- 超时（轮询时累计 10 分钟未完成）→ 自动 `unsubscribe` 并把状态视为 `failed`。

## 五、`VideoCacheAdapter` 扩展

### 5.1 配置变更

```
DEFAULT_CONFIG = {
  maxCacheSize: 32,                 // 20 → 32
  preloadTimeout: 30000,
  enableLRU: true,
  sameOriginOnly: true,
  // 新增：proxy 重写后的 URL 视为同源（即使原 URL 跨域）
  proxyOriginPrefix: '/api/media/proxy?'
}
```

`sameOriginOnly` 判断改为：

```
isSameOrigin(url):
  if url starts with '/' or with proxyOriginPrefix → true
  parsed = new URL(url, location.origin)
  return parsed.origin === location.origin
```

### 5.2 新增接口

```
class VideoCacheAdapter {
  ...existing...
  markUsed(materialId: string): void
    // 把 LRU 时间戳更新到 now，避免被淘汰
  preloadSequenceWindow(items: Array<{
    materialId: string,
    url: string,
    priority?: 'high' | 'normal'
  }>): void
    // best-effort 批量预热；high 优先；
    // 每个 url 走 buildProxyUrl 重写（如跨域）
  getMemoryStats(): { count, approxBytes }
    // 估算用于内存压力判定
}
```

### 5.3 行为

- `preloadSequenceWindow`：内部去重、并发 ≤ 3、跨调用 abortable。
- 调用 `buildProxyUrl(url)` 把远端 URL 重写为同源后再 set src，绕过 sameOriginOnly。

## 六、Hook 改造

### 6.1 `useVideoCache`

- 暴露 `preloadSequenceWindow`、`markUsed` 给 PlaybackEngine 调用。
- 内部 `getCachedVideo` 接受**已重写**的 URL；调用方负责通过 `effectivePreviewUrl` 取 URL。

### 6.2 `useRemoteMaterialPrefetch`

- 在 timeline `compositionPlayback` 变化时：
  - 计算窗口 `[k-1, k+2]`。
  - 调用 `videoCache.preloadSequenceWindow(items)`。
- **preview-proxy 转码触发点（v2 修订）**：仅在 **素材首次进入 timeline** 时触发，挂载点为 timeline `addItem` action（`src/components/video/timeline/store/actions/addItem.ts`）的成功回调，而**非** `useMaterialManagement.addMaterials`（后者只做素材库 hydrate，触发转码会对未使用的素材浪费配额并打满 spec 06 §四 队列）。
  - 触发条件：material `preview_proxy_status` 为 `absent` 或 `failed`，且素材命中以下任一启发式 → 调用 `mediaProxyClient.requestPreviewProxy(materialId)`：
    - 启发式 H1：`bytes > 50MB`
    - 启发式 H2：`bitrate > 8Mbps`（若 metadata 已知）
    - 启发式 H3：`source ∈ {'ark', 'pexels'}`（高码率远端源）
  - 触发后 `mediaProxyClient.watchPreviewProxy(...)` 订阅，把 `previewProxyStatus / previewProxyLocalUrl / previewProxyOssUrl / previewProxyProgress` 写回 store 内 material 元数据（**仅元数据 hydrate，不改播放真值；不修改 sequence 的 url 字段**）。
  - 同一 materialId 多次 `addItem` 不重复触发：由 `mediaProxyClient.requestPreviewProxy` 自身幂等（spec 06 §3.1）+ 前端 in-flight Set 去重。
- `useMaterialManagement.addMaterials`（`hooks/useMaterialManagement.ts:683`，行号仅供参考）回调侧：**只做** `previewProxy*` / `proxyStatus` 等字段的元数据 hydrate（从 `/api/material/lookup` 响应同步到 store），**不调用** `requestPreviewProxy`。

### 6.3 与 PlaybackEngine

- 启动 / seek 时：Engine 调用 `effectivePreviewUrl(seq)` → 把结果交给 `AbBufferController.bindActive`。
- preview-proxy 在播放期间变为 `cached`：Engine 不立即热替换 src（避免打断当前帧）；下一次 `bindActive` 或 `prewarmNext` 自然升级。
- 在 idle/paused 时若新 preview 已 ready，Engine 可主动重新 `bindActive` 以升级（可选优化，首期不做）。

## 七、Timeline Store 字段映射

`material` 对象在 store 中加上以下可选字段（沿用 `cached_materials` 表名，前端 camelCase）：

| 前端字段 | 后端字段 |
|----------|----------|
| `previewProxyStatus` | `preview_proxy_status` |
| `previewProxyLocalUrl` | `preview_proxy_local_url` |
| `previewProxyOssUrl` | `preview_proxy_oss_url` |
| `previewProxyProgress` | `preview_proxy_progress` |
| `proxyStatus` | `proxy_status`（spec 05） |
| `cacheUrl` / `localUrl` | 既有，沿用 |

`useMaterialManagement` 在 ingest/lookup 响应中读取并写入 store。

## 八、与现有 `selectPlaybackUrl` 的兼容

- 现状文件：`src/components/video/lib/selectPlaybackUrl.ts`，实际签名 `(material, { purpose }): string`（空字符串而非 `null`，见现有实现）。
- 本 spec 不破坏返回类型；扩展 `purpose='preview'` 分支：
  - 新增 `preferPreviewProxy`、`previewFallback` 可选项，默认开启 preview proxy。
  - 优先 P1–P5（新逻辑），P3 仍命中现有 `cacheUrl` → `toAbsolutePlaybackUrl` 行为。
  - `purpose='export'`：保持现有行为（`serverUrl || url`），不读 preview-proxy 字段。
- 现有调用方（如 `CompositionAdapter`）自动获益；未传新选项时默认走 P1→P5 流程。
- `toAbsolutePlaybackUrl` 工具函数继续复用，无需新实现。

## 九、测试

- `src/components/video/lib/__tests__/selectPlaybackUrl.previewProxy.test.ts`
  - P1–P5 各优先级覆盖
  - failed 状态降级
- `src/components/video/timeline/infrastructure/__tests__/MediaProxyClient.test.ts`
  - buildProxyUrl 重写
  - requestPreviewProxy 幂等（cached 短路返回）
  - watchPreviewProxy 轮询直到 cached
- `src/components/video/timeline/infrastructure/__tests__/VideoCacheAdapter.window.test.ts`
  - LRU 容量 32
  - sameOrigin 判断对 proxy URL 返回 true
  - preloadSequenceWindow 并发上限
- `src/components/video/hooks/__tests__/useRemoteMaterialPrefetch.test.ts`
  - timeline 变化 → 触发 preloadSequenceWindow
  - **addItem 触发** requestPreviewProxy（启发式 H1/H2/H3 任一命中）
  - **addMaterials 不触发** requestPreviewProxy（断言 spy 调用次数为 0）
  - 同一 materialId 重复 `addItem` 仅触发一次
  - watch 回写 store 元数据，不改 sequence.url

## 十、Open Questions

1. **启发式判断"是否需要预览代理"**：当前用 `bytes > 50MB` 或 `bitrate > 8Mbps` 或 `source='ark'/'pexels'`。是否给后端一个 endpoint 让前端先 probe 元数据，再决定？倾向：首期前端启发式即可，后端可拒绝小文件不转码。
2. **proxy URL 缓存与 cookie**：浏览器对 `/api/media/proxy?u=...` 会带 cookie。是否影响 OSS 命中？倾向：后端响应带 `Cache-Control: public, max-age=...`，CDN/浏览器各自缓存。
3. **重试**：preview-proxy 轮询 timeout 后是否自动重试？倾向：不重试（避免无限 loop），让用户在面板看到 hint。
4. **是否对 image 素材也走代理**？倾向：仅对 video 走，图片直接渲染 `<img>`（不在 A/B Buffer 中）。

## 十一、参考

- [`master-plan.md`](../master-plan.md) §4.2（VideoCacheAdapter 扩展）、§5（D5/D6/D12 决策）
- [`04-ab-buffer-preload.md`](04-ab-buffer-preload.md) §5.7（VideoCacheAdapter 协议）
- [`05-backend-media-proxy.md`](05-backend-media-proxy.md) §3 接口
- [`06-backend-preview-proxy-transcode.md`](06-backend-preview-proxy-transcode.md) §3 接口
- 现状：`src/components/video/lib/selectPlaybackUrl.ts`、`src/components/video/timeline/infrastructure/VideoCacheAdapter.ts`、`src/components/video/hooks/useRemoteMaterialPrefetch.ts`、`src/components/video/timeline/infrastructure/RemoteMaterialPrefetchAdapter.ts`、`src/components/video/timeline/store/actions/addItem.ts`（v2 修订后的 preview-proxy 触发点）

---

## 评审修订（v2，2026-05-15）

- §6.2：preview-proxy 转码触发点从 `useMaterialManagement.addMaterials`（素材库入库）改为 timeline `addItem` action（首次进入 timeline）。`addMaterials` 仅做元数据 hydrate。新增"同一 materialId 不重复触发"约束与配套测试。修订理由：master-plan v2 §0.2 F3——避免对未使用素材浪费转码配额、避免 spec 06 队列被无用任务打满。
