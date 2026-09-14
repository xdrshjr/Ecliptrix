/**
 * useVideoExport — duration and content of the export request (S5, EXV-03,
 * EXV-09, EXO-06, D-12).
 *
 * The request's `total_duration` is the timeline's render end — the same
 * number the preview plays to — not the sum of clip lengths; clips keep their
 * real start; an image + audio timeline exports; and a picture shorter than
 * the audio exports with a black tail and a notice instead of being refused.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MaterialItem, TimelineState } from '@/types';
import { useTimelineComposition } from '../useTimelineComposition';

interface ComposeResult {
  success: boolean;
  composition_id: string;
  status: string;
}

const composeVideo = vi.fn<(req: unknown) => Promise<ComposeResult>>(() =>
  Promise.resolve({ success: true, composition_id: 'comp-1', status: 'completed' }),
);
const triggerDownload = vi.fn<(...args: unknown[]) => Promise<undefined>>(() => Promise.resolve(undefined));
const pollCompositionStatus = vi.fn<(...args: unknown[]) => Promise<undefined>>(() => Promise.resolve(undefined));

vi.mock('@/lib/api/videoComposition', () => ({
  videoCompositionAPI: {
    composeVideo: (req: unknown) => composeVideo(req),
    triggerDownload: (...args: unknown[]) => triggerDownload(...args),
    pollCompositionStatus: (...args: unknown[]) => pollCompositionStatus(...args),
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

type TimelineTrack = TimelineState['tracks'][number];
type TimelineTrackItem = TimelineTrack['items'][number];

interface ExportRequest {
  total_duration: number;
  video_items: Array<{ id: string; start_time: number }>;
  audio_items: Array<{ id: string }>;
  image_items: Array<{ id: string }>;
}

function material(id: string, type: MaterialItem['type']): MaterialItem {
  return {
    id, name: id, type, format: 'x', size: 1,
    url: `/api/storage/files/${type}/${id}`, createdAt: new Date(0),
  } as MaterialItem;
}

const materials = [material('mv', 'video'), material('ma', 'audio'), material('img', 'image')];

function clip(id: string, startTime: number, duration: number, patch: Partial<TimelineTrackItem> = {}): TimelineTrackItem {
  return {
    id, name: id, type: 'video', materialId: 'mv', trackId: 't', startTime, duration, color: '#000',
    clipStart: 0, clipEnd: duration, originalDuration: duration, ...patch,
  };
}

const still = (id: string, startTime: number, duration: number) =>
  clip(id, startTime, duration, { materialId: 'img', originalMaterialType: 'image', clipEnd: duration });
const audio = (id: string, startTime: number, duration: number) =>
  clip(id, startTime, duration, { type: 'audio', materialId: 'ma' });

function track(id: string, type: TimelineTrack['type'], items: TimelineTrackItem[], order = 0): TimelineTrack {
  return {
    id, name: id, type, height: 80, isLocked: false, isMuted: false, isVisible: true,
    volume: 100, order, items,
  };
}

function stateOf(tracks: TimelineTrack[]): TimelineState {
  return {
    currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [], tracks,
    playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
  };
}

async function runExport(tracks: TimelineTrack[]): Promise<ExportRequest | undefined> {
  const { result } = renderHook(() =>
    useVideoExport({ timelineState: stateOf(tracks), materials, taskId: 'task-1', aspectRatio: '16:9' }),
  );
  await act(async () => {
    await result.current.handleExport();
  });
  const calls = composeVideo.mock.calls;
  return calls.length > 0 ? (calls[calls.length - 1][0] as ExportRequest) : undefined;
}

beforeEach(() => {
  composeVideo.mockClear();
  triggerDownload.mockClear();
  pollCompositionStatus.mockClear();
  showError.mockClear();
  showWarning.mockClear();
});

describe('useVideoExport duration', () => {
  it('sends the render end as total_duration for overlapping tracks', async () => {
    const request = await runExport([
      track('base', 'video', [clip('base', 0, 6)], 0),
      track('top', 'video', [clip('top', 2, 2)], 1),
    ]);
    expect(request?.total_duration).toBe(6);
  });

  it('an image between two videos keeps the second video start_time', async () => {
    const request = await runExport([
      track('v', 'video', [clip('a', 0, 3), still('picture', 3, 2), clip('b', 5, 3)]),
    ]);
    expect({
      bStart: request?.video_items.find((item) => item.id === 'b')?.start_time,
      total: request?.total_duration,
    }).toEqual({ bStart: 5, total: 8 });
  });

  it('an image and audio timeline exports with empty video_items', async () => {
    const request = await runExport([
      track('v', 'video', [still('cover', 0, 10)]),
      track('a', 'audio', [audio('voice', 0, 10)]),
    ]);
    expect({
      video: request?.video_items.length,
      images: request?.image_items.map((item) => item.id),
      total: request?.total_duration,
    }).toEqual({ video: 0, images: ['cover'], total: 10 });
  });

  it('an audio-only timeline is refused with nothingVisibleToExport', async () => {
    const request = await runExport([track('a', 'audio', [audio('voice', 0, 10)])]);
    expect(request).toBeUndefined();
    expect(showError).toHaveBeenCalledWith('nothing visible', 8000);
  });

  it('a 10 s video with 60 s music exports 60 s and warns about the black tail', async () => {
    const request = await runExport([
      track('v', 'video', [clip('shot', 0, 10)]),
      track('a', 'audio', [audio('music', 0, 60)]),
    ]);
    expect(request?.total_duration).toBe(60);
    expect(showWarning).toHaveBeenCalledWith('black 50.0', 8000);
    expect(showError).not.toHaveBeenCalled();
  });

  it('a black tail under half a second exports without a notice', async () => {
    const request = await runExport([
      track('v', 'video', [clip('shot', 0, 10)]),
      track('a', 'audio', [audio('music', 0, 10.4)]),
    ]);
    expect(request?.total_duration).toBe(10.4);
    expect(showWarning).not.toHaveBeenCalled();
  });

  it('preview composition end and export total_duration agree for the same timeline', async () => {
    const tracks = [
      track('base', 'video', [clip('base', 0, 6)], 0),
      track('top', 'video', [clip('top', 2, 2)], 1),
      track('a', 'audio', [audio('music', 0, 9)]),
    ];
    const preview = renderHook(() => useTimelineComposition('task-1', materials));
    act(() => {
      preview.result.current.handleTimelineStateChange(stateOf(tracks));
    });
    const request = await runExport(tracks);

    expect(request?.total_duration).toBe(preview.result.current.compositionPlayback.totalCompositionDuration);
  });
});
