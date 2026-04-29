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

/**
 * Reset every slice to its initial state.
 *
 * Why this exists: this Zustand store is a module-level singleton, so a
 * `key={projectId}` remount of a React subtree will rebuild the React tree
 * but will NOT reset the store. When the user switches between video
 * projects, materials/timeline/storyboards from project A would otherwise
 * leak into project B. Call this BEFORE hydrating the editor with a new
 * project's `project_data` (see `VideoEditingInterface` projectId effect).
 *
 * Implementation note: we re-use each slice's existing reset/clear helper
 * where one exists, and explicitly set fields that have no helper.
 */
export function resetVideoEditingStore(): void {
  const s = useVideoEditingStore.getState();
  // material slice
  s.clearMaterials();
  s.setFilterType(null);
  // script slice
  s.resetScript();
  // storyboard slice
  s.setStoryboards([]);
  s.setStoryboardPacks([]);
  s.setActiveStoryboard(null);
  s.setStoryboardGenerating(false);
  // timeline slice
  s.setTimelineState(null);
  // async-task slice — drop ALL tasks (including in-flight ones)
  useVideoEditingStore.setState({ tasks: {} });
}
