import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import sliderSource from '../VolumeSlider.tsx?raw';
import * as storeModule from '../store';
import * as trackActions from '../store/actions/trackActions';
import * as trackDisplayName from '../trackDisplayName';
import * as mouseGesture from '../lib/mouseGesture';
import { compileComponent, localeContextModule, reactModules } from './test-utils/compileComponent';

const { useTimelineStore } = storeModule;
const get = () => useTimelineStore.getState();
const TRACK_ID = 'audio-track-1';

let VolumeSlider: React.FC;

/** Mounts the popover only while open — exactly how Track.tsx renders it. */
function OwningTrack() {
  const isOpen = useTimelineStore((state) => state.showVolumeSlider !== null);
  return isOpen ? React.createElement(VolumeSlider) : null;
}

beforeAll(() => {
  VolumeSlider = compileComponent(sliderSource, {
    ...reactModules(),
    ...localeContextModule(),
    './store': storeModule,
    './store/actions/trackActions': trackActions,
    './trackDisplayName': trackDisplayName,
    './lib/mouseGesture': mouseGesture,
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
  get().clearHistory();
  get().showVolumeSliderForTrack(TRACK_ID, { x: 300, y: 300 });
});

afterEach(() => {
  cleanup();
  act(() => get().hideVolumeSlider());
  document.body.innerHTML = '';
});

const volume = () => get().tracks.find((track) => track.id === TRACK_ID)!.volume;

async function flushFrame(): Promise<void> {
  if (typeof requestAnimationFrame === 'undefined') return;
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

/** Opens the popover, presses the slider at 150% and drags to 80%. */
async function dragTo80() {
  const view = render(React.createElement(OwningTrack));
  const slider = screen.getByRole('slider');
  slider.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 200, bottom: 12, width: 200, height: 12, x: 0, y: 0, toJSON: () => ({}),
  });
  fireEvent.mouseDown(slider, { button: 0, clientX: 150 });
  fireEvent.mouseMove(document, { buttons: 1, clientX: 80 });
  await flushFrame();
  return { view, duringDrag: volume() };
}

describe('VolumeSlider — cancelling a drag', () => {
  it('Escape mid-drag restores the pre-gesture volume and records no history', async () => {
    const { duringDrag } = await dragTo80();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseUp(document, { button: 0, clientX: 80 });
    expect({
      duringDrag,
      after: volume(),
      canUndo: get().canUndo,
      popoverOpen: get().showVolumeSlider !== null,
    }).toEqual({ duringDrag: 80, after: 100, canUndo: false, popoverOpen: true });
  });

  it('unmount mid-drag detaches document listeners and reverts the preview', async () => {
    const { view, duringDrag } = await dragTo80();
    view.unmount();
    fireEvent.mouseUp(document, { button: 0, clientX: 80 });
    expect({ duringDrag, after: volume(), canUndo: get().canUndo })
      .toEqual({ duringDrag: 80, after: 100, canUndo: false });
  });

  it('window blur mid-drag cancels the gesture', async () => {
    const { duringDrag } = await dragTo80();
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    fireEvent.mouseUp(document, { button: 0, clientX: 80 });
    expect({ duringDrag, after: volume(), canUndo: get().canUndo })
      .toEqual({ duringDrag: 80, after: 100, canUndo: false });
  });

  it('a completed drag still commits one undoable step', async () => {
    await dragTo80();
    fireEvent.mouseUp(document, { button: 0, clientX: 80 });
    expect({ after: volume(), canUndo: get().canUndo }).toEqual({ after: 80, canUndo: true });
  });
});
