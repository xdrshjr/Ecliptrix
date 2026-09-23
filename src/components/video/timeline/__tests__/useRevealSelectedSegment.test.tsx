/**
 * Spec §3.4.3: selecting a segment card scrolls the timeline to the
 * segment's start when it is off-screen — without moving the playhead.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import * as React from 'react';
import { useRevealSelectedSegment } from '../hooks/useRevealSelectedSegment';
import { useTimelineStore } from '../store';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import {
  SegmentLinksContext,
  type SegmentLinksValue,
} from '../../lib/segments/SegmentLinksContext';
import { TRACK_HEADER_WIDTH } from '../theme/timelineTheme';

const LANE_WIDTH = 500;

function links(): SegmentLinksValue {
  return {
    segmentIndex: new Map(),
    itemSegmentMap: new Map(),
    materialSegmentMap: new Map(),
    // zoom 1 → 50 px/s: seg-far starts at 1500px, seg-near at 100px.
    segmentRanges: new Map([
      ['seg-far', { start: 30, end: 36 }],
      ['seg-near', { start: 2, end: 5 }],
    ]),
    statusById: new Map(),
    latestVoiceById: new Map(),
    highlightedItemIds: new Set(),
    isPlaceholderScript: false,
  };
}

function scrollContainer(): HTMLDivElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: LANE_WIDTH + TRACK_HEADER_WIDTH });
  Object.defineProperty(el, 'scrollWidth', { value: 5000 });
  el.scrollLeft = 0;
  return el;
}

function renderReveal(el: HTMLDivElement) {
  const ref = { current: el };
  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    React.createElement(SegmentLinksContext.Provider, { value: links() }, children);
  return renderHook(() => useRevealSelectedSegment(ref), { wrapper });
}

beforeEach(() => {
  useEditorFocusStore.getState().reset();
  useTimelineStore.setState({ zoomLevel: 1, currentTime: 7 });
});

afterEach(() => {
  cleanup();
  useEditorFocusStore.getState().reset();
});

describe('useRevealSelectedSegment', () => {
  it('script_selection_scrolls_offscreen_segment_start_into_view', () => {
    const el = scrollContainer();
    renderReveal(el);
    act(() => useEditorFocusStore.getState().selectSegment('seg-far', 'script'));
    expect({ scrolled: el.scrollLeft > 0, startVisible: 1500 >= el.scrollLeft && 1500 <= el.scrollLeft + LANE_WIDTH })
      .toEqual({ scrolled: true, startVisible: true });
  });

  it('script_selection_does_not_move_the_playhead', () => {
    renderReveal(scrollContainer());
    act(() => useEditorFocusStore.getState().selectSegment('seg-far', 'script'));
    expect(useTimelineStore.getState().currentTime).toBe(7);
  });

  it('visible_segment_start_does_not_scroll', () => {
    const el = scrollContainer();
    renderReveal(el);
    act(() => useEditorFocusStore.getState().selectSegment('seg-near', 'script'));
    expect(el.scrollLeft).toBe(0);
  });

  it('timeline_originated_selection_does_not_scroll', () => {
    const el = scrollContainer();
    renderReveal(el);
    act(() => useEditorFocusStore.getState().selectSegment('seg-far', 'timeline'));
    expect(el.scrollLeft).toBe(0);
  });
});
