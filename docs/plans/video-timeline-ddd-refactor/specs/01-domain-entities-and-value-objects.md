# Spec 01: Domain 实体与值对象

## 1. 概述

定义 Timeline 领域的核心实体（Entity）、值对象（Value Object）和聚合根（Aggregate Root）。这些是整个 DDD 重构的基础，所有业务逻辑都将围绕这些领域模型构建。

**目标文件位置：** `src/components/video/timeline/domain/`

## 2. 值对象 (Value Objects)

值对象是不可变的、通过值比较相等性的对象。它们封装验证逻辑，确保领域概念的一致性。

### 2.1 TimePosition

表示时间线上的一个时间位置（秒）。

```
TimePosition {
  value: number  // >= 0, 单位: 秒

  静态工厂方法:
    TimePosition.create(seconds: number) → TimePosition  // 验证 >= 0
    TimePosition.zero() → TimePosition                   // 返回 0
    TimePosition.fromPixels(px, zoomLevel) → TimePosition // 像素→时间转换

  实例方法:
    add(duration: Duration) → TimePosition
    subtract(duration: Duration) → TimePosition | null  // null if < 0
    toPixels(zoomLevel: ZoomLevel) → number
    equals(other: TimePosition) → boolean
    isAfter(other: TimePosition) → boolean
    isBefore(other: TimePosition) → boolean
}
```

**不变量：** value 必须 >= 0

### 2.2 Duration

表示一个时间段的长度（秒）。

```
Duration {
  value: number  // > 0, 单位: 秒

  静态工厂方法:
    Duration.create(seconds: number) → Duration   // 验证 > 0
    Duration.fromRange(start: TimePosition, end: TimePosition) → Duration
    Duration.default() → Duration                 // 默认 5 秒

  实例方法:
    add(other: Duration) → Duration
    subtract(other: Duration) → Duration | null   // null if <= 0
    multiply(factor: number) → Duration
    equals(other: Duration) → boolean
    isLongerThan(other: Duration) → boolean
}
```

**不变量：** value 必须 > 0

### 2.3 Volume

表示音量值，支持 0-200% 范围（轨道级）和 0-1 范围（Item 级）。

```
Volume {
  value: number  // 0-2.0 (0%-200%)

  静态工厂方法:
    Volume.create(value: number) → Volume         // clamp to [0, 2.0]
    Volume.fromPercentage(percent: number) → Volume  // 0-200 → 0-2.0
    Volume.default() → Volume                     // 1.0 (100%)
    Volume.muted() → Volume                       // 0

  实例方法:
    multiply(other: Volume) → Volume              // 用于 track × item 音量合成
    toPercentage() → number                       // 0-200
    isMuted() → boolean
    equals(other: Volume) → boolean
}
```

**不变量：** value 必须在 [0, 2.0] 区间内

### 2.4 ZoomLevel

表示时间线的缩放级别。

```
ZoomLevel {
  value: number  // 0.1 - 5.0

  静态工厂方法:
    ZoomLevel.create(value: number) → ZoomLevel   // clamp to [0.1, 5.0]
    ZoomLevel.default() → ZoomLevel               // 1.0

  实例方法:
    zoomIn(step?: number) → ZoomLevel
    zoomOut(step?: number) → ZoomLevel
    toPixelsPerSecond() → number                  // value * 50 (基准比率)
    equals(other: ZoomLevel) → boolean

  常量:
    PIXELS_PER_SECOND_BASE = 50
    MIN = 0.1
    MAX = 5.0
}
```

### 2.5 TrackType

轨道类型枚举。

```
TrackType = 'video' | 'audio' | 'subtitle'

TrackTypeUtils {
  静态方法:
    isCompatibleWith(trackType: TrackType, materialType: string) → boolean
    getDefaultColor(trackType: TrackType) → string
    getDefaultHeight(trackType: TrackType) → number
    canAcceptMaterial(trackType: TrackType, materialType: string, trackId: string) → boolean
}
```

**素材兼容性规则（从 Track.tsx 提取）：**
- video track: 接受 'video'（排除 image-track 开头的轨道）和 'image'
- image-track: 仅接受 'image'
- audio track: 接受 'audio'
- subtitle track: 接受 'subtitle'

## 3. 实体 (Entities)

实体通过唯一标识区分，具有生命周期。

### 3.1 TimelineItem 实体

表示时间线上的一个片段（视频/音频/字幕）。

```
TimelineItem {
  // 标识
  readonly id: string

  // 核心属性
  name: string
  type: TrackType
  startTime: TimePosition
  duration: Duration
  trackId: string
  color: string

  // 素材关联
  materialId?: string

  // 裁剪信息
  clipStart?: TimePosition
  clipEnd?: TimePosition
  originalDuration?: Duration

  // 媒体特定属性
  thumbnailUrl?: string       // 视频
  waveformData?: number[]     // 音频
  text?: string               // 字幕
  subtitleStyle?: SubtitleStyle
  imagePosition?: ImagePosition
  sentenceSegments?: AudioSentenceSegment

  // 效果属性
  volume: Volume              // 默认 1.0
  opacity: number             // 0-1, 默认 1.0

  方法:
    endTime() → TimePosition              // startTime + duration
    moveTo(position: TimePosition) → void
    resize(edge: 'start' | 'end', newPosition: TimePosition) → void
    updateVolume(volume: Volume) → void
    overlaps(other: TimelineItem) → boolean
    contains(position: TimePosition) → boolean
    clone() → TimelineItem
    toPlainObject() → TimelineItemData     // 序列化用

  静态工厂:
    TimelineItem.create(props: CreateItemProps) → TimelineItem
    TimelineItem.fromPlainObject(data: TimelineItemData) → TimelineItem
}
```

**ID 生成规则：** `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

### 3.2 Track 实体

表示时间线上的一条轨道。

```
Track {
  // 标识
  readonly id: string

  // 属性
  name: string
  type: TrackType
  height: number              // 32-80px
  isLocked: boolean
  isMuted: boolean
  isVisible: boolean
  volume: Volume              // 轨道级音量, 默认 100%
  items: TimelineItem[]
  order: number

  方法:
    addItem(item: TimelineItem) → void          // 验证类型兼容性
    removeItem(itemId: string) → TimelineItem | null
    findItem(itemId: string) → TimelineItem | null
    getItemAt(position: TimePosition) → TimelineItem | null
    getLastItem() → TimelineItem | null
    getNextAvailablePosition() → TimePosition    // 最后一个 item 的 endTime
    canAcceptMaterial(materialType: string) → boolean
    toggleLock() → void
    toggleMute() → void
    toggleVisibility() → void
    setVolume(volume: Volume) → void
    getEndTime() → TimePosition                  // 最后一个 item 的结束时间
    sortItems() → void                           // 按 startTime 排序
    clone() → Track
    toPlainObject() → TrackData

  静态工厂:
    Track.create(props: CreateTrackProps) → Track
    Track.fromPlainObject(data: TrackData) → Track

  不变量:
    - isLocked 时所有修改操作抛出异常
    - items 按 startTime 排序
    - 类型检查: addItem 验证 item.type 与 track.type 兼容
}
```

## 4. 聚合根 (Aggregate Root)

### 4.1 TimelineAggregate

Timeline 的聚合根，是所有状态变更的唯一入口。

```
TimelineAggregate {
  // 状态
  tracks: Track[]
  currentTime: TimePosition
  totalDuration: Duration
  zoomLevel: ZoomLevel
  playbackRate: number
  isPlaying: boolean
  snapToGrid: boolean
  gridSize: number
  scrollLeft: number

  // 状态变更方法 (所有变更通过聚合根)
  addItemToTrack(trackId: string, item: TimelineItem) → void
  removeItemFromTrack(trackId: string, itemId: string) → TimelineItem | null
  moveItem(itemId: string, newStartTime: TimePosition, targetTrackId?: string) → void
  resizeItem(itemId: string, edge: 'start' | 'end', newPosition: TimePosition) → void

  // 轨道操作
  addTrack(track: Track) → void
  removeTrack(trackId: string) → void
  reorderTracks(trackIds: string[]) → void
  toggleTrackLock(trackId: string) → void
  toggleTrackMute(trackId: string) → void
  toggleTrackVisibility(trackId: string) → void
  setTrackVolume(trackId: string, volume: Volume) → void

  // 选择操作
  // (选择状态在 selectionSlice 中管理, 聚合根不负责)

  // 播放控制
  setCurrentTime(time: TimePosition) → void
  setPlaybackRate(rate: number) → void
  setPlaying(playing: boolean) → void

  // 缩放/滚动
  setZoomLevel(zoom: ZoomLevel) → void
  setScrollLeft(value: number) → void
  setSnapToGrid(enabled: boolean) → void
  setGridSize(seconds: number) → void

  // 查询方法
  findTrack(trackId: string) → Track | null
  findItem(itemId: string) → { track: Track, item: TimelineItem } | null
  getTracksOfType(type: TrackType) → Track[]
  getCompatibleTracks(materialType: string) → Track[]
  calculateTotalDuration() → Duration
  getAllItems() → TimelineItem[]

  // 快照
  snapshot() → TimelineSnapshot           // 用于 undo/redo
  restore(snapshot: TimelineSnapshot) → void

  // 序列化
  toPlainObject() → TimelineData

  静态工厂:
    TimelineAggregate.create(initialState?: Partial<TimelineData>) → TimelineAggregate
    TimelineAggregate.fromPlainObject(data: TimelineData) → TimelineAggregate

  不变量:
    1. totalDuration 始终等于所有 item 的最大 endTime
    2. 锁定轨道的修改操作被拒绝
    3. item 的 startTime >= 0
    4. 素材类型与轨道类型必须兼容
}
```

## 5. 数据传输类型 (DTO / Plain Objects)

用于序列化/反序列化和跨层传递的纯数据类型。

```
TimelineItemData {
  id: string
  name: string
  type: 'video' | 'audio' | 'subtitle'
  startTime: number
  duration: number
  trackId: string
  color: string
  materialId?: string
  clipStart?: number
  clipEnd?: number
  originalDuration?: number
  thumbnailUrl?: string
  waveformData?: number[]
  text?: string
  subtitleStyle?: SubtitleStyle
  imagePosition?: ImagePosition
  sentenceSegments?: AudioSentenceSegment
  volume?: number
  opacity?: number
}

TrackData {
  id: string
  name: string
  type: 'video' | 'audio' | 'subtitle'
  height: number
  isLocked: boolean
  isMuted: boolean
  isVisible: boolean
  volume: number
  items: TimelineItemData[]
  order: number
}

TimelineData {
  currentTime: number
  totalDuration: number
  zoomLevel: number
  playbackRate: number
  isPlaying: boolean
  snapToGrid: boolean
  gridSize: number
  scrollLeft: number
  tracks: TrackData[]
}

TimelineSnapshot = TimelineData  // 快照就是完整序列化数据
```

## 6. 与现有类型的映射关系

| 现有类型 (src/types/index.ts) | 新 Domain 类型 | 变化说明 |
|------|------|---------|
| `TimelineItem` (interface) | `TimelineItem` (class) | 从接口提升为实体类，增加行为方法 |
| `Track` (interface) | `Track` (class) | 从接口提升为实体类，增加行为方法 |
| `TimelineState` (interface) | `TimelineAggregate` (class) | 聚合根，封装全部状态变更逻辑 |
| `item.startTime: number` | `item.startTime: TimePosition` | 内部用值对象，序列化时转为 number |
| `item.duration: number` | `item.duration: Duration` | 内部用值对象，序列化时转为 number |
| `item.volume: number` | `item.volume: Volume` | 内部用值对象，序列化时转为 number |
| `track.type: string` | `track.type: TrackType` | 类型收窄为联合类型 |

**兼容性保证：**
- `toPlainObject()` 输出与现有 interface 结构完全一致
- `fromPlainObject()` 接受现有数据格式
- Zustand store 对外暴露 plain object 形式的状态，UI 层无感知

## 7. 从现有代码提取的业务规则清单

以下业务规则将封装在实体和值对象中：

1. **ID 生成**: `item-${Date.now()}-${random}` → `TimelineItem.create()` 封装
2. **默认时长**: 无 duration 的素材默认 5 秒 → `Duration.default()`
3. **颜色分配**: 按 material type 分配颜色 → `TimelineItem.create()` 封装
4. **素材兼容性**: video/image/audio/subtitle 与轨道类型匹配 → `TrackTypeUtils.canAcceptMaterial()`
5. **image-track 特殊规则**: id 以 `image-track` 开头的轨道仅接受 image → `Track.canAcceptMaterial()`
6. **totalDuration 自动计算**: 添加/移动/删除 item 后重算 → `TimelineAggregate` 内部维护
7. **锁定保护**: isLocked 的轨道拒绝修改 → `Track` 方法内检查
8. **音量计算**: effectiveVolume = itemVolume × trackVolume → `Volume.multiply()`
9. **像素↔时间换算**: `pixelsPerSecond = zoomLevel * 50` → `ZoomLevel.toPixelsPerSecond()`
10. **缩放范围限制**: zoomLevel ∈ [0.1, 5.0] → `ZoomLevel.create()` clamp
