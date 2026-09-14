/**
 * useVideoExport — a clip whose material was deleted blocks the export with
 * its name (ME-02), instead of the export silently leaving that clip out.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MaterialItem, TimelineState } from '@/types';

const composeVideo = vi.fn<(req: unknown) => Promise<Record<string, unknown>>>(() =>
  Promise.resolve({ success: true, composition_id: 'comp-1', status: 'completed' }),
);

vi.mock('@/lib/api/videoComposition', () => ({
  videoCompositionAPI: {
    composeVideo: (req: unknown) => composeVideo(req),
    triggerDownload: () => Promise.resolve(undefined),
    pollCompositionStatus: () => Promise.resolve(undefined),
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
        missingMaterials: '{count} clips use deleted materials ({names})',
        blackTailNotice: 'black {seconds}',
        moreItems: 'and {count} more',
        exportFailedWithError: 'failed:',
        exportFailed: 'failed',
      },
    },
  }),
}));

import { useVideoExport } from '../useVideoExport';

const videoMaterial = {
  id: 'kept', name: 'kept', type: 'video', format: 'mp4', size: 1,
  url: '/api/storage/files/video/kept.mp4', createdAt: new Date(0),
} as MaterialItem;

function item(id: string, name: string, materialId: string, startTime: number) {
  return {
    id, name, type: 'video' as const, materialId, trackId: 'v', startTime, duration: 3,
    color: '#000', clipStart: 0, clipEnd: 3,
  };
}

const timeline: TimelineState = {
  currentTime: 0, totalDuration: 6, zoomLevel: 1, selectedItems: [], playbackRate: 1,
  isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
  tracks: [{
    id: 'v', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true,
    volume: 100, order: 0,
    items: [item('a', 'Opening shot', 'kept', 0), item('b', 'Intro clip', 'deleted', 3)],
  }],
};

beforeEach(() => {
  composeVideo.mockClear();
  showError.mockClear();
});

describe('useVideoExport missing materials', () => {
  it("export refuses when a clip's material is missing and names the clip", async () => {
    const { result } = renderHook(() =>
      useVideoExport({ timelineState: timeline, materials: [videoMaterial], taskId: 't', aspectRatio: '16:9' }),
    );

    await act(async () => {
      await result.current.handleExport();
    });

    expect(showError).toHaveBeenCalledWith('1 clips use deleted materials (Intro clip)', 8000);
    expect(composeVideo).not.toHaveBeenCalled();
  });
});
