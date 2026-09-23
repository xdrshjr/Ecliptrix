/**
 * Shared fixture for the segment command tests: three narrated segments laid
 * end to end (s1 0–5, s2 5–13, s3 13–19) on a main visual lane, a narration
 * lane, a background-music lane and a subtitle lane.
 */

import type { MaterialItem, ScriptSegment } from '@/types';
import type { TimelineItemData, TrackData } from '@/components/video/timeline/domain';
import { segmentTextHash } from '../../aiMix/segmentTextHash';
import type { SegmentPlanContext } from '../segmentCommands';

export function segment(id: string, text: string, extra: Partial<ScriptSegment> = {}): ScriptSegment {
  return {
    id,
    title: `title-${id}`,
    narrationText: text,
    sentences: [{ id: `${id}-s1`, text }],
    ...extra,
  } as ScriptSegment;
}

export const SEGMENTS: ScriptSegment[] = [
  segment('s1', 'first segment text'),
  segment('s2', 'second segment text'),
  segment('s3', 'third segment text'),
];

export function material(
  id: string,
  type: MaterialItem['type'],
  duration: number,
  metadata: Record<string, unknown> = {},
): MaterialItem {
  return {
    id, name: id, type, format: type === 'audio' ? 'mp3' : 'mp4', size: 1, duration,
    url: `/api/storage/files/${id}`, createdAt: new Date(0), metadata,
  } as MaterialItem;
}

export function voice(id: string, seg: ScriptSegment, duration: number, assignedAt = 1): MaterialItem {
  return material(id, 'audio', duration, {
    segment_id: seg.id, segment_text_hash: segmentTextHash(seg), segment_assigned_at: assignedAt,
  });
}

export const MATERIALS: MaterialItem[] = [
  voice('v1', SEGMENTS[0], 5),
  voice('v2', SEGMENTS[1], 8),
  voice('v3', SEGMENTS[2], 6),
  material('m1', 'video', 20, { segment_id: 's1' }),
  material('m2', 'video', 20, { segment_id: 's2' }),
  material('m3', 'video', 20, { segment_id: 's3' }),
  material('bgm', 'audio', 60),
];

export function clip(
  id: string,
  trackId: string,
  type: TimelineItemData['type'],
  startTime: number,
  duration: number,
  materialId?: string,
  extra: Partial<TimelineItemData> = {},
): TimelineItemData {
  return {
    id, name: id, type, startTime, duration, trackId, color: '#000', materialId,
    clipStart: 0, clipEnd: duration, originalDuration: materialId ? 20 : undefined, ...extra,
  };
}

export function track(
  id: string,
  type: TrackData['type'],
  items: TimelineItemData[],
  order: number,
  extra: Partial<TrackData> = {},
): TrackData {
  return {
    id, name: '', type, height: 60, isLocked: false, isMuted: false, isVisible: true,
    volume: 100, items, order, ...extra,
  };
}

export function baseTracks(): TrackData[] {
  return [
    track('video-track-1', 'video', [
      clip('c1', 'video-track-1', 'video', 0, 5, 'm1'),
      clip('c2', 'video-track-1', 'video', 5, 8, 'm2'),
      clip('c3', 'video-track-1', 'video', 13, 6, 'm3'),
    ], 0),
    track('audio-track-1', 'audio', [
      clip('a1', 'audio-track-1', 'audio', 0, 5, 'v1'),
      clip('a2', 'audio-track-1', 'audio', 5, 8, 'v2'),
      clip('a3', 'audio-track-1', 'audio', 13, 6, 'v3'),
    ], 1),
    track('audio-track-2', 'audio', [clip('music', 'audio-track-2', 'audio', 0, 19, 'bgm')], 2),
    track('subtitle-track-1', 'subtitle', [
      clip('t1', 'subtitle-track-1', 'subtitle', 0, 2),
      clip('t2', 'subtitle-track-1', 'subtitle', 5, 3),
      clip('t3', 'subtitle-track-1', 'subtitle', 9, 2),
      clip('t4', 'subtitle-track-1', 'subtitle', 13, 3),
    ], 3),
  ];
}

export function context(
  tracks: TrackData[] = baseTracks(),
  materials: MaterialItem[] = MATERIALS,
  segments: ScriptSegment[] = SEGMENTS,
): SegmentPlanContext {
  return { tracks, materialsById: new Map(materials.map((m) => [m.id, m])), segments };
}

export function itemsOf(tracks: readonly TrackData[], trackId: string) {
  const found = tracks.find((t) => t.id === trackId);
  return (found?.items ?? []).map((item) => ({
    id: item.id, start: item.startTime, dur: item.duration, materialId: item.materialId,
  }));
}

export function starts(tracks: readonly TrackData[], trackId: string): number[] {
  return itemsOf(tracks, trackId).map((item) => item.start);
}
