# TODO 03: XState 拖拽状态机

**对应 Spec:** `specs/03-drag-state-machine.md`

## Dependencies

- `depends_on: [01]` — 依赖 DragCalculationService 的类型（但主要依赖值对象）
- `blocks: [04]` — dragSlice 需要状态机定义
- `parallel_group: B` — 可与 TODO 02 并行（在 01 完成后）

## Tasks

- [ ] 安装 xstate 依赖: `npm install xstate @xstate/react`
- [ ] 创建目录 `src/components/video/timeline/domain/machines/`
- [ ] 实现 `dragMachine.ts` — XState v5 状态机定义:
  - 状态: idle, detecting, dragging, resizingStart, resizingEnd, previewing, committed
  - 事件: POINTER_DOWN, POINTER_MOVE, POINTER_UP, ESCAPE, PREVIEW_APPLIED, COMMIT_COMPLETE
  - Context: itemId, trackId, originalStartTime, originalDuration, interactionType, pointerDownPosition, currentDelta, previewStartTime, previewDuration, moveThreshold(3), throttleMs(16)
  - Guards: isMoveInteraction, isResizeStartInteraction, isResizeEndInteraction, exceedsThreshold
  - Actions: capturePointerDown, calculateMovePreview, calculateResizePreview, resetContext, restoreOriginal
- [ ] 实现 MaterialDropMachine（可选，简单状态机）: idle → dragOver → dropped → idle
- [ ] 更新 `domain/index.ts` 导出状态机
