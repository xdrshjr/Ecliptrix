# Spec 06: Infrastructure 层适配器

## 1. 概述

Infrastructure 层包含与外部系统交互的适配器，实现领域层定义的接口。这些适配器处理序列化、网络请求、文件 I/O 等关注点。

**目标文件位置：** `src/components/video/timeline/infrastructure/`

## 2. TimelineRepository

**提取来源：** `timelineExportService.ts` + `TimelinePanel.tsx` 中的导入/导出逻辑

负责时间线状态的持久化（JSON 导出/导入）。

```
TimelineRepository {
  // JSON 导出
  async exportToJSON(
    timelineData: TimelineData,
    materials: MaterialData[],
    metadata: ExportMetadata
  ) → { blob: Blob, filename: string }
  // 1. 组装 TimelineExportData 结构
  // 2. 序列化为 JSON
  // 3. 创建 Blob
  // 返回给 UI 层触发下载

  // 通过后端 API 导出
  async exportViaBackend(
    timelineData: TimelineData,
    materials: MaterialData[],
    taskId: string
  ) → { downloadUrl: string }
  // 调用 /api/timeline-export 接口

  // JSON 导入
  async importFromJSON(file: File) → {
    timelineData: TimelineData,
    materials: MaterialData[]
  }
  // 1. 读取文件内容
  // 2. 解析 JSON
  // 3. 验证结构完整性
  // 4. 转换为 TimelineData 和 MaterialData[]
  // 抛出 ImportValidationError 如果格式不对

  // 验证
  validateExportData(data: unknown) → data is TimelineExportData
  // 类型守卫，验证 JSON 结构
}

ExportMetadata {
  exportedAt: string        // ISO 日期
  version: string           // 导出格式版本
  taskId: string
}

TimelineExportData {
  metadata: ExportMetadata & {
    totalDuration: number
    trackCount: number
    itemCount: number
  }
  timeline: TimelineData
  tracks: TrackData[]       // 冗余（也在 timeline 中），保持向后兼容
  materials: MaterialData[]
}
```

## 3. VideoCacheAdapter

**提取来源：** `VideoCache.ts` 服务

负责视频预加载和缓存管理。

```
VideoCacheAdapter {
  // 缓存状态
  private cache: Map<string, CacheEntry>

  // 预加载视频
  async preloadVideo(materialId: string, url: string) → CacheState
  // 1. 检查缓存是否已存在
  // 2. 创建 HTMLVideoElement 预加载
  // 3. 更新缓存状态
  // 4. 返回加载结果

  // 查询缓存状态
  getCacheState(materialId: string) → CacheState
  // 返回 'loading' | 'loaded' | 'error' | 'not-found'

  // 清理缓存
  evict(materialId: string) → void
  clearAll() → void

  // 获取预加载的视频元素
  getVideoElement(materialId: string) → HTMLVideoElement | null
}

CacheState = 'loading' | 'loaded' | 'error' | 'not-found'

CacheEntry {
  materialId: string
  url: string
  state: CacheState
  element?: HTMLVideoElement
  loadedAt?: Date
}
```

## 4. CompositionAdapter

**提取来源：** `useTimelineComposition.ts` 中的序列提取逻辑

负责将时间线状态转换为视频/音频合成序列。

```
CompositionAdapter {
  // 提取视频序列
  extractVideoSequences(
    tracks: TrackData[],
    materials: MaterialData[],
    cacheAdapter: VideoCacheAdapter
  ) → VideoSequenceItem[]
  // 1. 过滤 type='video', isVisible=true, !isLocked 的轨道
  // 2. 对每个 item, 查找对应的 MaterialData
  // 3. 选择 URL: 优先 serverUrl, 其次 url
  // 4. 计算 volume: item.volume × track.volume / 100
  // 5. 获取缓存状态

  // 提取音频序列
  extractAudioSequences(
    tracks: TrackData[],
    materials: MaterialData[]
  ) → AudioSequenceItem[]
  // 类似视频序列提取，针对 audio 轨道

  // 构建合成请求
  buildCompositionRequest(
    videoSequences: VideoSequenceItem[],
    audioSequences: AudioSequenceItem[],
    config: CompositionConfig
  ) → VideoCompositionRequest
}

VideoSequenceItem {
  id: string
  name: string
  url: string
  startTime: number
  duration: number
  trackId: string
  clipStart?: number
  clipEnd?: number
  originalDuration?: number
  volume: number
  cacheState: CacheState
}

AudioSequenceItem {
  id: string
  name: string
  url: string
  startTime: number
  duration: number
  trackId: string
  clipStart?: number
  clipEnd?: number
  volume: number
}
```

## 5. 接口定义（依赖倒置）

Domain 层定义接口，Infrastructure 层实现：

```
// domain/ports.ts (接口定义)

interface ITimelineRepository {
  exportToJSON(data: TimelineData, materials: MaterialData[], metadata: ExportMetadata)
    → Promise<{ blob: Blob, filename: string }>
  importFromJSON(file: File)
    → Promise<{ timelineData: TimelineData, materials: MaterialData[] }>
}

interface IVideoCachePort {
  preloadVideo(materialId: string, url: string) → Promise<CacheState>
  getCacheState(materialId: string) → CacheState
}

interface ICompositionPort {
  extractVideoSequences(tracks: TrackData[], materials: MaterialData[])
    → VideoSequenceItem[]
  extractAudioSequences(tracks: TrackData[], materials: MaterialData[])
    → AudioSequenceItem[]
}
```

Store 层通过构造注入或模块级导入使用这些实现。测试时可以替换为 mock 实现。

## 6. 与现有服务的映射

| 现有文件 | 新适配器 | 处理方式 |
|---------|---------|---------|
| `services/timelineExportService.ts` | `TimelineRepository` | 逻辑迁移到 Repository，旧文件废弃 |
| `services/VideoCache.ts` | `VideoCacheAdapter` | 逻辑迁移到 Adapter，旧文件废弃 |
| `hooks/useTimelineComposition.ts` (序列提取部分) | `CompositionAdapter` | 序列提取逻辑迁移，hook 简化为 store 读取 |
| `hooks/useTimelineExport.ts` | `TimelineRepository` | 导出逻辑迁移到 Repository |

## 7. 错误处理

```
// infrastructure/errors.ts

class TimelineExportError extends Error {
  constructor(message: string, public cause?: unknown) {}
}

class TimelineImportError extends Error {
  constructor(
    message: string,
    public validationErrors: string[],
    public cause?: unknown
  ) {}
}

class VideoCacheError extends Error {
  constructor(
    message: string,
    public materialId: string,
    public cause?: unknown
  ) {}
}
```

Store 层捕获这些错误并转换为用户可见的通知（通过 NotificationContext）。
