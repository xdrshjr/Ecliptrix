/**
 * AudioSyncPool — spec 02 §2.5 / spec 01 §2.4.
 *
 * The per-tick decision logic is pure (`computeAudioSyncActions`) and is tested
 * without real audio elements: drift de-bounce, volume clamp, pause on gap /
 * mute / not-playing. S4: the pool owns only independent 'audio' tracks (a
 * detached video track's embedded audio is muted at the decode <video> by the
 * VideoSourcePool, so "no double audio" holds without an 'embeddedVideoAudio'
 * group kind). The thin `AudioSyncPool` wrapper is tested against fake audio
 * element objects.
 */

import { describe, it, expect } from 'vitest';
import {
  AudioSyncPool,
  computeAudioSyncActions,
  computeEffectiveVolume,
  type AudioSyncGroup,
  type AudioElementLike,
} from '../AudioSyncPool';
import { AUDIO_DRIFT_EPSILON_SEC } from '../internal/constants';

function audioGroup(
  trackId: string,
  items: AudioSyncGroup['items'],
  over: Partial<AudioSyncGroup> = {},
): AudioSyncGroup {
  return { trackId, muted: false, volume: 1, kind: 'audio', items, ...over };
}

function clip(
  id: string,
  startTime: number,
  duration: number,
  over: Partial<AudioSyncGroup['items'][number]> = {},
) {
  return { id, startTime, duration, clipStart: 0, clipEnd: duration, ...over };
}

describe('computeEffectiveVolume', () => {
  it('multiplies item volume by track volume and clamps to [0,1]', () => {
    expect(computeEffectiveVolume(0.5, 1)).toBe(0.5);
    expect(computeEffectiveVolume(undefined, 0.8)).toBe(0.8); // item defaults to 1
    expect(computeEffectiveVolume(1, 2)).toBe(1); // clamp high
    expect(computeEffectiveVolume(-1, 1)).toBe(0); // clamp low
  });

  // Added (google-tester-01, S1 acceptance): explicit edge values the task
  // asked to probe — exact 0, exact 1, just-over 1, and NaN/Inf degenerate input.
  it('treats an explicit item volume of 0 as silent (0, not the default 1)', () => {
    expect(computeEffectiveVolume(0, 1)).toBe(0);
  });

  it('keeps exactly 1.0 and clamps just-over-1 down to 1', () => {
    expect(computeEffectiveVolume(1, 1)).toBe(1);
    expect(computeEffectiveVolume(1.0001, 1)).toBe(1);
    expect(computeEffectiveVolume(0.6, 2)).toBe(1); // 1.2 → 1
  });

  it('guards every non-finite input to 0 (the !isFinite guard fires BEFORE the >=1 clamp)', () => {
    // Note: the implementation returns 0 for ANY non-finite value — including
    // +Inf — because the `!Number.isFinite` guard precedes the `>= 1` clamp.
    // This is the safe choice (never write a non-finite volume); pin it so a
    // future re-order to "+Inf → 1" is a deliberate, reviewed change.
    expect(computeEffectiveVolume(Number.NaN, 1)).toBe(0);
    expect(computeEffectiveVolume(Number.POSITIVE_INFINITY, 1)).toBe(0);
    expect(computeEffectiveVolume(Number.NEGATIVE_INFINITY, 1)).toBe(0);
  });
});

describe('computeAudioSyncActions', () => {
  it('pauses everything when not playing', () => {
    const groups = [audioGroup('t1', [clip('a', 0, 5)])];
    const actions = computeAudioSyncActions(groups, 2, { isPlaying: false });
    expect(actions).toEqual([{ trackId: 't1', action: 'pause' }]);
  });

  it('pauses a muted track even when a clip is active', () => {
    const groups = [audioGroup('t1', [clip('a', 0, 5)], { muted: true })];
    const actions = computeAudioSyncActions(groups, 2, { isPlaying: true });
    expect(actions[0]).toEqual({ trackId: 't1', action: 'pause' });
  });

  it('pauses on a gap (no active clip)', () => {
    const groups = [audioGroup('t1', [clip('a', 0, 2), clip('b', 5, 2)])];
    const actions = computeAudioSyncActions(groups, 3, { isPlaying: true });
    expect(actions[0]).toEqual({ trackId: 't1', action: 'pause' });
  });

  it('emits seek when drift exceeds the epsilon, with clamped volume', () => {
    // clip on track [0,5) reading source [10,15); at t=2 target source = 12.
    const groups = [audioGroup('t1', [clip('a', 0, 5, { clipStart: 10, clipEnd: 15, volume: 0.5 })], { volume: 1 })];
    const actions = computeAudioSyncActions(groups, 2, {
      isPlaying: true,
      currentSourceTimeByTrack: { t1: 0 }, // far from 12 → drift huge
    });
    expect(actions[0].action).toBe('seek');
    expect(actions[0].targetSourceTime).toBeCloseTo(12, 6);
    expect(actions[0].volume).toBe(0.5);
  });

  it('does NOT seek when drift is within the epsilon (de-bounce)', () => {
    const groups = [audioGroup('t1', [clip('a', 0, 5)])];
    // target source at t=2 is 2; current 2 + half-epsilon → within tolerance.
    const actions = computeAudioSyncActions(groups, 2, {
      isPlaying: true,
      currentSourceTimeByTrack: { t1: 2 + AUDIO_DRIFT_EPSILON_SEC / 2 },
      isElementPlayingByTrack: { t1: true },
    });
    expect(actions[0].action).toBe('hold');
    expect(actions[0].targetSourceTime).toBeUndefined();
  });

  it('emits play when within drift but the element is currently paused', () => {
    const groups = [audioGroup('t1', [clip('a', 0, 5)])];
    const actions = computeAudioSyncActions(groups, 2, {
      isPlaying: true,
      currentSourceTimeByTrack: { t1: 2 },
      isElementPlayingByTrack: { t1: false },
    });
    expect(actions[0].action).toBe('play');
    expect(actions[0].volume).toBe(1);
  });

  // S4: the pool now owns ONLY independent 'audio' tracks. A detached video
  // track's paired audio sequence is one of these and plays; the video track's
  // own embedded audio is muted at the decode <video> by the VideoSourcePool,
  // not routed through this pool — so "no double audio" holds without an
  // 'embeddedVideoAudio' group kind. This pins the surviving routing.
  it('an independent audio track (e.g. a detached video track\'s paired audio) plays', () => {
    const independentAudio = audioGroup('audio-1', [clip('aud', 0, 5)]);
    const actions = computeAudioSyncActions([independentAudio], 2, {
      isPlaying: true,
      currentSourceTimeByTrack: { 'audio-1': 2 },
      isElementPlayingByTrack: { 'audio-1': false },
    });
    expect(actions[0].action).toBe('play');
  });

  // Added (google-tester-01, S1 acceptance): a track muted via volume=0 is a
  // distinct concept from a muted TRACK or a gap. The element should still be
  // driven (play/seek) at volume 0 — NOT paused — so it stays clock-aligned and
  // resumes audibly the instant volume returns. Pausing here would desync.
  it('clip volume 0 still PLAYS at volume 0 (silent but clock-aligned), not paused', () => {
    const groups = [audioGroup('t1', [clip('a', 0, 5, { volume: 0 })])];
    const actions = computeAudioSyncActions(groups, 2, {
      isPlaying: true,
      currentSourceTimeByTrack: { t1: 2 },
      isElementPlayingByTrack: { t1: false },
    });
    expect(actions[0].action).toBe('play');
    expect(actions[0].volume).toBe(0);
  });

  it('an over-driven track volume is clamped into the action volume ([0,1])', () => {
    const groups = [audioGroup('t1', [clip('a', 0, 5, { volume: 1 })], { volume: 2 })];
    const actions = computeAudioSyncActions(groups, 2, {
      isPlaying: true,
      currentSourceTimeByTrack: { t1: 2 },
      isElementPlayingByTrack: { t1: true },
    });
    expect(actions[0].action).toBe('hold');
    expect(actions[0].volume).toBe(1); // 1 * 2 → clamped to 1
  });
});

// ---------------------------------------------------------------------------
// Wrapper against fake audio elements.
// ---------------------------------------------------------------------------

class FakeAudio implements AudioElementLike {
  currentTime = 0;
  volume = 1;
  paused = true;
  playCalls = 0;
  pauseCalls = 0;
  play(): Promise<void> {
    this.paused = false;
    this.playCalls += 1;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
    this.pauseCalls += 1;
  }
}

describe('AudioSyncPool.tick', () => {
  it('seeks + plays an active track, setting currentTime and volume', () => {
    const el = new FakeAudio();
    el.currentTime = 0;
    const pool = new AudioSyncPool(() => el);
    const groups = [audioGroup('t1', [clip('a', 0, 5, { clipStart: 10, clipEnd: 15, volume: 0.5 })])];

    pool.tick(groups, 2, true);

    expect(el.currentTime).toBeCloseTo(12, 6); // mapped source time
    expect(el.volume).toBe(0.5);
    expect(el.paused).toBe(false);
    expect(el.playCalls).toBe(1);
  });

  it('does not re-seek on the next tick once within drift, but keeps playing (hold)', () => {
    const el = new FakeAudio();
    const pool = new AudioSyncPool(() => el);
    const groups = [audioGroup('t1', [clip('a', 0, 5)])];

    pool.tick(groups, 2, true); // seeks to 2, plays
    el.currentTime = 2.0 + AUDIO_DRIFT_EPSILON_SEC / 2; // tiny natural drift
    const before = el.currentTime;
    pool.tick(groups, 2, true); // within drift → hold

    expect(el.currentTime).toBe(before); // no hard re-seek
    expect(el.playCalls).toBe(1); // still playing, no second play()
  });

  it('pauses a track that became inactive (gap) without leaving it playing', () => {
    const el = new FakeAudio();
    el.paused = false; // already playing from a prior segment
    const pool = new AudioSyncPool(() => el);
    const groups = [audioGroup('t1', [clip('a', 0, 2), clip('b', 5, 2)])];

    pool.tick(groups, 3, true); // t=3 is a gap

    expect(el.paused).toBe(true);
    expect(el.pauseCalls).toBe(1);
  });

  it('two independent audio tracks on one clock: an active track plays, an idle track pauses', () => {
    const activeEl = new FakeAudio();
    const idleEl = new FakeAudio();
    idleEl.paused = false; // would keep playing if not parked
    const byId: Record<string, FakeAudio> = { 'audio-1': activeEl, 'audio-2': idleEl };
    const pool = new AudioSyncPool((id) => byId[id] ?? null);

    const groups: AudioSyncGroup[] = [
      audioGroup('audio-1', [clip('a', 0, 5)]), // active at t=2
      audioGroup('audio-2', [clip('b', 10, 5)]), // not active at t=2 (gap)
    ];

    pool.tick(groups, 2, true);

    expect(activeEl.paused).toBe(false); // active track plays
    expect(activeEl.playCalls).toBe(1);
    expect(idleEl.paused).toBe(true); // idle track parked (no leftover audio)
  });
});
