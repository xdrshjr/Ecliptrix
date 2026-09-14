/**
 * N-06 — the store playhead can sit past the preview's render end (hidden
 * tracks and blank subtitles still count there). A seek beyond the end must
 * paint the last frame and report the render end, never a black frame at a
 * time the preview cannot draw.
 */

import { describe, expect, it, vi } from 'vitest';
import { MultiTrackPlaybackEngine } from '../MultiTrackPlaybackEngine';
import { CanvasCompositor } from '../CanvasCompositor';
import { PlaybackClock } from '../PlaybackClock';
import { PlayheadController } from '../PlayheadController';
import type { VideoElementLike } from '../VideoSourcePool';
import type { VideoSequenceItem } from '../../types';

function makeMockCanvas() {
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
  return { canvas, ctx };
}

function fakeVideoEl(): VideoElementLike & { paused: boolean } {
  const el = {
    src: '',
    currentTime: 0,
    readyState: 4,
    videoWidth: 1920,
    videoHeight: 1080,
    paused: true,
    muted: true,
    play() {
      el.paused = false;
    },
    pause() {
      el.paused = true;
    },
  };
  return el;
}

function clip(): VideoSequenceItem {
  return {
    id: 'a',
    name: 'a',
    url: '',
    startTime: 0,
    duration: 10,
    trackId: 't1',
    clipStart: 0,
    clipEnd: 10,
  } as VideoSequenceItem;
}

describe('MultiTrackPlaybackEngine.seek past the render end (N-06)', () => {
  it('seek past the render end paints the final frame and reports the render end', () => {
    const { canvas, ctx } = makeMockCanvas();
    const clock = new PlaybackClock({ raf: () => 1, caf: () => undefined, now: () => 0 });
    const engine = new MultiTrackPlaybackEngine({
      clock,
      compositor: new CanvasCompositor(() => 0),
      playhead: new PlayheadController({ throttleMs: 0, now: () => 0 }),
      now: () => 0,
    });
    const videoEl = fakeVideoEl();
    const currentTime = { value: 0 };
    engine.attach({
      canvas,
      resolveTrackElements: () => ({ active: videoEl, prewarm: null }),
      resolveAudioElement: () => null,
      resolveSource: () => '/api/storage/files/video/a.mp4',
      outputSize: { width: 1920, height: 1080 },
      timeline: {
        getVideoTrackGroups: () => [{ trackId: 't1', z: 0, items: [clip()] }],
        getAudioSyncGroups: () => [],
        getSubtitleItems: () => [],
        getImageItems: () => [],
        getTotalDuration: () => 10,
        getCurrentTime: () => currentTime.value,
        setCurrentTime: (t) => {
          currentTime.value = t;
        },
      },
    });
    ctx.drawImage.mockClear();

    engine.seek(15);

    expect({
      rendered: engine.getCompositionTime(),
      playhead: currentTime.value,
      paintedLastFrame: ctx.drawImage.mock.calls.length > 0,
    }).toEqual({ rendered: 10, playhead: 10, paintedLastFrame: true });
  });
});
