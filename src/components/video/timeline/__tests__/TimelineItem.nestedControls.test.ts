/**
 * UI3-03: the clip root is a keyboard control (Enter / Space select it), but a
 * control nested inside the clip — the camera-motion badge, the download
 * retry button — owns its own activation keys.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import * as React from 'react';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import itemSource from '../TimelineItem.tsx?raw';
import * as storeModule from '../store';
import * as updateItemFields from '../store/actions/updateItemFields';
import * as sentenceWindow from '../lib/sentenceWindow';
import * as timeFormat from '../timeFormat';
import * as zoomLevelModule from '../domain/value-objects/ZoomLevel';
import * as dragMachine from '../domain/machines/dragMachine';
import * as selectPlaybackUrl from '../../lib/selectPlaybackUrl';
import * as itemStyles from '../timelineItemStyles';
import * as presetLabels from '../../components/CameraMotionModal/presetLabels';
import * as eligibility from '../../playback/camera/eligibility';
import { applyPreset } from '../../playback/camera/cameraPresets';
import type { TimelineItemData } from '../domain/types';
import { compileComponent, localeContextModule, reactModules } from './test-utils/compileComponent';

type ItemProps = {
  item: TimelineItemData;
  pixelsPerSecond: number;
  trackHeight: number;
  onOpenCameraMotion?: (itemId: string) => void;
};

const { useTimelineStore } = storeModule;
const get = () => useTimelineStore.getState();
const Nothing = () => null;

const clip: TimelineItemData = {
  id: 'clip-1', name: 'Clip 1', type: 'video', startTime: 0, duration: 4,
  trackId: 'video-track-1', color: '#3b82f6', materialId: 'm1',
  cameraMotion: applyPreset('push-in', '2d'),
};

let TimelineItem: React.FC<ItemProps>;

beforeAll(() => {
  TimelineItem = compileComponent<ItemProps>(itemSource, {
    ...reactModules(),
    ...localeContextModule(),
    '@/contexts/NotificationContext': {
      useNotification: () => ({ showInfo: () => {}, showWarning: () => {} }),
    },
    './store': storeModule,
    './store/actions/updateItemFields': updateItemFields,
    './SentenceSegmentBar': Nothing,
    './lib/sentenceWindow': sentenceWindow,
    './AudioWaveformCanvas': Nothing,
    './timeFormat': timeFormat,
    './domain/value-objects/ZoomLevel': zoomLevelModule,
    './domain/machines/dragMachine': dragMachine,
    '../lib/filmstrip/filmstripCache': {
      filmstripCache: { framesFor: () => [], ensure: () => Promise.resolve() },
    },
    '../lib/selectPlaybackUrl': selectPlaybackUrl,
    './timelineItemStyles': itemStyles,
    '../components/CameraMotionModal/presetLabels': presetLabels,
    '../playback/camera/eligibility': eligibility,
    './TimelineItemFilmstrip': Nothing,
    './TimelineItemDownloadOverlay': Nothing,
  });
});

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline({
    currentTime: 0, totalDuration: 4, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'video-track-1', name: 'Video 1', type: 'video', height: 80,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0, items: [clip],
    }],
  });
  get().deselectAll();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function renderClip() {
  const { container } = render(React.createElement(TimelineItem, {
    item: get().tracks[0].items[0],
    pixelsPerSecond: 50,
    trackHeight: 80,
    onOpenCameraMotion: () => {},
  }));
  const root = container.querySelector<HTMLElement>('[data-clip-id="clip-1"]')!;
  return { root, badge: root.querySelector<HTMLButtonElement>('button')! };
}

describe('TimelineItem — nested controls', () => {
  it('Enter on the camera-motion badge is not default-prevented by the clip', () => {
    const { badge } = renderClip();
    const notPrevented = fireEvent.keyDown(badge, { key: 'Enter' });
    expect(notPrevented).toBe(true);
  });

  it('Space on the focused clip still selects it', () => {
    const { root } = renderClip();
    const notPrevented = fireEvent.keyDown(root, { key: ' ' });
    expect({ prevented: !notPrevented, selected: get().selectedItems }).toEqual({ prevented: true, selected: ['clip-1'] });
  });
});
