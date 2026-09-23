/**
 * The volume popover portals into <body>, but React still bubbles its focus
 * and hover events through the component tree. Rendered inside the volume
 * button's PortalTooltip, every focus or hover in the popover re-opened that
 * tooltip over the button while the user was adjusting the volume.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { createPortal } from 'react-dom';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import trackSource from '../Track.tsx?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import tooltipSource from '../PortalTooltip.tsx?raw';
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
import { compileComponent, reactModules } from './test-utils/compileComponent';

type TrackProps = { trackId: string; pixelsPerSecond: number; onMaterialDrop: () => void };

const { useTimelineStore } = storeModule;
const get = () => useTimelineStore.getState();
const TRACK_ID = 'audio-track-1';

/** Stands in for VolumeSlider: a focusable field portalled into <body>. */
function PopoverStub() {
  return createPortal(
    React.createElement('button', { type: 'button', 'data-testid': 'popover-field' }, '50%'),
    document.body,
  );
}

let Track: React.FC<TrackProps>;

beforeAll(() => {
  const PortalTooltip = compileComponent(tooltipSource, reactModules());
  Track = compileComponent<TrackProps>(trackSource, {
    ...reactModules(),
    '@/lib/i18n': i18n,
    './store': storeModule,
    './TimelineItem': () => null,
    './VolumeSlider': PopoverStub,
    './PortalTooltip': PortalTooltip,
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
  get().initTimeline({
    currentTime: 0, totalDuration: 0, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: TRACK_ID, name: 'Music', type: 'audio', height: 60,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0, items: [],
    }],
  });
});

afterEach(() => {
  cleanup();
  act(() => get().hideVolumeSlider());
});

describe('track volume popover', () => {
  it('focusing or hovering inside the open volume popover shows no track tooltip', () => {
    render(React.createElement(Track, { trackId: TRACK_ID, pixelsPerSecond: 50, onMaterialDrop: () => {} }));
    act(() => get().showVolumeSliderForTrack(TRACK_ID, { x: 300, y: 300 }));
    const field = screen.getByTestId('popover-field');

    act(() => field.focus());
    const tooltipOnFocus = document.body.querySelector('.fixed') !== null;
    fireEvent.mouseEnter(field);
    const tooltipOnHover = document.body.querySelector('.fixed') !== null;

    expect({ tooltipOnFocus, tooltipOnHover }).toEqual({ tooltipOnFocus: false, tooltipOnHover: false });
  });
});
