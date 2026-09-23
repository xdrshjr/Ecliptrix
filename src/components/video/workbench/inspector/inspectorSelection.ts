/**
 * inspectorSelection — which object the properties page shows (spec §3.7.2).
 *
 * Three things can be "selected" at once: timeline clips (timeline store),
 * a material on the materials page and a script segment (focus store). The
 * spec gives a static priority (clips > material > segment) AND says the most
 * recent selection wins. Rule, precisely:
 *
 * 1. Every candidate that still exists is eligible: clips when
 *    `selectedItems` is non-empty, the material when `selectedMaterialId`
 *    names a material that is still in the library, the segment when
 *    `selectedSegmentId` is set.
 * 2. The candidate the user touched LAST wins, if it is still eligible.
 *    "Touched" means: clips — `selectedItems` changed to a non-empty list;
 *    material — `selectedMaterialId` changed to a non-null id; segment — a
 *    segment was selected with source `'script'` (a segment selected by the
 *    timeline sync is a consequence of a clip click, so it does not count).
 * 3. Otherwise the static priority decides: clips > material > segment.
 */

import { useEffect, useState } from 'react';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import { useTimelineStore } from '../../timeline/store';
import type { MaterialItem } from '@/types';

export type InspectorSelection =
  | { kind: 'none' }
  | { kind: 'segment'; segmentId: string }
  | { kind: 'items'; itemIds: readonly string[] }
  | { kind: 'material'; materialId: string };

export type SelectionCandidate = 'items' | 'material' | 'segment';

export interface InspectorSelectionInput {
  itemIds: readonly string[];
  /** Only pass an id that resolves to a material in the library. */
  materialId: string | null;
  segmentId: string | null;
  /** The candidate the user selected last, or null before any selection. */
  latest: SelectionCandidate | null;
}

function candidateSelection(
  candidate: SelectionCandidate,
  input: InspectorSelectionInput,
): InspectorSelection | null {
  if (candidate === 'items') {
    return input.itemIds.length > 0 ? { kind: 'items', itemIds: input.itemIds } : null;
  }
  if (candidate === 'material') {
    return input.materialId ? { kind: 'material', materialId: input.materialId } : null;
  }
  return input.segmentId ? { kind: 'segment', segmentId: input.segmentId } : null;
}

const STATIC_PRIORITY: readonly SelectionCandidate[] = ['items', 'material', 'segment'];

export function resolveInspectorSelection(input: InspectorSelectionInput): InspectorSelection {
  if (input.latest) {
    const latest = candidateSelection(input.latest, input);
    if (latest) return latest;
  }
  for (const candidate of STATIC_PRIORITY) {
    const selection = candidateSelection(candidate, input);
    if (selection) return selection;
  }
  return { kind: 'none' };
}

/**
 * Tracks which candidate the user touched last. Subscribes outside render so
 * the order of two stores' updates is observed as it happens.
 */
function useLatestCandidate(): SelectionCandidate | null {
  const [latest, setLatest] = useState<SelectionCandidate | null>(null);
  useEffect(() => {
    const stopTimeline = useTimelineStore.subscribe((state, prev) => {
      if (state.selectedItems !== prev.selectedItems && state.selectedItems.length > 0) {
        setLatest('items');
      }
    });
    const stopFocus = useEditorFocusStore.subscribe((state, prev) => {
      if (state.selectedMaterialId !== prev.selectedMaterialId && state.selectedMaterialId) {
        setLatest('material');
        return;
      }
      const segmentTouched =
        state.selectedSegmentId !== prev.selectedSegmentId ||
        state.selectionSource !== prev.selectionSource;
      if (segmentTouched && state.selectedSegmentId && state.selectionSource === 'script') {
        setLatest('segment');
      }
    });
    return () => {
      stopTimeline();
      stopFocus();
    };
  }, []);
  return latest;
}

/** The inspector's current selection, derived from both stores. */
export function useInspectorSelection(materials: readonly MaterialItem[]): InspectorSelection {
  const itemIds = useTimelineStore((s) => s.selectedItems);
  const selectedMaterialId = useEditorFocusStore((s) => s.selectedMaterialId);
  const segmentId = useEditorFocusStore((s) => s.selectedSegmentId);
  const latest = useLatestCandidate();
  const materialId =
    selectedMaterialId && materials.some((m) => m.id === selectedMaterialId)
      ? selectedMaterialId
      : null;
  return resolveInspectorSelection({ itemIds, materialId, segmentId, latest });
}
