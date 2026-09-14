/**
 * Export failure wording (EX3-08, T21).
 *
 * A failed composition names the clips that failed, in the user's language;
 * the backend's English `error_summary` and suggestions stay in the log.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { TimeoutError } from '@/lib/api/http-client';
import { getTranslations } from '@/lib/i18n';

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
import { describeExportFailure } from '../exportFailureMessage';
import { exportTranslations, singleClipTimeline, videoMaterial } from './useVideoExport.fixtures';

type RealCompositionModule = typeof import('@/lib/api/videoComposition');

async function compositionFailure(details: Record<string, unknown>): Promise<Error> {
  const { CompositionFailedError } = await vi.importActual<RealCompositionModule>(
    '@/lib/api/videoComposition',
  );
  return new CompositionFailedError(
    'Composition failed: 1 out of 3 videos could not be resolved to a local file',
    details,
  );
}

let taskSequence = 0;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  taskSequence += 1;
  api.composeVideo.mockResolvedValue({ success: true, composition_id: 'comp-1', status: 'processing' });
  api.triggerDownload.mockResolvedValue(undefined);
});

async function exportRejectedWith(error: unknown) {
  api.pollCompositionStatus.mockRejectedValueOnce(error);
  const { result } = renderHook(() => useVideoExport({
    timelineState: singleClipTimeline('mv'),
    materials: [videoMaterial('mv')],
    taskId: `task-${taskSequence}`,
    aspectRatio: '16:9',
  }));
  await act(async () => {
    await result.current.handleExport();
  });
}

describe('useVideoExport failure messages', () => {
  it('names clips whose material is not local', async () => {
    await exportRejectedWith(await compositionFailure({
      composition_stage: 'media_resolution',
      failed_videos: [{ video_name: 'intro.mp4', stage: 'media_resolution' }],
    }));

    expect(notify.showError.mock.calls).toEqual([['1 not local: intro.mp4', 15000]]);
  });

  it('never shows the backend English summary', async () => {
    await exportRejectedWith(await compositionFailure({
      composition_stage: 'video_normalization',
      error_summary: '2 out of 3 videos failed to normalize after 3 retry attempts',
      recovery_suggestions: ['Check if the downloaded video files are corrupted'],
      failed_videos: [{ video_name: 'a.mp4' }, { video_name: 'b.mp4' }],
    }));

    expect(notify.showError.mock.calls).toEqual([['2 unprocessable: a.mp4, b.mp4', 15000]]);
  });

  it('keeps the timeout notice apart from a failure that mentions a timeout', async () => {
    const stalled = Object.assign(new Error('Composition polling timeout'), {
      name: 'TimeoutError',
      code: 'COMPOSITION_STALLED',
    });

    await exportRejectedWith(stalled);

    expect(notify.showError.mock.calls).toEqual([['timeout', 10000]]);
  });

  it('a status request timeout is not reported as ten minutes without progress', async () => {
    // http-client names its 30 s request timeout `TimeoutError` as well.
    await exportRejectedWith(new TimeoutError('Request timed out after 30000ms'));

    expect(notify.showError.mock.calls).toEqual([['failed', 15000]]);
  });
});

describe('describeExportFailure', () => {
  it('a cancelled composition is not an error', async () => {
    const cancelled = await compositionFailure({ composition_stage: 'cancelled' });

    expect(describeExportFailure(cancelled, exportTranslations, 'en')).toBeNull();
  });

  it('a stage without named clips reads as a rendering failure', async () => {
    const failure = await compositionFailure({ composition_stage: 'finalization' });

    expect(describeExportFailure(failure, exportTranslations, 'en')).toBe('render failed');
  });

  it('a plain error never leaks its English message', () => {
    const message = describeExportFailure(
      new Error('Invalid composition request: total_duration must be a positive number'),
      exportTranslations,
      'en',
    );

    expect(message).toBe('failed');
  });

  it('lists names with the Chinese separator in zh-CN', async () => {
    const zh = getTranslations('zh-CN');
    const failure = await compositionFailure({
      composition_stage: 'media_resolution',
      failed_videos: [{ video_name: '片头.mp4' }, { video_name: '结尾.mp4' }],
    });

    expect(describeExportFailure(failure, zh, 'zh-CN')).toBe(
      zh.videoExport.failedStageMediaResolution
        .replace('{count}', '2')
        .replace('{names}', '片头.mp4、结尾.mp4'),
    );
  });
});
