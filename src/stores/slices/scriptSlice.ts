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

export interface ScriptSegmentData {
  id: string;
  title: string;
  scriptText: string;
  narrationText: string;
}

export interface ScriptSlice {
  // State
  scriptContent: string;
  scriptType: ScriptType;
  isScriptGenerating: boolean;
  scriptGenerationProgress: number;
  scriptSegmentsData: ScriptSegmentData[] | null;

  // Actions
  setScriptContent: (content: string) => void;
  setScriptType: (type: ScriptType) => void;
  appendScriptContent: (content: string) => void;
  setScriptGenerating: (generating: boolean) => void;
  setScriptGenerationProgress: (progress: number) => void;
  setScriptSegmentsData: (data: Array<Omit<ScriptSegmentData, 'id'> & { id?: string }> | null) => void;
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
  scriptSegmentsData: null,

  // Actions
  setScriptContent: (content) => set({ scriptContent: content }),

  setScriptType: (type) => set({ scriptType: type }),

  appendScriptContent: (content) =>
    set((state) => ({ scriptContent: state.scriptContent + content })),

  setScriptGenerating: (generating) =>
    set({ isScriptGenerating: generating }),

  setScriptGenerationProgress: (progress) =>
    set({ scriptGenerationProgress: Math.min(100, Math.max(0, progress)) }),

  // 旧操作仅在接收时分配身份；React 消费、重排及保存始终沿用。
  setScriptSegmentsData: (data) => set({ scriptSegmentsData: data?.map(segment => ({
    ...segment, id: segment.id?.trim() ? segment.id : `agent-segment-${crypto.randomUUID()}`,
  })) ?? null }),

  resetScript: () =>
    set({
      scriptContent: '',
      scriptType: 'video',
      isScriptGenerating: false,
      scriptGenerationProgress: 0,
      scriptSegmentsData: null,
    }),
});
