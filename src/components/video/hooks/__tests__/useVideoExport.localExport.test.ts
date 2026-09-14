/**
 * useVideoExport — local-export request safety + multi-track fields
 * (spec 05 §2.2 / §6 cases 1–2).
 *
 * Pins that the export composition request:
 *   1. selects each item URL via selectPlaybackUrl(export) → same-origin local
 *      /api/storage/files/... ONLY; never blob: / media-proxy / preview-proxy;
 *   2. carries the new multi-track / transition fields (track_z, opacity,
 *      transition_in/out, audio_detached) with correct values.
 *
 * The hook does a dynamic `import('@/lib/api/videoComposition')`; we mock that
 * module to capture the composeVideo request without touching the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { TimelineState, MaterialItem } from '@/types';

// --- Capture the composition request the hook sends ------------------------

const composeVideo = vi.fn((_req: unknown) =>
  Promise.resolve({ success: true, composition_id: 'comp-1', status: 'completed' }),
);
const triggerDownload = vi.fn((..._args: unknown[]) => Promise.resolve(undefined));
const pollCompositionStatus = vi.fn((..._args: unknown[]) => Promise.resolve(undefined));

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
      },
    },
  }),
}));

import { useVideoExport } from '../useVideoExport';

function mat(patch: Partial<MaterialItem>): MaterialItem {
  return {
    id: 'm',
    name: 'm',
    type: 'video',
    format: 'mp4',
    size: 1000,
    url: '',
    createdAt: new Date(),
    ...patch,
  } as MaterialItem;
}

function videoTrack(order: number, items: TimelineState['tracks'][number]['items']) {
  return {
    id: `track-${order}`,
    name: `Video ${order}`,
    type: 'video' as const,
    height: 80,
    isLocked: false,
    isMuted: false,
    isVisible: true,
    volume: 100,
    order,
    items,
  };
}

function baseState(tracks: TimelineState['tracks']): TimelineState {
  return {
    currentTime: 0,
    totalDuration: 10,
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

async function runExport(state: TimelineState, materials: MaterialItem[]) {
  const { result } = renderHook(() =>
    useVideoExport({ timelineState: state, materials, taskId: 'task-1', aspectRatio: '16:9' }),
  );
  await act(async () => {
    await result.current.handleExport();
  });
  const calls = composeVideo.mock.calls;
  return calls.length > 0 ? (calls[calls.length - 1][0] as any) : undefined;
}

describe('useVideoExport local export request', () => {
  beforeEach(() => {
    composeVideo.mockClear();
    triggerDownload.mockClear();
    pollCompositionStatus.mockClear();
    showError.mockClear();
    showWarning.mockClear();
  });
  afterEach(() => vi.clearAllTimers());

  it('selects same-origin local /api/storage/files URLs, never blob/proxy', async () => {
    const material = mat({
      id: 'mat-1',
      type: 'video',
      // Preview-only fields the export MUST ignore:
      url: 'blob:http://localhost/stale',
      serverUrl: '/api/media/proxy?u=https%3A%2F%2Fcdn.example.com%2Fv.mp4',
      // The canonical local reference the export MUST pick:
      metadata: {
        storageKind: 'local',
        isLocalFile: true,
        localResolvedUrl: '/api/storage/files/video/local.mp4',
      },
    });
    const state = baseState([
      videoTrack(0, [
        {
          id: 'item-1',
          name: 'Clip',
          type: 'video',
          materialId: 'mat-1',
          trackId: 'track-0',
          startTime: 0,
          duration: 5,
          color: '#2563eb',
          clipStart: 0,
          clipEnd: 5,
          originalDuration: 5,
        },
      ]),
    ]);

    const request = await runExport(state, [material]);

    expect(request).toBeTruthy();
    expect(request.video_items).toHaveLength(1);
    const url: string = request.video_items[0].url;
    expect(url).toContain('/api/storage/files/video/local.mp4');
    const serialized = JSON.stringify(request);
    expect(serialized).not.toContain('blob:');
    expect(serialized).not.toContain('/api/media/proxy');
    expect(serialized).not.toContain('preview-proxies');
  });

  it('relativises an absolute loopback video URL so the export body has no loopback host', async () => {
    // §3.4: a clip export / persisted project can leave an ABSOLUTE
    // http://127.0.0.1:PORT/api/storage/files/... in metadata.localResolvedUrl.
    // The packaged desktop origin is 127.0.0.1, so the export must strip it to
    // a relative path or the backend SSRF guard rejects the whole request.
    const material = mat({
      id: 'mat-loopback',
      type: 'video',
      metadata: {
        storageKind: 'local',
        isLocalFile: true,
        localResolvedUrl:
          'http://127.0.0.1:18320/api/storage/files/video/local.mp4',
      },
    });
    const state = baseState([
      videoTrack(0, [
        {
          id: 'item-1',
          name: 'Clip',
          type: 'video',
          materialId: 'mat-loopback',
          trackId: 'track-0',
          startTime: 0,
          duration: 5,
          color: '#2563eb',
          clipStart: 0,
          clipEnd: 5,
          originalDuration: 5,
        },
      ]),
    ]);

    const request = await runExport(state, [material]);

    expect(request).toBeTruthy();
    expect(request.video_items[0].url).toBe('/api/storage/files/video/local.mp4');
    expect(JSON.stringify(request)).not.toContain('127.0.0.1');
  });

  it('relativises an absolute loopback audio serverUrl (audio_items leg of the invariant)', async () => {
    // audio_items is built by selectAudioPlaybackUrl, NOT selectPlaybackUrl, so
    // it never absolutised — but the backend guard still inspects it. An
    // absolute loopback serverUrl must be relativised at the export point too.
    const audio = mat({
      id: 'mat-audio',
      type: 'audio',
      serverUrl: 'http://127.0.0.1:18320/api/storage/files/audio/local.mp3',
    });
    const state = baseState([
      {
        id: 'track-audio',
        name: 'Audio',
        type: 'audio' as const,
        height: 60,
        isLocked: false,
        isMuted: false,
        isVisible: true,
        volume: 100,
        order: 0,
        items: [
          {
            id: 'item-audio',
            name: 'Audio clip',
            type: 'audio',
            materialId: 'mat-audio',
            trackId: 'track-audio',
            startTime: 0,
            duration: 5,
            color: '#16a34a',
            clipStart: 0,
            clipEnd: 5,
            originalDuration: 5,
          },
        ],
      },
      // A video track at least as long as the audio so export validation passes.
      videoTrack(1, [
        {
          id: 'item-video',
          name: 'Clip',
          type: 'video',
          materialId: 'mat-video',
          trackId: 'track-1',
          startTime: 0,
          duration: 5,
          color: '#2563eb',
          clipStart: 0,
          clipEnd: 5,
          originalDuration: 5,
        },
      ]),
    ]);
    const video = mat({
      id: 'mat-video',
      type: 'video',
      url: '/api/storage/files/video/v.mp4',
    });

    const request = await runExport(state, [audio, video]);

    expect(request).toBeTruthy();
    expect(request.audio_items).toHaveLength(1);
    expect(request.audio_items[0].url).toBe('/api/storage/files/audio/local.mp3');
    expect(JSON.stringify(request)).not.toContain('127.0.0.1');
  });

  it('forwards track_z, opacity, transition_in/out and audio_detached', async () => {
    const bottom = mat({
      id: 'mat-bottom',
      type: 'video',
      url: '/api/storage/files/video/bottom.mp4',
    });
    const top = mat({
      id: 'mat-top',
      type: 'video',
      url: '/api/storage/files/video/top.mp4',
    });
    const state = baseState([
      videoTrack(0, [
        {
          id: 'item-bottom',
          name: 'Bottom',
          type: 'video',
          materialId: 'mat-bottom',
          trackId: 'track-0',
          startTime: 0,
          duration: 6,
          color: '#000',
          clipStart: 0,
          clipEnd: 6,
          originalDuration: 6,
          opacity: 1,
        },
      ]),
      videoTrack(1, [
        {
          id: 'item-top',
          name: 'Top',
          type: 'video',
          materialId: 'mat-top',
          trackId: 'track-1',
          startTime: 0,
          duration: 6,
          color: '#000',
          clipStart: 0,
          clipEnd: 6,
          originalDuration: 6,
          opacity: 0.5,
          audioDetached: true,
          transitionIn: { type: 'fade', duration: 0.5 },
          transitionOut: { type: 'dissolve', duration: 1.0 },
        },
      ]),
    ]);

    const request = await runExport(state, [bottom, top]);

    const byId = Object.fromEntries(
      request.video_items.map((v: any) => [v.id, v]),
    );
    // Bottom track → track_z 0 (drawn first); top track → track_z 1 (overlaid).
    expect(byId['item-bottom'].track_z).toBe(0);
    expect(byId['item-top'].track_z).toBe(1);
    expect(byId['item-top'].opacity).toBe(0.5);
    expect(byId['item-top'].audio_detached).toBe(true);
    expect(byId['item-top'].transition_in).toEqual({ type: 'fade', duration: 0.5 });
    expect(byId['item-top'].transition_out).toEqual({ type: 'dissolve', duration: 1.0 });
    // Bottom is fully opaque, not detached, no transitions.
    expect(byId['item-bottom'].opacity).toBe(1);
    expect(byId['item-bottom'].audio_detached).toBeUndefined();
    expect(byId['item-bottom'].transition_in).toBeUndefined();
  });
});
