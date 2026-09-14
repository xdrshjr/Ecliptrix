/**
 * useVideoExport — the composed file is downloaded once, and a failed
 * download is reported instead of a success tick (EXO-14, T20).
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
import { singleClipTimeline, videoMaterial } from './useVideoExport.fixtures';

let taskSequence = 0;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  taskSequence += 1;
  api.composeVideo.mockResolvedValue({ success: true, composition_id: 'comp-1', status: 'processing' });
  api.pollCompositionStatus.mockResolvedValue(undefined);
  api.triggerDownload.mockRejectedValue(new Error('HTTP 500'));
});

function renderExport(progressSeen: number[] = []) {
  return renderHook(() => {
    const exportState = useVideoExport({
      timelineState: singleClipTimeline('mv'),
      materials: [videoMaterial('mv')],
      taskId: `task-${taskSequence}`,
      projectId: 'p1',
      aspectRatio: '16:9',
    });
    progressSeen.push(exportState.exportProgress);
    return exportState;
  });
}

describe('useVideoExport download', () => {
  it('the download is attempted once', async () => {
    const { result } = renderExport();

    await act(async () => {
      await result.current.handleExport();
    });

    expect({
      downloads: api.triggerDownload.mock.calls.length,
      errors: notify.showError.mock.calls,
    }).toEqual({ downloads: 1, errors: [['download failed', 10000]] });
  });

  it('a failed download never reaches 100%', async () => {
    const progressSeen: number[] = [];
    const { result } = renderExport(progressSeen);

    await act(async () => {
      await result.current.handleExport();
    });

    expect({
      highestProgress: Math.max(...progressSeen),
      isExporting: result.current.isExporting,
    }).toEqual({ highestProgress: 95, isExporting: false });
  });
});
