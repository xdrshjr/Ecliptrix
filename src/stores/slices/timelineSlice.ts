/**
 * timelineSlice — Wraps the existing TimelineState so that both React
 * components and non-React code (OperationApplier, AgentEventRouter)
 * share a single source of truth.
 *
 * `externalUpdateId` is a change-token that consumers can subscribe to
 * in order to trigger re-renders after the Agent mutates the timeline
 * programmatically (i.e. outside of React's lifecycle).
 */

import type { StateCreator } from 'zustand';
import type { TimelineState } from '@/types';
import type { VideoEditingStore } from '../videoEditingStore';

// ---------------------------------------------------------------------------
// Slice state + actions
// ---------------------------------------------------------------------------

export interface TimelineSlice {
  // State
  timelineState: TimelineState | null;
  externalUpdateId: string | null;

  // Actions
  setTimelineState: (state: TimelineState | null) => void;
  triggerUpdate: (updateId: string) => void;
}

// ---------------------------------------------------------------------------
// Slice creator
// ---------------------------------------------------------------------------

export const createTimelineSlice: StateCreator<
  VideoEditingStore,
  [],
  [],
  TimelineSlice
> = (set) => ({
  // Initial state
  timelineState: null,
  externalUpdateId: null,

  // Actions
  setTimelineState: (timelineState) => set({ timelineState }),

  triggerUpdate: (updateId) => set({ externalUpdateId: updateId }),
});
