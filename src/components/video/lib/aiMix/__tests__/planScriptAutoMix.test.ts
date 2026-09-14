import { describe, it, expect } from 'vitest';
import type { MaterialItem } from '@/types';
import { planScriptAutoMix } from '../planScriptAutoMix';
import type { ScriptAutoMixPlan } from '../planScriptAutoMix';
import { repairInheritedSegmentMembership } from '../../derivedMaterial';

interface ScriptMaterialOptions {
  id: string;
  segment: number;
  duration: number;
  slot?: number;
  createdAt?: string;
  assignedAt?: number;
  textHash?: string;
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
      ...(options.textHash !== undefined
        ? { segment_text_hash: options.textHash }
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

const videoIds = (plan: ScriptAutoMixPlan) => Array.from(new Set(
  plan.placements
    .filter((placement) => placement.lane === 'video')
    .map((placement) => placement.material.id),
));

/** Every video clip starts where the previous one ended; returns the lane end. */
function contiguousVideoEnd(plan: ScriptAutoMixPlan): number | 'hole' {
  let cursor = 0;
  for (const placement of plan.placements.filter((p) => p.lane === 'video')) {
    if (Math.abs(placement.startTime - cursor) > 1e-6) return 'hole';
    cursor = placement.startTime + placement.duration;
  }
  return Math.round(cursor * 1e6) / 1e6;
}

describe('planScriptAutoMix · AS2-01 re-matching', () => {
  const rematched = [
    voice({ id: 'tts', segment: 1, duration: 9, assignedAt: 500 }),
    footage({ id: 'v1', segment: 1, duration: 3, slot: 1, assignedAt: 1000 }),
    footage({ id: 'v2', segment: 1, duration: 3, slot: 2, assignedAt: 1000 }),
    footage({ id: 'v3', segment: 1, duration: 3, slot: 3, assignedAt: 1000 }),
    footage({ id: 'v4', segment: 1, duration: 3, slot: 1, assignedAt: 2000 }),
  ];

  it('drops videos of an earlier larger match when the segment is re-matched with fewer videos', () => {
    const plan = planScriptAutoMix(rematched);

    expect({ videos: videoIds(plan), ignored: plan.ignoredDuplicateMaterialIds })
      .toEqual({ videos: ['v4'], ignored: ['v1', 'v2', 'v3'] });
  });

  it('uses exactly the videos the script segment lists when a script is given', () => {
    const plan = planScriptAutoMix(rematched, {
      segments: [{ id: 'segment-1', videos: [{ id: 'v4' }] }],
    });

    expect({ videos: videoIds(plan), ignored: plan.ignoredDuplicateMaterialIds })
      .toEqual({ videos: ['v4'], ignored: ['v1', 'v2', 'v3'] });
  });
});

describe('planScriptAutoMix · AS2-02 current script', () => {
  const library = [
    voice({ id: 'tts-1', segment: 1, duration: 2 }),
    footage({ id: 'video-1', segment: 1, duration: 6 }),
    voice({ id: 'tts-2', segment: 2, duration: 3 }),
    footage({ id: 'video-2', segment: 2, duration: 6 }),
    voice({ id: 'tts-3', segment: 3, duration: 4 }),
    footage({ id: 'video-3', segment: 3, duration: 6 }),
  ];

  it('orders segments by the current script and renumbers them', () => {
    const plan = planScriptAutoMix(library, {
      segments: [{ id: 'segment-3' }, { id: 'segment-1' }],
    });

    expect({
      audio: laneTimings(plan, 'audio'),
      reports: plan.segments.map(({ segmentId, segmentNumber }) => [segmentId, segmentNumber]),
    }).toEqual({
      audio: [['tts-3', 0, 4], ['tts-1', 4, 2]],
      reports: [['segment-3', 1], ['segment-1', 2]],
    });
  });

  it('ignores materials of segments no longer in the script and reports them as orphaned', () => {
    const plan = planScriptAutoMix(library, {
      segments: [{ id: 'segment-1' }, { id: 'segment-3' }],
    });

    expect({
      audio: laneTimings(plan, 'audio').map(([id]) => id),
      orphaned: plan.orphanedMaterialIds,
    }).toEqual({ audio: ['tts-1', 'tts-3'], orphaned: ['tts-2', 'video-2'] });
  });

  it('does not report a video a current segment still shows as ignored or orphaned', () => {
    // An AI match lists library videos without re-tagging them: shown-by-2
    // still carries deleted segment 1's id, shown-by-3 carries segment 2's.
    const plan = planScriptAutoMix([
      voice({ id: 'tts-2', segment: 2, duration: 3 }),
      voice({ id: 'tts-3', segment: 3, duration: 3 }),
      footage({ id: 'shown-by-2', segment: 1, duration: 6 }),
      footage({ id: 'shown-by-3', segment: 2, duration: 6 }),
    ], {
      segments: [
        { id: 'segment-2', videos: [{ id: 'shown-by-2' }] },
        { id: 'segment-3', videos: [{ id: 'shown-by-3' }] },
      ],
    });

    expect({
      videos: videoIds(plan),
      ignored: plan.ignoredDuplicateMaterialIds,
      orphaned: plan.orphanedMaterialIds,
    }).toEqual({ videos: ['shown-by-2', 'shown-by-3'], ignored: [], orphaned: [] });
  });

  it('reports a script segment without any material as skipped', () => {
    const plan = planScriptAutoMix(library.slice(0, 2), {
      segments: [{ id: 'segment-1' }, { id: 'segment-new' }],
    });

    expect(plan.segments.map((segment) => segment.status))
      .toEqual(['placed', 'skipped-no-audio']);
  });

  it('keeps the legacy grouping when no script is given', () => {
    const legacy = planScriptAutoMix(library);

    expect({
      same: planScriptAutoMix(library, {}),
      audio: laneTimings(legacy, 'audio').map(([id]) => id),
      orphaned: legacy.orphanedMaterialIds,
    }).toEqual({
      same: legacy,
      audio: ['tts-1', 'tts-2', 'tts-3'],
      orphaned: [],
    });
  });

  it('ignores a voice-over whose text hash no longer matches the segment', () => {
    const plan = planScriptAutoMix([
      voice({ id: 'tts-stale', segment: 1, duration: 3, textHash: 'aaaaaaaa' }),
      footage({ id: 'video-1', segment: 1, duration: 6 }),
    ], { segments: [{ id: 'segment-1', textHash: 'bbbbbbbb' }] });

    expect({
      status: plan.segments[0].status,
      audio: laneTimings(plan, 'audio'),
      orphaned: plan.orphanedMaterialIds,
    }).toEqual({ status: 'skipped-no-audio', audio: [], orphaned: ['tts-stale'] });
  });

  it('keeps a legacy voice-over without a text hash', () => {
    const plan = planScriptAutoMix([
      voice({ id: 'tts-legacy', segment: 1, duration: 3 }),
      footage({ id: 'video-1', segment: 1, duration: 6 }),
    ], { segments: [{ id: 'segment-1', textHash: 'bbbbbbbb' }] });

    expect(laneTimings(plan, 'audio')).toEqual([['tts-legacy', 0, 3]]);
  });
});

describe('planScriptAutoMix · AS2-03 video coverage', () => {
  it('covers a long voice-over with a short video without leaving a hole', () => {
    const plan = planScriptAutoMix([
      voice({ id: 'tts', segment: 1, duration: 60 }),
      footage({ id: 'short', segment: 1, duration: 0.7 }),
    ]);

    expect({ end: contiguousVideoEnd(plan), status: plan.segments[0].status })
      .toEqual({ end: 60, status: 'video-looped' });
  });

  it('leaves no sub-0.1 s residue at a segment end', () => {
    const plan = planScriptAutoMix([
      voice({ id: 'tts', segment: 1, duration: 10.05 }),
      footage({ id: 'long', segment: 1, duration: 10 }),
    ]);

    expect({ video: laneTimings(plan, 'video'), end: contiguousVideoEnd(plan) }).toEqual({
      video: [['long', 0, 9.95], ['long', 9.95, 0.1]],
      end: 10.05,
    });
  });

  it('reports video-short when the residue cannot be covered', () => {
    const plan = planScriptAutoMix([
      voice({ id: 'tts', segment: 1, duration: 0.15 }),
      footage({ id: 'blip', segment: 1, duration: 0.12 }),
    ]);

    expect(plan.segments[0].status).toBe('video-short');
  });
});

describe('planScriptAutoMix · AM3-01 / N-13', () => {
  it('a video-only plan reports a segment without videos as skipped-no-video', () => {
    const plan = planScriptAutoMix([
      footage({ id: 'v1', segment: 1, duration: 3 }),
      footage({ id: 'v3', segment: 3, duration: 4 }),
    ], {
      segments: [
        { id: 'segment-1', videos: [{ id: 'v1' }] },
        { id: 'segment-2' },
        { id: 'segment-3', videos: [{ id: 'v3' }] },
      ],
    });

    expect({
      statuses: plan.segments.map((segment) => segment.status),
      video: laneTimings(plan, 'video'),
    }).toEqual({
      statuses: ['placed', 'skipped-no-video', 'placed'],
      video: [['v1', 0, 3], ['v3', 3, 4]],
    });
  });

  it('a repaired cut clip does not take its original legacy slot', () => {
    const original = footage({ id: 'V', segment: 1, duration: 20, slot: 1, assignedAt: 1000 });
    const cutClip: MaterialItem = {
      ...original,
      id: 'V_clip_c1',
      duration: 3,
      createdAt: new Date('2026-09-02T00:00:00Z'),
      metadata: { ...original.metadata, isClip: true, originalMaterialId: 'V' },
    };
    const { materials } = repairInheritedSegmentMembership([
      original,
      voice({ id: 'A', segment: 1, duration: 10, assignedAt: 1000 }),
      cutClip,
    ]);

    const plan = planScriptAutoMix(materials);

    expect({ videos: videoIds(plan), ignored: plan.ignoredDuplicateMaterialIds })
      .toEqual({ videos: ['V'], ignored: [] });
  });
});
