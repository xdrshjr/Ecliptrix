/**
 * PV3-02 — the canvas is now the only visible copy of an image, so an image
 * that finishes loading while the preview is paused must be painted without
 * waiting for the next seek.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MultiTrackPlaybackEngine } from '../MultiTrackPlaybackEngine';
import { CanvasCompositor } from '../CanvasCompositor';
import { PlaybackClock } from '../PlaybackClock';
import { PlayheadController } from '../PlayheadController';

class PendingImage {
  static created: PendingImage[] = [];
  crossOrigin = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  complete = false;
  naturalWidth = 0;
  naturalHeight = 0;
  src = '';
  constructor() {
    PendingImage.created.push(this);
  }
  finishLoading() {
    this.complete = true;
    this.naturalWidth = 200;
    this.naturalHeight = 100;
    this.onload?.();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  PendingImage.created = [];
});

describe('MultiTrackPlaybackEngine — image load repaint (PV3-02)', () => {
  it('repaints once when an image finishes loading while paused', () => {
    vi.stubGlobal('Image', PendingImage);
    const ctx = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillStyle: '#000',
      globalAlpha: 1,
      imageSmoothingQuality: 'high',
    };
    const canvas = { width: 1280, height: 720, getContext: vi.fn(() => ctx) } as unknown as HTMLCanvasElement;
    const compositor = new CanvasCompositor(() => 0);
    const engine = new MultiTrackPlaybackEngine({
      clock: new PlaybackClock({ raf: () => 1, caf: () => undefined, now: () => 0 }),
      compositor,
      playhead: new PlayheadController({ throttleMs: 0, now: () => 0 }),
      now: () => 0,
    });
    engine.attach({
      canvas,
      resolveTrackElements: () => null,
      resolveAudioElement: () => null,
      resolveSource: () => null,
      outputSize: { width: 1920, height: 1080 },
      viewport: { aspectRatio: 16 / 9 },
      timeline: {
        getVideoTrackGroups: () => [],
        getAudioSyncGroups: () => [],
        getSubtitleItems: () => [],
        getImageItems: () => [{ id: 'img', src: '/api/storage/files/images/a.png', startTime: 0, duration: 5 }],
        getTotalDuration: () => 5,
        getCurrentTime: () => 1,
        setCurrentTime: () => undefined,
      },
    });
    const renderSpy = vi.spyOn(compositor, 'renderFrame');
    expect(ctx.drawImage).not.toHaveBeenCalled();

    PendingImage.created[0].finishLoading();

    expect({ renders: renderSpy.mock.calls.length, drawnImages: ctx.drawImage.mock.calls.length })
      .toEqual({ renders: 1, drawnImages: 1 });
  });
});
