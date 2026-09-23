/**
 * T-EMPTY-TRACK (spec R2 §3.10): an empty image / subtitle lane folds into a
 * 20px「＋ 添加…」strip, a lane with content is always open, and a throwing
 * localStorage never stops the lane from rendering.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import trackSource from '../Track.tsx?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import stripSource from '../EmptyTrackStrip.tsx?raw';
import * as i18n from '@/lib/i18n';
import * as storeModule from '../store';
import * as trackDisplayName from '../trackDisplayName';
import * as rulerTicks from '../lib/rulerTicks';
import * as timelineGrid from '../lib/timelineGrid';
import * as materialDragTypes from '../lib/materialDragTypes';
import * as trackForMaterial from '../lib/trackForMaterial';
import * as theme from '../theme/timelineTheme';
import * as dropHint from '../lib/dropHint';
import * as emptyTrackExpansion from '../hooks/useEmptyTrackExpansion';
import type { TimelineData } from '../domain/types';
import { compileComponent, reactModules } from './test-utils/compileComponent';

interface TrackProps {
  trackId: string;
  pixelsPerSecond: number;
  onMaterialDrop: () => void;
  projectId?: string;
  locale?: i18n.SupportedLocale;
}

const { useTimelineStore } = storeModule;
const get = () => useTimelineStore.getState();
const PROJECT_ID = 'task-42';
const STORAGE_KEY = `ecliptrix.timeline.expandedEmptyTracks.${PROJECT_ID}`;

const Passthrough = ({ children }: { children: React.ReactNode }) =>
  React.createElement(React.Fragment, null, children);

function timeline(): TimelineData {
  const lane = { isLocked: false, isMuted: false, isVisible: true, volume: 100, height: 40 };
  return {
    currentTime: 0, totalDuration: 4, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [
      { ...lane, id: 'image-track-1', name: '', type: 'video', order: 0, items: [] },
      {
        ...lane, id: 'subtitle-track-1', name: '', type: 'subtitle', order: 1,
        items: [{
          id: 'line', name: 'line', type: 'subtitle', startTime: 0, duration: 4,
          trackId: 'subtitle-track-1', color: '#f59e0b',
        }],
      },
      { ...lane, id: 'video-track-1', name: '', type: 'video', order: 2, items: [] },
    ],
  };
}

let Track: React.FC<TrackProps>;

beforeAll(() => {
  const EmptyTrackStrip = compileComponent(stripSource, reactModules());
  Track = compileComponent<TrackProps>(trackSource, {
    ...reactModules(),
    '@/lib/i18n': i18n,
    './store': storeModule,
    './TimelineItem': () => null,
    './VolumeSlider': () => null,
    './PortalTooltip': Passthrough,
    '@/contexts/NotificationContext': {
      useNotification: () => ({ showWarning: () => {}, showConfirm: () => {} }),
    },
    './trackDisplayName': trackDisplayName,
    './lib/rulerTicks': rulerTicks,
    './lib/timelineGrid': timelineGrid,
    './lib/materialDragTypes': materialDragTypes,
    './lib/trackForMaterial': trackForMaterial,
    './theme/timelineTheme': theme,
    './TrackNameEditor': () => null,
    './EmptyTrackStrip': EmptyTrackStrip,
    './DropHintBadge': () => null,
    './lib/dropHint': dropHint,
    './hooks/useEmptyTrackExpansion': emptyTrackExpansion,
  });
});

const renderLane = (trackId: string) => render(React.createElement(Track, {
  trackId, pixelsPerSecond: 50, onMaterialDrop: () => {}, projectId: PROJECT_ID, locale: 'zh-CN',
}));

const laneHeight = (trackId: string) => {
  const content = document.querySelector<HTMLElement>(`[data-track-id="${trackId}"] .track-content`);
  return content?.style.height;
};

beforeEach(() => {
  window.localStorage.clear();
  get().setExternalEditLock(null);
  get().initTimeline(timeline());
  get().clearHistory();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('empty lane strip', () => {
  it('an empty image track collapses into a 20px add-images strip', () => {
    renderLane('image-track-1');
    expect({
      strip: screen.getByTestId('empty-track-strip').textContent,
      height: laneHeight('image-track-1'),
    }).toEqual({ strip: '＋ 添加图片', height: '20px' });
  });

  it('a subtitle track with content is forced open', () => {
    renderLane('subtitle-track-1');
    expect(screen.queryByTestId('empty-track-strip')).toBeNull();
  });

  it('an empty video track never collapses', () => {
    renderLane('video-track-1');
    expect(screen.queryByTestId('empty-track-strip')).toBeNull();
  });

  it('clicking the strip opens the lane and remembers it for the project', () => {
    renderLane('image-track-1');
    fireEvent.click(screen.getByTestId('empty-track-strip'));
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
    cleanup();
    renderLane('image-track-1');
    expect({
      stored,
      stripAfterRemount: screen.queryByTestId('empty-track-strip'),
    }).toEqual({ stored: ['image-track-1'], stripAfterRemount: null });
  });

  it('a throwing localStorage still renders the strip and still expands', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    renderLane('image-track-1');
    const rendered = screen.queryByTestId('empty-track-strip') !== null;
    fireEvent.click(screen.getByTestId('empty-track-strip'));
    expect({
      rendered,
      expanded: screen.queryByTestId('empty-track-strip') === null,
      warned: warn.mock.calls.length > 0,
    }).toEqual({ rendered: true, expanded: true, warned: true });
  });
});
