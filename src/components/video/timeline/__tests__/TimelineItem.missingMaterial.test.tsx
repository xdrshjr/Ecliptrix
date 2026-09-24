/**
 * N-01: a clip whose material is gone shows a badge; nothing is marked before
 * the material list has loaded.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import * as React from 'react';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import itemSource from '../TimelineItem.tsx?raw';
import { getTranslations } from '@/lib/i18n';
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
import { createMissingMaterialPredicate } from '../lib/missingMaterial';
import type { TimelineData, TimelineItemData } from '../domain/types';
import { compileComponent, localeContextModule, reactModules } from './test-utils/compileComponent';
import * as audioClipDisplayPref from '../audioClipDisplayPref';

type ItemProps = {
  item: TimelineItemData;
  pixelsPerSecond: number;
  trackHeight: number;
  isMaterialMissing?: boolean;
};

const { useTimelineStore } = storeModule;
const Nothing = () => null;

const clip: TimelineItemData = {
  id: 'orphan', name: 'orphan', type: 'video', startTime: 0, duration: 4,
  trackId: 'video-track-1', color: '#3b82f6', materialId: 'deleted-material',
};

function timeline(): TimelineData {
  return {
    currentTime: 0, totalDuration: 4, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'video-track-1', name: 'Video 1', type: 'video', height: 80,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0, items: [clip],
    }],
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

const renderClip = (isMaterialMissing: boolean) =>
  render(React.createElement(TimelineItem, { item: clip, pixelsPerSecond: 50, trackHeight: 80, isMaterialMissing }));

describe('missing material badge', () => {
  it("shows the missing-material badge when the clip's material is gone", () => {
    renderClip(true);
    expect(screen.getByTestId('clip-material-missing').getAttribute('aria-label')).toBe(
      getTranslations('en').timeline.track.materialMissing,
    );
  });

  it('shows no badge before the material list has loaded', () => {
    const predicate = createMissingMaterialPredicate([], false);
    renderClip(predicate?.(clip) ?? false);
    expect({ predicate, badge: screen.queryByTestId('clip-material-missing') }).toEqual({
      predicate: undefined,
      badge: null,
    });
  });
});
