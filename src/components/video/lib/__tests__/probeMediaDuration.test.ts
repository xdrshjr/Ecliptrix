/**
 * @vitest-environment jsdom
 *
 * ME-11: the duration probe reads a media element's metadata and gives up
 * with null instead of hanging.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { probeMediaDuration } from '../probeMediaDuration';

/** Record the probe's <video> element; jsdom cannot load media itself. */
function captureProbeElement(): () => HTMLVideoElement {
  const createElement = document.createElement.bind(document);
  let probeElement: HTMLVideoElement | null = null;
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    const created = createElement(tagName);
    if (tagName === 'video') probeElement = created as HTMLVideoElement;
    return created;
  }) as typeof document.createElement);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  return () => {
    if (!probeElement) throw new Error('probe did not create a video element');
    return probeElement;
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('probeMediaDuration', () => {
  it("resolves the media element's duration", async () => {
    const probeElement = captureProbeElement();
    const pending = probeMediaDuration('/api/storage/files/video/clip.mp4');
    const element = probeElement();
    Object.defineProperty(element, 'duration', { configurable: true, value: 12.5 });
    element.dispatchEvent(new Event('loadedmetadata'));
    await expect(pending).resolves.toBe(12.5);
  });

  it('times out to null', async () => {
    vi.useFakeTimers();
    captureProbeElement();
    const pending = probeMediaDuration('/api/storage/files/video/clip.mp4', 1000);
    vi.advanceTimersByTime(1000);
    await expect(pending).resolves.toBeNull();
  });

  // The detached element must not keep the media file open (or downloading)
  // once the probe has answered, whatever the answer was.
  it('the probe element releases its source after a timeout', async () => {
    vi.useFakeTimers();
    const probeElement = captureProbeElement();
    const pending = probeMediaDuration('/api/storage/files/video/clip.mp4', 1000);
    vi.advanceTimersByTime(1000);
    await pending;
    const element = probeElement();
    expect({ src: element.getAttribute('src'), reloaded: vi.mocked(element.load).mock.calls.length })
      .toEqual({ src: null, reloaded: 1 });
  });

  it('an unreadable length resolves to null', async () => {
    const probeElement = captureProbeElement();
    const pending = probeMediaDuration('/api/storage/files/video/recording.webm');
    const element = probeElement();
    Object.defineProperty(element, 'duration', { configurable: true, value: Number.POSITIVE_INFINITY });
    element.dispatchEvent(new Event('loadedmetadata'));
    await expect(pending).resolves.toBeNull();
  });
});
