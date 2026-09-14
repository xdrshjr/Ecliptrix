/**
 * MultiTrackPlaybackEngine — a timeline without any video clip (ME-07).
 *
 * An image + voice-over timeline has no video track groups at all. The engine
 * must still run its clock to the total duration, keep the audio in sync and
 * move the playhead, rather than relying on a video element to drive time.
 */

import { describe, expect, it, vi } from 'vitest';
import { MultiTrackPlaybackEngine } from '../MultiTrackPlaybackEngine';
import { PlaybackClock } from '../PlaybackClock';
import { CanvasCompositor } from '../CanvasCompositor';
import { PlayheadController } from '../PlayheadController';
import type { VideoElementLike } from '../VideoSourcePool';
import type { AudioSyncGroup } from '../AudioSyncPool';

function makeControlledClock() {
  let nowMs = 0;
  const queue: FrameRequestCallback[] = [];
  const clock = new PlaybackClock({
    raf: (cb) => {
      queue.push(cb);
      return queue.length;
    },
    caf: () => {
      queue.length = 0;
    },
    now: () => nowMs,
  });
  return {
    clock,
    advance(ms: number) {
      nowMs += ms;
    },
    tick() {
      const cb = queue.shift();
      if (cb) cb(nowMs);
    },
  };
}

function makeMockCanvas() {
  const ctx = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 50 })),
    save: vi.fn(),
    restore: vi.fn(),
    fillStyle: '#000',
    globalAlpha: 1,
    textAlign: 'center',
    textBaseline: 'middle',
    font: '',
    imageSmoothingQuality: 'high',
  };
  return {
    width: 1280,
    height: 720,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => 'data:'),
  } as unknown as HTMLCanvasElement;
}

function fakeAudioEl(): VideoElementLike & { paused: boolean; volume: number } {
  const el = {
    src: '',
    currentTime: 0,
    readyState: 4,
    paused: true,
    volume: 1,
    play() {
      el.paused = false;
    },
    pause() {
      el.paused = true;
    },
  };
  return el;
}

describe('MultiTrackPlaybackEngine — image and audio only', () => {
  it('plays to the total duration with only image and audio layers', () => {
    const control = makeControlledClock();
    const engine = new MultiTrackPlaybackEngine({
      clock: control.clock,
      compositor: new CanvasCompositor(() => 0),
      playhead: new PlayheadController({ throttleMs: 0, now: () => 0 }),
      now: () => 0,
    });
    const audioEl = fakeAudioEl();
    const currentTime = { value: 0 };
    const voice: AudioSyncGroup = {
      trackId: 'voice', muted: false, volume: 1, kind: 'audio',
      items: [{ id: 'v1', startTime: 0, duration: 5, clipStart: 0, clipEnd: 5, url: '/api/storage/files/audio/v1.mp3' }],
    };
    engine.attach({
      canvas: makeMockCanvas(),
      resolveTrackElements: () => null,
      resolveAudioElement: () => audioEl,
      resolveSource: () => null,
      timeline: {
        getVideoTrackGroups: () => [],
        getAudioSyncGroups: () => [voice],
        getSubtitleItems: () => [],
        getImageItems: () => [
          { id: 'cover', src: '/api/storage/files/images/cover.png', startTime: 0, duration: 5 },
        ],
        getTotalDuration: () => 5,
        getCurrentTime: () => currentTime.value,
        setCurrentTime: (t) => {
          currentTime.value = t;
        },
      },
    });

    engine.play();
    control.advance(2000);
    control.tick();
    const midway = { time: currentTime.value, audioPlaying: !audioEl.paused, phase: engine.getPhase() };
    control.advance(4000);
    control.tick();

    expect({
      midwayTime: Math.round(midway.time),
      midwayAudioPlaying: midway.audioPlaying,
      midwayPhase: midway.phase,
      endPhase: engine.getPhase(),
      endTime: currentTime.value,
    }).toEqual({
      midwayTime: 2,
      midwayAudioPlaying: true,
      midwayPhase: 'playing',
      endPhase: 'ended',
      endTime: 5,
    });
  });
});
