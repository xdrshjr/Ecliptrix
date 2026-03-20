# TODO 04: Zustand Store

**对应 Spec:** `specs/04-zustand-store.md`

## Dependencies

- `depends_on: [01, 02, 03]` — 依赖实体、服务、状态机
- `blocks: [05]` — UI 组件重构需要 store 就绪
- `parallel_group: C` — Phase 2，需要 01-03 全部完成

## Tasks

- [ ] 安装 zustand 依赖: `npm install zustand`
- [ ] 创建目录结构 `src/components/video/timeline/store/{slices,actions}`
- [ ] 实现 `slices/timelineSlice.ts` — 核心状态（TimelineAggregate 封装），包含 initTimeline, addItemToTrack, removeItem, moveItem, resizeItem, 轨道操作, 播放控制, 缩放/滚动, 导入/导出, _syncDerivedState 方法
- [ ] 实现 `slices/selectionSlice.ts` — 选中状态管理，包含 selectItem, toggleItemSelection, selectAllTrackItems, deselectAll, setActiveTool
- [ ] 实现 `slices/historySlice.ts` — undo/redo 状态管理，封装 HistoryService，包含 recordAction, captureNextState, undo, redo, clearHistory，维护 canUndo/canRedo 派生状态
- [ ] 实现 `slices/dragSlice.ts` — 拖拽状态管理，集成 XState dragMachine，包含 startDrag, updateDrag, endDrag, cancelDrag, materialDragOver 管理
- [ ] 实现 `slices/uiSlice.ts` — UI 状态管理，包含 isExporting, isImporting, isExtractingSubtitles, showVolumeSlider, editingSubtitleId
- [ ] 实现 `actions/addItem.ts` — 封装添加素材到轨道的完整流程（选轨道→创建item→添加→记录历史→同步）
- [ ] 实现 `actions/moveItem.ts` — 封装移动 item 流程
- [ ] 实现 `actions/resizeItem.ts` — 封装缩放 item 流程
- [ ] 实现 `actions/removeItem.ts` — 封装删除 item 流程
- [ ] 实现 `actions/trackActions.ts` — 轨道操作 (mute/lock/volume/visibility)
- [ ] 实现 `actions/historyActions.ts` — undo/redo actions
- [ ] 实现 `useTimelineStore.ts` — 组合所有 slices，使用 subscribeWithSelector 中间件
- [ ] 创建 `store/index.ts` 公共导出
