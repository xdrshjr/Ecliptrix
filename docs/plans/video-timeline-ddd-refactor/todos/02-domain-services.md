# TODO 02: 领域服务

**对应 Spec:** `specs/02-domain-services.md`

## Dependencies

- `depends_on: [01]` — 依赖实体和值对象类型
- `blocks: [04]` — Store 层调用领域服务
- `parallel_group: B` — 在 Phase 1 中，依赖 01 完成后开始

## Tasks

- [ ] 创建目录 `src/components/video/timeline/domain/services/`
- [ ] 实现 `TrackSelectionService.ts` — 从 TimelinePanel.tsx handleMaterialDrop 提取轨道选择算法（selectTrackForMaterial, getCompatibleTracks），包含 image-track 优先级逻辑
- [ ] 实现 `ItemPlacementService.ts` — 从 TimelinePanel.tsx 提取 item 创建逻辑（calculatePlacementPosition, createItemFromMaterial, getColorForType, hasOverlap）
- [ ] 实现 `DragCalculationService.ts` — 从 TimelineItem.tsx 提取拖拽计算逻辑（calculateMovePosition, calculateResizePosition, detectInteractionType, snapToGrid, pixelsToTime, timeToPixels），常量 RESIZE_HANDLE_WIDTH=8
- [ ] 实现 `HistoryService.ts` — 从 TimelinePanel.tsx 提取 undo/redo 逻辑（addAction, captureBeforeState, captureAfterState, undo, redo, canUndo, canRedo, clear），MAX_HISTORY=50
- [ ] 实现 `DurationCalculationService.ts` — 提取 totalDuration 计算逻辑（calculateTotalDuration, calculateTrackDuration）
- [ ] 更新 `domain/index.ts` 导出所有服务
