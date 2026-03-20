# Spec 05: UI 组件瘦化重构

## 1. 概述

将现有的"胖组件"瘦化为纯渲染层。组件仅负责：
1. 从 Zustand store 读取状态
2. 渲染 UI
3. 将用户交互转发给 store actions

所有业务逻辑、状态计算、副作用处理都已在 Domain 层和 Store 层完成。

**目标文件位置：** `src/components/video/timeline/components/`

## 2. TimelinePanel 重构

**当前：** 2,641 行，包含全部状态管理、事件处理、历史记录、导入导出逻辑

**重构后：** ~200-300 行，仅作为容器组件

```
TimelinePanel (重构后):
  职责:
    - 初始化 store（如果需要从 props 传入初始状态）
    - 渲染子组件布局（Toolbar + Ruler + TrackContainer）
    - 注册全局键盘快捷键（Ctrl+Z/Y, Delete 等）
    - 注册全局 pointer 事件监听器（用于拖拽）

  从 store 读取:
    - isExporting, isImporting（用于 loading 状态）

  事件处理:
    onKeyDown → 转发到 store (undo/redo/delete/selectAll)

  不再包含:
    ✗ timelineState useState
    ✗ history/historyIndex useState
    ✗ handleMaterialDrop 函数
    ✗ handleMoveItem/handleResizeItem 函数
    ✗ handleUndo/handleRedo 函数
    ✗ 所有的 addToHistory 调用
    ✗ selectedItems 状态管理
    ✗ dragPreview 状态管理
    ✗ isExtractingSubtitles 状态

  Props (精简):
    materials: MaterialItem[]     // 外部传入，仅用于素材拖入
    taskId: string               // 任务标识
    onTimeUpdate?: (time: number) => void  // 通知父组件时间变化
```

## 3. TrackContainer 重构

**当前：** 617 行，管理拖拽滚动、轨道高度计算、溢出检测

**重构后：** ~200-250 行

```
TrackContainer (重构后):
  职责:
    - 渲染轨道列表
    - 管理滚动同步（ruler ↔ tracks）
    - 溢出指示器
    - 动态轨道高度（ResizeObserver）

  从 store 读取:
    tracks, zoomLevel, scrollLeft, currentTime,
    selectedItems, isDragging, materialDragOver

  保留的 UI 逻辑 (这些是纯 UI 关注点):
    - dragScrollState（水平拖拽滚动）— 纯 UI 交互
    - canScrollLeft/canScrollRight 溢出检测
    - ResizeObserver 动态高度

  不再包含:
    ✗ 通过 props 接收 callbacks
    ✗ 手动传递 selectedItems 给子组件
```

## 4. Track 重构

**当前：** 601 行，包含素材类型兼容性检查、拖放处理、VolumeSlider 管理

**重构后：** ~200-250 行

```
Track (重构后):
  职责:
    - 渲染轨道头部（名称、控制按钮）
    - 渲染 item 列表
    - 处理 drag-and-drop 事件（素材拖入）
    - 渲染 VolumeSlider（UI 弹出层）

  从 store 读取:
    track (by id), selectedItems, materialDragOver, showVolumeSlider

  事件处理:
    onDragOver → store.setMaterialDragOver(trackId, materialType)
    onDragLeave → store.clearMaterialDragOver()
    onDrop → store.dropMaterial(trackId, material)
    onMuteClick → store.toggleTrackMute(trackId)
    onLockClick → store.toggleTrackLock(trackId)
    onVolumeClick → store.showVolumeSliderForTrack(trackId, position)
    onSelectAll → store.selectAllTrackItems(trackId)

  不再包含:
    ✗ isMaterialCompatible 内联函数 (移到 TrackTypeUtils)
    ✗ 接收 onSelectItem/onMoveItem/onResizeItem 等 callback props
    ✗ 手动传递 props 给 TimelineItem
```

## 5. TimelineItem 重构

**当前：** 608 行，包含完整的拖拽/缩放事件处理、位移计算、节流逻辑

**重构后：** ~150-200 行

```
TimelineItem (重构后):
  职责:
    - 渲染 item 外观（缩略图、标签、波形、字幕文本）
    - 渲染拖拽手柄视觉指示
    - 渲染选中状态
    - 发起 pointer 事件

  从 store 读取:
    dragPreview (匹配当前 itemId), isDragging,
    selectedItems (判断 isSelected), editingSubtitleId

  事件处理:
    onPointerDown → store.startDrag(event)
    onClick → store.selectItem(itemId)
    onDoubleClick (字幕) → store.setEditingSubtitle(itemId)
    onSubtitleChange → store.updateItemSubtitle(itemId, text)

  视觉状态:
    - 使用 dragPreview 中的位置/尺寸进行预览渲染
    - isSelected → 边框高亮
    - isDragging 且 itemId 匹配 → 半透明 + 拖拽光标

  不再包含:
    ✗ isDragging/isResizing 本地 useState
    ✗ mousedown/mousemove/mouseup 手动注册
    ✗ DragCalculationService 调用 (移到 dragSlice)
    ✗ 节流逻辑 (移到 TrackContainer 的全局 listener)
    ✗ onMove/onResize callback props
```

## 6. TimelineToolbar 重构

**当前：** 370 行

**重构后：** ~200 行（变化不大，主要是去掉 callback props）

```
TimelineToolbar (重构后):
  从 store 读取:
    activeTool, canUndo, canRedo, isExporting

  事件处理:
    onToolSelect → store.setActiveTool(tool)
    onUndo → store.undo()
    onRedo → store.redo()
    onDelete → store.removeItem(selectedItems)
    onExportJSON → 调用 infrastructure.TimelineRepository.exportJSON()
    onImportJSON → 调用 infrastructure.TimelineRepository.importJSON()

  不再包含:
    ✗ 通过 props 接收 onUndo/onRedo/onDelete 等 callbacks
```

## 7. TimelineRuler 重构

**当前：** 376 行

**重构后：** ~250 行（变化较小，保留滚动和缩放 UI 逻辑）

```
TimelineRuler (重构后):
  从 store 读取:
    currentTime, totalDuration, zoomLevel, scrollLeft

  事件处理:
    onScrub → store.setCurrentTime(time)
    onZoomChange → store.setZoomLevel(zoom)

  保留的 UI 逻辑:
    - 时间刻度渲染（纯渲染计算）
    - 播放头位置计算
```

## 8. VolumeSlider / SentenceSegmentBar

变化最小的组件：

```
VolumeSlider:
  从 store 读取: showVolumeSlider (获取 trackId 和 position)
  事件: onVolumeChange → store.setTrackVolume(trackId, volume)
  保留: Portal 渲染逻辑

SentenceSegmentBar:
  变化: 无（纯渲染组件，Props 不变）
```

## 9. Prop 变更对照表

| 组件 | 移除的 Props | 新的 Store 读取 |
|------|-------------|----------------|
| TimelinePanel | timelineState, onTimelineUpdate, selectedItems, onSelectItem, history, onUndo, onRedo, ... (~20 props) | store.tracks, store.currentTime, ... |
| TrackContainer | timelineState, selectedItems, onSelectItem, onMoveItem, onResizeItem, ... (~15 props) | store.tracks, store.selectedItems, ... |
| Track | track, selectedItems, zoomLevel, onSelectItem, onMoveItem, onResizeItem, onMute, onLock, ... (~12 props) | store (by trackId), store.selectedItems |
| TimelineItem | item, isSelected, zoomLevel, onSelect, onMove, onResize, onSubtitleEdit, ... (~10 props) | store (by itemId), store.dragPreview |
| TimelineToolbar | activeTool, canUndo, canRedo, onToolSelect, onUndo, onRedo, ... (~8 props) | store.activeTool, store.canUndo, ... |

## 10. 全局事件监听器

将分散在 TimelineItem 中的 mousemove/mouseup 监听器提升到 TimelinePanel 级别：

```
// TimelinePanel.tsx
useEffect(() => {
  if (!isDragging && !isResizing) return

  const handlePointerMove = throttle((e: PointerEvent) => {
    store.updateDrag({
      clientX: e.clientX,
      clientY: e.clientY,
      deltaX: e.clientX - dragStartX,
    })
  }, 16)

  const handlePointerUp = (e: PointerEvent) => {
    store.endDrag({ clientX: e.clientX, clientY: e.clientY })
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') store.cancelDrag()
  }

  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('keydown', handleKeyDown)

  return () => {
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
    window.removeEventListener('keydown', handleKeyDown)
  }
}, [isDragging, isResizing])
```

## 11. 行数预估对比

| 组件 | 重构前 | 重构后 | 减少 |
|------|--------|--------|------|
| TimelinePanel | 2,641 | ~250 | ~90% |
| TrackContainer | 617 | ~220 | ~64% |
| Track | 601 | ~220 | ~63% |
| TimelineItem | 608 | ~180 | ~70% |
| TimelineToolbar | 370 | ~200 | ~46% |
| TimelineRuler | 376 | ~250 | ~34% |
| VolumeSlider | 233 | ~200 | ~14% |
| SentenceSegmentBar | 142 | ~140 | ~1% |
| **合计** | **5,588** | **~1,660** | **~70%** |

减少的代码迁移到了 Domain 层和 Store 层，总代码量可能略有增加，但职责分离更清晰。
