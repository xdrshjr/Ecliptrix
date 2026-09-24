/**
 * UI3-04: while a caption is edited inline, the input is a text field, not a
 * drag handle — pressing in it places the caret and double-clicking a word
 * selects the word instead of re-opening the editor over the typed text.
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
import * as segmentLinksContext from '../../lib/segments/SegmentLinksContext';
import * as presetLabels from '../../components/CameraMotionModal/presetLabels';
import * as eligibility from '../../playback/camera/eligibility';
import type { TimelineItemData } from '../domain/types';
import { compileComponent, localeContextModule, reactModules } from './test-utils/compileComponent';
import * as audioClipDisplayPref from '../audioClipDisplayPref';

type ItemProps = { item: TimelineItemData; pixelsPerSecond: number; trackHeight: number };

const { useTimelineStore } = storeModule;
const get = () => useTimelineStore.getState();
const Nothing = () => null;

const caption: TimelineItemData = {
  id: 'caption-1', name: 'Caption', type: 'subtitle', startTime: 0, duration: 3,
  trackId: 'subtitle-track-1', color: '#f59e0b', text: 'hello',
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
    './SentenceHitLayer': Nothing,
    './audioClipDisplayPref': audioClipDisplayPref,
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
    '../lib/segments/SegmentLinksContext': segmentLinksContext,
  });
});

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline({
    currentTime: 0, totalDuration: 3, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'subtitle-track-1', name: 'Subtitles', type: 'subtitle', height: 50,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0, items: [caption],
    }],
  });
});

afterEach(() => {
  cleanup();
  get().setEditingSubtitle(null);
  get().cancelDrag();
  document.body.innerHTML = '';
});

/** Double-clicking the caption opens the inline editor with its stored text. */
function openInlineEditor(): HTMLInputElement {
  const { container } = render(React.createElement(TimelineItem, {
    item: get().tracks[0].items[0], pixelsPerSecond: 50, trackHeight: 50,
  }));
  fireEvent.doubleClick(container.querySelector('[data-clip-id="caption-1"]')!);
  return container.querySelector('input')!;
}

describe('TimelineItem — inline caption editor', () => {
  it('pressing inside the inline editor does not start a clip drag', () => {
    const input = openInlineEditor();
    const notPrevented = fireEvent.pointerDown(input, { clientX: 10, clientY: 10, button: 0 });
    expect({ notPrevented, interacting: get().isInteracting }).toEqual({ notPrevented: true, interacting: false });
  });

  it('double-clicking a word keeps the typed text', () => {
    const input = openInlineEditor();
    fireEvent.change(input, { target: { value: 'typed but unsaved' } });
    fireEvent.doubleClick(input);
    expect(input.value).toBe('typed but unsaved');
  });
});
