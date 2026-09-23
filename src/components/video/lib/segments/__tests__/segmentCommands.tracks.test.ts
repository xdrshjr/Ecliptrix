import { describe, expect, it } from 'vitest';
import {
  planSegmentRemoval,
  planSegmentReorder,
  planSegmentVisualReplace,
  planSegmentVoiceApply,
} from '../segmentCommands';
import type { SegmentCommandResult } from '../segmentCommands';
import { shiftItemsFrom } from '../segmentCommandGeometry';
import { stampMaterialForSegment } from '../stampMaterialForSegment';
import {
  baseTracks, clip, context, material, MATERIALS, SEGMENTS, track, voice,
} from './segmentFixtures';

const AT = '2026-09-23T10:00:00.000Z';
const stampCopy = (m: Parameters<typeof stampMaterialForSegment>[0], copyId: string) =>
  stampMaterialForSegment(m, {
    segmentId: 's2', segmentNumber: 2, videoIndexInSegment: 1, assignedAt: 1, segmentPrefix: '#{index}',
  }, copyId);

function allCommands(): SegmentCommandResult[] {
  const candidate = voice('v2b', SEGMENTS[1], 10, 5);
  const fresh = material('fresh', 'video', 30);
  const ctx = context(baseTracks(), [...MATERIALS, candidate, fresh]);
  return [
    planSegmentVoiceApply(ctx, { segmentId: 's2', candidate, lengthMode: 'adjust', appliedAt: AT }),
    planSegmentVisualReplace(ctx, { segmentId: 's2', material: fresh, copyId: 'copy', stampCopy }),
    planSegmentRemoval(ctx, { segmentId: 's2', removeTimelineItems: true }),
    planSegmentReorder(ctx, { segmentId: 's3', toIndex: 0 }),
  ];
}

describe('segment commands — shared lane rules', () => {
  it('T-CMD-BGM: the music lane keeps its object reference under all four commands', () => {
    const same = allCommands().map((result) => {
      if (!result.ok) return result.reason;
      const index = result.tracks.findIndex((t) => t.id === 'audio-track-2');
      return result.tracks[index] === result.baseTracks[index];
    });
    expect(same).toEqual([true, true, true, true]);
  });

  it('T-CMD-SHIFT-UNIFORM: a shrink uses one clamped value on every lane', () => {
    const tracks = [
      track('a', 'audio', [clip('a0', 'a', 'audio', 0, 4), clip('a1', 'a', 'audio', 10, 2)], 0),
      track('b', 'video', [clip('b0', 'b', 'video', 0, 9), clip('b1', 'b', 'video', 10, 2)], 1),
    ];
    const result = shiftItemsFrom(tracks, 10, -5, { eligibleTrackIds: new Set(['a', 'b']) });
    if (!result.ok) throw new Error('refused');
    expect({
      applied: result.applied,
      a: result.tracks[0].items[1].startTime,
      b: result.tracks[1].items[1].startTime,
    }).toEqual({ applied: -1, a: 9, b: 9 });
  });

  it('T-CMD-SHIFT-UNIFORM: a clip crossing the shift point makes a shrink interleaved', () => {
    const tracks = [
      track('a', 'audio', [clip('a0', 'a', 'audio', 8, 4), clip('a1', 'a', 'audio', 12, 2)], 0),
    ];
    expect(shiftItemsFrom(tracks, 10, -1, { eligibleTrackIds: new Set(['a']) }))
      .toEqual({ ok: false, reason: 'interleaved' });
  });
});

describe('planSegmentVisualReplace', () => {
  function replace(m = material('fresh', 'video', 30), tracks = baseTracks()) {
    return planSegmentVisualReplace(context(tracks, [...MATERIALS, m]), {
      segmentId: 's2', material: m, copyId: 'copy-1', stampCopy,
    });
  }

  it('T-CMD-VISUAL-1: a long material is trimmed to the span; other lanes are untouched', () => {
    const result = replace();
    if (!result.ok) throw new Error(result.reason);
    const main = result.tracks[0].items.map((i) => [i.materialId, i.startTime, i.duration]);
    const others = result.tracks.slice(1).every((t, index) => t === result.baseTracks[index + 1]);
    expect({ main, others, total: result.impact.totalDurationAfter })
      .toEqual({ main: [['m1', 0, 5], ['fresh', 5, 8], ['m3', 13, 6]], others: true, total: 19 });
  });

  it('T-CMD-VISUAL-2: a short material loops to fill the span', () => {
    const result = replace(material('short', 'video', 3));
    if (!result.ok) throw new Error(result.reason);
    const own = result.tracks[0].items.filter((i) => i.materialId === 'short')
      .map((i) => [i.startTime, i.duration]);
    expect(own).toEqual([[5, 3], [8, 3], [11, 2]]);
  });

  it('T-CMD-VISUAL-3: an image becomes one clip of the span', () => {
    const result = replace(material('pic', 'image', 5));
    if (!result.ok) throw new Error(result.reason);
    const own = result.tracks[0].items.filter((i) => i.materialId === 'pic')
      .map((i) => [i.startTime, i.duration]);
    expect(own).toEqual([[5, 8]]);
  });

  it('a video of unknown length is refused instead of looping forever', () => {
    const result = replace(material('unknown', 'video', 0));
    expect(result).toEqual({ ok: false, reason: 'nothing-to-do' });
  });

  it('T-CMD-VISUAL-4: an occupied span and a segment off the timeline are refused', () => {
    const occupied = baseTracks();
    occupied[0] = { ...occupied[0], items: [...occupied[0].items.filter((i) => i.id !== 'c2'),
      clip('loose', 'video-track-1', 'video', 6, 2, undefined)] };
    const offTimeline = baseTracks().map((t) => ({
      ...t, items: t.items.filter((i) => !['c2', 'a2'].includes(i.id)),
    }));
    expect([replace(undefined, occupied), replace(undefined, offTimeline)].map((r) => !r.ok && r.reason))
      .toEqual(['span-occupied', 'not-on-timeline']);
  });

  it('T-CMD-VISUAL-5: an unstamped material only links the new clips', () => {
    const fresh = material('fresh', 'video', 30);
    const result = replace(fresh);
    if (!result.ok) throw new Error(result.reason);
    const links = result.tracks[0].items.filter((i) => i.materialId === 'fresh')
      .map((i) => i.metadata?.linkedSegmentId);
    expect({ links, added: result.addedMaterials, materialMeta: fresh.metadata })
      .toEqual({ links: ['s2'], added: [], materialMeta: {} });
  });

  it('T-CMD-VISUAL-5: a material stamped for this segment is used directly', () => {
    const own = material('own', 'video', 30, { segment_id: 's2' });
    const result = replace(own);
    if (!result.ok) throw new Error(result.reason);
    expect({ added: result.addedMaterials.length, ids: result.tracks[0].items.map((i) => i.materialId) })
      .toEqual({ added: 0, ids: ['m1', 'own', 'm3'] });
  });

  it('T-CMD-VISUAL-5: a material stamped for another segment is copied, the original untouched', () => {
    const other = material('other', 'video', 30, { segment_id: 's1' });
    const result = replace(other);
    if (!result.ok) throw new Error(result.reason);
    expect({
      ids: result.tracks[0].items.map((i) => i.materialId),
      copyStamp: result.addedMaterials[0]?.metadata?.segment_id,
      original: other.metadata,
    }).toEqual({ ids: ['m1', 'copy-1', 'm3'], copyStamp: 's2', original: { segment_id: 's1' } });
  });
});

describe('planSegmentRemoval', () => {
  it('T-CMD-REMOVE-1: removes the segment clips (subtitles by start) without shifting later ones', () => {
    const result = planSegmentRemoval(context(), { segmentId: 's2', removeTimelineItems: true });
    if (!result.ok) throw new Error(result.reason);
    expect({
      ids: result.tracks.map((t) => t.items.map((i) => i.id)),
      removed: result.impact.removedItems.map((r) => r.count),
      gap: result.impact.gapSeconds,
      ops: result.scriptOps.map((op) => op.type),
    }).toEqual({
      ids: [['c1', 'c3'], ['a1', 'a3'], ['music'], ['t1', 't4']],
      removed: [1, 1, 2],
      gap: 8,
      ops: ['remove-segment'],
    });
  });

  it('T-CMD-REMOVE-2: without removeTimelineItems the tracks are the same list', () => {
    const ctx = context();
    const result = planSegmentRemoval(ctx, { segmentId: 's2', removeTimelineItems: false });
    if (!result.ok) throw new Error(result.reason);
    expect({ same: result.tracks === ctx.tracks, index: (result.scriptOps[0] as { index: number }).index })
      .toEqual({ same: true, index: 1 });
  });
});

describe('planSegmentReorder', () => {
  it('T-CMD-REORDER-1: moving s3 first moves its block and keeps gaps', () => {
    const result = planSegmentReorder(context(), { segmentId: 's3', toIndex: 0 });
    if (!result.ok) throw new Error(result.reason);
    const byId = (id: string) => result.tracks.flatMap((t) => t.items).find((i) => i.id === id)?.startTime;
    expect({
      c3: byId('c3'), a3: byId('a3'), t4: byId('t4'),
      c1: byId('c1'), c2: byId('c2'), t3: byId('t3'),
      music: byId('music'),
    }).toEqual({ c3: 0, a3: 0, t4: 0, c1: 6, c2: 11, t3: 15, music: 0 });
  });

  it('T-CMD-REORDER-2: interleaved blocks are refused', () => {
    const tracks = baseTracks();
    tracks[0] = { ...tracks[0], items: tracks[0].items.map((i) => (i.id === 'c2' ? { ...i, duration: 10 } : i)) };
    const result = planSegmentReorder(context(tracks), { segmentId: 's3', toIndex: 0 });
    expect(!result.ok && result.reason).toBe('interleaved');
  });

  it('T-CMD-REORDER-3: segments off the timeline only reorder the script', () => {
    const ctx = context([track('video-track-1', 'video', [], 0)]);
    const result = planSegmentReorder(ctx, { segmentId: 's3', toIndex: 0 });
    if (!result.ok) throw new Error(result.reason);
    expect({ same: result.tracks === result.baseTracks, ops: result.scriptOps }).toEqual({
      same: true,
      ops: [{ type: 'reorder', beforeOrder: ['s1', 's2', 's3'], afterOrder: ['s3', 's1', 's2'] }],
    });
  });

  it('refuses when a locked lane holds an involved segment', () => {
    const tracks = baseTracks().map((t) => (t.id === 'video-track-1' ? { ...t, isLocked: true } : t));
    const result = planSegmentReorder(context(tracks), { segmentId: 's3', toIndex: 0 });
    expect(!result.ok && result.reason).toBe('target-track-locked');
  });
});
