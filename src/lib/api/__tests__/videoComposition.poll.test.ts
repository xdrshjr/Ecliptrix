/**
 * videoComposition.pollCompositionStatus — EX-03 failure message + abort (T24).
 *
 * The backend's structured failure carries `error_summary` (never
 * `error_details.error`), so the old client always said "Unknown error". And
 * the poll loop kept running after the export's component unmounted. Fake
 * timers drive the poll interval; nothing here sleeps.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import {
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

  it('pollCompositionStatus surfaces error_summary', async () => {
    vi.spyOn(httpModule.http, 'get').mockResolvedValue(
      statusOf({
        status: 'failed',
        error_details: {
          error_summary: '2 videos could not be resolved locally',
          recovery_suggestions: ['Re-import the missing materials'],
          error: 'ignored when a summary exists',
        },
      }) as never,
    );

    await expect(api.pollCompositionStatus('comp-1')).rejects.toMatchObject({
      message:
        'Composition failed: 2 videos could not be resolved locally\n' +
        'Re-import the missing materials',
    });
  });

  it('falls back to error_details.error when error_summary is missing', async () => {
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

  it('stops polling on error status', async () => {
    const get = vi.spyOn(httpModule.http, 'get').mockResolvedValue(
      statusOf({ status: 'error', error: 'Async composition failed' }) as never,
    );

    await expect(api.pollCompositionStatus('comp-1')).rejects.toMatchObject({
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

  it('stops polling when aborted', async () => {
    const get = vi
      .spyOn(httpModule.http, 'get')
      .mockResolvedValue(statusOf({}) as never);
    const controller = new AbortController();
    const outcome = api
      .pollCompositionStatus('comp-1', undefined, 2000, 300, controller.signal)
      .catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(10_000);
    await outcome;

    expect({ calls: get.mock.calls.length, timers: vi.getTimerCount() })
      .toEqual({ calls: 1, timers: 0 });
  });

  it('rejects with an AbortError when aborted', async () => {
    vi.spyOn(httpModule.http, 'get').mockResolvedValue(statusOf({}) as never);
    const controller = new AbortController();
    const outcome = api
      .pollCompositionStatus('comp-1', undefined, 2000, 300, controller.signal)
      .catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    expect(await outcome).toMatchObject({
      name: 'AbortError',
      message: 'Composition polling aborted',
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
      .pollCompositionStatus('comp-1', onProgress, 2000, 300, controller.signal)
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
      .pollCompositionStatus('comp-1', undefined, 2000, 300, controller.signal)
      .catch(() => undefined);

    expect(get).not.toHaveBeenCalled();
  });

  it('rejects with a TimeoutError once the attempts are used up', async () => {
    // Named like http-client's timeout so the export hook can tell it apart
    // from a backend failure whose text merely mentions a timeout.
    vi.spyOn(httpModule.http, 'get').mockResolvedValue(statusOf({}) as never);

    const run = api.pollCompositionStatus('comp-1', undefined, 10, 2);
    const settled = expect(run).rejects.toMatchObject({
      name: 'TimeoutError',
      message: 'Composition polling timeout',
    });
    await vi.advanceTimersByTimeAsync(10);

    await settled;
  });
});
