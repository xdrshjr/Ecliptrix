/**
 * storyboardSlice — Manages storyboard panel state.
 *
 * Holds both individual storyboard items (for future fine-grained control)
 * and storyboard packs (the current production concept from the backend).
 */

import type { StateCreator } from 'zustand';
import type { StoryboardFrame, StoryboardPack } from '@/types';
import type { VideoEditingStore } from '../videoEditingStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * StoryboardItem represents a single conceptual storyboard entry that the
 * Agent can create/manipulate. This is a lightweight descriptor used for
 * Agent-driven storyboard workflows; it does NOT replace StoryboardPack
 * which remains the primary backend data model.
 */
export interface StoryboardItem {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  videoUrl?: string;
  order: number;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Slice state + actions
// ---------------------------------------------------------------------------

export interface StoryboardSlice {
  // State
  storyboards: StoryboardItem[];
  activeStoryboardId: string | null;
  storyboardPacks: StoryboardPack[];
  isStoryboardGenerating: boolean;

  // Actions — StoryboardItem
  setStoryboards: (items: StoryboardItem[]) => void;
  addStoryboard: (item: StoryboardItem) => void;
  updateStoryboard: (id: string, patch: Partial<StoryboardItem>) => void;
  removeStoryboard: (id: string) => void;
  setActiveStoryboard: (id: string | null) => void;

  // Actions — StoryboardPack
  setStoryboardPacks: (packs: StoryboardPack[]) => void;
  addStoryboardPack: (pack: StoryboardPack) => void;
  updateStoryboardPack: (
    packId: string,
    patch: Partial<StoryboardPack>,
  ) => void;
  removeStoryboardPack: (packId: string) => void;
  updatePackFrame: (
    packId: string,
    frameIndex: number,
    patch: Partial<StoryboardFrame>,
  ) => void;

  // Actions — generation state
  setStoryboardGenerating: (generating: boolean) => void;
}

// ---------------------------------------------------------------------------
// Slice creator
// ---------------------------------------------------------------------------

export const createStoryboardSlice: StateCreator<
  VideoEditingStore,
  [],
  [],
  StoryboardSlice
> = (set) => ({
  // Initial state
  storyboards: [],
  activeStoryboardId: null,
  storyboardPacks: [],
  isStoryboardGenerating: false,

  // --- StoryboardItem actions ---

  setStoryboards: (items) => set({ storyboards: items }),

  addStoryboard: (item) =>
    set((state) => {
      if (state.storyboards.some((s) => s.id === item.id)) return state;
      return { storyboards: [...state.storyboards, item] };
    }),

  updateStoryboard: (id, patch) =>
    set((state) => ({
      storyboards: state.storyboards.map((s) =>
        s.id === id ? { ...s, ...patch } : s,
      ),
    })),

  removeStoryboard: (id) =>
    set((state) => ({
      storyboards: state.storyboards.filter((s) => s.id !== id),
      activeStoryboardId:
        state.activeStoryboardId === id ? null : state.activeStoryboardId,
    })),

  setActiveStoryboard: (id) => set({ activeStoryboardId: id }),

  // --- StoryboardPack actions ---

  setStoryboardPacks: (packs) => set({ storyboardPacks: packs }),

  addStoryboardPack: (pack) =>
    set((state) => {
      if (state.storyboardPacks.some((p) => p.packId === pack.packId)) {
        return state;
      }
      return { storyboardPacks: [...state.storyboardPacks, pack] };
    }),

  updateStoryboardPack: (packId, patch) =>
    set((state) => ({
      storyboardPacks: state.storyboardPacks.map((p) =>
        p.packId === packId ? { ...p, ...patch } : p,
      ),
    })),

  removeStoryboardPack: (packId) =>
    set((state) => ({
      storyboardPacks: state.storyboardPacks.filter(
        (p) => p.packId !== packId,
      ),
    })),

  updatePackFrame: (packId, frameIndex, patch) =>
    set((state) => ({
      storyboardPacks: state.storyboardPacks.map((p) => {
        if (p.packId !== packId) return p;
        return {
          ...p,
          frames: p.frames.map((f) =>
            f.index === frameIndex ? { ...f, ...patch } : f,
          ),
        };
      }),
    })),

  // --- Generation state ---

  setStoryboardGenerating: (generating) =>
    set({ isStoryboardGenerating: generating }),
});
