import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  assignVideoSrcChecked,
  type AssignFailureReason,
} from '../assignVideoSrcChecked';
import { NoPlayableSourceError } from '../../errors';

/**
 * Shimmed <video> element. JSDOM's HTMLVideoElement does not actually
 * load media, so `loadedmetadata` / `error` never fire on real assignment.
 * We override `src` to a setter we control and dispatch lifecycle events
 * synchronously via `dispatchEvent`. This matches the spec §7.1 directive:
 * "exercise the actual `<video>` event flow (using a real or shimmed
 * `HTMLVideoElement`, not a JSON stub)".
 */
function createShimmedVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  let internalSrc = '';
  Object.defineProperty(video, 'src', {
    configurable: true,
    get: () => internalSrc,
    set: (v: string) => {
      internalSrc = v;
    },
  });
  // load() is a no-op in JSDOM and may throw — stub it.
  (video as any).load = vi.fn();
  return video;
}

function fireLoaded(video: HTMLVideoElement): void {
  video.dispatchEvent(new Event('loadedmetadata'));
}

function fireError(video: HTMLVideoElement): void {
  video.dispatchEvent(new Event('error'));
}

describe('assignVideoSrcChecked', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('(a) first candidate fires loadedmetadata → success, onCandidateFailed not invoked', async () => {
    const video = createShimmedVideo();
    const onCandidateFailed = vi.fn();
    const promise = assignVideoSrcChecked(video, 'https://x/v1.mp4', {
      fallbacks: ['https://x/v2.mp4'],
      transitionId: 1,
      getCurrentId: () => 1,
      onCandidateFailed,
    });
    await Promise.resolve(); // let event listeners attach
    fireLoaded(video);
    const result = await promise;
    expect(result.assigned).toBe('https://x/v1.mp4');
    expect(result.source).toBe('primary');
    expect(onCandidateFailed).not.toHaveBeenCalled();
    expect(video.src).toBe('https://x/v1.mp4');
  });

  it('(b) first errors (same-origin), second loads → fallback assigned + onCandidateFailed once', async () => {
    const video = createShimmedVideo();
    const onCandidateFailed = vi.fn();
    const localPath = '/api/storage/files/cached_materials/pexels/1.mp4';
    const promise = assignVideoSrcChecked(video, localPath, {
      fallbacks: ['https://cdn.example.com/v.mp4'],
      transitionId: 7,
      getCurrentId: () => 7,
      onCandidateFailed,
    });
    await Promise.resolve();
    fireError(video);
    await Promise.resolve();
    fireLoaded(video);
    const result = await promise;
    expect(result.assigned).toBe('https://cdn.example.com/v.mp4');
    expect(result.source).toBe('fallback');
    expect(onCandidateFailed).toHaveBeenCalledTimes(1);
    const [failedUrl, reason] = onCandidateFailed.mock.calls[0] as [
      string,
      AssignFailureReason,
    ];
    expect(failedUrl).toBe(localPath);
    expect(reason).toBe('same-origin-error');
  });

  it('(c) all candidates error → rejects with NoPlayableSourceError; same-origin gets handshake, remote does not', async () => {
    const video = createShimmedVideo();
    const onCandidateFailed = vi.fn();
    const localPath = '/api/storage/files/cached_materials/pexels/1.mp4';
    const remoteUrl = 'https://cdn.example.com/v.mp4';
    const promise = assignVideoSrcChecked(video, localPath, {
      fallbacks: [remoteUrl],
      transitionId: 1,
      getCurrentId: () => 1,
      onCandidateFailed,
    });
    await Promise.resolve();
    fireError(video);
    await Promise.resolve();
    fireError(video);
    await expect(promise).rejects.toBeInstanceOf(NoPlayableSourceError);
    expect(onCandidateFailed).toHaveBeenCalledTimes(2);
    expect(onCandidateFailed.mock.calls[0][1]).toBe('same-origin-error');
    expect(onCandidateFailed.mock.calls[1][1]).toBe('remote-error');
  });

  it('(d) transition superseded after first error → aborts without further src writes', async () => {
    const video = createShimmedVideo();
    let currentId = 1;
    const writes: string[] = [];
    const originalDescriptor = Object.getOwnPropertyDescriptor(video, 'src')!;
    Object.defineProperty(video, 'src', {
      configurable: true,
      get: originalDescriptor.get,
      set: (v: string) => {
        writes.push(v);
        originalDescriptor.set!.call(video, v);
      },
    });
    const promise = assignVideoSrcChecked(video, 'https://x/v1.mp4', {
      fallbacks: ['https://x/v2.mp4', 'https://x/v3.mp4'],
      transitionId: 1,
      getCurrentId: () => currentId,
    });
    await Promise.resolve();
    currentId = 99;
    fireError(video);
    await expect(promise).rejects.toBeInstanceOf(NoPlayableSourceError);
    // Only the first src write should have happened.
    expect(writes).toEqual(['https://x/v1.mp4']);
  });

  it('(e) timeout fires when neither event arrives → "timeout" reason and fallback attempted', async () => {
    const video = createShimmedVideo();
    const onCandidateFailed = vi.fn();
    const promise = assignVideoSrcChecked(video, 'https://x/v1.mp4', {
      fallbacks: ['https://x/v2.mp4'],
      transitionId: 1,
      getCurrentId: () => 1,
      perCandidateTimeoutMs: 50,
      onCandidateFailed,
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60); // 1st candidate times out
    await Promise.resolve();
    fireLoaded(video); // 2nd candidate succeeds
    const result = await promise;
    expect(result.assigned).toBe('https://x/v2.mp4');
    expect(onCandidateFailed).toHaveBeenCalledWith('https://x/v1.mp4', 'timeout');
  });

  it('(f) external AbortSignal mid-walk cancels without further work', async () => {
    const video = createShimmedVideo();
    const controller = new AbortController();
    const promise = assignVideoSrcChecked(video, 'https://x/v1.mp4', {
      fallbacks: ['https://x/v2.mp4'],
      transitionId: 1,
      getCurrentId: () => 1,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(NoPlayableSourceError);
  });

  it('removes listeners after each attempt (no leaks)', async () => {
    const video = createShimmedVideo();
    const addSpy = vi.spyOn(video, 'addEventListener');
    const removeSpy = vi.spyOn(video, 'removeEventListener');
    const promise = assignVideoSrcChecked(video, 'https://x/v1.mp4', {
      fallbacks: [],
      transitionId: 1,
      getCurrentId: () => 1,
    });
    await Promise.resolve();
    fireLoaded(video);
    await promise;
    // Each registered listener must have been removed.
    const added = addSpy.mock.calls.filter(c =>
      ['loadedmetadata', 'canplay', 'error'].includes(c[0] as string),
    );
    const removed = removeSpy.mock.calls.filter(c =>
      ['loadedmetadata', 'canplay', 'error'].includes(c[0] as string),
    );
    expect(removed.length).toBeGreaterThanOrEqual(added.length);
  });

  it('honours opt-in probe — falsy probe skips assignment', async () => {
    const video = createShimmedVideo();
    const writes: string[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(video, 'src')!;
    Object.defineProperty(video, 'src', {
      configurable: true,
      get: descriptor.get,
      set: (v: string) => {
        writes.push(v);
        descriptor.set!.call(video, v);
      },
    });
    const probe = vi
      .fn<(url: string) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const promise = assignVideoSrcChecked(video, 'https://x/v1.mp4', {
      fallbacks: ['https://x/v2.mp4'],
      transitionId: 1,
      getCurrentId: () => 1,
      probe,
    });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();
    fireLoaded(video);
    const result = await promise;
    expect(probe).toHaveBeenCalledTimes(2);
    expect(result.assigned).toBe('https://x/v2.mp4');
    expect(writes).toEqual(['https://x/v2.mp4']);
  });
});
