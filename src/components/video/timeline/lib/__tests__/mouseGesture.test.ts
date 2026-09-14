import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackMouseGesture } from '../mouseGesture';

function handlers() {
  return { onMove: vi.fn(), onEnd: vi.fn(), onCancel: vi.fn() };
}

function move(buttons: number): MouseEvent {
  const event = new MouseEvent('mousemove', { bubbles: true, buttons, clientX: 40 });
  document.dispatchEvent(event);
  return event;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('trackMouseGesture', () => {
  it('forwards moves while the primary button is held and ends on mouseup', () => {
    const h = handlers();
    trackMouseGesture(h);
    move(1);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    move(1);
    expect({ moves: h.onMove.mock.calls.length, ends: h.onEnd.mock.calls.length }).toEqual({ moves: 1, ends: 1 });
  });

  it('window blur cancels the gesture and detaches listeners', () => {
    const h = handlers();
    trackMouseGesture(h);
    window.dispatchEvent(new Event('blur'));
    move(1);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    expect({
      cancels: h.onCancel.mock.calls.length,
      moves: h.onMove.mock.calls.length,
      ends: h.onEnd.mock.calls.length,
    }).toEqual({ cancels: 1, moves: 0, ends: 0 });
  });

  it('a move without the primary button ends the gesture', () => {
    const h = handlers();
    trackMouseGesture(h);
    const released = move(0);
    move(1);
    expect({
      moves: h.onMove.mock.calls.length,
      endedWith: h.onEnd.mock.calls[0]?.[0],
      ends: h.onEnd.mock.calls.length,
    }).toEqual({ moves: 0, endedWith: released, ends: 1 });
  });

  it('the disposer is idempotent', () => {
    const h = handlers();
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const dispose = trackMouseGesture(h);
    dispose();
    dispose();
    move(1);
    expect({
      moves: h.onMove.mock.calls.length,
      removals: removeSpy.mock.calls.filter(([type]) => type === 'mousemove').length,
    }).toEqual({ moves: 0, removals: 1 });
  });
});
