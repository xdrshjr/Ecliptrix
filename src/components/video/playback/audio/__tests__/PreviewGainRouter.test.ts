/**
 * ME-06 — clip volume above 100% is audible in the preview through a WebAudio
 * gain stage, only for sources WebAudio can route audibly, and only into a
 * running AudioContext.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  PreviewGainRouter,
  isBoostableSource,
  splitPreviewVolume,
} from '../PreviewGainRouter';

const ORIGIN = 'http://localhost:3000';

function fakeContext(state: AudioContextState = 'running') {
  const gainTargets: number[] = [];
  const context = {
    state,
    currentTime: 0,
    destination: {},
    createMediaElementSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
    createGain: vi.fn(() => ({
      gain: { setTargetAtTime: vi.fn((value: number) => gainTargets.push(value)) },
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
  const router = new PreviewGainRouter({
    origin: () => ORIGIN,
    createContext: () => context as unknown as AudioContext,
  });
  return { context, router, gainTargets };
}

function videoWithSrc(src: string): HTMLVideoElement {
  const element = document.createElement('video');
  element.src = src;
  return element;
}

describe('PreviewGainRouter (ME-06)', () => {
  it('splits 1.6 into element volume 1 and gain 1.6', () => {
    expect([splitPreviewVolume(1.6), splitPreviewVolume(0.4), splitPreviewVolume(3)]).toEqual([
      { elementVolume: 1, gain: 1.6 },
      { elementVolume: 0.4, gain: 1 },
      { elementVolume: 1, gain: 2 },
    ]);
  });

  it('never routes a cross-origin source', () => {
    const { context, router } = fakeContext();
    const element = videoWithSrc('https://cdn.example.com/clip.mp4');

    const outcome = router.apply(element, 1.6);

    expect({
      outcome,
      routed: context.createMediaElementSource.mock.calls.length,
      elementVolume: element.volume,
      boostable: [isBoostableSource('blob:http://localhost:3000/x', ORIGIN), isBoostableSource('/api/storage/files/a.mp4', ORIGIN)],
    }).toEqual({ outcome: 'unboostable', routed: 0, elementVolume: 1, boostable: [true, true] });
  });

  it('judges the just-assigned src, not the previous currentSrc, before routing', () => {
    const { context, router } = fakeContext();
    const element = videoWithSrc('https://cdn.example.com/next.mp4');
    // A real element keeps the previous resource's currentSrc until the load
    // algorithm reaches a stable state — i.e. in the very frame the pool
    // assigns the next clip's src and writes its volume.
    Object.defineProperty(element, 'currentSrc', {
      value: `${ORIGIN}/api/storage/files/video/previous.mp4`,
    });

    const outcome = router.apply(element, 1.6);

    expect({ outcome, routed: context.createMediaElementSource.mock.calls.length }).toEqual({
      outcome: 'unboostable',
      routed: 0,
    });
  });

  it('does not route while the AudioContext is suspended', () => {
    const { context, router } = fakeContext('suspended');
    const element = videoWithSrc(`${ORIGIN}/api/storage/files/video/a.mp4`);

    const outcome = router.apply(element, 1.6);

    expect({
      outcome,
      routed: context.createMediaElementSource.mock.calls.length,
      resumed: context.resume.mock.calls.length,
    }).toEqual({ outcome: 'element', routed: 0, resumed: 1 });
  });

  it('a routed element carries volume and mute in the gain', () => {
    const { router, gainTargets } = fakeContext();
    const element = videoWithSrc(`${ORIGIN}/api/storage/files/video/a.mp4`);

    const boosted = router.apply(element, 1.6);
    const afterBoost = element.volume;
    element.muted = true;
    element.dispatchEvent(new Event('volumechange'));
    element.muted = false;
    element.dispatchEvent(new Event('volumechange'));
    const lowered = router.apply(element, 0.5);

    expect({ boosted, afterBoost, lowered, volume: element.volume, gainTargets }).toEqual({
      boosted: 'boosted',
      afterBoost: 1,
      lowered: 'element',
      volume: 1,
      gainTargets: [1.6, 0, 1.6, 0.5],
    });
  });

  it('asks for a recycle only when a routed element is about to get a cross-origin url', () => {
    const { router } = fakeContext();
    const element = videoWithSrc(`${ORIGIN}/api/storage/files/video/a.mp4`);
    const untouched = videoWithSrc(`${ORIGIN}/api/storage/files/video/b.mp4`);
    router.apply(element, 1.6);

    expect([
      router.needsRecycleFor(element, 'https://cdn.example.com/c.mp4'),
      router.needsRecycleFor(element, '/api/storage/files/video/c.mp4'),
      router.needsRecycleFor(untouched, 'https://cdn.example.com/c.mp4'),
    ]).toEqual([true, false, false]);
  });
});
