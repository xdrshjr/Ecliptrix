import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useFollowPlayhead } from '../useFollowPlayhead';
import { useTimelineStore } from '../../store';
import { TRACK_HEADER_WIDTH } from '../../theme/timelineTheme';

function trackScrollBox(): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  // A 1000 px lane next to the sticky header, 20 000 px of content.
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 1000 + TRACK_HEADER_WIDTH });
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: 20000 });
  return el;
}

function setPlayback(patch: { isPlaying?: boolean; currentTime?: number }) {
  act(() => {
    useTimelineStore.setState(patch);
  });
}

let initial: ReturnType<typeof useTimelineStore.getState>;

beforeEach(() => {
  initial = useTimelineStore.getState();
  useTimelineStore.setState({ isPlaying: false, currentTime: 0, zoomLevel: 1, isInteracting: false });
});

afterEach(() => {
  cleanup();
  useTimelineStore.setState(initial, true);
  document.body.innerHTML = '';
});

describe('useFollowPlayhead', () => {
  it('pages the view once the playing playhead passes the right margin', () => {
    const el = trackScrollBox();
    renderHook(() => useFollowPlayhead({ trackScrollRef: { current: el } }));
    setPlayback({ isPlaying: true });
    setPlayback({ currentTime: 20 }); // 1000 px at 50 px/s
    expect(el.scrollLeft).toBe(900);
  });

  it('does not move the view while paused', () => {
    const el = trackScrollBox();
    renderHook(() => useFollowPlayhead({ trackScrollRef: { current: el } }));
    setPlayback({ currentTime: 40 });
    expect(el.scrollLeft).toBe(0);
  });

  it('a user wheel during playback suspends following until the next play', () => {
    const el = trackScrollBox();
    renderHook(() => useFollowPlayhead({ trackScrollRef: { current: el } }));
    setPlayback({ isPlaying: true });
    el.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    setPlayback({ currentTime: 20 });
    const whileSuspended = el.scrollLeft;
    setPlayback({ isPlaying: false });
    setPlayback({ isPlaying: true });
    expect([whileSuspended, el.scrollLeft]).toEqual([0, 900]);
  });
});
