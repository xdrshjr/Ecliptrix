/**
 * ME-12: the track header has a mute button. It is a monitoring switch —
 * no undo entry — and is disabled while the track is locked.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import trackSource from '../Track.tsx?raw';
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

type TrackProps = { trackId: string; pixelsPerSecond: number; onMaterialDrop: () => void };

const { useTimelineStore } = storeModule;
const get = () => useTimelineStore.getState();

const Passthrough = ({ children }: { children: React.ReactNode }) =>
  React.createElement(React.Fragment, null, children);

function timeline(): TimelineData {
  return {
    currentTime: 0, totalDuration: 4, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'audio-track-1', name: 'Music', type: 'audio', height: 60,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
      items: [{
        id: 'music', name: 'music', type: 'audio', startTime: 0, duration: 4,
        trackId: 'audio-track-1', color: '#10b981', materialId: 'm-music',
      }],
    }, {
      id: 'video-track-1', name: 'Video', type: 'video', height: 80,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1, items: [],
    }],
  };
}

const isAudioTrackMuted = () => get().tracks.find((track) => track.id === 'audio-track-1')?.isMuted;

let Track: React.FC<TrackProps>;

beforeAll(() => {
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
    './EmptyTrackStrip': () => null,
    './DropHintBadge': () => null,
    './lib/dropHint': dropHint,
    './hooks/useEmptyTrackExpansion': emptyTrackExpansion,
  });
});

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(timeline());
  get().clearHistory();
});

afterEach(() => {
  cleanup();
});

describe('track header mute button', () => {
  it('mute button toggles isMuted and is disabled on a locked track', () => {
    render(React.createElement(Track, { trackId: 'audio-track-1', pixelsPerSecond: 50, onMaterialDrop: () => {} }));
    fireEvent.click(screen.getByTestId('track-mute-audio-track-1'));
    const afterClick = {
      isMuted: isAudioTrackMuted(),
      pressed: screen.getByTestId('track-mute-audio-track-1').getAttribute('aria-pressed'),
      canUndo: get().canUndo,
    };
    act(() => get().toggleTrackLock('audio-track-1'));
    expect({
      ...afterClick,
      disabled: (screen.getByTestId('track-mute-audio-track-1') as HTMLButtonElement).disabled,
    }).toEqual({ isMuted: true, pressed: 'true', canUndo: false, disabled: true });
  });

  // Preview (VideoSourcePool) and export (videoExportItems) ignore isMuted on
  // video tracks, so a pressed mute there would promise silence and deliver
  // the embedded audio anyway.
  it('a video track offers no mute button because its mute would not silence preview or export', () => {
    render(React.createElement(Track, { trackId: 'video-track-1', pixelsPerSecond: 50, onMaterialDrop: () => {} }));
    expect(screen.queryByTestId('track-mute-video-track-1')).toBeNull();
  });
});
