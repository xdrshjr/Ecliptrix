import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorFocusStore } from '../editorFocusStore';

const initial = useEditorFocusStore.getState();

beforeEach(() => {
  useEditorFocusStore.setState(initial, true);
});

describe('useEditorFocusStore', () => {
  it('selecting_segment_never_changes_right_panel_tab', () => {
    useEditorFocusStore.getState().setRightPanelTab('properties');
    useEditorFocusStore.getState().selectSegment('seg-1', 'script');
    useEditorFocusStore.getState().selectSegment('seg-2', 'timeline');
    useEditorFocusStore.getState().selectMaterial('mat-1');
    expect(useEditorFocusStore.getState().rightPanelTab).toBe('properties');
  });

  it('reset_clears_selection', () => {
    const store = useEditorFocusStore.getState();
    store.selectSegment('seg-1', 'timeline');
    store.selectMaterial('mat-1');
    store.setConvertingSegmentIds(new Set(['seg-1']));
    useEditorFocusStore.getState().reset();
    const state = useEditorFocusStore.getState();
    expect({
      segment: state.selectedSegmentId,
      source: state.selectionSource,
      material: state.selectedMaterialId,
      converting: state.convertingSegmentIds.size,
    }).toEqual({ segment: null, source: null, material: null, converting: 0 });
  });

  it('reset_keeps_follow_playback_and_tab_prefs', () => {
    const store = useEditorFocusStore.getState();
    store.setFollowPlayback(true);
    store.setRightPanelTab('properties');
    useEditorFocusStore.getState().reset();
    const state = useEditorFocusStore.getState();
    expect([state.followPlayback, state.rightPanelTab]).toEqual([true, 'properties']);
  });

  it('converting_mirror_ignores_an_identical_set', () => {
    useEditorFocusStore.getState().setConvertingSegmentIds(new Set(['a']));
    const before = useEditorFocusStore.getState().convertingSegmentIds;
    useEditorFocusStore.getState().setConvertingSegmentIds(new Set(['a']));
    expect(useEditorFocusStore.getState().convertingSegmentIds).toBe(before);
  });
});
