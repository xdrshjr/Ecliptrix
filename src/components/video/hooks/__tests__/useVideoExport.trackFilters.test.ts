/**
 * useVideoExport — export track filters, volume and poll abort (T23).
 *
 * EX-01: the request volume is `computeEffectiveVolume` (a 0% track is silent,
 * item × track is clamped to the backend's `le=2`).
 * EX-02: locking only prevents editing — locked tracks are exported like the
 * preview renders them; muted audio tracks are skipped, and the expected-audio
 * count uses the same guard so a muted track can never trip the mismatch check.
 * EX-03: an export outlives the editor unmounting (the file still downloads),
 * and a backend failure that mentions "timeout" keeps its real reason.
 *
 * The hook dynamically imports `@/lib/api/videoComposition`; that module is
 * mocked so the composition request is captured without any network.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MaterialItem, TimelineState } from '@/types';

interface ComposeResult {
  success: boolean;
  composition_id: string;
  status: string;
}

const composeVideo = vi.fn<(req: unknown) => Promise<ComposeResult>>(() =>
  Promise.resolve({ success: true, composition_id: 'comp-1', status: 'completed' }),
);
const triggerDownload = vi.fn<(...args: unknown[]) => Promise<undefined>>(
  () => Promise.resolve(undefined),
);
const pollCompositionStatus = vi.fn<(...args: unknown[]) => Promise<undefined>>(
  () => Promise.resolve(undefined),
);

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
    t: {
      videoExport: {
        nothingVisibleToExport: 'nothing visible',
        missingMaterials: 'missing {count}: {names}',
        blackTailNotice: 'black {seconds}',
        moreItems: 'and {count} more',
        exportFailedWithError: 'failed:',
        exportFailed: 'failed',
        exportTimeout: 'timeout',
        noContentToExportFull: 'no content',
        failedVideos: 'failed videos',
        recoverySuggestions: 'suggestions',
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
  video_items: Array<{ id: string; volume: number }>;
  audio_items: Array<{ id: string; volume: number }>;
}

function material(id: string, type: 'video' | 'audio'): MaterialItem {
  return {
    id,
    name: id,
    type,
    format: type === 'video' ? 'mp4' : 'mp3',
    size: 1000,
    url: `/api/storage/files/${type}/${id}`,
    createdAt: new Date(),
  } as MaterialItem;
}

function clip(
  id: string,
  type: 'video' | 'audio',
  materialId: string,
  patch: Partial<TimelineTrackItem> = {},
): TimelineTrackItem {
  return {
    id,
    name: id,
    type,
    materialId,
    trackId: `track-${id}`,
    startTime: 0,
    duration: 5,
    color: '#000',
    clipStart: 0,
    clipEnd: 5,
    originalDuration: 5,
    ...patch,
  };
}

function track(
  id: string,
  type: 'video' | 'audio',
  items: TimelineTrackItem[],
  patch: Partial<TimelineTrack> = {},
): TimelineTrack {
  return {
    id,
    name: id,
    type,
    height: 80,
    isLocked: false,
    isMuted: false,
    isVisible: true,
    volume: 100,
    order: 0,
    items,
    ...patch,
  };
}

function stateOf(tracks: TimelineTrack[]): TimelineState {
  return {
    currentTime: 0,
    totalDuration: 5,
    zoomLevel: 1,
    selectedItems: [],
    tracks,
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: false,
    gridSize: 1,
    scrollLeft: 0,
  };
}

function renderExport(tracks: TimelineTrack[], materials: MaterialItem[]) {
  return renderHook(() =>
    useVideoExport({
      timelineState: stateOf(tracks),
      materials,
      taskId: 'task-1',
      aspectRatio: '16:9',
    }),
  );
}

async function runExport(
  tracks: TimelineTrack[],
  materials: MaterialItem[],
): Promise<ExportRequest | undefined> {
  const { result } = renderExport(tracks, materials);
  await act(async () => {
    await result.current.handleExport();
  });
  const calls = composeVideo.mock.calls;
  return calls.length > 0
    ? (calls[calls.length - 1][0] as ExportRequest)
    : undefined;
}

const ids = (items: Array<{ id: string }> | undefined) =>
  (items ?? []).map((item) => item.id);

beforeEach(() => {
  composeVideo.mockClear();
  triggerDownload.mockClear();
  pollCompositionStatus.mockClear();
  showError.mockClear();
  showWarning.mockClear();
});

describe('useVideoExport track filters', () => {
  it('exports clips on locked tracks', async () => {
    const request = await runExport(
      [
        track('v', 'video', [clip('video-1', 'video', 'mv')], { isLocked: true }),
        track('a', 'audio', [clip('audio-1', 'audio', 'ma')], { isLocked: true }),
      ],
      [material('mv', 'video'), material('ma', 'audio')],
    );

    expect({
      video: ids(request?.video_items),
      audio: ids(request?.audio_items),
    }).toEqual({ video: ['video-1'], audio: ['audio-1'] });
  });

  it('counts locked video tracks as rendered picture', async () => {
    // A locked video track renders; it must neither be reported as "nothing
    // visible" nor produce a black-tail notice for audio of the same length.
    await runExport(
      [
        track('v', 'video', [clip('video-1', 'video', 'mv')], { isLocked: true }),
        track('a', 'audio', [clip('audio-1', 'audio', 'ma')]),
      ],
      [material('mv', 'video'), material('ma', 'audio')],
    );

    expect({ errors: showError.mock.calls, warnings: showWarning.mock.calls })
      .toEqual({ errors: [], warnings: [] });
  });

  it('skips muted audio tracks on export', async () => {
    const request = await runExport(
      [
        track('v', 'video', [clip('video-1', 'video', 'mv')]),
        track('muted', 'audio', [clip('audio-muted', 'audio', 'ma')], { isMuted: true }),
        track('live', 'audio', [clip('audio-live', 'audio', 'ma')]),
      ],
      [material('mv', 'video'), material('ma', 'audio')],
    );

    expect(ids(request?.audio_items)).toEqual(['audio-live']);
  });

  it('does not count muted audio items as missing materials', async () => {
    // The expected-audio count must use the build loop's guard; a muted track
    // whose material is gone must not block the export.
    await runExport(
      [
        track('v', 'video', [clip('video-1', 'video', 'mv')]),
        track('muted', 'audio', [clip('audio-gone', 'audio', 'missing')], {
          isMuted: true,
        }),
      ],
      [material('mv', 'video')],
    );

    expect(composeVideo).toHaveBeenCalledTimes(1);
  });
});

describe('useVideoExport volume', () => {
  it('exports a 0% track as silent', async () => {
    const request = await runExport(
      [
        track('v', 'video', [clip('video-1', 'video', 'mv')]),
        track('a', 'audio', [clip('audio-1', 'audio', 'ma')], { volume: 0 }),
      ],
      [material('mv', 'video'), material('ma', 'audio')],
    );

    expect(request?.audio_items[0].volume).toBe(0);
  });

  it('clamps exported item x track volume to 2', async () => {
    const request = await runExport(
      [
        track('v', 'video', [clip('video-1', 'video', 'mv', { volume: 2 })], {
          volume: 200,
        }),
      ],
      [material('mv', 'video')],
    );

    expect(request?.video_items[0].volume).toBe(2);
  });
});

describe('useVideoExport across unmount', () => {
  it('still downloads the file when the editor unmounts mid-poll', async () => {
    composeVideo.mockResolvedValueOnce({
      success: true,
      composition_id: 'comp-1',
      status: 'processing',
    });
    let finishPolling: () => void = () => {};
    let markPollingStarted: () => void = () => {};
    const pollingStarted = new Promise<void>((resolve) => {
      markPollingStarted = resolve;
    });
    pollCompositionStatus.mockImplementationOnce(() => {
      markPollingStarted();
      return new Promise<undefined>((resolve) => {
        finishPolling = () => resolve(undefined);
      });
    });

    const { result, unmount } = renderExport(
      [track('v', 'video', [clip('video-1', 'video', 'mv')])],
      [material('mv', 'video')],
    );
    let exportRun: Promise<void> = Promise.resolve();
    await act(async () => {
      exportRun = result.current.handleExport();
      await pollingStarted;
    });

    unmount();
    finishPolling();
    await exportRun;

    expect(triggerDownload).toHaveBeenCalledTimes(1);
    expect(triggerDownload.mock.calls[0][0]).toBe('comp-1');
  });
});

describe('useVideoExport failure messages', () => {
  async function exportWithPollingError(error: Error) {
    composeVideo.mockResolvedValueOnce({
      success: true,
      composition_id: 'comp-1',
      status: 'processing',
    });
    pollCompositionStatus.mockRejectedValueOnce(error);
    const { result } = renderExport(
      [track('v', 'video', [clip('video-1', 'video', 'mv')])],
      [material('mv', 'video')],
    );
    await act(async () => {
      await result.current.handleExport();
    });
  }

  it('keeps the backend reason when a failure message mentions a timeout', async () => {
    await exportWithPollingError(
      new Error('Composition failed: ffprobe timeout on clip 2'),
    );

    expect(showError).toHaveBeenCalledWith(
      'failed: Composition failed: ffprobe timeout on clip 2',
      15000,
    );
  });

  it('shows the timeout notice when polling gives up', async () => {
    const timeout = new Error('Composition polling timeout');
    timeout.name = 'TimeoutError';

    await exportWithPollingError(timeout);

    expect(showError).toHaveBeenCalledWith('timeout', 10000);
  });
});
