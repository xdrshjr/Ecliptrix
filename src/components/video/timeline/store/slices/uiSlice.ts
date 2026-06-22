/**
 * uiSlice — UI-only transient state.
 *
 * Holds flags for exporting, importing, subtitle extraction, and
 * UI overlays like the volume slider popover. This slice has no
 * domain logic; it is purely for coordinating UI presentation state.
 */

import type { StateCreator } from 'zustand';
import type { TimelineStore } from '../useTimelineStore';

// ---------------------------------------------------------------------------
// Volume slider position
// ---------------------------------------------------------------------------

export interface VolumeSliderState {
  trackId: string;
  position: { x: number; y: number };
}

// ---------------------------------------------------------------------------
// Slice state + actions interface
// ---------------------------------------------------------------------------

export interface UISlice {
  isExporting: boolean;
  isImporting: boolean;
  isExtractingSubtitles: boolean;
  showVolumeSlider: VolumeSliderState | null;
  editingSubtitleId: string | null;
  /**
   * Item id flagged to be scrolled horizontally into view by the panel. Set
   * after a cross-track drag commit (fix C): autoOrganize repacks the target
   * track flush-from-0, so a short clip dropped onto a track that already holds
   * a long clip lands past the viewport and reads as "lost". The panel consumes
   * this signal, scrolls the real DOM container, then clears it. Transient —
   * never part of the snapshot/history.
   */
  pendingScrollItemId: string | null;

  setExporting: (value: boolean) => void;
  setImporting: (value: boolean) => void;
  setExtractingSubtitles: (value: boolean) => void;
  showVolumeSliderForTrack: (trackId: string, position: { x: number; y: number }) => void;
  hideVolumeSlider: () => void;
  setEditingSubtitle: (itemId: string | null) => void;
  /** Flag an item to be scrolled into view by the panel (fix C). */
  requestScrollItemIntoView: (itemId: string) => void;
  /** Clear the pending scroll-into-view request once consumed. */
  clearPendingScrollItem: () => void;
}

// ---------------------------------------------------------------------------
// Slice factory
// ---------------------------------------------------------------------------

export const createUISlice: StateCreator<
  TimelineStore,
  [],
  [],
  UISlice
> = (set) => ({
  isExporting: false,
  isImporting: false,
  isExtractingSubtitles: false,
  showVolumeSlider: null,
  editingSubtitleId: null,
  pendingScrollItemId: null,

  setExporting: (value: boolean) => {
    set({ isExporting: value });
  },

  setImporting: (value: boolean) => {
    set({ isImporting: value });
  },

  setExtractingSubtitles: (value: boolean) => {
    set({ isExtractingSubtitles: value });
  },

  showVolumeSliderForTrack: (trackId: string, position: { x: number; y: number }) => {
    set({ showVolumeSlider: { trackId, position } });
  },

  hideVolumeSlider: () => {
    set({ showVolumeSlider: null });
  },

  setEditingSubtitle: (itemId: string | null) => {
    set({ editingSubtitleId: itemId });
  },

  requestScrollItemIntoView: (itemId: string) => {
    set({ pendingScrollItemId: itemId });
  },

  clearPendingScrollItem: () => {
    set({ pendingScrollItemId: null });
  },
});
