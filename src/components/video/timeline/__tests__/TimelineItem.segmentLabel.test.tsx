/**
 * Spec §3.8: a clip that belongs to a script segment is labelled with the
 * segment's ordinal and title (file name moves to the tooltip), and clips of
 * the selected segment carry the `ws-item-linked` ring independently of the
 * timeline's own selection.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
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
import * as segmentLinksContext from '../../lib/segments/SegmentLinksContext';
import type { SegmentLinksValue } from '../../lib/segments/SegmentLinksContext';
import type { TimelineData, TimelineItemData } from '../domain/types';
import { compileComponent, localeContextModule, reactModules } from './test-utils/compileComponent';
import * as audioClipDisplayPref from '../audioClipDisplayPref';

type ItemProps = { item: TimelineItemData; pixelsPerSecond: number; trackHeight: number };

const { useTimelineStore } = storeModule;
const { SegmentLinksContext } = segmentLinksContext;
const Nothing = () => null;

const linkedClip: TimelineItemData = {
  id: 'clip-linked', name: 'beach_take3.mp4', type: 'video', startTime: 3.34, duration: 8.5,
  trackId: 'video-track-1', color: '#3b82f6', materialId: 'material-1',
};
const plainClip: TimelineItemData = { ...linkedClip, id: 'clip-plain', startTime: 12 };

function timeline(): TimelineData {
  return {
    currentTime: 0, totalDuration: 20, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'video-track-1', name: '', type: 'video', height: 80,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
      items: [linkedClip, plainClip],
    }],
  };
}

function links(highlighted: string[] = []): SegmentLinksValue {
  return {
    segmentIndex: new Map([['seg-1', {
      segmentId: 'seg-1', ordinal: 1, title: '丝滑亮相', badge: '01', label: '01 丝滑亮相',
    }]]),
    itemSegmentMap: new Map([['clip-linked', 'seg-1']]),
    materialSegmentMap: new Map(),
    segmentRanges: new Map(),
    statusById: new Map(),
    latestVoiceById: new Map(),
    highlightedItemIds: new Set(highlighted),
    isPlaceholderScript: false,
  };
}

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
  useTimelineStore.getState().initTimeline(timeline());
});

afterEach(() => {
  cleanup();
});

function renderClip(item: TimelineItemData, value: SegmentLinksValue): HTMLElement {
  const { container } = render(
    React.createElement(
      SegmentLinksContext.Provider,
      { value },
      React.createElement(TimelineItem, { item, pixelsPerSecond: 50, trackHeight: 80 }),
    ),
  );
  return container.querySelector<HTMLElement>(`[data-clip-id="${item.id}"]`)!;
}

describe('TimelineItem segment label', () => {
  it('renders_ordinal_label_when_linked', () => {
    const clip = renderClip(linkedClip, links());
    expect({
      badge: clip.querySelector('.ws-badge-ordinal')?.textContent,
      text: clip.textContent?.includes('丝滑亮相'),
      fileNameVisible: clip.textContent?.includes('beach_take3.mp4'),
      title: clip.getAttribute('title'),
      ariaStartsWith: clip.getAttribute('aria-label')?.startsWith('01 丝滑亮相 · beach_take3.mp4 · 0:03.34–0:11.84'),
    }).toEqual({
      badge: '01',
      text: true,
      fileNameVisible: false,
      title: '01 丝滑亮相 · beach_take3.mp4 · 0:03.34–0:11.84',
      ariaStartsWith: true,
    });
  });

  it('falls_back_to_file_name_when_unlinked', () => {
    const clip = renderClip(plainClip, links());
    expect({
      badge: clip.querySelector('.ws-badge-ordinal'),
      fileNameVisible: clip.textContent?.includes('beach_take3.mp4'),
      title: clip.getAttribute('title'),
    }).toEqual({
      badge: null,
      fileNameVisible: true,
      title: 'beach_take3.mp4 0:12.00 - 0:20.50',
    });
  });

  it('linked_highlight_class_independent_of_selection', () => {
    const highlightedOnly = renderClip(linkedClip, links(['clip-linked']));
    const linkedUnselected = [
      highlightedOnly.classList.contains('ws-item-linked'),
      highlightedOnly.getAttribute('aria-pressed'),
    ];
    cleanup();
    useTimelineStore.getState().selectItem('clip-plain');
    const selectedOnly = renderClip(plainClip, links(['clip-linked']));
    expect({
      linkedUnselected,
      selectedUnlinked: [
        selectedOnly.classList.contains('ws-item-linked'),
        selectedOnly.getAttribute('aria-pressed'),
      ],
      selection: useTimelineStore.getState().selectedItems,
    }).toEqual({
      linkedUnselected: [true, 'false'],
      selectedUnlinked: [false, 'true'],
      selection: ['clip-plain'],
    });
  });
});
