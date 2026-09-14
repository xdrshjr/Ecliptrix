/**
 * videoComposition.pollCompositionStatus — failure details, abort and the
 * "no progress" timeout (T18: EX3-08 / EXO-07).
 *
 * A failed composition rejects with `CompositionFailedError` carrying the
 * backend's `error_details`, so the export hook can name the failed clips in
 * the user's language instead of showing backend English. The poller gives up
 * only after `stallTimeoutMs` without any change in progress, stage or ffmpeg
 * activity — never after a fixed number of attempts, and never while queued.
 * Fake timers drive the poll interval and the clock; nothing here sleeps.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import {
  CompositionFailedError,
  VideoCompositionAPI,
  type CompositionStatusResponse,
} from '../videoComposition';

function statusOf(
  patch: Partial<CompositionStatusResponse>,
): CompositionStatusResponse {
  return {
    composition_id: 'comp-1',
    task_id: 'task-1',
    status: 'processing',
    progress: 0.5,
    start_time: 0,
    ...patch,
  };
}

/** Answers each status request with the next entry; the last one repeats. */
function respondInSequence(statuses: Array<Partial<CompositionStatusResponse>>) {
  let index = 0;
  return vi.spyOn(httpModule.http, 'get').mockImplementation(async () => {
    const next = statuses[Math.min(index, statuses.length - 1)];
    index += 1;
    return statusOf(next) as never;
  });
}

describe('videoComposition pollCompositionStatus', () => {
  let api: VideoCompositionAPI;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    api = new VideoCompositionAPI();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('failed status rejects with CompositionFailedError carrying error_details', async () => {
    const failedVideos = [{ video_name: 'intro.mp4', stage: 'media_resolution' }];
    vi.spyOn(httpModule.http, 'get').mockResolvedValue(
      statusOf({
        status: 'failed',
        error_details: {
          error_summary: '1 out of 3 videos could not be resolved to a local file',
          composition_stage: 'media_resolution',
          failed_videos: failedVideos,
        },
      }) as never,
    );

    const error = await api.pollCompositionStatus('comp-1').catch((e: unknown) => e);

    expect({
      isCompositionFailure: error instanceof CompositionFailedError,
      name: (error as Error).name,
      details: (error as CompositionFailedError).details,
    }).toEqual({
      isCompositionFailure: true,
      name: 'CompositionFailedError',
      details: {
        error_summary: '1 out of 3 videos could not be resolved to a local file',
        composition_stage: 'media_resolution',
        failed_videos: failedVideos,
      },
    });
  });

  it('keeps the backend summary in the error message for the logs', async () => {
    // The async-exception path records only `{ error }`.
    vi.spyOn(httpModule.http, 'get').mockResolvedValue(
      statusOf({
        status: 'failed',
        error_details: { error: 'Async video composition failed: boom' },
      }) as never,
    );

    await expect(api.pollCompositionStatus('comp-1')).rejects.toMatchObject({
      message: 'Composition failed: Async video composition failed: boom',
    });
  });

  it('reads a top-level composition_stage when error_details has none', async () => {
    vi.spyOn(httpModule.http, 'get').mockResolvedValue(
      statusOf({
        status: 'failed',
        composition_stage: 'cancelled',
        error_details: { error_summary: 'cancelled by user' },
      }) as never,
    );

    const error = await api.pollCompositionStatus('comp-1').catch((e: unknown) => e);

    expect((error as CompositionFailedError).details.composition_stage).toBe('cancelled');
  });

  it('stops polling on error status', async () => {
    const get = vi.spyOn(httpModule.http, 'get').mockResolvedValue(
      statusOf({ status: 'error', error: 'Async composition failed' }) as never,
    );

    await expect(api.pollCompositionStatus('comp-1')).rejects.toMatchObject({
      name: 'CompositionFailedError',
      message: 'Composition failed: Async composition failed',
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown status instead of polling to the cap', async () => {
    const get = vi.spyOn(httpModule.http, 'get').mockResolvedValue(
      statusOf({ status: 'unknown' as never }) as never,
    );

    await expect(api.pollCompositionStatus('comp-1')).rejects.toMatchObject({
      message: 'Unexpected composition status "unknown"',
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('keeps polling past 300 attempts while progress advances', async () => {
    let polls = 0;
    const get = vi.spyOn(httpModule.http, 'get').mockImplementation(async () => {
      polls += 1;
      return statusOf(
        polls > 320 ? { status: 'completed', progress: 1 } : { progress: polls / 1000 },
      ) as never;
    });

    const run = api.pollCompositionStatus('comp-1', undefined, {
      pollIntervalMs: 10,
      stallTimeoutMs: 1_000,
    });
    const settled = expect(run).resolves.toMatchObject({ status: 'completed' });
    await vi.advanceTimersByTimeAsync(10 * 330);

    await settled;
    expect(get).toHaveBeenCalledTimes(321);
  });

  it('rejects TimeoutError after the stall timeout without progress change', async () => {
    // Named like http-client's timeout so the export hook can tell it apart
    // from a backend failure whose text merely mentions a timeout.
    respondInSequence([{ progress: 0.4, stage: 'normalizing' }]);

    const run = api.pollCompositionStatus('comp-1', undefined, {
      pollIntervalMs: 1_000,
      stallTimeoutMs: 5_000,
    });
    const settled = expect(run).rejects.toMatchObject({
      name: 'TimeoutError',
      code: 'COMPOSITION_STALLED',
      message: 'Composition polling timeout',
    });
    await vi.advanceTimersByTimeAsync(6_000);

    await settled;
  });

  it('a failed status request does not end a running export', async () => {
    // A local service busy for a moment answers one poll late or not at all
    // while ffmpeg keeps rendering; the export must keep polling.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let polls = 0;
    const get = vi.spyOn(httpModule.http, 'get').mockImplementation(async () => {
      polls += 1;
      if (polls === 2) throw new httpModule.TimeoutError('Request timed out after 30000ms');
      return statusOf(polls > 2 ? { status: 'completed', progress: 1 } : { progress: 0.3 }) as never;
    });

    const run = api.pollCompositionStatus('comp-1', undefined, { pollIntervalMs: 1_000 });
    const settled = expect(run).resolves.toMatchObject({ status: 'completed' });
    await vi.advanceTimersByTimeAsync(3_000);

    await settled;
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('gives up with the last error after repeated failed status requests', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const get = vi.spyOn(httpModule.http, 'get').mockRejectedValue(
      new httpModule.ApiError(502, 'BACKEND_UNREACHABLE', 'Backend unreachable'),
    );

    const run = api.pollCompositionStatus('comp-1', undefined, { pollIntervalMs: 1_000 });
    const settled = expect(run).rejects.toMatchObject({ code: 'BACKEND_UNREACHABLE' });
    await vi.advanceTimersByTimeAsync(10_000);

    await settled;
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('a composition the backend no longer knows ends polling at once', async () => {
    const get = vi.spyOn(httpModule.http, 'get').mockRejectedValue(
      new httpModule.ApiError(404, 'COMPOSITION_NOT_FOUND', 'Composition not found'),
    );

    await expect(api.pollCompositionStatus('comp-1')).rejects.toMatchObject({ status: 404 });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('queued stage does not arm the stall timer', async () => {
    const queued = Array.from({ length: 20 }, () => ({ progress: 0, stage: 'queued' as const }));
    respondInSequence([...queued, { status: 'completed', progress: 1 }]);

    const run = api.pollCompositionStatus('comp-1', undefined, {
      pollIntervalMs: 1_000,
      stallTimeoutMs: 5_000,
    });
    const settled = expect(run).resolves.toMatchObject({ status: 'completed' });
    await vi.advanceTimersByTimeAsync(21_000);

    await settled;
  });

  it('a changing activity_at keeps polling past the stall timeout', async () => {
    // One long ffmpeg command: progress and stage stay put, the -progress file
    // keeps being written (RV3-02).
    const compositing = Array.from({ length: 20 }, (_, index) => ({
      progress: 0.7,
      stage: 'compositing' as const,
      activity_at: 1_789_400_000 + index,
    }));
    respondInSequence([...compositing, { status: 'completed', progress: 1 }]);

    const run = api.pollCompositionStatus('comp-1', undefined, {
      pollIntervalMs: 1_000,
      stallTimeoutMs: 5_000,
    });
    const settled = expect(run).resolves.toMatchObject({ status: 'completed' });
    await vi.advanceTimersByTimeAsync(21_000);

    await settled;
  });

  it('an aborted signal stops polling', async () => {
    const get = vi
      .spyOn(httpModule.http, 'get')
      .mockResolvedValue(statusOf({}) as never);
    const controller = new AbortController();
    const outcome = api
      .pollCompositionStatus('comp-1', undefined, { signal: controller.signal })
      .catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(10_000);

    expect({
      error: await outcome,
      calls: get.mock.calls.length,
      timers: vi.getTimerCount(),
    }).toMatchObject({
      error: { name: 'AbortError', message: 'Composition polling aborted' },
      calls: 1,
      timers: 0,
    });
  });

  it('does not report progress for a request that returns after abort', async () => {
    let releaseStatus: (status: CompositionStatusResponse) => void = () => {};
    vi.spyOn(httpModule.http, 'get').mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseStatus = resolve as typeof releaseStatus;
        }) as never,
    );
    const onProgress = vi.fn();
    const controller = new AbortController();
    const outcome = api
      .pollCompositionStatus('comp-1', onProgress, { signal: controller.signal })
      .catch((error: unknown) => error);

    controller.abort();
    releaseStatus(statusOf({}));
    await outcome;
    await vi.advanceTimersByTimeAsync(0);

    expect(onProgress).not.toHaveBeenCalled();
  });

  it('never requests status when the signal is already aborted', async () => {
    const get = vi.spyOn(httpModule.http, 'get');
    const controller = new AbortController();
    controller.abort();

    await api
      .pollCompositionStatus('comp-1', undefined, { signal: controller.signal })
      .catch(() => undefined);

    expect(get).not.toHaveBeenCalled();
  });
});

describe('videoComposition cancelComposition', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts to the BFF cancel route', async () => {
    const post = vi.spyOn(httpModule.http, 'post').mockResolvedValue({} as never);

    await new VideoCompositionAPI().cancelComposition('comp-1');

    expect(post.mock.calls[0][0]).toBe('/api/video-compose/comp-1/cancel');
  });

  it.each([409, 404])('treats a %i as nothing left to cancel', async (status) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(httpModule.http, 'post').mockRejectedValue(
      new httpModule.ApiError(status, 'COMPOSITION_ALREADY_SETTLED', 'settled'),
    );

    await expect(new VideoCompositionAPI().cancelComposition('comp-1')).resolves.toBeUndefined();
  });

  it('rethrows any other failure', async () => {
    vi.spyOn(httpModule.http, 'post').mockRejectedValue(
      new httpModule.ApiError(502, 'BACKEND_UNREACHABLE', 'unreachable'),
    );

    await expect(new VideoCompositionAPI().cancelComposition('comp-1')).rejects.toMatchObject({
      code: 'BACKEND_UNREACHABLE',
    });
  });
});
