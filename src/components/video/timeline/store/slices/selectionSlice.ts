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

  /** Switch the active editing tool (e.g. 'select' ↔ 'cut'). */
  setActiveTool: (tool: TimelineToolType) => void;

  selectItem: (itemId: string) => void;
  toggleItemSelection: (itemId: string) => void;
  selectAllTrackItems: (trackId: string) => void;
  deselectAll: () => void;
  /** Drop any selected items that belong to the given track. */
  clearItemsOfTrack: (trackId: string) => void;

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

  // Tool state is transient UI state, not part of the timeline snapshot, so
  // switching tools is never recorded in undo history.
  setActiveTool: (tool: TimelineToolType) => {
    set({ activeTool: tool });
  },

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

  clearItemsOfTrack: (trackId: string) => {
    const tracks = get().tracks;
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;
    const doomedIds = new Set(track.items.map(i => i.id));
    const filtered = get().selectedItems.filter(id => !doomedIds.has(id));
    if (filtered.length !== get().selectedItems.length) {
      set({ selectedItems: filtered });
    }
  },

  isSelected: (itemId: string): boolean => {
    return get().selectedItems.includes(itemId);
  },

  getSelectedItems: (): string[] => {
    return get().selectedItems;
  },
});
