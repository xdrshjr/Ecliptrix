/**
 * useTimelineStore — Combined Zustand store for the timeline.
 *
 * Merges all slices into a single store with subscribeWithSelector
 * middleware for fine-grained subscriptions. This is the single source
 * of truth for all timeline state.
 *
 * Usage:
 *   // Single value (automatic reference equality)
 *   const tracks = useTimelineStore(state => state.tracks);
 *
 *   // Multiple values with shallow comparison
 *   import { shallow } from 'zustand/shallow';
 *   const { currentTime, isPlaying } = useTimelineStore(
 *     state => ({ currentTime: state.currentTime, isPlaying: state.isPlaying }),
 *     shallow,
 *   );
 *
 *   // Non-React usage (testing, Node.js)
 *   const store = useTimelineStore;
 *   store.getState().initTimeline();
 *   store.getState().addItemToTrack('video-track-1', material);
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { createTimelineSlice, type TimelineSlice } from './slices/timelineSlice';
import { createSelectionSlice, type SelectionSlice } from './slices/selectionSlice';
import { createHistorySlice, type HistorySlice } from './slices/historySlice';
import { createDragSlice, type DragSlice } from './slices/dragSlice';
import { createUISlice, type UISlice } from './slices/uiSlice';

// ---------------------------------------------------------------------------
// Combined store type
// ---------------------------------------------------------------------------

export type TimelineStore =
  & TimelineSlice
  & SelectionSlice
  & HistorySlice
  & DragSlice
  & UISlice
  & { onEditCover?: (itemId: string) => void;
      onRemoveCover?: (collapse: boolean) => void };

// ---------------------------------------------------------------------------
// Store creation
// ---------------------------------------------------------------------------

export const useTimelineStore = create<TimelineStore>()(
  subscribeWithSelector((...args) => ({
    ...createTimelineSlice(...args),
    ...createSelectionSlice(...args),
    ...createHistorySlice(...args),
    ...createDragSlice(...args),
    ...createUISlice(...args),
  })),
);
