/**
 * TimelineRepository persistence round-trip tests (spec 06 §2.1 / §6).
 *
 * Covers the persistence contract:
 *   - A timeline with trim/split/transition/audio-detach/multi-track exports
 *     and re-imports with FULL restore (item count, clip interval,
 *     audioDetached, transitions, track order).
 *   - Old-data INV-3 regularization: an item whose persisted `duration`
 *     disagrees with `clipEnd - clipStart` is corrected once on import.
 *   - Selection + playback/history are NOT persisted (isSelected cleared,
 *     isPlaying false on import).
 *   - The waveform-inlining change: a fresh export NO LONGER writes item-level
 *     `waveformData`, but a legacy project that carries inline peaks still
 *     imports (read as a first-paint fallback) — new+old mixed round-trip.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimelineRepository } from '../TimelineRepository';
import type { TimelineExportData } from '../TimelineRepository';
import type { TimelineData, MaterialData } from '../../domain/types';
import type { ExportMetadata } from '../../domain/ports';

const META: ExportMetadata = {
  exportedAt: '2026-06-10T00:00:00.000Z',
  version: '1.0.0',
  taskId: 'task-1',
};

const MATERIALS: MaterialData[] = [
  {
    id: 'mat-vid',
    name: 'clip.mp4',
    type: 'video',
    duration: 10,
    thumbnailUrl: '/api/storage/files/video/poster.jpg',
    url: '/api/storage/files/video/clip.mp4',
  },
  {
    id: 'mat-aud',
    name: 'voice.mp3',
    type: 'audio',
    duration: 8,
    url: '/api/storage/files/audio/voice.mp3',
  },
];

/** A timeline exercising trim, split products, transitions, audio-detach and
 *  three track types (video + audio + subtitle). */
function buildTimeline(): TimelineData {
  return {
    currentTime: 3.2,
    totalDuration: 12,
    zoomLevel: 2,
    playbackRate: 1,
    isPlaying: true, // must be cleared on import
    snapToGrid: true,
    gridSize: 1,
    scrollLeft: 40,
    tracks: [
      {
        id: 'video-track-1',
        name: 'Video Track 1',
        type: 'video',
        height: 80,
        isLocked: false,
        isMuted: false,
        isVisible: true,
        volume: 100,
        order: 1,
        items: [
          // split LEFT product (trimmed): clip [2,5] dur 3
          {
            id: 'clip-left',
            name: 'clip.mp4',
            type: 'video',
            startTime: 0,
            duration: 3,
            trackId: 'video-track-1',
            color: '#111',
            materialId: 'mat-vid',
            clipStart: 2,
            clipEnd: 5,
            originalDuration: 10,
            opacity: 0.8,
            audioDetached: true,
            transitionIn: { type: 'fade', duration: 0.5 },
            cameraMotion: {
              presetId: 'orbit-left',
              space: '3d' as const,
              from: { scale: 1.1, offsetX: 0, offsetY: 0, roll: 0, yaw: -10, pitch: 0, dolly: 1 },
              to: { scale: 1.1, offsetX: 0, offsetY: 0, roll: 0, yaw: 10, pitch: 0, dolly: 1 },
              easing: 'ease-in-out' as const,
              startRatio: 0,
              endRatio: 1,
              intensity: 1,
            },
            isSelected: true, // must NOT persist
          },
          // split RIGHT product: clip [5,8] dur 3, with a trailing dissolve
          {
            id: 'clip-right',
            name: 'clip.mp4',
            type: 'video',
            startTime: 3,
            duration: 3,
            trackId: 'video-track-1',
            color: '#111',
            materialId: 'mat-vid',
            clipStart: 5,
            clipEnd: 8,
            originalDuration: 10,
            opacity: 1,
            transitionOut: { type: 'dissolve', duration: 0.75 },
          },
        ],
      },
      {
        id: 'audio-track-1',
        name: 'Audio Track 1',
        type: 'audio',
        height: 60,
        isLocked: false,
        isMuted: false,
        isVisible: true,
        volume: 90,
        order: 0, // lower order — different z than the video track
        items: [
          // detached audio item — same materialId/clip as the video item
          {
            id: 'audio-detached',
            name: 'clip.mp4',
            type: 'audio',
            startTime: 0,
            duration: 3,
            trackId: 'audio-track-1',
            color: '#222',
            materialId: 'mat-vid',
            clipStart: 2,
            clipEnd: 5,
            originalDuration: 10,
            volume: 1,
          },
        ],
      },
      {
        id: 'subtitle-track-1',
        name: 'Subtitle Track 1',
        type: 'subtitle',
        height: 40,
        isLocked: false,
        isMuted: false,
        isVisible: true,
        volume: 100,
        order: 2,
        items: [
          {
            id: 'sub-1',
            name: 'subtitle',
            type: 'subtitle',
            startTime: 0,
            duration: 4,
            trackId: 'subtitle-track-1',
            color: '#333',
            text: 'Hello world',
          },
        ],
      },
    ],
  };
}

/** Read an exported Blob back into a parsed object. */
async function blobToJson(blob: Blob): Promise<TimelineExportData> {
  return JSON.parse(await blob.text());
}

/** Wrap an export object as an importable File. */
function jsonToFile(obj: unknown): File {
  return new File([JSON.stringify(obj)], 'project.json', {
    type: 'application/json',
  });
}

describe('TimelineRepository persistence round-trip (spec 06)', () => {
  let repo: TimelineRepository;

  beforeEach(() => {
    repo = new TimelineRepository();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fully restores trim/split/transition/audio-detach/multi-track on round-trip', async () => {
    const { blob } = await repo.exportToJSON(buildTimeline(), MATERIALS, META);
    const file = jsonToFile(await blobToJson(blob));
    const { timelineData } = await repo.importFromJSON(file);

    // Track count + order preserved (z-order authority).
    expect(timelineData.tracks).toHaveLength(3);
    const byId = Object.fromEntries(timelineData.tracks.map((t) => [t.id, t]));
    expect(byId['audio-track-1'].order).toBe(0);
    expect(byId['video-track-1'].order).toBe(1);
    expect(byId['subtitle-track-1'].order).toBe(2);

    // Split products both restored with exact clip intervals.
    const videoItems = byId['video-track-1'].items;
    expect(videoItems.map((i) => i.id)).toEqual(['clip-left', 'clip-right']);
    const left = videoItems.find((i) => i.id === 'clip-left')!;
    const right = videoItems.find((i) => i.id === 'clip-right')!;
    expect([left.clipStart, left.clipEnd, left.duration]).toEqual([2, 5, 3]);
    expect([right.clipStart, right.clipEnd, right.duration]).toEqual([5, 8, 3]);

    // audioDetached + opacity + transitions restored.
    expect(left.audioDetached).toBe(true);
    expect(left.opacity).toBe(0.8);
    expect(left.transitionIn).toEqual({ type: 'fade', duration: 0.5 });
    expect(right.transitionOut).toEqual({ type: 'dissolve', duration: 0.75 });

    // Camera motion survives the export/import round-trip whole — dropping one
    // nested angle would leave a 3D move rendering as a flat one, with nothing
    // in the UI to indicate the project file lost it.
    expect(left.cameraMotion).toEqual({
      presetId: 'orbit-left',
      space: '3d',
      from: { scale: 1.1, offsetX: 0, offsetY: 0, roll: 0, yaw: -10, pitch: 0, dolly: 1 },
      to: { scale: 1.1, offsetX: 0, offsetY: 0, roll: 0, yaw: 10, pitch: 0, dolly: 1 },
      easing: 'ease-in-out',
      startRatio: 0,
      endRatio: 1,
      intensity: 1,
    });
    expect(right.cameraMotion).toBeUndefined();

    // Detached audio item (same materialId/clip) restored on the audio track.
    const audio = byId['audio-track-1'].items[0];
    expect(audio.materialId).toBe('mat-vid');
    expect([audio.clipStart, audio.clipEnd, audio.duration]).toEqual([2, 5, 3]);

    // Subtitle text restored.
    expect(byId['subtitle-track-1'].items[0].text).toBe('Hello world');
  });

  it('items store only materialId — no live preview URL is persisted', async () => {
    const { blob } = await repo.exportToJSON(buildTimeline(), MATERIALS, META);
    const exported = await blobToJson(blob);
    for (const track of exported.tracks) {
      for (const item of track.items) {
        expect(item.materialId === undefined || typeof item.materialId === 'string').toBe(true);
        // The serialized item shape carries no url/serverUrl/cacheUrl fields.
        expect((item as Record<string, unknown>).url).toBeUndefined();
        expect((item as Record<string, unknown>).serverUrl).toBeUndefined();
        expect((item as Record<string, unknown>).cacheUrl).toBeUndefined();
      }
    }
  });

  it('does NOT persist selection or playback state (spec 06 §2.1)', async () => {
    const { blob } = await repo.exportToJSON(buildTimeline(), MATERIALS, META);
    const file = jsonToFile(await blobToJson(blob));
    const { timelineData } = await repo.importFromJSON(file);

    expect(timelineData.isPlaying).toBe(false);
    const allItems = timelineData.tracks.flatMap((t) => t.items);
    expect(allItems.every((i) => i.isSelected === false)).toBe(true);
  });

  it('stops inlining waveformData on export (spec 06 §2.1)', async () => {
    // Plant an item carrying inline peaks; export must drop them.
    const tl = buildTimeline();
    tl.tracks[1].items[0].waveformData = [0.1, 0.2, 0.3, 0.4];

    const { blob } = await repo.exportToJSON(tl, MATERIALS, META);
    const exported = await blobToJson(blob);

    const exportedAudioItem = exported.tracks
      .flatMap((t) => t.items)
      .find((i) => i.id === 'audio-detached')!;
    expect(exportedAudioItem.waveformData).toBeUndefined();
  });

  it('tolerates legacy inline waveformData on import (first-paint fallback)', async () => {
    // A legacy export object that still carries inline peaks on an item.
    const { blob } = await repo.exportToJSON(buildTimeline(), MATERIALS, META);
    const legacy = await blobToJson(blob);
    const legacyAudio = legacy.tracks
      .flatMap((t) => t.items)
      .find((i) => i.id === 'audio-detached')!;
    legacyAudio.waveformData = [0.5, 0.6, 0.7];

    const { timelineData } = await repo.importFromJSON(jsonToFile(legacy));
    const imported = timelineData.tracks
      .flatMap((t) => t.items)
      .find((i) => i.id === 'audio-detached')!;
    // The legacy inline value is still read as a first-paint fallback.
    expect(imported.waveformData).toEqual([0.5, 0.6, 0.7]);
  });

  it('regularizes a legacy INV-3 violation on import (duration != clipEnd-clipStart)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { blob } = await repo.exportToJSON(buildTimeline(), MATERIALS, META);
    const broken = await blobToJson(blob);
    // Corrupt clip-left: clip span is 3 (=5-2) but persisted duration says 9.
    const brokenItem = broken.tracks
      .flatMap((t) => t.items)
      .find((i) => i.id === 'clip-left')!;
    brokenItem.duration = 9;

    const { timelineData } = await repo.importFromJSON(jsonToFile(broken));
    const fixed = timelineData.tracks
      .flatMap((t) => t.items)
      .find((i) => i.id === 'clip-left')!;
    // duration regularized to clipEnd - clipStart (3); startTime untouched.
    expect(fixed.duration).toBe(3);
    expect(fixed.startTime).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it('leaves a self-consistent item untouched (no false-positive regularize)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { blob } = await repo.exportToJSON(buildTimeline(), MATERIALS, META);
    const file = jsonToFile(await blobToJson(blob));
    const { timelineData } = await repo.importFromJSON(file);
    const right = timelineData.tracks
      .flatMap((t) => t.items)
      .find((i) => i.id === 'clip-right')!;
    expect(right.duration).toBe(3); // unchanged
    expect(warn).not.toHaveBeenCalled();
  });

  it('round-trips a NEW (no inline peaks) + OLD (inline peaks) mixed project', async () => {
    // Build a project where one item carries legacy inline peaks and the rest
    // do not — export (drops peaks) then import (tolerates the legacy field on
    // the doctored copy) must not error and must keep both.
    const { blob } = await repo.exportToJSON(buildTimeline(), MATERIALS, META);
    const mixed = await blobToJson(blob);
    mixed.tracks[1].items[0].waveformData = [0.9, 0.8]; // legacy inline on one

    const { timelineData } = await repo.importFromJSON(jsonToFile(mixed));
    const audio = timelineData.tracks
      .flatMap((t) => t.items)
      .find((i) => i.id === 'audio-detached')!;
    const videoLeft = timelineData.tracks
      .flatMap((t) => t.items)
      .find((i) => i.id === 'clip-left')!;
    expect(audio.waveformData).toEqual([0.9, 0.8]); // legacy survived
    expect(videoLeft.waveformData).toBeUndefined();  // new item has none
  });
});
