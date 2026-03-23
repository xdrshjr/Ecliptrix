/**
 * scriptSlice — Manages the script panel state.
 *
 * Tracks the current script content, its type (video / understanding /
 * ai_generated), and generation progress so the Agent can write script
 * content and the ScriptPanel reacts in real time.
 */

import type { StateCreator } from 'zustand';
import type { VideoEditingStore } from '../videoEditingStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScriptType = 'video' | 'understanding' | 'ai_generated';

// ---------------------------------------------------------------------------
// Slice state + actions
// ---------------------------------------------------------------------------

export interface ScriptSlice {
  // State
  scriptContent: string;
  scriptType: ScriptType;
  isScriptGenerating: boolean;
  scriptGenerationProgress: number;

  // Actions
  setScriptContent: (content: string) => void;
  setScriptType: (type: ScriptType) => void;
  appendScriptContent: (content: string) => void;
  setScriptGenerating: (generating: boolean) => void;
  setScriptGenerationProgress: (progress: number) => void;
  resetScript: () => void;
}

// ---------------------------------------------------------------------------
// Slice creator
// ---------------------------------------------------------------------------

export const createScriptSlice: StateCreator<
  VideoEditingStore,
  [],
  [],
  ScriptSlice
> = (set) => ({
  // Initial state
  scriptContent: '',
  scriptType: 'video',
  isScriptGenerating: false,
  scriptGenerationProgress: 0,

  // Actions
  setScriptContent: (content) => set({ scriptContent: content }),

  setScriptType: (type) => set({ scriptType: type }),

  appendScriptContent: (content) =>
    set((state) => ({ scriptContent: state.scriptContent + content })),

  setScriptGenerating: (generating) =>
    set({ isScriptGenerating: generating }),

  setScriptGenerationProgress: (progress) =>
    set({ scriptGenerationProgress: Math.min(100, Math.max(0, progress)) }),

  resetScript: () =>
    set({
      scriptContent: '',
      scriptType: 'video',
      isScriptGenerating: false,
      scriptGenerationProgress: 0,
    }),
});
