import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type React from 'react';
import {
  insertionToIndex,
  readDroppedMaterialId,
  SEGMENT_DRAG_MIME,
  useSegmentReorderDrag,
} from '../useSegmentReorderDrag';

function dragEvent(types: string[], data: Record<string, string> = {}, clientY = 0) {
  return {
    dataTransfer: {
      types, dropEffect: 'none', effectAllowed: 'all',
      getData: (type: string) => data[type] ?? '', setData: vi.fn(),
    },
    clientY,
    currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 100 }), contains: () => false },
    relatedTarget: null,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.DragEvent;
}

function keyEvent(key: string, altKey: boolean) {
  return { key, altKey, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.KeyboardEvent;
}

function setup() {
  const callbacks = { onMove: vi.fn(), onReplaceVisual: vi.fn() };
  const hook = renderHook(() => useSegmentReorderDrag(['a', 'b', 'c'], callbacks));
  return { callbacks, hook };
}

describe('useSegmentReorderDrag (T-UI-REORDER)', () => {
  it('only the handle is draggable and it carries the segment MIME', () => {
    const { hook } = setup();
    const props = hook.result.current.handleProps('b', 1, 3);
    const event = dragEvent([]);
    act(() => props.onDragStart?.(event as unknown as React.DragEvent<HTMLElement>));
    expect({ draggable: props.draggable, set: (event.dataTransfer.setData as ReturnType<typeof vi.fn>).mock.calls[0] })
      .toEqual({ draggable: true, set: [SEGMENT_DRAG_MIME, 'b'] });
  });

  it('Alt+↑ on the handle moves the segment up; plain arrows do nothing', () => {
    const { hook, callbacks } = setup();
    const props = hook.result.current.handleProps('b', 1, 3);
    props.onKeyDown?.(keyEvent('ArrowUp', false) as unknown as React.KeyboardEvent<HTMLElement>);
    props.onKeyDown?.(keyEvent('ArrowUp', true) as unknown as React.KeyboardEvent<HTMLElement>);
    expect(callbacks.onMove.mock.calls).toEqual([['b', 0]]);
  });

  it('dropping below the last card moves the segment to the end', () => {
    const { hook, callbacks } = setup();
    act(() => hook.result.current.cardDropProps('c', 2).onDragOver?.(
      dragEvent([SEGMENT_DRAG_MIME], {}, 90) as unknown as React.DragEvent<HTMLElement>));
    act(() => hook.result.current.cardDropProps('c', 2).onDrop?.(
      dragEvent([SEGMENT_DRAG_MIME], { [SEGMENT_DRAG_MIME]: 'a' }, 90) as unknown as React.DragEvent<HTMLElement>));
    expect(callbacks.onMove.mock.calls).toEqual([['a', 2]]);
  });

  it('a video material drop replaces the picture; audio is refused while hovering', () => {
    const { hook, callbacks } = setup();
    const audioOver = dragEvent(['application/x-ecliptrix-material-audio']);
    act(() => hook.result.current.cardDropProps('b', 1).onDragOver?.(
      audioOver as unknown as React.DragEvent<HTMLElement>));
    const refused = hook.result.current.dropState;
    act(() => hook.result.current.cardDropProps('b', 1).onDrop?.(dragEvent(['application/json'], {
      'application/json': JSON.stringify({ type: 'material', material: { id: 'm1' } }),
    }) as unknown as React.DragEvent<HTMLElement>));
    expect({ refused, calls: callbacks.onReplaceVisual.mock.calls, prevented: (audioOver.preventDefault as ReturnType<typeof vi.fn>).mock.calls.length })
      .toEqual({ refused: { kind: 'material', segmentId: 'b', accepts: false }, calls: [['b', 'm1']], prevented: 0 });
  });

  it('insertion points map to target indexes; junk payloads are ignored', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect([insertionToIndex(0, 3), insertionToIndex(2, 0), readDroppedMaterialId('{oops')])
      .toEqual([2, 0, null]);
    warn.mockRestore();
  });
});
