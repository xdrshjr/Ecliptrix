import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import * as shallowModule from 'zustand/react/shallow';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import rulerSource from '../TimelineRuler.tsx?raw';
import * as storeModule from '../store';
import * as constants from '../constants';
import * as timeFormat from '../timeFormat';
import * as rulerTicks from '../lib/rulerTicks';
import * as theme from '../theme/timelineTheme';
import * as mouseGesture from '../lib/mouseGesture';
import {
  compileComponent,
  installResizeObserverStub,
  localeContextModule,
  reactModules,
} from './test-utils/compileComponent';

type RulerProps = {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: (scrollLeft: number) => void;
};

const { useTimelineStore } = storeModule;
const get = () => useTimelineStore.getState();

let TimelineRuler: React.FC<RulerProps>;
let restoreResizeObserver: () => void = () => {};

beforeAll(() => {
  TimelineRuler = compileComponent<RulerProps>(rulerSource, {
    ...reactModules(),
    ...localeContextModule(),
    'zustand/react/shallow': shallowModule,
    './store': storeModule,
    './constants': constants,
    './timeFormat': timeFormat,
    './lib/rulerTicks': rulerTicks,
    './theme/timelineTheme': theme,
    './lib/mouseGesture': mouseGesture,
    './TimelinePlayhead': () => null,
  });
});

beforeEach(() => {
  restoreResizeObserver = installResizeObserverStub();
  get().initTimeline({
    currentTime: 0, totalDuration: 10, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'video-track-1', name: 'Video 1', type: 'video', height: 80,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
      items: [{
        id: 'a1', name: 'A1', type: 'video', startTime: 0, duration: 10,
        trackId: 'video-track-1', color: '#4A90D9', materialId: 'm1',
      }],
    }],
  });
  get().setCurrentTime(0);
});

afterEach(() => {
  cleanup();
  restoreResizeObserver();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function renderRuler() {
  const view = render(React.createElement(TimelineRuler, {
    scrollRef: React.createRef<HTMLDivElement>(),
    onScroll: vi.fn(),
  }));
  return { slider: screen.getByRole('slider'), unmount: view.unmount };
}

describe('TimelineRuler — scrubbing', () => {
  it('right-button press does not seek', () => {
    const { slider } = renderRuler();
    fireEvent.mouseDown(slider, { button: 2, clientX: 100 });
    expect(get().currentTime).toBe(0);
  });

  it('left press focuses the ruler slider', () => {
    const { slider } = renderRuler();
    fireEvent.mouseDown(slider, { button: 0, clientX: 100 });
    expect({ focused: document.activeElement === slider, time: get().currentTime })
      .toEqual({ focused: true, time: 2 });
  });

  it('unmount mid-scrub disposes document listeners', () => {
    const { slider, unmount } = renderRuler();
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    fireEvent.mouseDown(slider, { button: 0, clientX: 100 });
    unmount();
    expect(removeSpy.mock.calls.some(([type]) => type === 'mousemove')).toBe(true);
  });
});
