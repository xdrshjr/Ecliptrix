/**
 * Public API for the video editing Zustand store.
 *
 * Re-exports the store hook, the store type, all slice types, and
 * convenience selector hooks so consumers only need:
 *
 *   import { useVideoEditingStore, useMaterials } from '@/stores';
 */

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export { useVideoEditingStore, type VideoEditingStore } from './videoEditingStore';

// ---------------------------------------------------------------------------
// Slice types
// ---------------------------------------------------------------------------

export type { MaterialSlice } from './slices/materialSlice';
export type { ScriptSlice, ScriptType } from './slices/scriptSlice';
export type {
  StoryboardSlice,
  StoryboardItem,
} from './slices/storyboardSlice';
export type { TimelineSlice } from './slices/timelineSlice';
export type {
  AsyncTaskSlice,
  AsyncTask,
  AsyncTaskType,
  AsyncTaskStatus,
} from './slices/asyncTaskSlice';

// ---------------------------------------------------------------------------
// Convenience selector hooks
//
// These are thin wrappers that select a specific slice of state. They
// reduce boilerplate in components and produce stable references when
// the selected slice has not changed.
//
// IMPORTANT: Zustand's default equality check is Object.is (strict
// reference equality). Selectors that return new objects/arrays must use
// `useShallow` to avoid unnecessary re-renders on every store update.
// ---------------------------------------------------------------------------

import { useShallow } from 'zustand/react/shallow';
import { useVideoEditingStore } from './videoEditingStore';

/** Select the full materials array. */
export const useMaterials = () =>
  useVideoEditingStore((s) => s.materials);

/** Select material actions (stable — functions never change). */
export const useMaterialActions = () =>
  useVideoEditingStore(
    useShallow((s) => ({
      addMaterial: s.addMaterial,
      addMaterials: s.addMaterials,
      removeMaterial: s.removeMaterial,
      updateMaterial: s.updateMaterial,
      setSelectedMaterial: s.setSelectedMaterial,
      setFilterType: s.setFilterType,
      clearMaterials: s.clearMaterials,
    })),
  );

/** Select script state. */
export const useScript = () =>
  useVideoEditingStore(
    useShallow((s) => ({
      scriptContent: s.scriptContent,
      scriptType: s.scriptType,
      isScriptGenerating: s.isScriptGenerating,
      scriptGenerationProgress: s.scriptGenerationProgress,
    })),
  );

/** Select script actions. */
export const useScriptActions = () =>
  useVideoEditingStore(
    useShallow((s) => ({
      setScriptContent: s.setScriptContent,
      setScriptType: s.setScriptType,
      appendScriptContent: s.appendScriptContent,
      setScriptGenerating: s.setScriptGenerating,
      setScriptGenerationProgress: s.setScriptGenerationProgress,
      resetScript: s.resetScript,
    })),
  );

/** Select storyboard packs. */
export const useStoryboardPacks = () =>
  useVideoEditingStore((s) => s.storyboardPacks);

/** Select storyboard items. */
export const useStoryboards = () =>
  useVideoEditingStore((s) => s.storyboards);

/** Select timeline state. */
export const useTimeline = () =>
  useVideoEditingStore(
    useShallow((s) => ({
      timelineState: s.timelineState,
      externalUpdateId: s.externalUpdateId,
    })),
  );

/** Select async tasks as an array (for UI rendering). */
export const useAsyncTasks = () =>
  useVideoEditingStore(useShallow((s) => Object.values(s.tasks)));

/** Select a single async task by ID. */
export const useAsyncTask = (taskId: string) =>
  useVideoEditingStore((s) => s.tasks[taskId] ?? null);
