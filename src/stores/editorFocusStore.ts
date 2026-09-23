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
const EMPTY_ERRORS: ReadonlyMap<string, string> = new Map<string, string>();
const EMPTY_PROGRESS: ReadonlyMap<string, number> = new Map<string, number>();

export interface EditorFocusState {
  selectedSegmentId: string | null;
  selectionSource: SelectionSource;
  followPlayback: boolean;
  rightPanelTab: RightPanelTab;
  selectedMaterialId: string | null;
  /**
   * Bumped on every material selection, also of the same id again (R1 L-4):
   * clicking the selected material after a clip must bring it back into the
   * properties page even though the id did not change.
   */
  materialSelectSeq: number;
  /** Read-only mirror of ScriptPanel's `convertingSegments` (spec RV-03). */
  convertingSegmentIds: ReadonlySet<string>;
  /** Per-segment voice generation failure reason (session only, R2 §3.4.4). */
  segmentVoiceErrors: ReadonlyMap<string, string>;
  /** Per-segment voice generation progress 0–100 (task centre rows). */
  segmentVoiceProgress: ReadonlyMap<string, number>;
  /** Voice candidates the user chose "not now" for (banner hidden). */
  dismissedCandidateIds: ReadonlySet<string>;
  /**
   * A request to (re)generate voice-overs raised outside ScriptPanel (task
   * centre retry, "regenerate" in a dialog); ScriptPanel owns TTS and serves it.
   */
  voiceRequest: { segmentIds: string[]; nonce: number } | null;
  /** "更换画面" just picked new videos for this segment (one-shot prompt, §3.6 A). */
  pickedVisualSegmentId: string | null;
  selectSegment(id: string | null, source: SelectionSource): void;
  selectMaterial(id: string | null): void;
  setFollowPlayback(on: boolean): void;
  setRightPanelTab(tab: RightPanelTab): void;
  setConvertingSegmentIds(ids: ReadonlySet<string>): void;
  setSegmentVoiceError(id: string, message: string | null): void;
  /** Integer progress; null clears the row. Unchanged values do not notify. */
  setSegmentVoiceProgress(id: string, value: number | null): void;
  dismissCandidate(materialId: string): void;
  requestSegmentVoice(segmentIds: string[]): void;
  /** Clears the request it was handed (a newer request stays). */
  clearVoiceRequest(nonce: number): void;
  setPickedVisualSegmentId(id: string | null): void;
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
  materialSelectSeq: 0,
  convertingSegmentIds: EMPTY_IDS,
  segmentVoiceErrors: EMPTY_ERRORS,
  segmentVoiceProgress: EMPTY_PROGRESS,
  dismissedCandidateIds: EMPTY_IDS,
  voiceRequest: null,
  pickedVisualSegmentId: null,
  selectSegment: (id, source) => {
    set({ selectedSegmentId: id, selectionSource: id === null ? null : source });
  },
  selectMaterial: (id) => {
    set({
      selectedMaterialId: id,
      selectionSource: id === null ? get().selectionSource : 'material',
      materialSelectSeq: get().materialSelectSeq + 1,
    });
  },
  setFollowPlayback: (on) => set({ followPlayback: on }),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  setConvertingSegmentIds: (ids) => {
    if (sameIds(get().convertingSegmentIds, ids)) return;
    set({ convertingSegmentIds: new Set(ids) });
  },
  setSegmentVoiceError: (id, message) => {
    const current = get().segmentVoiceErrors;
    if ((current.get(id) ?? null) === message) return;
    const next = new Map(current);
    if (message === null) next.delete(id);
    else next.set(id, message);
    set({ segmentVoiceErrors: next });
  },
  setSegmentVoiceProgress: (id, value) => {
    const current = get().segmentVoiceProgress;
    const rounded = value === null ? null : Math.round(value);
    if ((current.get(id) ?? null) === rounded) return;
    const next = new Map(current);
    if (rounded === null) next.delete(id);
    else next.set(id, rounded);
    set({ segmentVoiceProgress: next });
  },
  dismissCandidate: (materialId) => {
    if (get().dismissedCandidateIds.has(materialId)) return;
    set({ dismissedCandidateIds: new Set([...Array.from(get().dismissedCandidateIds), materialId]) });
  },
  requestSegmentVoice: (segmentIds) => {
    if (segmentIds.length === 0) return;
    set({ voiceRequest: { segmentIds, nonce: (get().voiceRequest?.nonce ?? 0) + 1 } });
  },
  clearVoiceRequest: (nonce) => {
    if (get().voiceRequest?.nonce === nonce) set({ voiceRequest: null });
  },
  setPickedVisualSegmentId: (id) => set({ pickedVisualSegmentId: id }),
  reset: () => {
    set({
      selectedSegmentId: null,
      selectionSource: null,
      selectedMaterialId: null,
      convertingSegmentIds: EMPTY_IDS,
      segmentVoiceErrors: EMPTY_ERRORS,
      segmentVoiceProgress: EMPTY_PROGRESS,
      dismissedCandidateIds: EMPTY_IDS,
      voiceRequest: null,
      pickedVisualSegmentId: null,
    });
  },
}));
