import { describe, it, expect } from 'vitest';
import type { MaterialItem } from '@/types';
import { planScriptAutoMix } from '../planScriptAutoMix';
import type { ScriptAutoMixPlan } from '../planScriptAutoMix';

interface ScriptMaterialOptions {
  id: string;
  segment: number;
  duration: number;
  slot?: number;
  createdAt?: string;
  assignedAt?: number;
}

function scriptMaterial(
  type: 'audio' | 'video',
  options: ScriptMaterialOptions,
): MaterialItem {
  return {
    id: options.id,
    name: options.id,
    type,
    format: type === 'audio' ? 'mp3' : 'mp4',
    size: 1,
    duration: options.duration,
    url: `/api/storage/files/${options.id}`,
    createdAt: new Date(options.createdAt ?? '2026-09-01T00:00:00Z'),
    metadata: {
      segment_id: `segment-${options.segment}`,
      segment_number: options.segment,
      ...(options.slot !== undefined
        ? { video_index_in_segment: options.slot }
        : {}),
      ...(options.assignedAt !== undefined
        ? { segment_assigned_at: options.assignedAt }
        : {}),
    },
  };
}

const voice = (options: ScriptMaterialOptions) =>
  scriptMaterial('audio', options);
const footage = (options: ScriptMaterialOptions) =>
  scriptMaterial('video', options);

function laneTimings(plan: ScriptAutoMixPlan, lane: 'audio' | 'video') {
  return plan.placements
    .filter((placement) => placement.lane === lane)
    .map(({ material, startTime, duration }) =>
      [material.id, startTime, duration]);
}

describe('planScriptAutoMix', () => {
  it('uses the most recently added TTS audio per segment (array order, not createdAt)', () => {
    const plan = planScriptAutoMix([
      voice({ id: 'tts-old', segment: 1, duration: 4,
        createdAt: '2026-09-10T00:00:00Z' }),
      voice({ id: 'tts-new', segment: 1, duration: 3,
        createdAt: '2026-01-01T00:00:00Z' }),
    ]);

    expect(laneTimings(plan, 'audio')).toEqual([['tts-new', 0, 3]]);
  });

  it('keeps the most recently matched video per video_index_in_segment even when its createdAt is older', () => {
    const plan = planScriptAutoMix([
      voice({ id: 'tts', segment: 1, duration: 4 }),
      footage({ id: 'match-old', segment: 1, duration: 10, slot: 1,
        createdAt: '2026-09-10T00:00:00Z' }),
      footage({ id: 'match-new', segment: 1, duration: 10, slot: 1,
        createdAt: '2020-01-01T00:00:00Z' }),
    ]);

    expect(laneTimings(plan, 'video')).toEqual([['match-new', 0, 4]]);
  });

  it('keeps a re-match that reused an earlier library id (replaced in place, not appended)', () => {
    const plan = planScriptAutoMix([
      footage({ id: 'local-upload', segment: 1, duration: 10, slot: 1,
        assignedAt: 2000 }),
      voice({ id: 'tts', segment: 1, duration: 4, assignedAt: 1500 }),
      footage({ id: 'earlier-match', segment: 1, duration: 10, slot: 1,
        assignedAt: 1000 }),
    ]);

    expect(laneTimings(plan, 'video')).toEqual([['local-upload', 0, 4]]);
  });

  it('reports superseded versions as ignored duplicates', () => {
    const plan = planScriptAutoMix([
      voice({ id: 'tts-old', segment: 1, duration: 4 }),
      footage({ id: 'match-old', segment: 1, duration: 10, slot: 1 }),
      voice({ id: 'tts-new', segment: 1, duration: 3 }),
      footage({ id: 'match-new', segment: 1, duration: 10, slot: 1 }),
    ]);

    expect(plan.ignoredDuplicateMaterialIds).toEqual(['tts-old', 'match-old']);
  });

  it('trims video to the segment voice-over so segment k+1 starts in sync', () => {
    const plan = planScriptAutoMix([
      voice({ id: 'tts-1', segment: 1, duration: 4 }),
      footage({ id: 'video-1', segment: 1, duration: 10 }),
      voice({ id: 'tts-2', segment: 2, duration: 3 }),
      footage({ id: 'video-2', segment: 2, duration: 5 }),
    ]);

    expect({
      audio: laneTimings(plan, 'audio'),
      video: laneTimings(plan, 'video'),
    }).toEqual({
      audio: [['tts-1', 0, 4], ['tts-2', 4, 3]],
      video: [['video-1', 0, 4], ['video-2', 4, 3]],
    });
  });

  it('loops segment videos when they are shorter than the voice-over', () => {
    const plan = planScriptAutoMix([
      voice({ id: 'tts', segment: 1, duration: 5 }),
      footage({ id: 'short', segment: 1, duration: 2 }),
    ]);

    expect({
      video: laneTimings(plan, 'video'),
      status: plan.segments[0].status,
    }).toEqual({
      video: [['short', 0, 2], ['short', 2, 2], ['short', 4, 1]],
      status: 'video-looped',
    });
  });

  it('reuses the previous segment video when a segment has none', () => {
    const plan = planScriptAutoMix([
      voice({ id: 'tts-1', segment: 1, duration: 2 }),
      footage({ id: 'video-1', segment: 1, duration: 6 }),
      voice({ id: 'tts-2', segment: 2, duration: 2 }),
    ]);

    expect({
      video: laneTimings(plan, 'video'),
      report: plan.segments[1],
    }).toEqual({
      video: [['video-1', 0, 2], ['video-1', 2, 2]],
      report: {
        segmentId: 'segment-2',
        segmentNumber: 2,
        status: 'video-reused',
        reusedFromSegment: 1,
      },
    });
  });

  it('skips segments without voice-over and reports them', () => {
    const plan = planScriptAutoMix([
      voice({ id: 'tts-1', segment: 1, duration: 2 }),
      footage({ id: 'video-1', segment: 1, duration: 6 }),
      footage({ id: 'video-2', segment: 2, duration: 6 }),
      voice({ id: 'tts-3', segment: 3, duration: 3 }),
      footage({ id: 'video-3', segment: 3, duration: 6 }),
    ]);

    expect({
      statuses: plan.segments.map((segment) => segment.status),
      audio: laneTimings(plan, 'audio'),
    }).toEqual({
      statuses: ['placed', 'skipped-no-audio', 'placed'],
      audio: [['tts-1', 0, 2], ['tts-3', 2, 3]],
    });
  });

  it('lays videos end to end when no segment has a voice-over', () => {
    const plan = planScriptAutoMix([
      footage({ id: 'video-2', segment: 2, duration: 3 }),
      footage({ id: 'video-1', segment: 1, duration: 5 }),
    ]);

    expect(laneTimings(plan, 'video'))
      .toEqual([['video-1', 0, 5], ['video-2', 5, 3]]);
  });

  it('produces the same plan for the same input', () => {
    const materials = [
      voice({ id: 'tts-1', segment: 1, duration: 4.3 }),
      footage({ id: 'video-1', segment: 1, duration: 1.7, slot: 2 }),
      footage({ id: 'video-0', segment: 1, duration: 2.1, slot: 1 }),
      voice({ id: 'tts-2', segment: 2, duration: 2.2 }),
    ];

    expect(planScriptAutoMix(materials)).toEqual(planScriptAutoMix(materials));
  });
});
