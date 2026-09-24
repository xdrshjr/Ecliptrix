import * as React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FAB_POSITION_KEY,
  useDraggableFab,
} from '../useDraggableFab';

/** A FAB element whose positioned parent is `width` x `height`. */
function makeFab(width = 800, height = 600): HTMLButtonElement {
  const parent = document.createElement('div');
  const fab = document.createElement('button');
  parent.appendChild(fab);
  document.body.appendChild(parent);
  Object.defineProperty(fab, 'offsetParent', { get: () => parent });
  Object.defineProperty(parent, 'clientWidth', { get: () => width });
  Object.defineProperty(parent, 'clientHeight', { get: () => height });
  parent.getBoundingClientRect = () => ({ right: width, bottom: height } as DOMRect);
  fab.getBoundingClientRect = () =>
    ({ right: width - 24, bottom: height - 48 } as DOMRect);
  return fab;
}

function pointer(fab: HTMLElement, x: number, y: number) {
  return { currentTarget: fab, clientX: x, clientY: y, pointerId: 1 } as unknown as
    React.PointerEvent<HTMLElement>;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('useDraggableFab', () => {
  it('drag_beyond_threshold_suppresses_click', () => {
    const fab = makeFab();
    const { result } = renderHook(() => useDraggableFab({ current: fab }));
    act(() => result.current.dragHandlers.onPointerDown(pointer(fab, 100, 100)));
    act(() => result.current.dragHandlers.onPointerMove(pointer(fab, 103, 100)));
    expect(result.current.movedRef.current).toBe(false);
    act(() => result.current.dragHandlers.onPointerMove(pointer(fab, 140, 100)));
    expect(result.current.movedRef.current).toBe(true);
    // 24 - 40 = -16 is clamped to the 8px edge margin.
    expect(result.current.position).toEqual({ right: 8, bottom: 48 });
  });

  it('persists_position_after_drag', () => {
    const fab = makeFab();
    const { result } = renderHook(() => useDraggableFab({ current: fab }));
    act(() => result.current.dragHandlers.onPointerDown(pointer(fab, 100, 100)));
    act(() => result.current.dragHandlers.onPointerMove(pointer(fab, 60, 50)));
    act(() => result.current.dragHandlers.onPointerUp(pointer(fab, 60, 50)));
    expect(JSON.parse(localStorage.getItem(FAB_POSITION_KEY)!)).toEqual({ right: 64, bottom: 98 });
  });

  it('does_not_persist_a_plain_click', () => {
    const fab = makeFab();
    const { result } = renderHook(() => useDraggableFab({ current: fab }));
    act(() => result.current.dragHandlers.onPointerDown(pointer(fab, 100, 100)));
    act(() => result.current.dragHandlers.onPointerUp(pointer(fab, 100, 100)));
    expect(localStorage.getItem(FAB_POSITION_KEY)).toBeNull();
  });

  it('clamps_restored_position_into_parent', () => {
    localStorage.setItem(FAB_POSITION_KEY, JSON.stringify({ right: 5000, bottom: -20 }));
    const fab = makeFab(800, 600);
    const { result } = renderHook(() => useDraggableFab({ current: fab }));
    // right max = 800 - 56 - 8, bottom min = 8
    expect(result.current.position).toEqual({ right: 736, bottom: 8 });
  });

  it('ignores_invalid_stored_position', () => {
    localStorage.setItem(FAB_POSITION_KEY, '{"right":"x"}');
    const fab = makeFab();
    const { result } = renderHook(() => useDraggableFab({ current: fab }));
    expect(result.current.position).toBeNull();
  });

  it('storage_failure_falls_back_to_default', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('denied');
    });
    const fab = makeFab();
    const { result } = renderHook(() => useDraggableFab({ current: fab }));
    expect(result.current.position).toBeNull();
    expect(warn).toHaveBeenCalledWith('[AgentFab] position storage unavailable', expect.anything());
  });
});
