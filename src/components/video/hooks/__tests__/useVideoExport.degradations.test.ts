/**
 * useVideoExport — content that did not make it into a finished video is
 * reported (EXO-03 / S7), not silently dropped behind "export succeeded".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MaterialItem, TimelineState } from '@/types';

type StatusUpdate = Record<string, unknown>;

const composeVideo = vi.fn<(req: unknown) => Promise<Record<string, unknown>>>(() =>
  Promise.resolve({ success: true, composition_id: 'comp-1', status: 'processing' }),
);
const triggerDownload = vi.fn<(...args: unknown[]) => Promise<undefined>>(() => Promise.resolve(undefined));
let statusUpdates: StatusUpdate[] = [];
const pollCompositionStatus = vi.fn(
  async (_id: string, onProgress?: (status: StatusUpdate) => void) => {
    statusUpdates.forEach((update) => onProgress?.(update));
  },
);

vi.mock('@/lib/api/videoComposition', () => ({
  videoCompositionAPI: {
    composeVideo: (req: unknown) => composeVideo(req),
    triggerDownload: (...args: unknown[]) => triggerDownload(...args),
    pollCompositionStatus: (...args: unknown[]) =>
      (pollCompositionStatus as unknown as (...a: unknown[]) => Promise<void>)(...args),
  },
}));

const showError = vi.fn();
const showWarning = vi.fn();
vi.mock('@/contexts/NotificationContext', () => ({
  useNotification: () => ({ showError, showWarning, showSuccess: vi.fn(), showInfo: vi.fn() }),
}));

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({
    locale: 'en',
    t: {
      videoExport: {
        nothingVisibleToExport: 'nothing visible',
        missingMaterials: 'missing {count}: {names}',
        blackTailNotice: 'black {seconds}',
        moreItems: 'and {count} more',
        degradedTitle: 'Some content is missing:',
        degradedImageOverlay: 'Images not rendered: {names}',
        degradedSubtitles: 'Subtitles not burned in',
        degradedAudioItem: 'Audio not mixed in: {names}',
        degradedEmbeddedAudio: 'Original sound not mixed in: {names}',
        exportFailedWithError: 'failed:',
        exportFailed: 'failed',
        exportTimeout: 'timeout',
        exportCompletedButDownloadFailed: 'download failed',
        compositionWarningsTitle: 'warnings',
      },
    },
  }),
}));

import { useVideoExport } from '../useVideoExport';

function material(id: string, type: MaterialItem['type']): MaterialItem {
  return { id, name: id, type, format: 'x', size: 1, url: `/api/storage/files/${type}/${id}`, createdAt: new Date(0) } as MaterialItem;
}

const timeline: TimelineState = {
  currentTime: 0, totalDuration: 5, zoomLevel: 1, selectedItems: [], playbackRate: 1,
  isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
  tracks: [{
    id: 'v', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true,
    volume: 100, order: 0,
    items: [{
      id: 'clip', name: 'clip', type: 'video', materialId: 'mv', trackId: 'v', startTime: 0,
      duration: 5, color: '#000', clipStart: 0, clipEnd: 5,
    }],
  }],
};

beforeEach(() => {
  composeVideo.mockClear();
  triggerDownload.mockClear();
  showError.mockClear();
  showWarning.mockClear();
  statusUpdates = [];
});

describe('useVideoExport degradations', () => {
  it('shows a warning naming the images that were not rendered', async () => {
    const degraded = {
      kind: 'image_overlay',
      item_ids: ['img-2'],
      item_names: ['cover.png'],
      reason: 'remote image is not available locally',
    };
    statusUpdates = [
      { progress: 0.5, status: 'processing', degradations: [degraded] },
      { progress: 1, status: 'completed', degradations: [degraded] },
    ];
    const { result } = renderHook(() =>
      useVideoExport({ timelineState: timeline, materials: [material('mv', 'video')], taskId: 't', aspectRatio: '16:9' }),
    );

    await act(async () => {
      await result.current.handleExport();
    });

    expect(showWarning).toHaveBeenCalledWith(
      'Some content is missing:\nImages not rendered: cover.png',
      15000,
    );
    expect(triggerDownload).toHaveBeenCalledTimes(1);
  });
});
