/**
 * useVideoExport — the user can cancel a running export (EXO-07, T22).
 *
 * Cancel tells the backend to stop at its next stage boundary, stops the
 * client poll and closes the progress modal. It is not an error: no error
 * toast, no download.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const api = vi.hoisted(() => ({
  composeVideo: vi.fn(),
  pollCompositionStatus: vi.fn(),
  triggerDownload: vi.fn(),
  cancelComposition: vi.fn(),
}));
vi.mock('@/lib/api/videoComposition', () => ({ videoCompositionAPI: api }));

const notify = vi.hoisted(() => ({
  showError: vi.fn(), showWarning: vi.fn(), showInfo: vi.fn(), showSuccess: vi.fn(),
}));
vi.mock('@/contexts/NotificationContext', () => ({ useNotification: () => notify }));

vi.mock('@/contexts/LocaleContext', async () => {
  const { exportTranslations } = await import('./useVideoExport.fixtures');
  return { useLocale: () => ({ locale: 'en', t: exportTranslations }) };
});

import { useVideoExport } from '../useVideoExport';
import {
  deferred,
  pollUntilAborted,
  singleClipTimeline,
  videoMaterial,
} from './useVideoExport.fixtures';

let taskSequence = 0;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  taskSequence += 1;
  api.composeVideo.mockResolvedValue({ success: true, composition_id: 'comp-1', status: 'processing' });
  api.triggerDownload.mockResolvedValue(undefined);
  api.cancelComposition.mockResolvedValue(undefined);
});

function renderExport() {
  return renderHook(() => useVideoExport({
    timelineState: singleClipTimeline('mv'),
    materials: [videoMaterial('mv')],
    taskId: `task-${taskSequence}`,
    projectId: 'p1',
    aspectRatio: '16:9',
  }));
}

/**
 * Starts an export whose poll only ends when the client aborts it. The run is
 * wrapped in an object: returning the promise itself from this async helper
 * would make the caller wait for the export to finish before cancelling it.
 */
async function startPollingExport(result: { current: ReturnType<typeof useVideoExport> }) {
  const started = deferred<void>();
  api.pollCompositionStatus.mockImplementationOnce(
    (_id: string, _onProgress: unknown, options?: { signal?: AbortSignal }) => {
      started.resolve();
      return pollUntilAborted(options?.signal);
    },
  );
  let run: Promise<void> = Promise.resolve();
  await act(async () => {
    run = result.current.handleExport();
    await started.promise;
  });
  return { run };
}

function outcomeOf(result: { current: ReturnType<typeof useVideoExport> }) {
  return {
    cancelRequests: api.cancelComposition.mock.calls,
    isExporting: result.current.isExporting,
    errors: notify.showError.mock.calls,
    info: notify.showInfo.mock.calls,
    downloads: api.triggerDownload.mock.calls.length,
  };
}

describe('useVideoExport cancel', () => {
  it('cancel calls the backend and closes the modal without an error', async () => {
    const { result } = renderExport();
    const { run } = await startPollingExport(result);

    await act(async () => {
      await result.current.cancelExport();
      await run;
    });

    expect(outcomeOf(result)).toEqual({
      cancelRequests: [['comp-1']],
      isExporting: false,
      errors: [],
      info: [['cancelled']],
      downloads: 0,
    });
  });

  it('a failed cancel request still stops the client without an error toast', async () => {
    api.cancelComposition.mockRejectedValueOnce(new Error('backend unreachable'));
    const { result } = renderExport();
    const { run } = await startPollingExport(result);

    await act(async () => {
      await result.current.cancelExport();
      await run;
    });

    expect({ isExporting: result.current.isExporting, errors: notify.showError.mock.calls })
      .toEqual({ isExporting: false, errors: [] });
  });

  it('cancelling before the composition has an id cancels it once it starts', async () => {
    const compose = deferred<Record<string, unknown>>();
    api.composeVideo.mockReturnValueOnce(compose.promise);
    const { result } = renderExport();
    let run: Promise<void> = Promise.resolve();
    await act(async () => {
      run = result.current.handleExport();
    });

    await act(async () => {
      await result.current.cancelExport();
      compose.resolve({ success: true, composition_id: 'comp-1', status: 'processing' });
      await run;
    });

    expect({
      cancelRequests: api.cancelComposition.mock.calls,
      polls: api.pollCompositionStatus.mock.calls.length,
      isExporting: result.current.isExporting,
    }).toEqual({ cancelRequests: [['comp-1']], polls: 0, isExporting: false });
  });
});
