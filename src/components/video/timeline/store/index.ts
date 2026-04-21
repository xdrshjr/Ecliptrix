/**
 * Store — Public API
 *
 * Re-exports the combined store hook, slice types, and orchestrated
 * actions for use by UI components and external consumers.
 */

// ---------------------------------------------------------------------------
// Store hook
// ---------------------------------------------------------------------------

export { useTimelineStore } from './useTimelineStore';
export type { TimelineStore } from './useTimelineStore';

// ---------------------------------------------------------------------------
// Slice types (for typed selectors)
// ---------------------------------------------------------------------------

export type { TimelineSlice } from './slices/timelineSlice';
export type { SelectionSlice } from './slices/selectionSlice';
export type { HistorySlice } from './slices/historySlice';
export type { DragSlice, DragPreviewData, MaterialDragOverData } from './slices/dragSlice';
export type { UISlice, VolumeSliderState } from './slices/uiSlice';

// Re-export TimelineToolType as a value (not just a type) for consumer use
export type { TimelineToolType } from './slices/selectionSlice';

// ---------------------------------------------------------------------------
// Orchestrated actions
// ---------------------------------------------------------------------------

export { addItemAction } from './actions/addItem';
export { moveItemAction } from './actions/moveItem';
export { resizeItemAction } from './actions/resizeItem';
export { removeItemAction, removeItemsAction } from './actions/removeItem';
export { swapItemsAction } from './actions/swapItems';
export {
  toggleTrackLockAction,
  toggleTrackMuteAction,
  toggleTrackVisibilityAction,
  setTrackVolumeAction,
  removeTrackAction,
  addTrackAction,
} from './actions/trackActions';
export type {
  RemoveTrackGroupKey,
  RemoveTrackResult,
  AddTrackType,
  AddTrackParams,
  AddTrackResult,
} from './actions/trackActions';
export {
  undoAction,
  redoAction,
  clearHistoryAction,
} from './actions/historyActions';

// ---------------------------------------------------------------------------
// Re-export shallow from zustand for consumer convenience
// ---------------------------------------------------------------------------

export { shallow } from 'zustand/shallow';
