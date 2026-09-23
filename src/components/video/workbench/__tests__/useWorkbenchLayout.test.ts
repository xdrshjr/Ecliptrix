import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import { LAYOUT_STORAGE_KEY } from '../layoutPrefs';
import { useWorkbenchLayout } from '../useWorkbenchLayout';

function stored() {
  return JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? 'null');
}

beforeEach(() => {
  window.localStorage.clear();
  useEditorFocusStore.setState({ followPlayback: false, rightPanelTab: 'materials' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useWorkbenchLayout', () => {
  it('auto_collapse_does_not_overwrite_user_pref', () => {
    const { result } = renderHook(() => useWorkbenchLayout());
    // No measured container in jsdom → width 0 → no auto collapse; toggling is a user pref.
    act(() => result.current.toggle('right'));
    expect(result.current.layout.rightCollapsed).toBe(true);
    expect(result.current.autoCollapsed.right).toBe(false);
  });

  it('persists_layout_and_focus_prefs_under_one_key', () => {
    const { result } = renderHook(() => useWorkbenchLayout());
    act(() => result.current.applyPreset('edit'));
    act(() => useEditorFocusStore.getState().setRightPanelTab('properties'));
    expect(stored()).toMatchObject({ v: 1, preset: 'edit', timelineHeight: 360, rightPanelTab: 'properties' });
  });

  it('injects_stored_focus_prefs_on_mount', () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({
      v: 1, leftWidth: 320, rightWidth: 300, timelineHeight: 260, leftCollapsed: false,
      rightCollapsed: false, preset: 'custom', followPlayback: true, rightPanelTab: 'properties',
    }));
    renderHook(() => useWorkbenchLayout());
    const focus = useEditorFocusStore.getState();
    expect([focus.followPlayback, focus.rightPanelTab]).toEqual([true, 'properties']);
  });

  it('storage_throwing_does_not_break_render', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useWorkbenchLayout());
    act(() => result.current.applyPreset('script'));
    expect(result.current.layout.preset).toBe('script');
  });
});
