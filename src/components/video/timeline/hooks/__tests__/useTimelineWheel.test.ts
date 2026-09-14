import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { nextWheelZoom, useAnchoredZoom, useTimelineWheel } from '../useTimelineWheel';
import { TRACK_HEADER_WIDTH } from '../../theme/timelineTheme';
import { useTimelineStore } from '../../store';

function scrollBox(left: number): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  el.getBoundingClientRect = () => ({ left, top: 0, right: left + 1200, bottom: 200, width: 1200, height: 200, x: left, y: 0, toJSON: () => ({}) });
  return el;
}

function wheel(target: Element, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function mountHook(zoomLevel = 1) {
  const track = scrollBox(0);
  const ruler = scrollBox(TRACK_HEADER_WIDTH);
  const onZoom = vi.fn();
  renderHook(() => useTimelineWheel({
    trackScrollRef: { current: track },
    rulerScrollRef: { current: ruler },
    getZoomLevel: () => zoomLevel,
    onZoom,
  }));
  return { track, ruler, onZoom };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('useTimelineWheel', () => {
  it('ctrl+wheel is cancelled by a non-passive native listener', () => {
    const { track, onZoom } = mountHook();
    const event = wheel(track, { ctrlKey: true, deltaY: -100 });
    expect({ prevented: event.defaultPrevented, zoomedIn: (onZoom.mock.calls[0]?.[0] ?? 0) > 1 })
      .toEqual({ prevented: true, zoomedIn: true });
  });

  it('a trackpad pinch delta of −4 changes zoom by less than 2%', () => {
    const next = nextWheelZoom(1, -4, 0);
    expect(next > 1 && next < 1.02).toBe(true);
  });

  it('anchors the zoom at the time under the cursor in the lane', () => {
    const { track, onZoom } = mountHook(1);
    track.scrollLeft = 500;
    // 300 px right of the lane origin at 50 px/s with scrollLeft 500 → 16 s.
    wheel(track, { ctrlKey: true, deltaY: 100, clientX: TRACK_HEADER_WIDTH + 300 });
    expect(onZoom.mock.calls[0]?.[1]).toEqual({ timeAtAnchor: 16, anchorOffsetPx: 300 });
  });

  it('an anchored zoom scrolls the lanes so the anchor time stays under the cursor', () => {
    act(() => useTimelineStore.getState().setZoomLevel(1));
    const track = scrollBox(0);
    const { result } = renderHook(() => useAnchoredZoom({ current: track }));
    act(() => result.current(2, { timeAtAnchor: 16, anchorOffsetPx: 300 }));
    // 16 s at 100 px/s is 1600 px into the lane; 300 px of it stays left of the cursor.
    expect({ zoom: useTimelineStore.getState().zoomLevel, scrollLeft: track.scrollLeft })
      .toEqual({ zoom: 2, scrollLeft: 1300 });
  });

  it('a plain wheel over the ruler scrolls the track lanes horizontally', () => {
    const { track, ruler, onZoom } = mountHook();
    const event = wheel(ruler, { deltaY: 120, shiftKey: true });
    expect({ scrollLeft: track.scrollLeft, prevented: event.defaultPrevented, zooms: onZoom.mock.calls.length })
      .toEqual({ scrollLeft: 120, prevented: true, zooms: 0 });
  });
});
