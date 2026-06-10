/**
 * VideoSourcePool tests (spec 02 §2.2 / §2.6).
 *
 * Covers the PURE planner (`computeSourcePlan`) — per-track active clip + source
 * plan, seek-tolerance de-bounce, RC-B same-key src-swap, prewarm selection —
 * and the thin applier (`VideoSourcePool`) against fake VideoElementLike objects
 * (no real <video>). Mirrors the AudioSyncPool test split.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  computeSourcePlan,
  VideoSourcePool,
  type VideoElementLike,
  type CurrentStateByTrack,
  type SequenceSourceResolver,
  type TrackElements,
} from '../VideoSourcePool';
import { VIDEO_SEEK_TOLERANCE_SEC } from '../internal/constants';
import type { VideoTrackGroup } from '../types';
import type { VideoSequenceItem } from '../../types';

/** Same-origin absolute form of a path, as the browser/normalizeSrc resolves it. */
function abs(path: string): string {
  return new URL(path, window.location.href).href;
}

function seq(over: Partial<VideoSequenceItem> & { id: string }): VideoSequenceItem {
  return {
    name: over.id,
    url: '',
    startTime: 0,
    duration: 5,
    trackId: 't',
    clipStart: 0,
    clipEnd: 5,
    ...over,
  } as VideoSequenceItem;
}

function group(trackId: string, z: number, items: VideoSequenceItem[]): VideoTrackGroup {
  return { trackId, z, items };
}

/** Resolver keyed by clip id → url. */
function resolverFrom(map: Record<string, string | null>): SequenceSourceResolver {
  return (s) => map[s.id] ?? null;
}

describe('computeSourcePlan — per-track active clip + source plan', () => {
  it('selects the active clip per track and resolves its source time via ClipTimeMapping', () => {
    const groups = [
      group('top', 1, [seq({ id: 'a', startTime: 0, duration: 5, clipStart: 2, clipEnd: 7 })]),
      group('bottom', 0, [seq({ id: 'b', startTime: 0, duration: 5, clipStart: 0, clipEnd: 5 })]),
    ];
    const resolve = resolverFrom({ a: '/a.mp4', b: '/b.mp4' });
    const state: CurrentStateByTrack = {};
    const plans = computeSourcePlan(groups, 3, state, resolve);

    const top = plans.find((p) => p.trackId === 'top')!;
    expect(top.activeClipId).toBe('a');
    expect(top.desiredUrl).toBe('/a.mp4');
    // clipStart 2 + local 3 → source time 5
    expect(top.desiredSourceTime).toBeCloseTo(5, 6);
    expect(top.z).toBe(1);

    const bottom = plans.find((p) => p.trackId === 'bottom')!;
    expect(bottom.desiredSourceTime).toBeCloseTo(3, 6);
  });

  it('returns an idle plan (null url) when a track has no active clip at t', () => {
    const groups = [group('t1', 0, [seq({ id: 'a', startTime: 10, duration: 5 })])];
    const plans = computeSourcePlan(groups, 2, {}, resolverFrom({ a: '/a.mp4' }));
    expect(plans[0].desiredUrl).toBeNull();
    expect(plans[0].desiredSourceTime).toBeNull();
    expect(plans[0].needsSrcSwap).toBe(false);
    expect(plans[0].activeClipId).toBeNull();
  });

  it('returns idle (no swap) when the resolver yields no url for the active clip', () => {
    const groups = [group('t1', 0, [seq({ id: 'a', startTime: 0, duration: 5 })])];
    const plans = computeSourcePlan(groups, 1, {}, resolverFrom({ a: null }));
    expect(plans[0].desiredUrl).toBeNull();
    expect(plans[0].activeClipId).toBe('a');
  });
});

describe('computeSourcePlan — RC-B "比对键==赋值" same-key src swap', () => {
  it('needsSrcSwap is FALSE when the element already holds the live-resolved url', () => {
    const groups = [group('t1', 0, [seq({ id: 'a', startTime: 0, duration: 5 })])];
    const resolve = resolverFrom({ a: abs('/api/storage/files/video/x.mp4') });
    const state: CurrentStateByTrack = {
      t1: {
        currentSrc: abs('/api/storage/files/video/x.mp4'),
        currentTime: 1,
        hasPrewarm: false,
      },
    };
    const plans = computeSourcePlan(groups, 1, state, resolve);
    // Same resolved url as the element's current src → no swap, no forced seek.
    expect(plans[0].needsSrcSwap).toBe(false);
  });

  it('needsSrcSwap is TRUE when the live material patches a NEW url (root-cause of black screen)', () => {
    const groups = [group('t1', 0, [seq({ id: 'a', startTime: 0, duration: 5 })])];
    // Element currently has the empty/stale src; live material now resolves a real local url.
    const state: CurrentStateByTrack = {
      t1: { currentSrc: '', currentTime: 0, hasPrewarm: false },
    };
    const resolve = resolverFrom({ a: '/api/storage/files/video/patched.mp4' });
    const plans = computeSourcePlan(groups, 1, state, resolve);
    expect(plans[0].needsSrcSwap).toBe(true);
    // A fresh src always needs the initial seek.
    expect(plans[0].needsSeek).toBe(true);
    // The url the planner compared is the url assigned — same key.
    expect(plans[0].desiredUrl).toBe('/api/storage/files/video/patched.mp4');
  });

  it('normalizes relative vs absolute forms so a same-origin path is not a false swap', () => {
    const groups = [group('t1', 0, [seq({ id: 'a', startTime: 0, duration: 5 })])];
    const resolve = resolverFrom({ a: '/api/storage/files/video/x.mp4' });
    const state: CurrentStateByTrack = {
      t1: {
        currentSrc: abs('/api/storage/files/video/x.mp4'),
        currentTime: 0,
        hasPrewarm: false,
      },
    };
    const plans = computeSourcePlan(groups, 1, state, resolve);
    expect(plans[0].needsSrcSwap).toBe(false);
  });
});

describe('computeSourcePlan — seek-tolerance de-bounce', () => {
  it('does NOT request a seek when currentTime is within tolerance of the target', () => {
    const groups = [group('t1', 0, [seq({ id: 'a', startTime: 0, duration: 5 })])];
    const resolve = resolverFrom({ a: '/a.mp4' });
    const target = 2;
    const state: CurrentStateByTrack = {
      t1: {
        currentSrc: abs('/a.mp4'),
        currentTime: target + VIDEO_SEEK_TOLERANCE_SEC / 2,
        hasPrewarm: false,
      },
    };
    const plans = computeSourcePlan(groups, 2, state, resolve);
    expect(plans[0].needsSrcSwap).toBe(false);
    expect(plans[0].needsSeek).toBe(false);
  });

  it('DOES request a seek when currentTime exceeds tolerance', () => {
    const groups = [group('t1', 0, [seq({ id: 'a', startTime: 0, duration: 5 })])];
    const resolve = resolverFrom({ a: '/a.mp4' });
    const state: CurrentStateByTrack = {
      t1: {
        currentSrc: abs('/a.mp4'),
        currentTime: 2 + VIDEO_SEEK_TOLERANCE_SEC + 0.1,
        hasPrewarm: false,
      },
    };
    const plans = computeSourcePlan(groups, 2, state, resolve);
    expect(plans[0].needsSeek).toBe(true);
  });
});

describe('computeSourcePlan — prewarm selection', () => {
  it('resolves the NEXT clip url to prewarm when a prewarm element exists', () => {
    const groups = [
      group('t1', 0, [
        seq({ id: 'a', startTime: 0, duration: 5 }),
        seq({ id: 'b', startTime: 5, duration: 5 }),
      ]),
    ];
    const resolve = resolverFrom({ a: '/a.mp4', b: '/b.mp4' });
    const state: CurrentStateByTrack = {
      t1: { currentSrc: abs('/a.mp4'), currentTime: 4, hasPrewarm: true, prewarmSrc: '' },
    };
    const plans = computeSourcePlan(groups, 4, state, resolve);
    expect(plans[0].prewarmUrl).toBe('/b.mp4');
  });

  it('does NOT prewarm when the B element is already warmed to that url', () => {
    const groups = [
      group('t1', 0, [
        seq({ id: 'a', startTime: 0, duration: 5 }),
        seq({ id: 'b', startTime: 5, duration: 5 }),
      ]),
    ];
    const resolve = resolverFrom({ a: '/a.mp4', b: '/b.mp4' });
    const state: CurrentStateByTrack = {
      t1: {
        currentSrc: abs('/a.mp4'),
        currentTime: 4,
        hasPrewarm: true,
        prewarmSrc: abs('/b.mp4'),
      },
    };
    const plans = computeSourcePlan(groups, 4, state, resolve);
    expect(plans[0].prewarmUrl).toBeNull();
  });

  it('does NOT prewarm when there is no prewarm element', () => {
    const groups = [
      group('t1', 0, [
        seq({ id: 'a', startTime: 0, duration: 5 }),
        seq({ id: 'b', startTime: 5, duration: 5 }),
      ]),
    ];
    const resolve = resolverFrom({ a: '/a.mp4', b: '/b.mp4' });
    const state: CurrentStateByTrack = {
      t1: { currentSrc: abs('/a.mp4'), currentTime: 4, hasPrewarm: false },
    };
    const plans = computeSourcePlan(groups, 4, state, resolve);
    expect(plans[0].prewarmUrl).toBeNull();
  });
});

describe('computeSourcePlan — embedded-audio mute routing (RISK 2)', () => {
  it('muteAudio is FALSE for a non-detached active clip (its decode element carries audio)', () => {
    const groups = [group('t1', 0, [seq({ id: 'a', startTime: 0, duration: 5 })])];
    const plans = computeSourcePlan(groups, 1, {}, resolverFrom({ a: '/a.mp4' }));
    expect(plans[0].muteAudio).toBe(false);
  });

  it('muteAudio is TRUE for a detached active clip (paired audio track owns the sound)', () => {
    const groups = [
      group('t1', 0, [seq({ id: 'a', startTime: 0, duration: 5, audioDetached: true })]),
    ];
    const plans = computeSourcePlan(groups, 1, {}, resolverFrom({ a: '/a.mp4' }));
    expect(plans[0].muteAudio).toBe(true);
  });

  it('muteAudio is TRUE for an idle track', () => {
    const groups = [group('t1', 0, [seq({ id: 'a', startTime: 100, duration: 5 })])];
    const plans = computeSourcePlan(groups, 1, {}, resolverFrom({ a: '/a.mp4' }));
    expect(plans[0].muteAudio).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Applier — against fake VideoElementLike (no real <video>).
// ---------------------------------------------------------------------------

type FakeEl = VideoElementLike & { paused: boolean; playCalls: number; muted: boolean };

function fakeEl(over: Partial<FakeEl> = {}): FakeEl {
  return {
    src: '',
    currentTime: 0,
    readyState: 4,
    paused: true,
    muted: false,
    playCalls: 0,
    play() {
      this.paused = false;
      this.playCalls += 1;
    },
    pause() {
      this.paused = true;
    },
    ...over,
  } as FakeEl;
}

describe('VideoSourcePool applier (fake elements)', () => {
  it('assigns EXACTLY the planned desiredUrl to the active element (RC-B assign==compare)', () => {
    const active = fakeEl();
    const prewarm = fakeEl();
    const elements = new Map<string, TrackElements>([
      ['t1', { active, prewarm }],
    ]);
    const pool = new VideoSourcePool(
      (id) => elements.get(id) ?? null,
      resolverFrom({ a: '/api/storage/files/video/x.mp4' }),
    );
    const groups = [group('t1', 0, [seq({ id: 'a', startTime: 0, duration: 5 })])];
    const result = pool.sync(groups, 1, true);
    expect(active.src).toBe('/api/storage/files/video/x.mp4');
    expect(result[0].element).toBe(active);
    expect(active.paused).toBe(false); // playing → element driven to play
  });

  it('seeks the element to the mapped source time on a fresh src', () => {
    const active = fakeEl();
    const elements = new Map<string, TrackElements>([['t1', { active, prewarm: null }]]);
    const pool = new VideoSourcePool(
      (id) => elements.get(id) ?? null,
      resolverFrom({ a: '/a.mp4' }),
    );
    const groups = [group('t1', 0, [seq({ id: 'a', startTime: 0, duration: 5, clipStart: 2, clipEnd: 7 })])];
    pool.sync(groups, 1, true);
    // clipStart 2 + local 1 → 3
    expect(active.currentTime).toBeCloseTo(3, 6);
  });

  it('does NOT re-seek within tolerance on a steady second tick', () => {
    const active = fakeEl({ src: abs('/a.mp4'), currentTime: 1, readyState: 4 });
    const elements = new Map<string, TrackElements>([['t1', { active, prewarm: null }]]);
    const pool = new VideoSourcePool(
      (id) => elements.get(id) ?? null,
      resolverFrom({ a: '/a.mp4' }),
    );
    const groups = [group('t1', 0, [seq({ id: 'a', startTime: 0, duration: 5 })])];
    // target at t=1.1 is 1.1; element at 1 → within tolerance → currentTime untouched.
    const before = active.currentTime;
    pool.sync(groups, 1.1, true);
    expect(active.currentTime).toBe(before);
  });

  it('pauses the active element on an idle track', () => {
    const active = fakeEl({ paused: false });
    const elements = new Map<string, TrackElements>([['t1', { active, prewarm: null }]]);
    const pool = new VideoSourcePool(
      (id) => elements.get(id) ?? null,
      resolverFrom({ a: '/a.mp4' }),
    );
    const groups = [group('t1', 0, [seq({ id: 'a', startTime: 100, duration: 5 })])];
    const result = pool.sync(groups, 1, true);
    expect(active.paused).toBe(true);
    expect(result[0].element).toBeNull();
  });

  it('warms the prewarm element to the next clip url', () => {
    const active = fakeEl({ src: abs('/a.mp4'), currentTime: 4 });
    const prewarm = fakeEl();
    const elements = new Map<string, TrackElements>([['t1', { active, prewarm }]]);
    const pool = new VideoSourcePool(
      (id) => elements.get(id) ?? null,
      resolverFrom({ a: '/a.mp4', b: '/b.mp4' }),
    );
    const groups = [
      group('t1', 0, [
        seq({ id: 'a', startTime: 0, duration: 5 }),
        seq({ id: 'b', startTime: 5, duration: 5 }),
      ]),
    ];
    pool.sync(groups, 4, true);
    expect(prewarm.src).toBe('/b.mp4');
  });

  it('parks all elements when not playing', () => {
    const active = fakeEl({ paused: false });
    const elements = new Map<string, TrackElements>([['t1', { active, prewarm: null }]]);
    const pool = new VideoSourcePool(
      (id) => elements.get(id) ?? null,
      resolverFrom({ a: '/a.mp4' }),
    );
    const groups = [group('t1', 0, [seq({ id: 'a', startTime: 0, duration: 5 })])];
    pool.sync(groups, 1, false);
    expect(active.paused).toBe(true);
  });

  it('UNMUTES the decode element for a non-detached active clip (RISK 2 — embedded audio audible)', () => {
    const active = fakeEl({ muted: true });
    const elements = new Map<string, TrackElements>([['t1', { active, prewarm: null }]]);
    const pool = new VideoSourcePool(
      (id) => elements.get(id) ?? null,
      resolverFrom({ a: '/a.mp4' }),
    );
    const groups = [group('t1', 0, [seq({ id: 'a', startTime: 0, duration: 5 })])];
    pool.sync(groups, 1, true);
    expect(active.muted).toBe(false);
  });

  it('MUTES the decode element for a detached active clip (no double audio; paired track owns it)', () => {
    const active = fakeEl({ muted: false });
    const elements = new Map<string, TrackElements>([['t1', { active, prewarm: null }]]);
    const pool = new VideoSourcePool(
      (id) => elements.get(id) ?? null,
      resolverFrom({ a: '/a.mp4' }),
    );
    const groups = [
      group('t1', 0, [seq({ id: 'a', startTime: 0, duration: 5, audioDetached: true })]),
    ];
    pool.sync(groups, 1, true);
    expect(active.muted).toBe(true);
  });

  it('MUTES the decode element on an idle track', () => {
    const active = fakeEl({ muted: false, paused: false });
    const elements = new Map<string, TrackElements>([['t1', { active, prewarm: null }]]);
    const pool = new VideoSourcePool(
      (id) => elements.get(id) ?? null,
      resolverFrom({ a: '/a.mp4' }),
    );
    const groups = [group('t1', 0, [seq({ id: 'a', startTime: 100, duration: 5 })])];
    pool.sync(groups, 1, true);
    expect(active.muted).toBe(true);
  });

  it('swallows a rejected play() promise (interrupted by near-simultaneous seek)', () => {
    const rejecting = fakeEl();
    rejecting.play = () => Promise.reject(new Error('interrupted'));
    const elements = new Map<string, TrackElements>([['t1', { active: rejecting, prewarm: null }]]);
    const pool = new VideoSourcePool(
      (id) => elements.get(id) ?? null,
      resolverFrom({ a: '/a.mp4' }),
    );
    const groups = [group('t1', 0, [seq({ id: 'a', startTime: 0, duration: 5 })])];
    expect(() => pool.sync(groups, 1, true)).not.toThrow();
  });
});
