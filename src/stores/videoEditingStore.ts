/**
 * videoEditingStore — The single combined Zustand store for the video
 * editing workspace. All feature-specific slices are merged here via
 * the Zustand slice pattern so that every part of the app (React
 * components, AgentEventRouter, OperationApplier) shares one store
 * instance.
 *
 * Usage in React:
 *   const materials = useVideoEditingStore(s => s.materials);
 *
 * Usage outside React (AgentEventRouter, etc.):
 *   const { addMaterial } = useVideoEditingStore.getState();
 */

import { create } from 'zustand';

import {
  createMaterialSlice,
  type MaterialSlice,
} from './slices/materialSlice';
import {
  createScriptSlice,
  type ScriptSlice,
} from './slices/scriptSlice';
import {
  createStoryboardSlice,
  type StoryboardSlice,
} from './slices/storyboardSlice';
import {
  createTimelineSlice,
  type TimelineSlice,
} from './slices/timelineSlice';
import {
  createAsyncTaskSlice,
  type AsyncTaskSlice,
} from './slices/asyncTaskSlice';

// ---------------------------------------------------------------------------
// Combined store type
// ---------------------------------------------------------------------------

export type VideoEditingStore = MaterialSlice &
  ScriptSlice &
  StoryboardSlice &
  TimelineSlice &
  AsyncTaskSlice;

// ---------------------------------------------------------------------------
// Store instance
// ---------------------------------------------------------------------------

export const useVideoEditingStore = create<VideoEditingStore>()((...a) => ({
  ...createMaterialSlice(...a),
  ...createScriptSlice(...a),
  ...createStoryboardSlice(...a),
  ...createTimelineSlice(...a),
  ...createAsyncTaskSlice(...a),
}));
