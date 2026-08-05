/**
 * TimelineRepository — camera-motion JSON round-trip + sanitation (spec §9.1).
 *
 * Project JSON is user-editable and therefore untrusted (R11): the import gate
 * must clamp ranges, drop unknown structure versions, and never let a hostile
 * number reach an FFmpeg filter expression.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TimelineRepository } from '../TimelineRepository';
import { applyPreset } from '../../../playback/camera/cameraPresets';
import type { TimelineData, MaterialData } from '../../domain/types';
import type { ExportMetadata } from '../../domain/ports';

const META: ExportMetadata = {
  exportedAt: '2026-08-05T00:00:00.000Z',
  version: '1.0.0',
  taskId: 'task-camera',
};

const MATERIALS: MaterialData[] = [
  { id: 'mat-vid', name: 'clip.mp4', type: 'video', duration: 10, url: '/api/storage/files/clip.mp4' },
];

function buildTimeline(cameraMotion: unknown): TimelineData {
  return {
    currentTime: 0,
    totalDuration: 6,
    zoomLevel: 1,
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: true,
    gridSize: 1,
    scrollLeft: 0,
    tracks: [
      {
        id: 'video-track-1',
        name: 'Video 1',
        type: 'video',
        height: 60,
        isLocked: false,
        isMuted: false,
        isVisible: true,
        volume: 100,
        order: 0,
        items: [
          {
            id: 'clip-1',
            name: 'clip.mp4',
            type: 'video',
            startTime: 0,
            duration: 6,
            trackId: 'video-track-1',
            color: '#4A90D9',
            materialId: 'mat-vid',
            clipStart: 0,
            clipEnd: 6,
            originalDuration: 10,
            cameraMotion: cameraMotion as never,
          },
        ],
      },
    ],
  };
}

async function blobToJson(blob: Blob): Promise<unknown> {
  return JSON.parse(await blob.text());
}

function jsonToFile(json: unknown): File {
  return new File([JSON.stringify(json)], 'project.json', { type: 'application/json' });
}

describe('TimelineRepository — camera motion', () => {
  let repo: TimelineRepository;

  beforeEach(() => {
    repo = new TimelineRepository();
  });

  async function roundTrip(motion: unknown) {
    const { blob } = await repo.exportToJSON(buildTimeline(motion), MATERIALS, META);
    const raw = (await blobToJson(blob)) as { tracks: Array<{ items: Array<Record<string, unknown>> }> };
    const { timelineData } = await repo.importFromJSON(jsonToFile(raw));
    return { raw, item: timelineData.tracks[0].items[0] };
  }

  it('round-trips a preset motion field for field', async () => {
    const motion = applyPreset('orbit-left', '3d');
    const { raw, item } = await roundTrip(motion);
    expect(raw.tracks[0].items[0].cameraMotion).toBeTruthy();
    expect(item.cameraMotion).toEqual(motion);
  });

  it('round-trips an explicit window (including a negative offset)', async () => {
    const motion = { ...applyPreset('push-in', '2d'), startOffset: -2, duration: 6 };
    const { item } = await roundTrip(motion);
    expect(item.cameraMotion!.startOffset).toBe(-2);
    expect(item.cameraMotion!.duration).toBe(6);
  });

  it('leaves the field absent for a clip without a motion', async () => {
    const { item } = await roundTrip(undefined);
    expect(item.cameraMotion).toBeUndefined();
  });

  it('clamps an out-of-range value from hand-edited JSON', async () => {
    const { item } = await roundTrip({
      version: 1,
      mode: '2d',
      presetId: 'custom',
      intensity: 99,
      easing: 'easeInOut',
      start: { scale: 99, x: -5, y: 7, roll: 900, rotateX: 0, rotateY: 0, dolly: 0 },
      end: { scale: 1, x: 0.5, y: 0.5, roll: 0, rotateX: 0, rotateY: 0, dolly: 0 },
    });
    expect(item.cameraMotion!.intensity).toBe(2);
    expect(item.cameraMotion!.start.scale).toBe(4);
    expect(item.cameraMotion!.start.x).toBe(0);
    expect(item.cameraMotion!.start.y).toBe(1);
    expect(item.cameraMotion!.start.roll).toBe(45);
  });

  it('drops an unknown structure version rather than half-migrating it', async () => {
    const { item } = await roundTrip({ ...applyPreset('push-in', '2d'), version: 2 });
    expect(item.cameraMotion).toBeUndefined();
  });

  it('zeroes 3D components carried on a 2D motion', async () => {
    const { item } = await roundTrip({
      ...applyPreset('push-in', '2d'),
      start: { scale: 1, x: 0.5, y: 0.5, roll: 0, rotateX: 20, rotateY: 30, dolly: 0.4 },
    });
    expect(item.cameraMotion!.start.rotateX).toBe(0);
    expect(item.cameraMotion!.start.rotateY).toBe(0);
    expect(item.cameraMotion!.start.dolly).toBe(0);
  });

  it('survives a garbage payload without throwing', async () => {
    const { item } = await roundTrip('not-an-object');
    expect(item.cameraMotion).toBeUndefined();
  });

  it('fills missing keyframe fields with the defaults', async () => {
    const { item } = await roundTrip({
      version: 1,
      mode: '2d',
      presetId: 'custom',
      intensity: 1,
      easing: 'linear',
      start: { scale: 1.5 },
      end: {},
    });
    expect(item.cameraMotion!.start.scale).toBe(1.5);
    expect(item.cameraMotion!.start.x).toBe(0.5);
    expect(item.cameraMotion!.end.scale).toBe(1);
  });
});
