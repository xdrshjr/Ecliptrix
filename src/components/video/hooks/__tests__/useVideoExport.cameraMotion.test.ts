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
import { insertKeyframeAt, setKeyframeComponent } from '../../playback/camera/keyframes';

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

  // ── T12 / D38 — the curve is omitted unless there IS one ──────────────────

  it('T12 — a two-keyframe motion sends NO keyframes key at all', async () => {
    const request = await runExport(state(applyPreset('push-in', '2d')));
    const wire = request!.video_items[0].camera_motion;
    expect('keyframes' in wire).toBe(false);
    // …and the rest of the body is field-for-field what it always was, which is
    // what keeps "identical command line" usable as the primary release gate.
    expect(wire).toEqual({
      version: 1,
      mode: '2d',
      preset_id: 'push-in',
      intensity: 1,
      easing: 'easeInOut',
      start_offset: undefined,
      duration: undefined,
      start: { scale: 1, x: 0.5, y: 0.5, roll: 0, rotate_x: 0, rotate_y: 0, dolly: 0 },
      end: { scale: 1.25, x: 0.5, y: 0.5, roll: 0, rotate_x: 0, rotate_y: 0, dolly: 0 },
    });
  });

  it('T12 — a real curve is sent, ascending, in snake_case', async () => {
    const curved = insertKeyframeAt(
      setKeyframeComponent(insertKeyframeAt(applyPreset('orbit-left', '3d'), 0.4), 1, 'rotateY', 4),
      0.75,
    );
    expect(curved.keyframes).toHaveLength(4);
    const request = await runExport(state(curved));
    const wire = request!.video_items[0].camera_motion;
    expect(wire.keyframes).toHaveLength(4);
    const ats = wire.keyframes.map((stop: { at: number }) => stop.at);
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
    expect(ats[0]).toBe(0);
    expect(ats[ats.length - 1]).toBe(1);
    // snake_case, exactly like `start` / `end`.
    expect(wire.keyframes[1]).toHaveProperty('rotate_y');
    expect(wire.keyframes[1]).not.toHaveProperty('rotateY');
    // The D31 mirror survives the wire hop.
    expect(wire.keyframes[0].rotate_y).toBeCloseTo(wire.start.rotate_y, 9);
    expect(wire.keyframes[3].rotate_y).toBeCloseTo(wire.end.rotate_y, 9);
    // Only the last stop has no easing (D34).
    expect(wire.keyframes[3].easing).toBeUndefined();
    expect(wire.keyframes[0].easing).toBeTruthy();
  });

  it('T12 — a still carries its curve too', async () => {
    const curved = insertKeyframeAt(applyPreset('push-in', '2d'), 0.5);
    const request = await runExport(stillState(setKeyframeComponent(curved, 1, 'scale', 2)));
    expect(request!.image_items[0].camera_motion.keyframes).toHaveLength(3);
  });
});
