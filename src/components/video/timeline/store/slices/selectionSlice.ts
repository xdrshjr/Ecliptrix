/**
 * selectionSlice — Selection and active tool state management.
 *
 * Manages which timeline items are selected and which tool is active.
 * Pure state management with no domain logic beyond array operations.
 */

import type { StateCreator } from 'zustand';
import type { TimelineStore } from '../useTimelineStore';

// ---------------------------------------------------------------------------
// TimelineToolType
// ---------------------------------------------------------------------------

export type TimelineToolType =
  | 'select'
  | 'cut'
  | 'copy'
  | 'delete'
  | 'zoom'
  | 'hand';

// ---------------------------------------------------------------------------
// Slice state + actions interface
// ---------------------------------------------------------------------------

export interface SelectionSlice {
  selectedItems: string[];
  activeTool: TimelineToolType;

  selectItem: (itemId: string) => void;
  toggleItemSelection: (itemId: string) => void;
  selectAllTrackItems: (trackId: string) => void;
  deselectAll: () => void;
  setActiveTool: (tool: TimelineToolType) => void;

  // Query helpers
  isSelected: (itemId: string) => boolean;
  getSelectedItems: () => string[];
}

// ---------------------------------------------------------------------------
// Slice factory
// ---------------------------------------------------------------------------

export const createSelectionSlice: StateCreator<
  TimelineStore,
  [],
  [],
  SelectionSlice
> = (set, get) => ({
  selectedItems: [],
  activeTool: 'select' as TimelineToolType,

  // Note: Selection changes are NOT recorded in undo history.
  // Selection state is not part of the timeline snapshot, so recording
  // would create no-op undo entries that confuse the user.
  selectItem: (itemId: string) => {
    set({ selectedItems: [itemId] });
  },

  toggleItemSelection: (itemId: string) => {
    const current = get().selectedItems;
    const index = current.indexOf(itemId);
    if (index >= 0) {
      set({ selectedItems: current.filter(id => id !== itemId) });
    } else {
      set({ selectedItems: [...current, itemId] });
    }
  },

  selectAllTrackItems: (trackId: string) => {
    const tracks = get().tracks;
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;
    set({ selectedItems: track.items.map(item => item.id) });
  },

  deselectAll: () => {
    set({ selectedItems: [] });
  },

  setActiveTool: (tool: TimelineToolType) => {
    set({ activeTool: tool });
  },

  isSelected: (itemId: string): boolean => {
    return get().selectedItems.includes(itemId);
  },

  getSelectedItems: (): string[] => {
    return get().selectedItems;
  },
});
