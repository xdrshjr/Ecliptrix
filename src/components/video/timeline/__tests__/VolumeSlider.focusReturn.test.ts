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
});

afterEach(() => {
  cleanup();
  act(() => get().hideVolumeSlider());
  document.body.innerHTML = '';
});

function button(label: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.textContent = label;
  document.body.appendChild(element);
  return element;
}

/** Focus-on-open runs a microtask, then a frame. */
async function openFromFocused(opener: HTMLElement) {
  opener.focus();
  act(() => get().showVolumeSliderForTrack(TRACK_ID, { x: 300, y: 300 }));
  render(React.createElement(OwningTrack));
  await act(async () => {
    await Promise.resolve();
    if (typeof requestAnimationFrame !== 'undefined') {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  });
}

describe('VolumeSlider — focus after closing', () => {
  it('Escape returns focus to the track volume button', async () => {
    const opener = button('Volume');
    await openFromFocused(opener);
    const focusedSlider = document.activeElement === screen.getByRole('slider');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect({ focusedSlider, returned: document.activeElement === opener })
      .toEqual({ focusedSlider: true, returned: true });
  });

  it('an outside click leaves focus where the user clicked', async () => {
    const opener = button('Volume');
    const elsewhere = button('Elsewhere');
    await openFromFocused(opener);
    act(() => {
      elsewhere.focus();
    });
    fireEvent.mouseDown(elsewhere);
    expect({ open: get().showVolumeSlider !== null, focused: document.activeElement === elsewhere })
      .toEqual({ open: false, focused: true });
  });
});
