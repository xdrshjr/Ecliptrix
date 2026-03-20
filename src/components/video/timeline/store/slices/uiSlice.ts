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

  setExporting: (value: boolean) => void;
  setImporting: (value: boolean) => void;
  setExtractingSubtitles: (value: boolean) => void;
  showVolumeSliderForTrack: (trackId: string, position: { x: number; y: number }) => void;
  hideVolumeSlider: () => void;
  setEditingSubtitle: (itemId: string | null) => void;
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
});
