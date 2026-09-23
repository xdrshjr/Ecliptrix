import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from '../../timeline/store';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import { useSegmentSelectionSync } from '../useSegmentSelectionSync';

const ITEM_SEGMENTS: ReadonlyMap<string, string> = new Map([
  ['clip-a', 'seg-1'],
  ['clip-b', 'seg-2'],
]);

function select(ids: string[]) {
  act(() => { useTimelineStore.setState({ selectedItems: ids }); });
}

beforeEach(() => {
  useTimelineStore.setState({ selectedItems: [] });
  useEditorFocusStore.getState().reset();
  useEditorFocusStore.getState().setRightPanelTab('materials');
});

afterEach(() => { cleanup(); });

describe('useSegmentSelectionSync', () => {
  it('single_timeline_selection_selects_owning_segment', () => {
    renderHook(() => useSegmentSelectionSync(ITEM_SEGMENTS));
    select(['clip-b']);
    const focus = useEditorFocusStore.getState();
    expect(focus.selectedSegmentId).toBe('seg-2');
    expect(focus.selectionSource).toBe('timeline');
    expect(focus.rightPanelTab).toBe('materials');
  });

  it('multi_selection_does_not_change_segment', () => {
    renderHook(() => useSegmentSelectionSync(ITEM_SEGMENTS));
    useEditorFocusStore.getState().selectSegment('seg-1', 'script');
    select(['clip-a', 'clip-b']);
    expect(useEditorFocusStore.getState().selectedSegmentId).toBe('seg-1');
    expect(useEditorFocusStore.getState().selectionSource).toBe('script');
  });

  it('unlinked_clip_does_not_change_segment', () => {
    renderHook(() => useSegmentSelectionSync(ITEM_SEGMENTS));
    useEditorFocusStore.getState().selectSegment('seg-1', 'script');
    select(['music-clip']);
    expect(useEditorFocusStore.getState().selectedSegmentId).toBe('seg-1');
  });

  it('rederived_map_alone_does_not_steal_focus_back', () => {
    const { rerender } = renderHook(
      ({ map }) => useSegmentSelectionSync(map),
      { initialProps: { map: ITEM_SEGMENTS } },
    );
    select(['clip-a']);
    useEditorFocusStore.getState().selectSegment('seg-2', 'script');
    rerender({ map: new Map(ITEM_SEGMENTS) });
    expect(useEditorFocusStore.getState().selectedSegmentId).toBe('seg-2');
  });
});
