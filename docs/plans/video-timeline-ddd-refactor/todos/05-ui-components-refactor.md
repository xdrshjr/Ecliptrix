# TODO 05: UI 组件瘦化重构

**对应 Spec:** `specs/05-ui-components-refactor.md`

## Dependencies

- `depends_on: [04]` — 需要 Zustand store 就绪
- `blocks: [07]` — 集成测试需要 UI 重构完成
- `parallel_group: D` — Phase 4，需要 04 完成

## Tasks

按从叶子到根的顺序重构：

- [ ] 创建目录 `src/components/video/timeline/components/`（新的 UI 组件目录）
- [ ] 重构 `SentenceSegmentBar.tsx` — 几乎不变，移动到 components/ 目录
- [ ] 重构 `VolumeSlider.tsx` — 改为从 store 读取 showVolumeSlider 状态，调用 store.setTrackVolume/store.hideVolumeSlider
- [ ] 重构 `TimelineItem.tsx` — 移除内部 isDragging/isResizing useState 和手动事件处理，改为从 store 读取 dragPreview/isSelected，onPointerDown 调用 store.startDrag()，约 608→180 行
- [ ] 重构 `Track.tsx` — 移除 callback props (onSelectItem/onMoveItem/onResizeItem...)，改为从 store 读取轨道状态，将 isMaterialCompatible 委托给 TrackTypeUtils，约 601→220 行
- [ ] 重构 `TimelineRuler.tsx` — 从 store 读取 currentTime/totalDuration/zoomLevel/scrollLeft，调用 store.setCurrentTime/setZoomLevel
- [ ] 重构 `TimelineToolbar.tsx` — 从 store 读取 activeTool/canUndo/canRedo/isExporting，调用 store actions 替代 callback props
- [ ] 重构 `TrackContainer.tsx` — 从 store 读取 tracks/zoomLevel/selectedItems/isDragging，保留滚动同步和 ResizeObserver 的 UI 逻辑，约 617→220 行
- [ ] 重构 `TimelinePanel.tsx` — 最后瘦化：移除全部 useState（timelineState/history/selectedItems/dragPreview 等），移除 handleMaterialDrop/handleMoveItem/handleResizeItem 等所有业务方法，添加全局 pointer 事件监听器和键盘快捷键，约 2641→250 行
- [ ] 更新 `VideoEditingInterface.tsx` — 调整对 TimelinePanel 的调用方式（减少 props），通过 store 交互
- [ ] 创建 `components/index.ts` 公共导出
