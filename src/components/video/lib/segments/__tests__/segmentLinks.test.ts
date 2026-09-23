import { describe, expect, it } from 'vitest';
import type { MaterialItem, ScriptSegment } from '@/types';
import { segmentTextHash } from '../../aiMix/segmentTextHash';
import {
  buildMaterialsById,
  buildSegmentIndex,
  computeSegmentTimeRange,
  deriveSegmentStatus,
  findPlayingSegmentId,
  resolveItemSegmentId,
  type LinkableItem,
  type LinkableTrack,
} from '../segmentLinks';

const segment: ScriptSegment = {
  id: 'seg-2',
  title: '活泼天性',
  sentences: [{ id: 's1', text: '它总是精力充沛。' }],
};

function material(id: string, patch: Partial<MaterialItem> = {}): MaterialItem {
  return {
    id, name: id, type: 'audio', format: 'mp3', size: 1, url: `/f/${id}`,
    createdAt: new Date(0), ...patch,
  };
}

function voice(id: string, assignedAt: number, hash: string | undefined): MaterialItem {
  const metadata: Record<string, unknown> = { segment_id: 'seg-2', segment_assigned_at: assignedAt };
  if (hash !== undefined) metadata.segment_text_hash = hash;
  return material(id, { metadata });
}

function item(id: string, patch: Partial<LinkableItem>): LinkableItem {
  return { id, type: 'video', startTime: 0, duration: 1, ...patch };
}

function track(id: string, type: string, items: LinkableItem[]): LinkableTrack {
  return { id, type, items };
}

const noMaterials = new Map<string, MaterialItem>();

describe('segmentLinks', () => {
  it('label_pads_ordinal_to_two_digits', () => {
    const index = buildSegmentIndex([{ ...segment, id: 'a', title: '丝滑亮相' }, segment]);
    expect(index.get('a')?.label).toBe('01 丝滑亮相');
    expect(index.get('seg-2')?.badge).toBe('02');
  });

  it('resolves_segment_from_sentence_segments_first', () => {
    const materials = buildMaterialsById([material('m', { metadata: { segment_id: 'other' } })]);
    const linked = item('i', { materialId: 'm', sentenceSegments: { segment_id: 'seg-2' } });
    expect(resolveItemSegmentId(linked, materials)).toBe('seg-2');
  });

  it('falls_back_to_material_metadata_segment_id', () => {
    const materials = buildMaterialsById([material('m', { metadata: { segment_id: 'seg-2' } })]);
    expect(resolveItemSegmentId(item('i', { materialId: 'm' }), materials)).toBe('seg-2');
  });

  it('returns_null_for_unlinked_item', () => {
    expect(resolveItemSegmentId(item('i', { materialId: 'x' }), noMaterials)).toBeNull();
  });

  it('time_range_prefers_narration_audio_items', () => {
    const tracks = [
      track('video-track-1', 'video', [item('v', { startTime: 0, duration: 20, metadata: { linkedSegmentId: 'seg-2' } })]),
      track('audio-track-1', 'audio', [item('a', {
        type: 'audio', startTime: 3, duration: 8, sentenceSegments: { segment_id: 'seg-2' },
      })]),
    ];
    expect(computeSegmentTimeRange(tracks, noMaterials, 'seg-2')).toEqual({ start: 3, end: 11 });
  });

  it('voice_stale_when_text_hash_differs', () => {
    const status = deriveSegmentStatus({
      segment, materials: [voice('v1', 1, 'deadbeef')], tracks: [], isConverting: false,
    });
    expect(status.voice).toBe('stale');
  });

  it('voice_ready_when_hash_matches', () => {
    const status = deriveSegmentStatus({
      segment, materials: [voice('v1', 1, segmentTextHash(segment))], tracks: [], isConverting: false,
    });
    expect(status.voice).toBe('ready');
  });

  it('voice_ready_when_legacy_material_has_no_hash', () => {
    const status = deriveSegmentStatus({
      segment, materials: [voice('v1', 1, undefined)], tracks: [], isConverting: false,
    });
    expect(status.voice).toBe('ready');
  });

  it('voice_generating_while_converting', () => {
    const status = deriveSegmentStatus({ segment, materials: [], tracks: [], isConverting: true });
    expect(status.voice).toBe('generating');
  });

  it('voice_on_timeline_outdated_when_newer_voice_only_in_library', () => {
    const hash = segmentTextHash(segment);
    const tracks = [track('audio-track-1', 'audio', [item('a', { type: 'audio', materialId: 'old' })])];
    const status = deriveSegmentStatus({
      segment, materials: [voice('old', 1, 'stale'), voice('new', 2, hash)], tracks, isConverting: false,
    });
    expect([status.voice, status.voiceOnTimeline]).toEqual(['ready', 'outdated']);
  });

  it('voice_on_timeline_current_when_latest_voice_is_on_track', () => {
    const tracks = [track('audio-track-1', 'audio', [item('a', { type: 'audio', materialId: 'new' })])];
    const status = deriveSegmentStatus({
      segment, materials: [voice('old', 1, undefined), voice('new', 2, undefined)], tracks, isConverting: false,
    });
    expect(status.voiceOnTimeline).toBe('current');
  });

  it('voice_on_timeline_absent_without_narration_item', () => {
    const status = deriveSegmentStatus({
      segment, materials: [voice('new', 2, undefined)], tracks: [], isConverting: false,
    });
    expect(status.voiceOnTimeline).toBe('absent');
  });

  it('subtitle_ready_only_when_overlapping_segment_range', () => {
    const narration = track('audio-track-1', 'audio', [item('a', {
      type: 'audio', startTime: 10, duration: 5, sentenceSegments: { segment_id: 'seg-2' },
    })]);
    const before = track('subtitle-track-1', 'subtitle', [item('s', { type: 'subtitle', startTime: 0, duration: 10 })]);
    const inside = track('subtitle-track-1', 'subtitle', [item('s', { type: 'subtitle', startTime: 12, duration: 1 })]);
    const statusOf = (sub: LinkableTrack) =>
      deriveSegmentStatus({ segment, materials: [], tracks: [narration, sub], isConverting: false }).subtitle;
    expect([statusOf(before), statusOf(inside)]).toEqual(['none', 'ready']);
  });

  it('visual_configured_from_linked_timeline_video', () => {
    const tracks = [track('video-track-1', 'video', [item('v', { metadata: { linkedSegmentId: 'seg-2' } })])];
    expect(deriveSegmentStatus({ segment, materials: [], tracks, isConverting: false }).visual)
      .toBe('configured');
  });

  it('playing_segment_is_null_between_ranges', () => {
    const ranges = new Map([['a', { start: 0, end: 5 }], ['b', { start: 8, end: 12 }]]);
    expect([findPlayingSegmentId(ranges, 3), findPlayingSegmentId(ranges, 6), findPlayingSegmentId(ranges, 8)])
      .toEqual(['a', null, 'b']);
  });
});
