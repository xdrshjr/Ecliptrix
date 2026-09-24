/**
 * editor-shell-ui-consolidation W6: an audio clip shows a clean waveform by
 * default. The name sits in its own label strip ABOVE the waveform (never on
 * it), short lanes drop the strip, and the TTS sentence colour blocks are an
 * opt-in view — still without text drawn over them.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import * as React from 'react';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import itemSource from '../TimelineItem.tsx?raw';
// @ts-expect-error -- Vite raw source.
import barSource from '../SentenceSegmentBar.tsx?raw';
// @ts-expect-error -- Vite raw source.
import hitLayerSource from '../SentenceHitLayer.tsx?raw';
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
import * as audioClipDisplayPref from '../audioClipDisplayPref';
import type { TimelineData, TimelineItemData } from '../domain/types';
import {
  compileComponent, compileComponentModule, localeContextModule, reactModules,
} from './test-utils/compileComponent';

type ItemProps = { item: TimelineItemData; pixelsPerSecond: number; trackHeight: number };

const { useTimelineStore } = storeModule;
const Nothing = () => null;

const ttsClip: TimelineItemData = {
  id: 'clip-tts', name: 'segment_voice.mp3', type: 'audio', startTime: 0, duration: 4,
  trackId: 'audio-track-1', color: '#10b981', materialId: 'audio_seg-1_1700000000000',
  url: '/api/audio/generated/segment_voice.mp3',
  serverUrl: '/api/audio/generated/segment_voice.mp3',
  sentenceSegments: {
    sentences: [
      { sentence_id: 's1', text: '第一句台词', order: 0, start_time: 0, end_time: 2, duration: 2 },
      { sentence_id: 's2', text: '第二句台词', order: 1, start_time: 2, end_time: 4, duration: 2 },
    ],
  },
} as TimelineItemData;

function timeline(): TimelineData {
  return {
    currentTime: 0, totalDuration: 10, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'audio-track-1', name: '', type: 'audio', height: 80,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
      items: [ttsClip],
    }],
  };
}

let TimelineItem: React.FC<ItemProps>;

beforeAll(() => {
  const shared = { ...reactModules(), ...localeContextModule() };
  const barModule = compileComponentModule(barSource, {
    ...shared, './timeFormat': timeFormat, './lib/sentenceWindow': sentenceWindow,
  });
  const HitLayer = compileComponent(hitLayerSource, {
    ...shared, './lib/sentenceWindow': sentenceWindow, './SentenceSegmentBar': barModule,
  });
  const SentenceBar = () => React.createElement('div', { 'data-testid': 'sentence-bar' });
  const Waveform = (props: { height: number; color?: string }) =>
    React.createElement('canvas', {
      'data-testid': 'waveform', 'data-height': props.height, 'data-color': props.color,
    });
  TimelineItem = compileComponent<ItemProps>(itemSource, {
    ...shared,
    '@/contexts/NotificationContext': {
      useNotification: () => ({ showInfo: () => {}, showWarning: () => {} }),
    },
    './store': storeModule,
    './store/actions/updateItemFields': updateItemFields,
    './SentenceSegmentBar': { __esModule: true, default: SentenceBar },
    './lib/sentenceWindow': sentenceWindow,
    './AudioWaveformCanvas': { __esModule: true, default: Waveform },
    './SentenceHitLayer': { __esModule: true, default: HitLayer },
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
  localStorage.clear();
  useTimelineStore.getState().initTimeline(timeline());
});

afterEach(() => {
  act(() => audioClipDisplayPref.writeAudioClipDisplay('waveform'));
  cleanup();
});

function renderClip(trackHeight = 80): HTMLElement {
  const { container } = render(React.createElement(TimelineItem, {
    item: ttsClip, pixelsPerSecond: 50, trackHeight,
  }));
  return container.querySelector<HTMLElement>('[data-clip-id="clip-tts"]')!;
}

describe('TimelineItem audio clip — waveform by default', () => {
  it('tts_clip_defaults_to_waveform_without_sentence_blocks', () => {
    const clip = renderClip();
    expect(clip.querySelector('[data-testid="waveform"]')).not.toBeNull();
    expect(clip.querySelector('[data-testid="sentence-bar"]')).toBeNull();
    expect(clip.querySelector('[data-testid="waveform"]')?.getAttribute('data-color'))
      .toBe('rgba(255,255,255,0.78)');
  });

  it('label_strip_and_waveform_do_not_overlap', () => {
    const clip = renderClip(80);
    const strip = clip.querySelector<HTMLElement>('.ws-audio-label-strip')!;
    const body = clip.querySelector<HTMLElement>('[data-audio-body]')!;
    expect(strip.style.height).toBe('14px');
    expect(body.style.top).toBe('14px');
    expect(body.querySelector('.ws-audio-label-strip')).toBeNull();
    expect(body.textContent).toBe('');
    // Clip box = 80 - 2 * lane padding(10) = 60; waveform fills 60 - 14.
    expect(clip.querySelector('[data-testid="waveform"]')?.getAttribute('data-height')).toBe('46');
  });

  it('short_lane_has_no_label_strip', () => {
    const clip = renderClip(30);
    expect(clip.querySelector('.ws-audio-label-strip')).toBeNull();
    expect(clip.querySelector<HTMLElement>('[data-audio-body]')!.style.top).toBe('0px');
  });

  it('sentence_tooltips_survive_in_waveform_mode', () => {
    const clip = renderClip();
    const layer = clip.querySelector('[data-testid="sentence-hit-layer"]')!;
    const titles = Array.from(layer.children).map(block => block.getAttribute('title'));
    expect(titles).toHaveLength(2);
    expect(titles[0]).toContain('第一句台词');
    expect(titles[1]).toContain('第二句台词');
  });

  it('sentences_mode_shows_blocks_without_overlaid_text', () => {
    act(() => audioClipDisplayPref.writeAudioClipDisplay('sentences'));
    const clip = renderClip();
    const body = clip.querySelector<HTMLElement>('[data-audio-body]')!;
    expect(body.querySelector('[data-testid="sentence-bar"]')).not.toBeNull();
    expect(body.querySelector('[data-testid="waveform"]')).toBeNull();
    expect(body.textContent).toBe('');
  });
});
