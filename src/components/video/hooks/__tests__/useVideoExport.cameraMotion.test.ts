/**
 * useVideoExport — camera_motion in the request + the W4 warnings channel
 * (spec §4.4.1 / §4.4.5).
 *
 * The warnings half is the end-to-end half of P0-3: composition is ASYNC, so a
 * degrade recorded during normalization can only reach the user through the
 * status poll. A hook that reads warnings off the compose response would always
 * see an empty list and G7 would fail silently.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { TimelineState, MaterialItem } from '@/types';
import { applyPreset } from '../../playback/camera/cameraPresets';

const composeVideo = vi.fn((_req: unknown) =>
  Promise.resolve({ success: true, composition_id: 'comp-1', status: 'processing' }),
);
const triggerDownload = vi.fn((..._args: unknown[]) => Promise.resolve(undefined));
/** Replays a status sequence into the hook's poll callback. */
let statusUpdates: Array<Record<string, unknown>> = [];
const pollCompositionStatus = vi.fn(
  async (_id: string, onProgress?: (status: Record<string, unknown>) => void) => {
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
    t: {
      videoExport: {
        videoTrackTooShort: 'too short',
        videoTrackDuration: 'video',
        audioTrackDuration: 'audio',
        needToAdd: 'add',
        exportFailedWithError: 'failed:',
        exportFailed: 'failed',
        exportTimeout: 'timeout',
        noContentToExportFull: 'no content',
        failedVideos: 'failed videos',
        recoverySuggestions: 'suggestions',
        exportCompletedButDownloadFailed: 'download failed',
        compositionWarningsTitle: 'Some clips rendered differently:',
      },
    },
  }),
}));

import { useVideoExport } from '../useVideoExport';

function material(): MaterialItem {
  return {
    id: 'mat-1',
    name: 'clip.mp4',
    type: 'video',
    format: 'mp4',
    size: 1000,
    url: '',
    createdAt: new Date(),
    metadata: {
      storageKind: 'local',
      isLocalFile: true,
      localResolvedUrl: '/api/storage/files/video/clip.mp4',
    },
  } as MaterialItem;
}

function state(cameraMotion?: unknown): TimelineState {
  return {
    currentTime: 0,
    totalDuration: 6,
    zoomLevel: 1,
    selectedItems: [],
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: false,
    gridSize: 1,
    scrollLeft: 0,
    tracks: [
      {
        id: 'track-0',
        name: 'Video 1',
        type: 'video',
        height: 80,
        isLocked: false,
        isMuted: false,
        isVisible: true,
        volume: 100,
        order: 0,
        items: [
          {
            id: 'item-1',
            name: 'Clip',
            type: 'video',
            materialId: 'mat-1',
            trackId: 'track-0',
            startTime: 0,
            duration: 6,
            color: '#2563eb',
            clipStart: 0,
            clipEnd: 6,
            originalDuration: 6,
            cameraMotion: cameraMotion as never,
          },
        ],
      },
    ],
  } as TimelineState;
}

function stillMaterial(): MaterialItem {
  return {
    id: 'mat-img',
    name: 'storyboard-03.png',
    type: 'image',
    format: 'png',
    size: 1000,
    url: '/api/storage/files/images/storyboard-03.png',
    createdAt: new Date(),
    metadata: {
      storageKind: 'local',
      isLocalFile: true,
      localResolvedUrl: '/api/storage/files/images/storyboard-03.png',
    },
  } as MaterialItem;
}

/** A video clip (so the export validates) plus one still on the same track. */
function stillState(cameraMotion?: unknown): TimelineState {
  const base = state(undefined);
  base.tracks[0].items.push({
    id: 'item-still',
    name: 'storyboard-03.png',
    type: 'video',
    materialId: 'mat-img',
    trackId: 'track-0',
    startTime: 1.6,
    duration: 4,
    color: '#2563eb',
    originalMaterialType: 'image',
    imagePosition: { x: 0, y: 0, width: 1, height: 1, zIndex: 10 },
    cameraMotion: cameraMotion as never,
  } as never);
  return base;
}

async function runExport(timelineState: TimelineState) {
  const { result } = renderHook(() =>
    useVideoExport({
      timelineState,
      materials: [material(), stillMaterial()],
      taskId: 'task-1',
      aspectRatio: '16:9',
    }),
  );
  await act(async () => {
    await result.current.handleExport();
  });
  const calls = composeVideo.mock.calls;
  return calls.length > 0 ? (calls[calls.length - 1][0] as Record<string, any>) : undefined;
}

describe('useVideoExport — camera motion', () => {
  beforeEach(() => {
    composeVideo.mockClear();
    triggerDownload.mockClear();
    pollCompositionStatus.mockClear();
    showError.mockClear();
    showWarning.mockClear();
    statusUpdates = [];
  });

  it('omits camera_motion for a clip without a motion', async () => {
    const request = await runExport(state(undefined));
    expect(request).toBeTruthy();
    expect(request!.video_items[0].camera_motion).toBeUndefined();
  });

  it('sends the snake_cased motion for a configured clip', async () => {
    const request = await runExport(state(applyPreset('orbit-left', '3d')));
    const wire = request!.video_items[0].camera_motion;
    expect(wire.mode).toBe('3d');
    expect(wire.preset_id).toBe('orbit-left');
    expect(wire.start.rotate_y).toBeCloseTo(10, 6);
    expect(wire.end.rotate_y).toBeCloseTo(-10, 6);
  });

  it('omits camera_motion for a still without a motion (zero regression)', async () => {
    const request = await runExport(stillState(undefined));
    expect(request!.image_items).toHaveLength(1);
    expect(request!.image_items[0].camera_motion).toBeUndefined();
    expect('camera_motion' in request!.image_items[0]).toBe(false);
  });

  it('sends the snake_cased motion for a still (camera-motion-stills §4.4.1)', async () => {
    const request = await runExport(stillState(applyPreset('orbit-left', '3d')));
    const wire = request!.image_items[0].camera_motion;
    // Same wire, same clamping, same everything as a video clip: a still is not
    // a second kind of camera motion.
    expect(wire.mode).toBe('3d');
    expect(wire.preset_id).toBe('orbit-left');
    expect(wire.start.rotate_y).toBeCloseTo(10, 6);
    expect(wire.end.rotate_y).toBeCloseTo(-10, 6);
    expect(wire.version).toBe(1);
  });

  it('sends a 2D still motion with its scale endpoints intact', async () => {
    const request = await runExport(stillState(applyPreset('push-in', '2d')));
    const wire = request!.image_items[0].camera_motion;
    expect(wire.mode).toBe('2d');
    expect(wire.start.scale).toBeCloseTo(1, 6);
    expect(wire.end.scale).toBeCloseTo(1.25, 6);
  });

  it('surfaces status-channel warnings after a successful export (W4)', async () => {
    statusUpdates = [
      { progress: 0.4, status: 'processing', warnings: [] },
      { progress: 0.8, status: 'processing', warnings: ['clip A: 3D motion rendered as 2D'] },
      { progress: 1, status: 'completed', warnings: ['clip A: 3D motion rendered as 2D'] },
    ];
    await runExport(state(applyPreset('orbit-left', '3d')));
    expect(showWarning).toHaveBeenCalled();
    const warnCalls = showWarning.mock.calls;
    const message = warnCalls[warnCalls.length - 1][0] as string;
    expect(message).toContain('Some clips rendered differently:');
    expect(message).toContain('clip A: 3D motion rendered as 2D');
    // De-duplicated across polls — the same line must not repeat.
    expect(message.match(/clip A/g)).toHaveLength(1);
    // Export still succeeded: this is a notice, not a failure.
    expect(showError).not.toHaveBeenCalled();
  });

  it('does not warn when the status channel is clean', async () => {
    statusUpdates = [{ progress: 1, status: 'completed', warnings: [] }];
    await runExport(state(applyPreset('push-in', '2d')));
    expect(showWarning).not.toHaveBeenCalled();
  });

  it('tolerates a backend that omits the warnings field entirely', async () => {
    statusUpdates = [{ progress: 1, status: 'completed' }];
    await runExport(state(applyPreset('push-in', '2d')));
    expect(showWarning).not.toHaveBeenCalled();
  });
});
