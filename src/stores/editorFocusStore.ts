/**
 * editorFocusStore — UI focus of the segment-centric editor workbench.
 *
 * Holds which script segment / material is currently "in focus" so the four
 * workbench regions (script, preview, materials|properties, timeline) can
 * highlight the same thing. Nothing here is written into `project_data`:
 * selection lives in memory only, and the two user preferences
 * (`followPlayback`, `rightPanelTab`) are persisted by `useWorkbenchLayout`,
 * which injects them on mount and writes them back — this store never touches
 * localStorage, so the preference key has exactly one owner (spec RV-12).
 *
 * Iron rule (spec §3.4.1): no selection action may call `setRightPanelTab`.
 * Selecting a segment must never pull the materials list away from the user.
 */

import { create } from 'zustand';

export type SelectionSource = 'script' | 'timeline' | 'material' | null;
export type RightPanelTab = 'materials' | 'properties';

const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

export interface EditorFocusState {
  selectedSegmentId: string | null;
  selectionSource: SelectionSource;
  followPlayback: boolean;
  rightPanelTab: RightPanelTab;
  selectedMaterialId: string | null;
  /** Read-only mirror of ScriptPanel's `convertingSegments` (spec RV-03). */
  convertingSegmentIds: ReadonlySet<string>;
  selectSegment(id: string | null, source: SelectionSource): void;
  selectMaterial(id: string | null): void;
  setFollowPlayback(on: boolean): void;
  setRightPanelTab(tab: RightPanelTab): void;
  setConvertingSegmentIds(ids: ReadonlySet<string>): void;
  /** Project switch: clears selection only; the two preferences survive. */
  reset(): void;
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  let same = true;
  a.forEach((id) => {
    if (!b.has(id)) same = false;
  });
  return same;
}

export const useEditorFocusStore = create<EditorFocusState>()((set, get) => ({
  selectedSegmentId: null,
  selectionSource: null,
  followPlayback: false,
  rightPanelTab: 'materials',
  selectedMaterialId: null,
  convertingSegmentIds: EMPTY_IDS,
  selectSegment: (id, source) => {
    set({ selectedSegmentId: id, selectionSource: id === null ? null : source });
  },
  selectMaterial: (id) => {
    set({
      selectedMaterialId: id,
      selectionSource: id === null ? get().selectionSource : 'material',
    });
  },
  setFollowPlayback: (on) => set({ followPlayback: on }),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  setConvertingSegmentIds: (ids) => {
    if (sameIds(get().convertingSegmentIds, ids)) return;
    set({ convertingSegmentIds: new Set(ids) });
  },
  reset: () => {
    set({
      selectedSegmentId: null,
      selectionSource: null,
      selectedMaterialId: null,
      convertingSegmentIds: EMPTY_IDS,
    });
  },
}));
