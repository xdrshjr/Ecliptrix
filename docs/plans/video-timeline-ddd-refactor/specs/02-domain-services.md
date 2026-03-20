# Spec 02: 领域服务

## 1. 概述

定义从现有组件中提取的领域服务（Domain Service）。领域服务处理不属于单个实体的业务逻辑，是纯函数或纯类，不依赖任何 UI 框架或外部库。

**目标文件位置：** `src/components/video/timeline/domain/services/`

## 2. TrackSelectionService

**提取来源：** `TimelinePanel.tsx` lines 394-500（handleMaterialDrop 中的轨道选择算法）

负责根据素材类型选择目标轨道。

```
TrackSelectionService {
  静态方法:

  selectTrackForMaterial(
    tracks: Track[],
    materialType: string,
    targetTrackId?: string
  ) → Track | null

  算法:
    1. 如果指定了 targetTrackId 且该轨道存在 → 返回该轨道
    2. 否则按 materialType 查找兼容轨道:
       - 'image' → 优先查找 id 以 'image-track' 开头的轨道，其次找第一个 video 轨道
       - 'video' → 查找 type='video' 且 id 不以 'image-track' 开头的轨道
       - 'audio' → 查找 type='audio' 的轨道
       - 'subtitle' → 查找 type='subtitle' 的轨道
    3. 无兼容轨道 → 返回 null

  getCompatibleTracks(
    tracks: Track[],
    materialType: string
  ) → Track[]
  // 返回所有兼容的轨道列表（用于 UI 高亮）
}
```

## 3. ItemPlacementService

**提取来源：** `TimelinePanel.tsx` lines 500-695（handleMaterialDrop 中的 item 创建和放置逻辑）

负责计算新 item 的放置位置、创建 item、处理冲突检测。

```
ItemPlacementService {
  静态方法:

  calculatePlacementPosition(track: Track) → TimePosition
  // 返回轨道上下一个可用位置（最后一个 item 的 endTime）
  // 空轨道返回 TimePosition.zero()

  createItemFromMaterial(
    material: MaterialData,
    track: Track,
    startTime?: TimePosition
  ) → TimelineItem
  // 从素材创建 TimelineItem
  // 算法:
  //   1. 生成唯一 ID
  //   2. startTime = 参数指定值 || calculatePlacementPosition(track)
  //   3. duration = material.duration || Duration.default() (5秒)
  //   4. color = 按 material.type 分配颜色
  //   5. 复制素材相关属性 (thumbnailUrl, waveformData 等)

  getColorForType(materialType: string) → string
  // 颜色映射规则:
  //   video → '#4A90D9'
  //   audio → '#50C878'
  //   subtitle → '#FFB347'
  //   image → '#9B59B6'

  hasOverlap(
    items: TimelineItem[],
    newItem: TimelineItem,
    excludeId?: string
  ) → boolean
  // 检测新 item 是否与轨道上已有 item 时间重叠
  // excludeId 用于移动场景排除自身
}
```

## 4. DragCalculationService

**提取来源：** `TimelineItem.tsx` lines 100-200（拖拽计算逻辑）

负责拖拽和缩放过程中的位移计算，是纯数学计算，不涉及任何 DOM 操作。

```
DragCalculationService {
  静态方法:

  // 像素→时间转换常量
  RESIZE_HANDLE_WIDTH = 8  // px

  calculateMovePosition(
    originalStartTime: TimePosition,
    deltaX: number,               // 鼠标移动的像素距离
    zoomLevel: ZoomLevel,
    snapToGrid: boolean,
    gridSize: number
  ) → TimePosition
  // 算法:
  //   1. deltaTime = deltaX / zoomLevel.toPixelsPerSecond()
  //   2. newStartTime = max(0, originalStartTime.value + deltaTime)
  //   3. 如果 snapToGrid → 对齐到 gridSize
  //   4. 返回 TimePosition.create(newStartTime)

  calculateResizePosition(
    item: TimelineItem,
    edge: 'start' | 'end',
    deltaX: number,
    zoomLevel: ZoomLevel,
    minDuration?: Duration         // 最小片段时长, 默认 0.1 秒
  ) → { startTime: TimePosition, duration: Duration }
  // 算法:
  //   edge = 'start':
  //     newStart = max(0, item.startTime + deltaTime)
  //     newDuration = item.endTime - newStart
  //     如果 newDuration < minDuration → 不变
  //   edge = 'end':
  //     newDuration = max(minDuration, item.duration + deltaTime)
  //     startTime 不变

  detectInteractionType(
    relativeX: number,
    itemWidth: number
  ) → 'move' | 'resize-start' | 'resize-end'
  // 检测点击位置决定交互类型
  //   relativeX <= RESIZE_HANDLE_WIDTH → 'resize-start'
  //   relativeX >= itemWidth - RESIZE_HANDLE_WIDTH → 'resize-end'
  //   否则 → 'move'

  snapToGrid(
    time: number,
    gridSize: number
  ) → number
  // 对齐到网格: Math.round(time / gridSize) * gridSize

  pixelsToTime(px: number, zoomLevel: ZoomLevel) → number
  timeToPixels(time: number, zoomLevel: ZoomLevel) → number
}
```

## 5. HistoryService

**提取来源：** `TimelinePanel.tsx` lines 334-391, 1675-1760（undo/redo 系统）

封装快照式的撤销/重做逻辑。

```
HistoryService {
  MAX_HISTORY = 50

  // 状态
  history: TimelineAction[]
  historyIndex: number

  方法:

  addAction(action: TimelineAction) → void
  // 1. 截断 historyIndex 之后的记录（新分支）
  // 2. 追加新 action
  // 3. 如果超过 MAX_HISTORY → 移除最旧的记录
  // 4. historyIndex = history.length - 1

  captureBeforeState(snapshot: TimelineSnapshot) → void
  // 在 action 执行前调用，记录 previousState

  captureAfterState(snapshot: TimelineSnapshot) → void
  // 在 action 执行后调用（下一帧），记录 nextState

  undo() → TimelineSnapshot | null
  // 如果 historyIndex > 0:
  //   historyIndex--
  //   返回 history[historyIndex].previousState
  // 否则返回 null

  redo() → TimelineSnapshot | null
  // 如果 historyIndex < history.length - 1:
  //   historyIndex++
  //   返回 history[historyIndex].nextState
  // 否则返回 null

  canUndo() → boolean
  canRedo() → boolean

  clear() → void
  // 清空历史记录（导入 JSON 后使用）

  getActionCount() → number
  getCurrentIndex() → number
}

TimelineAction {
  type: 'ADD_ITEM' | 'REMOVE_ITEM' | 'UPDATE_ITEM' | 'MOVE_ITEM' |
        'SELECT_ITEM' | 'DESELECT_ALL' | 'SELECT_ALL_TRACK_ITEMS' |
        'TRACK_LOCK' | 'TRACK_MUTE' | 'TRACK_VOLUME' | 'TRACK_VISIBILITY'
  payload?: any
  timestamp: Date
  previousState?: TimelineSnapshot
  nextState?: TimelineSnapshot
}
```

## 6. DurationCalculationService

**提取来源：** `TimelinePanel.tsx` 中 totalDuration 的自动计算逻辑

```
DurationCalculationService {
  静态方法:

  calculateTotalDuration(tracks: Track[]) → Duration
  // 遍历所有轨道的所有 item，取最大的 endTime
  // 如果无 item → Duration.create(0.1) (保底值)

  calculateTrackDuration(track: Track) → Duration
  // 该轨道最后一个 item 的 endTime
}
```

## 7. 服务间依赖关系

```
TrackSelectionService ← 独立，仅依赖 Track 实体
ItemPlacementService ← 依赖 Track, TimelineItem 实体
DragCalculationService ← 独立，仅依赖值对象 (TimePosition, Duration, ZoomLevel)
HistoryService ← 依赖 TimelineSnapshot 类型
DurationCalculationService ← 依赖 Track, Duration
```

所有服务均为纯函数/纯类，可以独立单元测试，不依赖任何外部框架。
