# Spec 04 — Frame Scrubber & Upload

> 父：`master-plan.md` §5.3（虚拟时间轴）, §6.4（imageSource 字段）
> 范围：抽帧滑块、虚拟时间轴构建、`extractVideoFrameAt` 工具扩展、本地图片上传备选

## 1. Goals

- G4.1 抽帧拖拽器只能落在"有视频画面"的虚拟时间内（跳过空档与纯音频）
- G4.2 拖动 200ms debounce 后调用 `extractVideoFrameAt` 取得帧 dataURL
- G4.3 LRU 缓存最近 8 个 (clipUrl, time) → dataURL 结果
- G4.4 源切换控件：`抽帧 ↔ 上传`，互斥；切换时清空对方状态
- G4.5 上传：接受 image/png 与 image/jpeg；最大 10MB；前端校验后 `POST /api/storage/upload`（复用现有 storage 服务）
- G4.6 项目无视频素材时滑块禁用 + 自动切换到上传模式

## 2. 文件改动列表

### 2.1 新增

```
src/components/video/components/VideoCoverModal/
├── FrameScrubberOrUpload.tsx        # 上层容器，包源切换
├── FrameScrubber.tsx
├── ImageUploadInput.tsx
├── FrameScrubberOrUpload.module.css
├── hooks/
│   └── useFrameExtraction.ts
└── __tests__/
    ├── buildVirtualSegments.test.ts
    ├── mapVirtualTimeToClip.test.ts
    ├── useFrameExtraction.test.tsx
    └── ImageUploadInput.test.tsx
```

```
src/components/video/utils/
└── extractVideoFrameAt.ts           # 新增（参考现有 extractVideoThumbnail.ts）
```

### 2.2 修改

`src/components/video/utils/extractVideoThumbnail.ts` — **不修改原函数 `extractVideoThumbnail(videoUrl)`（签名为 `(videoUrl: string) => Promise<string | null>`，已确认）**。

> **关于 `proxiedVideoUrl`**：现有 `extractVideoThumbnail.ts` 顶部定义了一个 **未导出** 的 `proxiedVideoUrl(url: string)` 本地辅助函数（已确认行 1-9）。要在新文件 `extractVideoFrameAt.ts` 内复用它有两种做法（任选其一）：
>
> 1. **推荐**：把 `proxiedVideoUrl` 改为 `export function proxiedVideoUrl(...)`（一行 diff，不破坏既有调用）。新文件 `import { proxiedVideoUrl } from './extractVideoThumbnail'`。
> 2. **备用**：在 `extractVideoFrameAt.ts` 内复制同样几行实现（重复但零依赖耦合）。
>
> 本 spec 默认走方案 1。

## 3. 虚拟时间轴

### 3.1 数据来源

`VideoCoverModal` 已通过 props 拿到 `timelineItems` 和 `materials`。

> **字段名校正（已对照 `src/components/video/timeline/domain/types.ts:39-63` 的 `TimelineItemData`）**：
>
> - 轨道分类用 `type: 'video' | 'audio' | 'subtitle'`（**不是** `mediaType`）
> - **没有** `endTime` 字段；时长用 `duration`，结束时间需算 `startTime + duration`
> - 源素材内偏移用 `clipStart`（**不是** `materialStart`）
> - 区分"视频画面"vs"图片素材"用 `originalMaterialType: MaterialType`（取自 `src/types/index.ts`，包含 `'video' | 'audio' | 'image' | ...`）；同一个 `type='video'` 轨道上的素材，`originalMaterialType==='image'` 才是静态图
>
> ```ts
> import type { TimelineItemData } from '@/components/video/timeline/domain/types';
> // TimelineItemData 字段（截选，已确认 types.ts:39-63）:
> //   id, type ('video' | 'audio' | 'subtitle'),
> //   startTime, duration, trackId, materialId,
> //   clipStart, clipEnd, originalDuration,
> //   originalMaterialType ('video' | 'audio' | 'image' | ...), ...
> ```

### 3.2 构建函数

```ts
// utils/buildVirtualSegments.ts
export interface VirtualSegment {
  virtualStart: number;     // 秒
  virtualEnd: number;
  materialId: string;
  clipOffset: number;       // 该 clip 在源素材内的起始时间（秒）
}

export interface VirtualTimeline {
  segments: VirtualSegment[];
  totalDurationSec: number;
}

export function buildVirtualSegments(
  timelineItems: TimelineItemData[]
): VirtualTimeline {
  // 仅保留视频轨且素材原始类型为 video 的条目（排除静态图占位与音频轨）。
  const videoItems = timelineItems
    .filter(it =>
      it.type === 'video' &&
      // originalMaterialType 缺省时按 'video' 处理（向后兼容旧数据）
      (it.originalMaterialType === 'video' || it.originalMaterialType === undefined) &&
      !!it.materialId,
    )
    .sort((a, b) => a.startTime - b.startTime);

  let cumulative = 0;
  const segments: VirtualSegment[] = [];
  for (const it of videoItems) {
    const dur = it.duration;             // 时间轴上的"显示时长"
    if (!dur || dur <= 0) continue;
    segments.push({
      virtualStart: cumulative,
      virtualEnd: cumulative + dur,
      materialId: it.materialId!,
      clipOffset: it.clipStart ?? 0,     // 该 clip 在源素材内的起始时间
    });
    cumulative += dur;
  }
  return { segments, totalDurationSec: cumulative };
}

export function mapVirtualTimeToClip(
  virtualTime: number,
  vt: VirtualTimeline
): { materialId: string; localTime: number } | null {
  if (vt.segments.length === 0) return null;
  // 取最后一个 virtualStart <= virtualTime 的 segment（兼容 virtualTime === totalDuration）
  let target: VirtualSegment | null = null;
  for (const seg of vt.segments) {
    if (seg.virtualStart <= virtualTime && virtualTime < seg.virtualEnd) {
      target = seg; break;
    }
  }
  if (!target) {
    // 边界情况：virtualTime === totalDuration → 最后一段最后一帧
    const last = vt.segments[vt.segments.length - 1];
    if (Math.abs(virtualTime - last.virtualEnd) < 1e-3) target = last;
  }
  if (!target) return null;
  return {
    materialId: target.materialId,
    localTime: (virtualTime - target.virtualStart) + target.clipOffset,
  };
}
```

### 3.3 测试要点

- 空素材列表 → totalDuration === 0
- 单 clip → 一个 segment
- 多 clip 含空档 → 空档不出现在 segment
- `originalMaterialType==='image'` → 被过滤（视频轨上的静态图占位不参与抽帧）
- 纯音频轨（`type==='audio'`）→ 被过滤
- 时间轴包含 0 时长（`duration<=0`）clip → 被过滤
- `mapVirtualTimeToClip(0)` → 第一个 segment 的 (clipOffset)
- `mapVirtualTimeToClip(totalDuration)` → 最后 segment 的 (clipOffset + dur)（边界）

## 4. `extractVideoFrameAt`

### 4.1 与 `extractVideoThumbnail.ts` 的差异

现有 `extractVideoThumbnail(videoUrl: string): Promise<string | null>`（已对照 `extractVideoThumbnail.ts` 第 16-61 行确认）：

- seek 时间硬编码（`duration > 2 ? 1 : 0`）
- 画布限定 320 宽
- 返回 JPEG dataURL（quality 0.8）或 `null`（错误时）
- 内部用 `proxiedVideoUrl()` → `/api/video-proxy?url=...` 处理跨域；该函数当前**未导出**，需要在重构时改为 `export`（参见上文 §2.2）

新函数 `extractVideoFrameAt(videoUrl, timeSec, options?)`：

```ts
interface ExtractOptions {
  maxWidth?: number;              // 默认无上限（保留源分辨率）
  jpegQuality?: number;           // 默认 0.85
  timeoutMs?: number;             // 默认 8000
}

export async function extractVideoFrameAt(
  videoUrl: string,
  timeSec: number,
  options: ExtractOptions = {}
): Promise<string>;   // JPEG dataURL
```

伪代码：

```ts
async function extractVideoFrameAt(url, t, opts) {
  const proxied = proxiedVideoUrl(url);          // 复用现有工具
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.src = proxied;
  video.muted = true;
  video.playsInline = true;

  await loadMetadata(video, opts.timeoutMs);     // promise wrapper
  video.currentTime = clamp(t, 0, video.duration - 0.05);
  await waitForSeeked(video, opts.timeoutMs);

  const canvas = document.createElement('canvas');
  const w = video.videoWidth, h = video.videoHeight;
  if (opts.maxWidth && w > opts.maxWidth) {
    const scale = opts.maxWidth / w;
    canvas.width = opts.maxWidth;
    canvas.height = Math.round(h * scale);
  } else {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', opts.jpegQuality ?? 0.85);
}
```

错误：超时、视频加载失败、canvas tainted（极端情况下 video-proxy 失效）— 抛 Error，由调用方处理。

## 5. `useFrameExtraction` Hook

### 5.1 API

```ts
export function useFrameExtraction(
  vt: VirtualTimeline,
  materials: MaterialItem[]      // 来自 `@/types`（`MaterialItem`，行 708）
): {
  extractAt: (virtualTimeSec: number) => Promise<string | null>;
  // null = 无可用素材
};
```

### 5.2 实现

```ts
export function useFrameExtraction(vt, materials) {
  const cacheRef = useRef(new Map<string, string>());     // 简易 LRU(8)
  const inflightRef = useRef(new Map<string, Promise<string>>());

  const extractAt = useCallback(async (vtTime: number) => {
    const mapped = mapVirtualTimeToClip(vtTime, vt);
    if (!mapped) return null;
    const material = materials.find(m => m.id === mapped.materialId);
    if (!material?.url) return null;

    const key = `${material.id}@${mapped.localTime.toFixed(2)}`;
    const cached = cacheRef.current.get(key);
    if (cached) return cached;

    const inflight = inflightRef.current.get(key);
    if (inflight) return inflight;

    const promise = extractVideoFrameAt(material.url, mapped.localTime)
      .then(dataUrl => {
        cacheRef.current.set(key, dataUrl);
        evictLRU(cacheRef.current, 8);
        inflightRef.current.delete(key);
        return dataUrl;
      })
      .catch(err => {
        inflightRef.current.delete(key);
        throw err;
      });
    inflightRef.current.set(key, promise);
    return promise;
  }, [vt, materials]);

  return { extractAt };
}
```

### 5.3 测试

- 重复同一 (materialId, time) → 第二次走缓存（断言 `extractVideoFrameAt` 仅被调用一次）
- 并发同一 key → 只发一次 inflight 请求
- 不同 key 各自独立
- `mapped == null` → 返回 `null`，不报错
- 超过 8 项时最早的被驱逐

## 6. `<FrameScrubber />`

### 6.1 Props

```tsx
interface FrameScrubberProps {
  totalDurationSec: number;         // = vt.totalDurationSec
  currentVirtualTime: number;
  disabled?: boolean;               // totalDuration === 0 时
  onChange: (virtualTime: number) => void;       // 拖动中（live）
  onCommit: (virtualTime: number) => void;       // 拖动结束
}
```

### 6.2 渲染

- 复用 shadcn `<Slider>` 或自研 range 输入
- 当前时间显示：`mm:ss / mm:ss`
- 视觉提示：每 5 秒一个刻度
- 禁用态：滑块灰；提示文案

### 6.3 实时拖动行为

- `onChange` 立即触发（每次值变化）→ 上层 200ms debounce 后调用 `extractAt` → 更新 `backgroundUrl`
- `onCommit`（mouseup / touchend）→ 立即调用 `extractAt` 并触发 `useCoverPersistence.save`

## 7. `<ImageUploadInput />`

### 7.1 Props

```tsx
interface ImageUploadInputProps {
  currentUrl: string | null;
  onUploaded: (url: string) => void;
  onError: (msg: string) => void;
}
```

### 7.2 行为

- 拖拽 / 点击触发 `<input type="file" accept="image/png,image/jpeg">`
- 校验：`size <= 10 * 1024 * 1024`
- `POST /api/storage/upload-file`（multipart，复用现有 storage 服务的 BFF；已确认存在于 `src/app/api/storage/upload-file/route.ts`，使用 `createPassthroughRoute('/api/storage/upload-file')`）
- 成功 → `onUploaded(returnedUrl)`；失败 → `onError`

### 7.3 已上传预览

- 显示已上传缩略图 + "重新上传"按钮
- 切换源到"抽帧"时不主动删除文件（节省请求），仅清空状态

### 7.4 利用现有上传链路

> **注意**：项目当前 **没有** `src/lib/api/storage.ts` 客户端模块（`src/lib/api/` 下只有 `storage` 相关文件 `arkImage.ts` / `arkVideo.ts` / `tts.ts` 等）；唯一的 storage 入口是 BFF 路由 `/api/storage/upload-file`（multipart，POST，文件 字段名 `file`）。本 spec 直接在 `ImageUploadInput` 内构造 `FormData` 调用该 BFF：

```ts
async function uploadCoverImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  // 后端 router 的字段名以现有 /api/storage/upload-file 实现为准（沿用现状）
  const res = await fetch('/api/storage/upload-file', { method: 'POST', body: fd });
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json();
  // 返回的字段名以后端实际响应为准；常见为 { data: { url } } 或 { url }
  return json.data?.url ?? json.url;
}
```

> 如后续要建立通用 `src/lib/api/storage.ts`，这段逻辑可迁移；不在本 spec 范围。

## 8. `<FrameScrubberOrUpload />`（容器）

### 8.1 Props

```tsx
interface FrameScrubberOrUploadProps {
  imageSource: 'frame' | 'upload';
  onSourceChange: (s: 'frame' | 'upload') => void;
  // frame mode
  vt: VirtualTimeline;
  frameVirtualTimeMs: number;
  onFrameTimeChange: (ms: number) => void;
  onFrameCommit: (ms: number) => void;
  // upload mode
  uploadedUrl: string | null;
  onUploaded: (url: string) => void;
  onError: (msg: string) => void;
}
```

### 8.2 渲染

```tsx
<div className="frame-scrubber-or-upload">
  <SourceToggle value={imageSource} onChange={onSourceChange}
                disabled={vt.totalDurationSec === 0 ? 'frame' : undefined} />
  {imageSource === 'frame' ? (
    <FrameScrubber
      totalDurationSec={vt.totalDurationSec}
      currentVirtualTime={frameVirtualTimeMs / 1000}
      disabled={vt.totalDurationSec === 0}
      onChange={(s) => onFrameTimeChange(s * 1000)}
      onCommit={(s) => onFrameCommit(s * 1000)}
    />
  ) : (
    <ImageUploadInput
      currentUrl={uploadedUrl}
      onUploaded={onUploaded}
      onError={onError}
    />
  )}
</div>
```

### 8.3 自动切换

`useEffect`：当 `vt.totalDurationSec === 0` 时自动 `onSourceChange('upload')`，并显示提示"项目内暂无视频素材，已切换至上传"。

## 9. i18n keys 增量

```ts
videoCoverModal: {
  source: {
    frame: '抽帧' | 'Frame',
    upload: '上传' | 'Upload',
    autoSwitchedToUpload: '项目内暂无视频素材，已切换至上传' | 'No video material — switched to upload',
  },
  scrubber: {
    tooltip: '拖动选择封面背景帧' | 'Drag to pick a cover frame',
    atTime: '已选取 {time}' | 'Selected at {time}',
    disabled: '请先添加视频素材' | 'Add a video clip first',
  },
  upload: {
    dropzone: '拖入或点击上传图片' | 'Drop or click to upload',
    formats: '支持 PNG / JPG，最大 10 MB' | 'PNG / JPG up to 10 MB',
    errors: {
      tooLarge: '图片太大，超过 10 MB' | 'Image too large (>10 MB)',
      wrongType: '仅支持 PNG / JPG' | 'Only PNG / JPG allowed',
      networkError: '上传失败，请重试' | 'Upload failed, please retry',
    },
  },
}
```

## 10. 测试计划

### 10.1 算法

- `buildVirtualSegments.test.ts` — 6 个用例（空、单、多、含空档、含纯音频、含 0 时长）
- `mapVirtualTimeToClip.test.ts` — 边界（0 / 中点 / 尾点 / 越界）

### 10.2 Hook

- `useFrameExtraction.test.tsx` — 缓存、并发去重、错误传递

### 10.3 组件

- `FrameScrubber.test.tsx` — 拖动 onChange / mouseup onCommit / disabled
- `ImageUploadInput.test.tsx` — 文件校验、成功上传、错误提示
- `FrameScrubberOrUpload.test.tsx` — 源切换、totalDuration=0 自动切

## 11. 边界与风险

| 风险 | 缓解 |
|----|------|
| 视频素材 URL 跨域 → canvas tainted | 已通过 `/api/video-proxy` 解决；新工具复用同一 proxy 路径 |
| 视频元数据加载耗时（远端 OSS）| Hook 内 8s 超时；UI 显示骨架 |
| 拖动产生大量 seek 请求把视频卡死 | 200ms debounce + LRU + 并发去重 |
| 用户上传超大图片导致内存压力 | 前端 10MB 上限；后端 storage 服务有自己的限制 |
| 自动切到 upload 时用户已经在 frame 模式编辑 | 仅在 totalDuration 真的为 0 时切换；普通切换 `frame ↔ upload` 由用户控制；切换前 toast 提醒 |
| 时间轴 mediaType=`image` 的素材是否参与 | v1 不参与（master-plan §5.3 决定）；如未来要支持，扩展 buildVirtualSegments 过滤条件 |

## 12. Dependencies

- 上游：spec 01（弹窗壳右下区域）、spec 02（用户已选择模板）
- 下游：spec 03（CoverPreview 接收 backgroundUrl）、spec 05（渲染时 backgroundUrl 写入 PNG）、spec 07（持久化时序列化 imageSource、frameVirtualTimeMs、uploadedImageUrl）
- 后端依赖：现有 `/api/storage/upload`（无新增）

## 13. 完成条件

- [ ] 虚拟时间轴算法 6+ 用例全绿
- [ ] `useFrameExtraction` 缓存与并发去重单测通过
- [ ] FrameScrubber 拖动 / commit 行为通过
- [ ] ImageUploadInput 校验 / 上传 / 错误路径通过
- [ ] 项目无视频时自动切换 + 提示生效
- [ ] 跨域视频 URL 抽帧成功（手动 QA）
