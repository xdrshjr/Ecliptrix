/**
 * defaultTimeline.ts — the one timeline an agent turn starts from when the
 * editor has none yet.
 *
 * The chat route (server) and `OperationApplier` (browser) used to keep their
 * own copies; a turn that started from no timeline then had no baseline to
 * undo against. Both sides and `useAgentExecution` now share this factory.
 *
 * Pure: no React, DOM or store access — safe on the server and in the browser.
 */

import type { TimelineState } from '@/types';

/** A fresh default timeline: video, image, two audio and one subtitle track. */
export function createDefaultAgentTimelineState(): TimelineState {
  return {
    currentTime: 0,
    totalDuration: 0,
    zoomLevel: 1,
    selectedItems: [],
    tracks: [
      { id: 'video-track-1', name: 'Video Track', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0, items: [] },
      { id: 'image-track-1', name: 'Image Track', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1, items: [] },
      { id: 'audio-track-1', name: 'Audio Track 1', type: 'audio', height: 60, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 2, items: [] },
      { id: 'audio-track-2', name: 'Audio Track 2', type: 'audio', height: 60, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 3, items: [] },
      { id: 'subtitle-track-1', name: 'Subtitle Track', type: 'subtitle', height: 50, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 4, items: [] },
    ],
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: true,
    gridSize: 0.5,
    scrollLeft: 0,
  };
}
