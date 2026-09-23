/**
 * useSegmentSelectionSync — timeline → segment focus (spec §3.4.3, §3.12 B).
 *
 * When the user single-selects a timeline clip that belongs to a script
 * segment, that segment becomes the focused one (source 'timeline') so the
 * script card scrolls into view and the inspector follows. Multi-selection or
 * an unlinked clip leaves the focus untouched, and the right-panel tab is never
 * changed (the store's iron rule).
 *
 * Only a *change* of `selectedItems` triggers a sync: re-deriving the segment
 * map (typing in a card, a new voice-over landing) must not snap the focus back
 * to the clip's segment after the user picked another card in the script.
 */

import { useEffect, useRef } from 'react';
import { useTimelineStore } from '../timeline/store';
import { useEditorFocusStore } from '@/stores/editorFocusStore';

export function useSegmentSelectionSync(
  itemSegmentMap: ReadonlyMap<string, string>,
): void {
  const mapRef = useRef(itemSegmentMap);
  mapRef.current = itemSegmentMap;

  useEffect(() => useTimelineStore.subscribe(
    (state) => state.selectedItems,
    (selectedItems) => {
      if (selectedItems.length !== 1) return;
      const segmentId = mapRef.current.get(selectedItems[0]);
      if (!segmentId) return;
      useEditorFocusStore.getState().selectSegment(segmentId, 'timeline');
    },
  ), []);
}
