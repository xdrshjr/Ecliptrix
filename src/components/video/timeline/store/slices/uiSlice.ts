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
   * Item whose camera-motion (2D/3D 运镜) panel is open, or null when closed.
   *
   * Lives in the store rather than in TimelinePanel's local state because BOTH
   * the toolbar (panel-owned) and a clip's context menu (three levels down,
   * inside TimelineItem) open the same dialog — drilling a callback through
   * TrackContainer and Track would couple two components that have nothing else
   * to do with the feature. Transient; never part of the snapshot/history.
   */
  cameraMotionItemId: string | null;
  /**
   * Item id flagged to be scrolled horizontally into view by the panel. Set
   * after a cross-track drag commit (fix C): autoOrganize repacks the target
   * track flush-from-0, so a short clip dropped onto a track that already holds
   * a long clip lands past the viewport and reads as "lost". The panel consumes
   * this signal, scrolls the real DOM container, then clears it. Transient —
   * never part of the snapshot/history.
   */
  pendingScrollItemId: string | null;
  /**
   * Aspect ratio (width / height) of the PROJECT canvas the preview renders at.
   *
   * Published by the player panel, which owns the ratio selector, and read by
   * the camera-motion panel, which is its sibling three levels away in the tree.
   * It lives here for the same reason `cameraMotionItemId` does: the alternative
   * is drilling a scalar through the whole editor for one dialog.
   *
   * Why the panel needs it at all: `isMotionRenderable` and the 2D coverage
   * guarantee both key off the ASPECT, so judging an Apply against a hard-coded
   * 16:9 in a 9:16 project gates the user on a framing the renderer never draws
   * (G3 / P1-9). Transient; never part of the snapshot/history.
   */
  projectCanvasAspect: number;

  setExporting: (value: boolean) => void;
  setImporting: (value: boolean) => void;
  setExtractingSubtitles: (value: boolean) => void;
  showVolumeSliderForTrack: (trackId: string, position: { x: number; y: number }) => void;
  hideVolumeSlider: () => void;
  setEditingSubtitle: (itemId: string | null) => void;
  /** Open (or close, with null) the camera-motion panel for an item. */
  setCameraMotionItem: (itemId: string | null) => void;
  /** Publish the project canvas ratio (width / height). Ignores junk values. */
  setProjectCanvasAspect: (aspect: number) => void;
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
  cameraMotionItemId: null,
  pendingScrollItemId: null,
  // 16:9 until the player panel reports otherwise — the historical assumption,
  // now an explicit default instead of a constant buried in the dialog.
  projectCanvasAspect: 16 / 9,

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

  setCameraMotionItem: (itemId: string | null) => {
    set({ cameraMotionItemId: itemId });
  },

  setProjectCanvasAspect: (aspect: number) => {
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    set({ projectCanvasAspect: aspect });
  },

  requestScrollItemIntoView: (itemId: string) => {
    set({ pendingScrollItemId: itemId });
  },

  clearPendingScrollItem: () => {
    set({ pendingScrollItemId: null });
  },
});
