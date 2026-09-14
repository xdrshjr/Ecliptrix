import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import * as shallowModule from 'zustand/react/shallow';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import containerSource from '../TrackContainer.tsx?raw';
import * as storeModule from '../store';
import * as constants from '../constants';
import * as timeFormat from '../timeFormat';
import * as theme from '../theme/timelineTheme';
import * as mouseGesture from '../lib/mouseGesture';
import type { TimelineData } from '../domain/types';
import {
  compileComponent,
  installResizeObserverStub,
  localeContextModule,
  reactModules,
} from './test-utils/compileComponent';

type ContainerProps = {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: (scrollLeft: number) => void;
  onAddTrack: () => void;
  onMaterialDrop: () => void;
};

const { useTimelineStore } = storeModule;
const get = () => useTimelineStore.getState();

function TrackStub({ trackId }: { trackId: string }) {
  return React.createElement(
    'div',
    { className: 'track', 'data-track-id': trackId },
    React.createElement('div', { className: 'track-controls' }, 'header'),
    React.createElement(
      'div',
      { className: 'track-content', 'data-testid': `lane-${trackId}` },
      React.createElement('div', { className: 'timeline-item', 'data-clip-id': 'a1' }, 'clip'),
    ),
  );
}

function timelineWithOneClip(): TimelineData {
  return {
    currentTime: 0, totalDuration: 0, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'video-track-1', name: 'Video 1', type: 'video', height: 80,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
      items: [{
        id: 'a1', name: 'A1', type: 'video', startTime: 0, duration: 5,
        trackId: 'video-track-1', color: '#4A90D9', materialId: 'm1',
      }],
    }],
  };
}

let TrackContainer: React.FC<ContainerProps>;
let restoreResizeObserver: () => void = () => {};

beforeAll(() => {
  TrackContainer = compileComponent<ContainerProps>(containerSource, {
    ...reactModules(),
    ...localeContextModule(),
    'zustand/react/shallow': shallowModule,
    './store': storeModule,
    './constants': constants,
    './timeFormat': timeFormat,
    './theme/timelineTheme': theme,
    './lib/mouseGesture': mouseGesture,
    './Track': TrackStub,
    './TimelinePlayhead': () => null,
    './PortalTooltip': ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  });
});

beforeEach(() => {
  restoreResizeObserver = installResizeObserverStub();
  get().initTimeline(timelineWithOneClip());
  get().selectItem('a1');
});

afterEach(() => {
  cleanup();
  restoreResizeObserver();
  document.body.innerHTML = '';
});

function renderContainer() {
  render(React.createElement(TrackContainer, {
    scrollRef: React.createRef<HTMLDivElement>(),
    onScroll: vi.fn(),
    onAddTrack: vi.fn(),
    onMaterialDrop: vi.fn(),
  }));
  return screen.getByTestId('lane-video-track-1');
}

describe('TrackContainer — empty-lane clicks', () => {
  it('a still click on an empty lane clears the selection', () => {
    const lane = renderContainer();
    fireEvent.mouseDown(lane, { button: 0, clientX: 300, clientY: 20 });
    fireEvent.mouseUp(document, { button: 0, clientX: 301, clientY: 20 });
    expect(get().selectedItems).toEqual([]);
  });

  it('a drag-scroll pan on an empty lane keeps the selection', () => {
    const lane = renderContainer();
    fireEvent.mouseDown(lane, { button: 0, clientX: 300, clientY: 20 });
    fireEvent.mouseMove(document, { buttons: 1, clientX: 360, clientY: 20 });
    fireEvent.mouseUp(document, { button: 0, clientX: 360, clientY: 20 });
    expect(get().selectedItems).toEqual(['a1']);
  });

  it('Ctrl+click on an empty lane keeps the selection', () => {
    const lane = renderContainer();
    fireEvent.mouseDown(lane, { button: 0, clientX: 300, clientY: 20, ctrlKey: true });
    fireEvent.mouseUp(document, { button: 0, clientX: 300, clientY: 20, ctrlKey: true });
    expect(get().selectedItems).toEqual(['a1']);
  });
});
