import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as shallowModule from 'zustand/react/shallow';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import containerSource from '../TrackContainer.tsx?raw';
import * as storeModule from '../store';
import * as constants from '../constants';
import * as timeFormat from '../timeFormat';
import * as theme from '../theme/timelineTheme';
import * as mouseGesture from '../lib/mouseGesture';
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

/** A lane whose header owns a popover portalled to <body>, like the volume slider. */
function TrackWithPopoverStub({ trackId }: { trackId: string }) {
  return React.createElement(
    'div',
    { className: 'track', 'data-track-id': trackId },
    React.createElement(
      'div',
      { className: 'track-controls' },
      ReactDOM.createPortal(
        React.createElement('div', { 'data-testid': 'volume-popover' }, '100%'),
        document.body,
      ),
    ),
    React.createElement('div', { className: 'track-content', 'data-testid': 'lane' }),
  );
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
    './Track': TrackWithPopoverStub,
    './TimelinePlayhead': () => null,
    './PortalTooltip': ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  });
});

beforeEach(() => {
  restoreResizeObserver = installResizeObserverStub();
  useTimelineStore.getState().initTimeline({
    currentTime: 0, totalDuration: 0, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'audio-track-1', name: 'Audio 1', type: 'audio', height: 60,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0, items: [],
    }],
  });
});

afterEach(() => {
  cleanup();
  restoreResizeObserver();
  document.body.innerHTML = '';
});

function renderContainer() {
  const scrollRef = React.createRef<HTMLDivElement>();
  const onScroll = vi.fn();
  render(React.createElement(TrackContainer, {
    scrollRef, onScroll, onAddTrack: vi.fn(), onMaterialDrop: vi.fn(),
  }));
  return { scrollEl: scrollRef.current!, onScroll };
}

describe('TrackContainer — events from portalled descendants', () => {
  it('pressing inside the volume popover does not start drag-scroll', () => {
    const { scrollEl, onScroll } = renderContainer();
    fireEvent.mouseDown(screen.getByTestId('volume-popover'), { button: 0, clientX: 50, clientY: 5 });
    fireEvent.mouseMove(document, { buttons: 1, clientX: 120, clientY: 5 });
    expect({ cursor: scrollEl.style.cursor, scrolled: onScroll.mock.calls.length })
      .toEqual({ cursor: 'default', scrolled: 0 });
  });

  it('an empty-lane press still starts drag-scroll', () => {
    const { scrollEl } = renderContainer();
    fireEvent.mouseDown(screen.getByTestId('lane'), { button: 0, clientX: 50, clientY: 5 });
    expect(scrollEl.style.cursor).toBe('grabbing');
  });
});
