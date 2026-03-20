# Spec 04: Zustand Store 设计

## 1. 概述

设计 Zustand store 作为 Application 层，替代当前 `TimelinePanel.tsx` 中通过 `useState` 管理的所有状态。Store 是领域层和 UI 层之间的桥梁。

**目标文件位置：** `src/components/video/timeline/store/`

## 2. Store 整体结构

```
useTimelineStore = create()(
  combine(
    timelineSlice,
    selectionSlice,
    historySlice,
    dragSlice,
    uiSlice
  )
)
```

使用 Zustand 的 slice 模式组织，每个 slice 管理独立的状态域。

## 3. timelineSlice — 核心时间线状态

**提取来源：** `TimelinePanel.tsx` 中的 `timelineState` (useState)

```
State:
  timeline: TimelineAggregate    // 聚合根实例（内部状态）

  // 对外暴露的派生状态（plain object，便于 React 渲染）
  tracks: TrackData[]
  currentTime: number
  totalDuration: number
  zoomLevel: number
  playbackRate: number
  isPlaying: boolean
  snapToGrid: boolean
  gridSize: number
  scrollLeft: number

Actions:
  // 初始化
  initTimeline(data?: Partial<TimelineData>) → void
    // 创建 TimelineAggregate，同步派生状态

  // Item 操作
  addItemToTrack(trackId: string, material: MaterialData) → void
    // 1. 调用 ItemPlacementService.createItemFromMaterial()
    // 2. 调用 TrackSelectionService 确认轨道
    // 3. 调用 aggregate.addItemToTrack()
    // 4. 调用 historySlice.recordAction()
    // 5. 同步派生状态
    // 6. 返回创建的 item（供外部触发视频预加载）

  removeItem(itemId: string) → void
    // 1. 调用 aggregate.removeItemFromTrack()
    // 2. 记录历史
    // 3. 同步派生状态

  moveItem(itemId: string, newStartTime: number, isPreview?: boolean) → void
    // 1. 调用 aggregate.moveItem()
    // 2. 如果不是 preview → 记录历史
    // 3. 同步派生状态

  resizeItem(itemId: string, edge: 'start' | 'end', newPosition: number) → void
  updateItemVolume(itemId: string, volume: number) → void
  updateItemSubtitle(itemId: string, text: string) → void

  // 轨道操作
  toggleTrackLock(trackId: string) → void
  toggleTrackMute(trackId: string) → void
  toggleTrackVisibility(trackId: string) → void
  setTrackVolume(trackId: string, volume: number) → void

  // 播放控制
  setCurrentTime(time: number) → void
  setPlaybackRate(rate: number) → void
  setPlaying(playing: boolean) → void

  // 缩放/滚动
  setZoomLevel(zoom: number) → void
  setScrollLeft(value: number) → void
  setSnapToGrid(enabled: boolean) → void

  // 快照/恢复
  getSnapshot() → TimelineSnapshot
  restoreFromSnapshot(snapshot: TimelineSnapshot) → void

  // 序列化
  exportToData() → TimelineData
  importFromData(data: TimelineData) → void

内部方法:
  _syncDerivedState() → void
    // 将 aggregate 内部状态转换为 plain object 写入 zustand state
    // 使每次状态变更后 React 能感知到变化
```

## 4. selectionSlice — 选中状态

**提取来源：** `TimelinePanel.tsx` 中的 `selectedItems` 状态和相关操作

```
State:
  selectedItems: string[]        // 选中的 item IDs
  activeTool: TimelineToolType   // 当前工具 ('select' | 'cut' | ...)

Actions:
  selectItem(itemId: string) → void
    // 单选: 替换 selectedItems
    // 记录历史

  toggleItemSelection(itemId: string) → void
    // Ctrl+Click: 切换选中状态

  selectAllTrackItems(trackId: string) → void
    // 选中指定轨道的所有 item

  deselectAll() → void
    // 清空选择

  setActiveTool(tool: TimelineToolType) → void

  // 查询
  isSelected(itemId: string) → boolean
  getSelectedItems() → string[]
```

## 5. historySlice — 撤销/重做

**提取来源：** `TimelinePanel.tsx` 中的 history/historyIndex 状态和 addToHistory/handleUndo/handleRedo

```
State:
  historyService: HistoryService  // 领域服务实例
  canUndo: boolean                // 派生状态
  canRedo: boolean                // 派生状态

Actions:
  recordAction(type: string, payload?: any) → void
    // 1. 获取当前 timeline 快照作为 previousState
    // 2. 创建 TimelineAction
    // 3. 调用 historyService.addAction()
    // 4. 调度 after-render 回调捕获 nextState
    // 5. 更新 canUndo/canRedo

  captureNextState() → void
    // 在 React 渲染后调用, 捕获当前状态作为最新 action 的 nextState
    // 对应现有的 needsNextStateCaptureRef 机制

  undo() → void
    // 1. 调用 historyService.undo()
    // 2. 如果返回快照 → 调用 timelineSlice.restoreFromSnapshot()
    // 3. 更新 canUndo/canRedo

  redo() → void
    // 类似 undo

  clearHistory() → void
    // JSON 导入后清空历史
```

## 6. dragSlice — 拖拽状态

**提取来源：** `TimelineItem.tsx` 中的 isDragging/isResizing 状态和事件处理

```
State:
  // 状态机 actor
  dragActor: ActorRef<typeof dragMachine> | null

  // 派生的便捷状态
  isDragging: boolean
  isResizing: boolean
  dragPreview: {
    itemId: string
    startTime: number
    duration: number
  } | null

  // 素材拖入预览
  materialDragOver: {
    trackId: string
    materialType: string
    isCompatible: boolean
  } | null

Actions:
  // Item 拖拽/缩放
  startDrag(event: PointerDownEvent) → void
  updateDrag(event: PointerMoveEvent) → void
  endDrag(event: PointerUpEvent) → void
  cancelDrag() → void

  // 素材拖入
  setMaterialDragOver(trackId: string, materialType: string) → void
  clearMaterialDragOver() → void
  dropMaterial(trackId: string, material: MaterialData) → void
    // 1. 调用 timelineSlice.addItemToTrack()
    // 2. 清除 dragOver 状态
```

## 7. uiSlice — UI 专用状态

**提取来源：** `TimelinePanel.tsx` 中的各种 UI 状态

```
State:
  isExporting: boolean
  isImporting: boolean
  isExtractingSubtitles: boolean
  showVolumeSlider: { trackId: string, position: { x: number, y: number } } | null
  editingSubtitleId: string | null

Actions:
  setExporting(value: boolean) → void
  setImporting(value: boolean) → void
  setExtractingSubtitles(value: boolean) → void
  showVolumeSliderForTrack(trackId: string, position: { x: number, y: number }) → void
  hideVolumeSlider() → void
  setEditingSubtitle(itemId: string | null) → void
```

## 8. Store 初始化

```
// useTimelineStore.ts
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

export const useTimelineStore = create(
  subscribeWithSelector((...a) => ({
    ...createTimelineSlice(...a),
    ...createSelectionSlice(...a),
    ...createHistorySlice(...a),
    ...createDragSlice(...a),
    ...createUISlice(...a),
  }))
)
```

使用 `subscribeWithSelector` 中间件支持细粒度订阅，避免不必要的重渲染。

## 9. 与外部系统的接口

### 9.1 VideoEditingInterface 接入

```
// 原来: <TimelinePanel timelineState={...} onUpdate={...} materials={...} ... />
// 重构后: <TimelinePanel materials={materials} taskId={taskId} />

// VideoEditingInterface 通过 store 交互:
const { currentTime, isPlaying } = useTimelineStore(
  state => ({ currentTime: state.currentTime, isPlaying: state.isPlaying })
)
```

### 9.2 useMaterialManagement 接入

素材管理 hook 不在重构范围内，但需要定义交互接口：

```
// 素材拖入轨道时:
store.addItemToTrack(trackId, material)  // material 是 MaterialData

// 需要的 MaterialData 接口 (从 material hook 提供):
MaterialData {
  id: string
  name: string
  type: string           // 'video' | 'audio' | 'image' | 'subtitle'
  duration?: number
  url?: string
  serverUrl?: string
  thumbnailUrl?: string
  waveformData?: number[]
  format?: string
}
```

### 9.3 useTimelineComposition 接入

合成 hook 通过 store 读取时间线状态：

```
// 原来: 通过 props 接收 timelineState 和 materials
// 重构后: 直接从 store 读取
const tracks = useTimelineStore(state => state.tracks)
```

## 10. 性能优化

### 10.1 选择器优化

```
// 避免: 订阅整个 store
const store = useTimelineStore()  // ❌ 每次任何状态变化都重渲染

// 推荐: 精确订阅
const tracks = useTimelineStore(state => state.tracks)  // ✅
const isDragging = useTimelineStore(state => state.isDragging)  // ✅

// 多值订阅使用 shallow 比较
import { shallow } from 'zustand/shallow'
const { currentTime, totalDuration } = useTimelineStore(
  state => ({ currentTime: state.currentTime, totalDuration: state.totalDuration }),
  shallow
)
```

### 10.2 派生状态

频繁计算的派生值可以在 slice 内缓存：

```
// canUndo/canRedo 在每次 recordAction/undo/redo 后更新
// 避免每次渲染都调用 historyService.canUndo()
```

### 10.3 批量更新

Zustand 默认批量更新（React 18+ automatic batching），无需额外处理。

## 11. 迁移路径

```
Step 1: 创建空 store 骨架（所有 slice 的 state + actions 声明）
Step 2: 实现 timelineSlice（核心状态管理）
Step 3: 实现 historySlice（undo/redo）
Step 4: 实现 selectionSlice（选中管理）
Step 5: 实现 dragSlice（拖拽状态机集成）
Step 6: 实现 uiSlice（UI 状态）
Step 7: 在 TimelinePanel 中并行使用 store（保留旧 useState 作为回退）
Step 8: 逐组件切换到 store
Step 9: 移除旧的 useState 和 prop drilling
```
