import { describe, it, expect } from 'vitest';
import type {
  TimelineData,
  TimelineItemData,
  TrackData,
} from '@/components/video/timeline/domain';
import type { TimelineState } from '@/types';
import { findOrganizeDrift } from '@/test/organizeFixedPoint';
import { mergeAiMixTimeline } from '../mergeAiMixTimeline';

function clip(
  id: string,
  trackId: string,
  startTime: number,
  duration: number,
  overrides: Partial<TimelineItemData> = {},
): TimelineItemData {
  const type = trackId.startsWith('audio') ? 'audio' : 'video';
  return {
    id,
    name: id,
    type,
    startTime,
    duration,
    trackId,
    color: '#3b82f6',
    materialId: type === 'audio' ? 'material-audio' : 'material-video',
    ...overrides,
  };
}

function lane(
  id: string,
  items: TimelineItemData[] = [],
  overrides: Partial<TrackData> = {},
): TrackData {
  const type = id.startsWith('audio')
    ? 'audio'
    : id.startsWith('subtitle') ? 'subtitle' : 'video';
  return {
    id,
    name: id,
    type,
    height: 60,
    isLocked: false,
    isMuted: false,
    isVisible: true,
    volume: 100,
    order: 0,
    items,
    ...overrides,
  };
}

function timeline(tracks: TrackData[]): TimelineData {
  return {
    currentTime: 3,
    totalDuration: 99,
    zoomLevel: 2,
    playbackRate: 1,
    isPlaying: true,
    snapToGrid: true,
    gridSize: 0.5,
    scrollLeft: 40,
    tracks,
  };
}

function plan(tracks: TrackData[]): TimelineState {
  return { ...timeline(tracks), selectedItems: [] };
}

const knownMaterialIds = new Set([
  'material-video',
  'material-audio',
  'material-image',
]);

function merge(current: TrackData[], imported: TrackData[]) {
  return mergeAiMixTimeline({
    current: timeline(current),
    imported: plan(imported),
    knownMaterialIds,
  });
}

function trackById(data: TimelineData, id: string): TrackData | undefined {
  return data.tracks.find((track) => track.id === id);
}

describe('mergeAiMixTimeline', () => {
  it('keeps subtitle and untouched audio tracks when merging an AI plan', () => {
    const subtitles = lane('subtitle-track-1',
      [clip('sub-1', 'subtitle-track-1', 0, 2, { type: 'subtitle' })]);
    const music = lane('audio-track-2', [clip('bgm-1', 'audio-track-2', 0, 30)]);
    const result = merge(
      [lane('video-track-1', [clip('user-1', 'video-track-1', 0, 4)]),
        lane('audio-track-1'), music, subtitles],
      [lane('video-track-1', [clip('ai-1', 'video-track-1', 0, 5)]),
        lane('audio-track-1', [clip('ai-voice', 'audio-track-1', 0, 5)])],
    );

    expect([
      trackById(result.timeline, 'subtitle-track-1'),
      trackById(result.timeline, 'audio-track-2'),
    ]).toEqual([subtitles, music]);
  });

  it('never copies AI video items onto a user-added video track', () => {
    const result = merge(
      [lane('video-track-1', [], { order: 0 }),
        lane('video-track-2', [clip('user-2', 'video-track-2', 0, 3)],
          { order: 1 })],
      [lane('video-track-1', [clip('ai-1', 'video-track-1', 0, 5)])],
    );

    const ids = result.timeline.tracks
      .map((track) => [track.id, track.items.map((item) => item.id)]);
    expect(ids).toEqual([
      ['video-track-1', ['ai-1']],
      ['video-track-2', ['user-2']],
    ]);
  });

  it('maps imported audio-track-2 onto audio-track-2 instead of flattening', () => {
    const result = merge(
      [lane('audio-track-1', [], { order: 0 }),
        lane('audio-track-2', [], { order: 1 })],
      [lane('audio-track-1', [clip('voice', 'audio-track-1', 0, 8)]),
        lane('audio-track-2', [clip('bgm', 'audio-track-2', 0, 8)])],
    );

    const ids = result.timeline.tracks
      .map((track) => [track.id, track.items.map((item) => item.id)]);
    expect(ids).toEqual([
      ['audio-track-1', ['voice']],
      ['audio-track-2', ['bgm']],
    ]);
  });

  it('keeps two AI audio lanes apart when only audio-track-2 exists', () => {
    const result = merge(
      [lane('audio-track-2', [], { order: 0 })],
      [lane('audio-track-1', [clip('voice', 'audio-track-1', 0, 8)]),
        lane('audio-track-2', [clip('bgm', 'audio-track-2', 0, 8)])],
    );

    const ids = result.timeline.tracks
      .map((track) => [track.id, track.items.map((item) => item.id)]);
    expect(ids).toEqual([
      ['audio-track-2', ['bgm']],
      ['audio-track-1', ['voice']],
    ]);
  });

  it('renames item ids that collide with preserved tracks', () => {
    const result = merge(
      [lane('video-track-1'),
        lane('subtitle-track-1',
          [clip('clip-1', 'subtitle-track-1', 0, 2, { type: 'subtitle' })])],
      [lane('video-track-1', [clip('clip-1', 'video-track-1', 0, 5)])],
    );

    expect(result.renamedItemIds).toEqual({ 'clip-1': 'clip-1-2' });
  });

  it('drops items whose material is unknown', () => {
    const result = merge(
      [lane('video-track-1')],
      [lane('video-track-1', [
        clip('ai-1', 'video-track-1', 0, 5),
        clip('ghost', 'video-track-1', 5, 5, { materialId: 'deleted' }),
      ])],
    );

    expect(result.droppedItems)
      .toEqual([{ itemId: 'ghost', reason: 'unknown-material' }]);
  });

  it('drops items shorter than the minimum clip length', () => {
    const result = merge(
      [lane('video-track-1')],
      [lane('video-track-1', [
        clip('ai-1', 'video-track-1', 0, 5),
        clip('blip', 'video-track-1', 5, 0),
      ])],
    );

    expect(result.droppedItems).toEqual([{ itemId: 'blip', reason: 'too-short' }]);
  });

  it('skips locked target tracks', () => {
    const locked = lane('video-track-1',
      [clip('user-1', 'video-track-1', 0, 4)], { isLocked: true });
    const result = merge(
      [locked],
      [lane('video-track-1', [clip('ai-1', 'video-track-1', 0, 5)])],
    );

    expect({
      skipped: result.skippedLockedTrackIds,
      track: trackById(result.timeline, 'video-track-1'),
    }).toEqual({ skipped: ['video-track-1'], track: locked });
  });

  it('keeps the existing lane when every AI clip on it was dropped', () => {
    const userLane = lane('video-track-1', [clip('user-1', 'video-track-1', 0, 4)]);
    const result = merge(
      [userLane],
      [lane('video-track-1',
        [clip('ghost', 'video-track-1', 0, 5, { materialId: 'deleted' })])],
    );

    expect(trackById(result.timeline, 'video-track-1')).toEqual(userLane);
  });

  it('creates the image track when the timeline has none', () => {
    const result = merge(
      [lane('video-track-1', [], { order: 3 })],
      [lane('image-track-1', [clip('ai-image', 'image-track-1', 0, 5,
        { materialId: 'material-image', originalMaterialType: 'image' })])],
    );

    expect({
      created: result.createdTrackIds,
      track: trackById(result.timeline, 'image-track-1'),
    }).toMatchObject({
      created: ['image-track-1'],
      track: { type: 'video', order: 4, isLocked: false, volume: 100 },
    });
  });

  it('pushes a clip that starts inside its predecessor to that clip\'s end', () => {
    const result = merge(
      [lane('video-track-1')],
      [lane('video-track-1', [
        clip('second', 'video-track-1', 3, 2),
        clip('first', 'video-track-1', 0, 4),
      ])],
    );

    const placed = trackById(result.timeline, 'video-track-1')?.items
      .map((item) => [item.id, item.startTime]);
    expect(placed).toEqual([['first', 0], ['second', 4]]);
  });

  it('recomputes totalDuration across all tracks', () => {
    const result = merge(
      [lane('video-track-1'),
        lane('subtitle-track-1',
          [clip('sub-1', 'subtitle-track-1', 20, 10, { type: 'subtitle' })])],
      [lane('video-track-1', [clip('ai-1', 'video-track-1', 0, 12)])],
    );

    expect(result.timeline.totalDuration).toBe(30);
  });

  it('packs every AI lane so a later auto-organize changes nothing', () => {
    const image = { materialId: 'material-image', originalMaterialType: 'image' as const };
    const result = merge(
      [lane('video-track-1', [], { order: 0 }),
        lane('audio-track-1', [], { order: 1 }),
        lane('audio-track-2', [], { order: 2 })],
      [lane('video-track-1', [
        clip('v1', 'video-track-1', 0, 30.5),
        clip('v2', 'video-track-1', 35, 25),
      ]),
      lane('image-track-1', [clip('image', 'image-track-1', 55.5, 5, image)]),
      lane('audio-track-1', [
        clip('voice-1', 'audio-track-1', 0, 55.5),
        clip('voice-2', 'audio-track-1', 60, 5),
      ]),
      lane('audio-track-2', [clip('bgm', 'audio-track-2', 2, 61)])],
    );

    expect(findOrganizeDrift(result.timeline)).toEqual([]);
  });

  it('reports packed item ids', () => {
    const result = merge(
      [lane('video-track-1')],
      [lane('video-track-1', [
        clip('ai-1', 'video-track-1', 0, 4),
        clip('ai-2', 'video-track-1', 6, 2),
      ])],
    );

    expect({
      packed: result.packedItemIds,
      starts: trackById(result.timeline, 'video-track-1')?.items
        .map((item) => [item.id, item.startTime]),
    }).toEqual({ packed: ['ai-2'], starts: [['ai-1', 0], ['ai-2', 4]] });
  });

  it('gives a non-numbered AI audio track its own lane', () => {
    const result = merge(
      [lane('audio-track-1', [], { order: 0 }),
        lane('audio-track-2', [], { order: 1 })],
      [lane('audio-track-1', [clip('voice', 'audio-track-1', 0, 8)]),
        lane('audio-track-bgm', [clip('bgm', 'audio-track-bgm', 0, 8)])],
    );

    const ids = result.timeline.tracks
      .map((track) => [track.id, track.items.map((item) => item.id)]);
    expect(ids).toEqual([
      ['audio-track-1', ['voice']],
      ['audio-track-2', ['bgm']],
    ]);
  });

  it('creates AI lanes without a hard-coded track name', () => {
    const result = merge(
      [lane('video-track-1')],
      [lane('image-track-1',
        [clip('ai-image', 'image-track-1', 0, 5,
          { materialId: 'material-image', originalMaterialType: 'image' })],
        { name: 'Image Track' }),
      lane('audio-track-2',
        [clip('bgm', 'audio-track-2', 0, 5)],
        { name: 'Audio Track bgm' })],
    );

    expect(result.createdTrackIds.map((id) => trackById(result.timeline, id)?.name))
      .toEqual(['', '']);
  });
});
