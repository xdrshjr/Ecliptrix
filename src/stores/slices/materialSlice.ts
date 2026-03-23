/**
 * materialSlice — Manages the material library state.
 *
 * Replaces the local React state in useMaterialManagement.ts with a
 * centralized Zustand slice so that both UI components and non-React
 * code (AgentEventRouter, OperationApplier) can read/write materials.
 */

import type { StateCreator } from 'zustand';
import type { MaterialItem, MaterialType } from '@/types';
import type { VideoEditingStore } from '../videoEditingStore';

// ---------------------------------------------------------------------------
// Slice state + actions
// ---------------------------------------------------------------------------

export interface MaterialSlice {
  // State
  materials: MaterialItem[];
  selectedMaterialId: string | null;
  filterType: MaterialType | null;

  // Actions
  addMaterial: (item: MaterialItem) => void;
  addMaterials: (items: MaterialItem[]) => void;
  removeMaterial: (id: string) => void;
  updateMaterial: (id: string, patch: Partial<MaterialItem>) => void;
  setSelectedMaterial: (id: string | null) => void;
  setFilterType: (type: MaterialType | null) => void;
  clearMaterials: () => void;
}

// ---------------------------------------------------------------------------
// Slice creator
// ---------------------------------------------------------------------------

export const createMaterialSlice: StateCreator<
  VideoEditingStore,
  [],
  [],
  MaterialSlice
> = (set) => ({
  // Initial state
  materials: [],
  selectedMaterialId: null,
  filterType: null,

  // Actions
  addMaterial: (item) =>
    set((state) => {
      // Deduplicate by id
      if (state.materials.some((m) => m.id === item.id)) {
        return state;
      }
      return { materials: [...state.materials, item] };
    }),

  addMaterials: (items) =>
    set((state) => {
      const existingIds = new Set(state.materials.map((m) => m.id));
      const newItems = items.filter((item) => !existingIds.has(item.id));
      if (newItems.length === 0) return state;
      return { materials: [...state.materials, ...newItems] };
    }),

  removeMaterial: (id) =>
    set((state) => ({
      materials: state.materials.filter((m) => m.id !== id),
      // Clear selection if the removed material was selected
      selectedMaterialId:
        state.selectedMaterialId === id ? null : state.selectedMaterialId,
    })),

  updateMaterial: (id, patch) =>
    set((state) => ({
      materials: state.materials.map((m) =>
        m.id === id ? { ...m, ...patch } : m,
      ),
    })),

  setSelectedMaterial: (id) => set({ selectedMaterialId: id }),

  setFilterType: (type) => set({ filterType: type }),

  clearMaterials: () =>
    set({ materials: [], selectedMaterialId: null }),
});
