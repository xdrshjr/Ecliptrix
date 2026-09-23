import { describe, expect, it } from 'vitest';
import { planSegmentVoiceApply } from '../segmentCommands';
import type { SegmentCommandPlan } from '../segmentCommands';
import {
  baseTracks, clip, context, itemsOf, MATERIALS, SEGMENTS, segment, starts, track, voice,
} from './segmentFixtures';

const AT = '2026-09-23T10:00:00.000Z';

function planWith(candidateDuration: number, lengthMode: 'adjust' | 'keep' = 'adjust') {
  const candidate = voice('v2b', SEGMENTS[1], candidateDuration, 5);
  const ctx = context(baseTracks(), [...MATERIALS, candidate]);
  return planSegmentVoiceApply(ctx, { segmentId: 's2', candidate, lengthMode, appliedAt: AT });
}

function ok(result: ReturnType<typeof planWith>): SegmentCommandPlan {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result;
}

describe('planSegmentVoiceApply', () => {
  it('T-CMD-VOICE-1: a 2 s longer voice shifts later segments by 2 s and extends the picture', () => {
    const plan = ok(planWith(10));
    const narration = itemsOf(plan.tracks, 'audio-track-1');
    expect({
      narration: narration.map((i) => [i.materialId, i.start, i.dur]),
      main: itemsOf(plan.tracks, 'video-track-1').map((i) => [i.start, i.dur]),
      subtitles: starts(plan.tracks, 'subtitle-track-1'),
      delta: plan.impact.durationDelta,
      shifted: plan.impact.shiftedSegmentOrdinals,
      total: [plan.impact.totalDurationBefore, plan.impact.totalDurationAfter],
    }).toEqual({
      narration: [['v1', 0, 5], ['v2b', 5, 10], ['v3', 15, 6]],
      main: [[0, 5], [5, 10], [15, 6]],
      subtitles: [0, 5, 9, 15],
      delta: 2,
      shifted: [3],
      total: [19, 21],
    });
  });

  it('T-CMD-VOICE-1: background music keeps its object reference (I-6)', () => {
    const plan = ok(planWith(10));
    const before = plan.baseTracks.find((t) => t.id === 'audio-track-2');
    const after = plan.tracks.find((t) => t.id === 'audio-track-2');
    expect({ same: before === after, music: plan.impact.untouchedMusicTrackNames })
      .toEqual({ same: true, music: ['audio-track-2'] });
  });

  it('T-CMD-VOICE-1: the script patch records applied voice, time and duration', () => {
    const plan = ok(planWith(10));
    expect(plan.scriptOps).toEqual([{
      type: 'patch-segment', segmentId: 's2',
      before: { appliedVoiceMaterialId: undefined, appliedVoiceAt: undefined, duration: undefined },
      after: { appliedVoiceMaterialId: 'v2b', appliedVoiceAt: AT, duration: 10 },
    }]);
  });

  it('T-CMD-VOICE-2: a 1.2 s shorter voice with adjust moves later content up and trims the picture', () => {
    const plan = ok(planWith(6.8));
    expect({
      main: itemsOf(plan.tracks, 'video-track-1').map((i) => [i.start, i.dur]),
      narrationStarts: starts(plan.tracks, 'audio-track-1'),
      delta: plan.impact.durationDelta,
    }).toEqual({
      main: [[0, 5], [5, 6.8], [11.8, 6]],
      narrationStarts: [0, 5, 11.8],
      delta: -1.2,
    });
  });

  it('T-CMD-VOICE-2: keep leaves every other clip in place and the narration tail empty', () => {
    const plan = ok(planWith(6.8, 'keep'));
    expect({
      main: itemsOf(plan.tracks, 'video-track-1').map((i) => [i.start, i.dur]),
      narration: itemsOf(plan.tracks, 'audio-track-1').map((i) => [i.start, i.dur]),
      delta: plan.impact.durationDelta,
    }).toEqual({
      main: [[0, 5], [5, 8], [13, 6]],
      narration: [[0, 5], [5, 6.8], [13, 6]],
      delta: 0,
    });
  });

  it('T-CMD-VOICE-3: a segment not on the timeline is inserted after the previous one', () => {
    const tracks = baseTracks().map((t) => ({
      ...t, items: t.items.filter((item) => !['c2', 'a2', 't2', 't3'].includes(item.id)),
    }));
    // Close the hole so s3 directly follows s1.
    const packed = tracks.map((t) => ({
      ...t,
      items: t.items.map((item) => (item.startTime >= 13 ? { ...item, startTime: item.startTime - 8 } : item)),
    }));
    const candidate = voice('v2b', SEGMENTS[1], 4, 5);
    const result = planSegmentVoiceApply(context(packed, [...MATERIALS, candidate]), {
      segmentId: 's2', candidate, lengthMode: 'adjust', appliedAt: AT,
    });
    const plan = ok(result);
    expect({
      narration: itemsOf(plan.tracks, 'audio-track-1').map((i) => [i.materialId, i.start]),
      main: starts(plan.tracks, 'video-track-1'),
    }).toEqual({
      narration: [['v1', 0], ['v2b', 5], ['v3', 9]],
      main: [0, 9],
    });
  });

  it('T-CMD-VOICE-3b: a segment with picture but no narration places the voice at its span start', () => {
    const tracks = baseTracks().map((t) => ({ ...t, items: t.items.filter((item) => item.id !== 'a2') }));
    const candidate = voice('v2b', SEGMENTS[1], 9, 5);
    const plan = ok(planSegmentVoiceApply(context(tracks, [...MATERIALS, candidate]), {
      segmentId: 's2', candidate, lengthMode: 'adjust', appliedAt: AT,
    }));
    expect({
      narration: itemsOf(plan.tracks, 'audio-track-1').map((i) => [i.materialId, i.start]),
      main: itemsOf(plan.tracks, 'video-track-1').map((i) => [i.start, i.dur]),
      delta: plan.impact.durationDelta,
    }).toEqual({
      narration: [['v1', 0], ['v2b', 5], ['v3', 14]],
      main: [[0, 5], [5, 9], [14, 6]],
      delta: 1,
    });
  });

  it('T-CMD-VOICE-4: a candidate written for older text is refused and nothing changes', () => {
    const oldText = segment('s2', 'an older text');
    const candidate = voice('v2b', oldText, 10, 5);
    const ctx = context(baseTracks(), [...MATERIALS, candidate]);
    const result = planSegmentVoiceApply(ctx, {
      segmentId: 's2', candidate, lengthMode: 'adjust', appliedAt: AT,
    });
    expect(result).toEqual({ ok: false, reason: 'candidate-stale' });
  });

  it('T-CMD-VOICE-5: allowStale applies an older version (restore previous voice)', () => {
    const oldText = segment('s2', 'an older text');
    const candidate = voice('v2old', oldText, 8, 0);
    const ctx = context(baseTracks(), [...MATERIALS, candidate]);
    const result = planSegmentVoiceApply(ctx, {
      segmentId: 's2', candidate, lengthMode: 'adjust', allowStale: true, appliedAt: AT,
    });
    const plan = ok(result);
    expect(itemsOf(plan.tracks, 'audio-track-1').map((i) => i.materialId)).toEqual(['v1', 'v2old', 'v3']);
  });

  it('refuses when the narration lane is locked', () => {
    const tracks = baseTracks().map((t) => (t.id === 'audio-track-1' ? { ...t, isLocked: true } : t));
    const candidate = voice('v2b', SEGMENTS[1], 10, 5);
    const result = planSegmentVoiceApply(context(tracks, [...MATERIALS, candidate]), {
      segmentId: 's2', candidate, lengthMode: 'adjust', appliedAt: AT,
    });
    expect(result).toEqual({ ok: false, reason: 'target-track-locked' });
  });

  it('T-CMD-LOCK: a locked subtitle lane stays put and is listed', () => {
    const tracks = baseTracks().map((t) => (t.id === 'subtitle-track-1' ? { ...t, isLocked: true, name: 'Subs' } : t));
    const candidate = voice('v2b', SEGMENTS[1], 10, 5);
    const plan = ok(planSegmentVoiceApply(context(tracks, [...MATERIALS, candidate]), {
      segmentId: 's2', candidate, lengthMode: 'adjust', appliedAt: AT,
    }));
    const locked = plan.tracks.find((t) => t.id === 'subtitle-track-1');
    expect({
      same: locked === tracks.find((t) => t.id === 'subtitle-track-1'),
      names: plan.impact.lockedTrackNames,
    }).toEqual({ same: true, names: ['Subs'] });
  });

  it('extends a short picture by looping its first material when the source runs out', () => {
    const tracks = baseTracks().map((t) => (t.id === 'video-track-1'
      ? track('video-track-1', 'video', [
        clip('c1', 'video-track-1', 'video', 0, 5, 'm1'),
        clip('c2', 'video-track-1', 'video', 5, 8, 'm2', { clipStart: 12, clipEnd: 20 }),
        clip('c3', 'video-track-1', 'video', 13, 6, 'm3'),
      ], 0)
      : t));
    const candidate = voice('v2b', SEGMENTS[1], 10, 5);
    const plan = ok(planSegmentVoiceApply(context(tracks, [...MATERIALS, candidate]), {
      segmentId: 's2', candidate, lengthMode: 'adjust', appliedAt: AT,
    }));
    const main = itemsOf(plan.tracks, 'video-track-1').map((i) => [i.materialId, i.start, i.dur]);
    expect(main).toEqual([['m1', 0, 5], ['m2', 5, 8], ['m2', 13, 2], ['m3', 15, 6]]);
  });
});
