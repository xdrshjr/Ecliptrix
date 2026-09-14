/**
 * useVideoExport — an export session outlives the editor (EXO-14, T19).
 *
 * Switching tasks or projects unmounts the editor; the running export must
 * still be visible when it comes back, must not be startable twice, and must
 * not block a different project of the same task (RV3-07).
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
import { deferred, singleClipTimeline, videoMaterial } from './useVideoExport.fixtures';

let taskSequence = 0;

beforeEach(() => {
  vi.clearAllMocks();
  taskSequence += 1;
  api.composeVideo.mockResolvedValue({ success: true, composition_id: 'comp-1', status: 'processing' });
  api.triggerDownload.mockResolvedValue(undefined);
});

function exportProps(projectId?: string) {
  return {
    timelineState: singleClipTimeline('mv'),
    materials: [videoMaterial('mv')],
    taskId: `task-${taskSequence}`,
    projectId,
    aspectRatio: '16:9',
  };
}

/** Starts an export that stays in the polling phase until `finish()` is called. */
async function startPendingExport(render: { current: ReturnType<typeof useVideoExport> }) {
  const started = deferred<void>();
  const polling = deferred<void>();
  api.pollCompositionStatus.mockImplementationOnce(() => {
    started.resolve();
    return polling.promise;
  });
  let run: Promise<void> = Promise.resolve();
  await act(async () => {
    run = render.current.handleExport();
    await started.promise;
  });
  return {
    finish: async () => {
      polling.resolve();
      await act(async () => { await run; });
    },
  };
}

describe('useVideoExport session', () => {
  it('a remounted hook for the same task reports the running export', async () => {
    const first = renderHook(() => useVideoExport(exportProps('p1')));
    const pending = await startPendingExport(first.result);

    first.unmount();
    const second = renderHook(() => useVideoExport(exportProps('p1')));

    expect({
      isExporting: second.result.current.isExporting,
      progress: second.result.current.exportProgress,
    }).toEqual({ isExporting: true, progress: 30 });
    await pending.finish();
  });

  it('a second handleExport while running starts no composition', async () => {
    const { result } = renderHook(() => useVideoExport(exportProps('p1')));
    const pending = await startPendingExport(result);

    await act(async () => {
      await result.current.handleExport();
    });

    expect(api.composeVideo).toHaveBeenCalledTimes(1);
    await pending.finish();
  });

  it('another project in the same task is not blocked by the running export', async () => {
    const projectA = renderHook(() => useVideoExport(exportProps('project-a')));
    const pending = await startPendingExport(projectA.result);
    api.pollCompositionStatus.mockResolvedValueOnce(undefined);
    const projectB = renderHook(() => useVideoExport(exportProps('project-b')));

    await act(async () => {
      await projectB.result.current.handleExport();
    });

    expect({
      compositions: api.composeVideo.mock.calls.length,
      projectAStillExporting: projectA.result.current.isExporting,
    }).toEqual({ compositions: 2, projectAStillExporting: true });
    await pending.finish();
  });
});
