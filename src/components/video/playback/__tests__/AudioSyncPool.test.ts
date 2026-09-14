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
  computeMediaElementVolume,
  type AudioSyncGroup,
  type AudioElementLike,
} from '../AudioSyncPool';
import { AUDIO_DRIFT_EPSILON_SEC } from '../internal/constants';

/** Default clip source url. Clips carry a url so the pool can assign `src`. */
const AUDIO_URL = 'audio.mp3';

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
  return { id, startTime, duration, clipStart: 0, clipEnd: duration, url: AUDIO_URL, ...over };
}

describe('computeMediaElementVolume', () => {
  it('multiplies item volume by the group volume and clamps to the effective [0,2] range (ME-06)', () => {
    expect(computeMediaElementVolume(0.5, 1)).toBe(0.5);
    expect(computeMediaElementVolume(undefined, 0.8)).toBe(0.8); // item defaults to 1
    expect(computeMediaElementVolume(1, 2)).toBe(2); // >100% carried for the gain stage
    expect(computeMediaElementVolume(1.5, 2)).toBe(2); // clamp high at the export ceiling
    expect(computeMediaElementVolume(-1, 1)).toBe(0); // clamp low
  });

  it('the default volume writer clamps the element to [0,1]', () => {
    const el: AudioElementLike = {
      src: '',
      currentTime: 0,
      volume: 1,
      paused: false,
      play: () => undefined,
      pause: () => undefined,
    };
    const pool = new AudioSyncPool(() => el);
    const group = audioGroup('t1', [clip('c', 0, 10, { volume: 1.6, url: AUDIO_URL })]);
    el.src = new URL(AUDIO_URL, window.location.href).href;
    pool.tick([group], 1, true);
    expect(el.volume).toBe(1);
  });

  it('writes the effective volume through the injected applyVolume', () => {
    const el: AudioElementLike = {
      src: new URL(AUDIO_URL, window.location.href).href,
      currentTime: 1,
      volume: 1,
      paused: false,
      play: () => undefined,
      pause: () => undefined,
    };
    const writes: number[] = [];
    const pool = new AudioSyncPool(() => el, {
      applyVolume: (_trackId, _element, volume) => writes.push(volume),
    });
    pool.tick([audioGroup('t1', [clip('c', 0, 10, { volume: 1.6 })])], 1, true);
    expect(writes).toEqual([1.6]);
  });

  // Added (google-tester-01, S1 acceptance): explicit edge values the task
  // asked to probe — exact 0, exact 1, just-over 1, and NaN/Inf degenerate input.
  it('treats an explicit item volume of 0 as silent (0, not the default 1)', () => {
    expect(computeMediaElementVolume(0, 1)).toBe(0);
  });

  it('keeps exactly 1.0 and carries just-over-1 for the gain stage', () => {
    expect(computeMediaElementVolume(1, 1)).toBe(1);
    expect(computeMediaElementVolume(1.0001, 1)).toBe(1.0001);
    expect(computeMediaElementVolume(0.6, 2)).toBeCloseTo(1.2, 9);
  });

  it('guards every non-finite input to 0 (the !isFinite guard fires BEFORE the >=1 clamp)', () => {
    // Note: the implementation returns 0 for ANY non-finite value — including
    // +Inf — because the `!Number.isFinite` guard precedes the `>= 1` clamp.
    // This is the safe choice (never write a non-finite volume); pin it so a
    // future re-order to "+Inf → 1" is a deliberate, reviewed change.
    expect(computeMediaElementVolume(Number.NaN, 1)).toBe(0);
    expect(computeMediaElementVolume(Number.POSITIVE_INFINITY, 1)).toBe(0);
    expect(computeMediaElementVolume(Number.NEGATIVE_INFINITY, 1)).toBe(0);
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
    // currentSrc matches the clip url so no source swap is forced.
    const actions = computeAudioSyncActions(groups, 2, {
      isPlaying: true,
      currentSourceTimeByTrack: { t1: 2 + AUDIO_DRIFT_EPSILON_SEC / 2 },
      isElementPlayingByTrack: { t1: true },
      currentSrcByTrack: { t1: AUDIO_URL },
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
      currentSrcByTrack: { t1: AUDIO_URL },
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
      currentSrcByTrack: { 'audio-1': AUDIO_URL },
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
      currentSrcByTrack: { t1: AUDIO_URL },
    });
    expect(actions[0].action).toBe('play');
    expect(actions[0].volume).toBe(0);
  });

  it('an over-driven group volume is carried into the action volume up to the export ceiling (ME-06)', () => {
    const groups = [audioGroup('t1', [clip('a', 0, 5, { volume: 1 })], { volume: 2 })];
    const actions = computeAudioSyncActions(groups, 2, {
      isPlaying: true,
      currentSourceTimeByTrack: { t1: 2 },
      isElementPlayingByTrack: { t1: true },
      currentSrcByTrack: { t1: AUDIO_URL },
    });
    expect(actions[0].action).toBe('hold');
    expect(actions[0].volume).toBe(2); // 1 * 2 → carried; the element writer clamps or boosts
  });

  // --- timeline-preview-audio-track-silent fix: source url carriage ---------

  it('carries the active clip url on play/seek so the pool can assign src', () => {
    const groups = [audioGroup('t1', [clip('a', 0, 5, { url: 'song.mp3' })])];
    // No currentSrc → forces a seek that carries the url to assign.
    const seekActions = computeAudioSyncActions(groups, 2, {
      isPlaying: true,
      currentSourceTimeByTrack: { t1: 2 },
      isElementPlayingByTrack: { t1: true },
    });
    expect(seekActions[0].action).toBe('seek');
    expect(seekActions[0].url).toBe('song.mp3');

    // Once the src matches, a within-drift paused element plays carrying the url.
    const playActions = computeAudioSyncActions(groups, 2, {
      isPlaying: true,
      currentSourceTimeByTrack: { t1: 2 },
      isElementPlayingByTrack: { t1: false },
      currentSrcByTrack: { t1: 'song.mp3' },
    });
    expect(playActions[0].action).toBe('play');
    expect(playActions[0].url).toBe('song.mp3');
  });

  it('forces a seek (re-assign src) when the active clip url differs from the current src', () => {
    // Element playing, within drift — would normally HOLD — but the active
    // clip's url changed (e.g. crossed into an adjacent clip of a different
    // file), so a seek is forced to swap the source.
    const groups = [audioGroup('t1', [clip('a', 0, 5, { url: 'next.mp3' })])];
    const actions = computeAudioSyncActions(groups, 2, {
      isPlaying: true,
      currentSourceTimeByTrack: { t1: 2 },
      isElementPlayingByTrack: { t1: true },
      currentSrcByTrack: { t1: 'previous.mp3' },
    });
    expect(actions[0].action).toBe('seek');
    expect(actions[0].url).toBe('next.mp3');
  });

  it('pauses an active clip that has no resolvable url (never plays a source-less element)', () => {
    const groups = [audioGroup('t1', [clip('a', 0, 5, { url: undefined })])];
    const actions = computeAudioSyncActions(groups, 2, {
      isPlaying: true,
      currentSourceTimeByTrack: { t1: 2 },
      isElementPlayingByTrack: { t1: false },
    });
    expect(actions[0]).toEqual({ trackId: 't1', action: 'pause' });
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
  /** Counts every `src =` write so tests can assert no per-frame churn. */
  srcAssignments = 0;
  private _src = '';
  get src(): string {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    this.srcAssignments += 1;
  }
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

  // --- timeline-preview-audio-track-silent fix: the missing src assignment ---

  it('assigns the active clip src before playing (the core fix)', () => {
    const el = new FakeAudio();
    const pool = new AudioSyncPool(() => el);
    const groups = [audioGroup('t1', [clip('a', 0, 5, { url: 'song.mp3' })])];

    pool.tick(groups, 2, true);

    expect(el.src).toBe('song.mp3'); // source assigned → audio can play
    expect(el.paused).toBe(false);
    expect(el.playCalls).toBe(1);
  });

  it('does NOT re-assign src every tick once it matches (no AbortError churn)', () => {
    const el = new FakeAudio();
    const pool = new AudioSyncPool(() => el);
    const groups = [audioGroup('t1', [clip('a', 0, 5, { url: 'song.mp3' })])];

    pool.tick(groups, 2, true); // assigns src once
    el.currentTime = 2; // settled at target → next tick holds
    pool.tick(groups, 2, true);
    pool.tick(groups, 2, true);

    expect(el.srcAssignments).toBe(1); // assigned exactly once
  });

  it('swaps src when the playhead crosses into a clip of a different file', () => {
    const el = new FakeAudio();
    const pool = new AudioSyncPool(() => el);
    const groups = [
      audioGroup('t1', [
        clip('a', 0, 5, { url: 'first.mp3' }),
        clip('b', 5, 5, { url: 'second.mp3' }),
      ]),
    ];

    pool.tick(groups, 2, true); // inside clip a
    expect(el.src).toBe('first.mp3');

    el.currentTime = 2; // settled
    pool.tick(groups, 7, true); // inside clip b → must swap source
    expect(el.src).toBe('second.mp3');
    expect(el.paused).toBe(false);
  });

  it('does NOT clear src when a track falls into a gap (pause keeps the source)', () => {
    const el = new FakeAudio();
    const pool = new AudioSyncPool(() => el);
    const groups = [audioGroup('t1', [clip('a', 0, 2, { url: 'song.mp3' }), clip('b', 5, 2, { url: 'song.mp3' })])];

    pool.tick(groups, 1, true); // active → src assigned
    expect(el.src).toBe('song.mp3');
    pool.tick(groups, 3, true); // gap → pause, but src untouched

    expect(el.paused).toBe(true);
    expect(el.src).toBe('song.mp3'); // not cleared (avoids reload churn)
  });

  it('applies a live volume change to the playing element on the next tick (real-time volume)', () => {
    const el = new FakeAudio();
    const pool = new AudioSyncPool(() => el);
    const louder = [audioGroup('t1', [clip('a', 0, 5, { volume: 0.8 })])];

    pool.tick(louder, 2, true); // assigns src + plays at 0.8
    expect(el.volume).toBe(0.8);

    el.currentTime = 2; // settled → next tick holds, but still re-applies volume
    const quieter = [audioGroup('t1', [clip('a', 0, 5, { volume: 0.3 })])];
    pool.tick(quieter, 2, true);

    expect(el.volume).toBe(0.3); // volume tracked the change without re-seeking
    expect(el.srcAssignments).toBe(1); // no source churn
  });

  it('plays a source-less clip as a no-op pause (never calls play on empty src)', () => {
    const el = new FakeAudio();
    const pool = new AudioSyncPool(() => el);
    const groups = [audioGroup('t1', [clip('a', 0, 5, { url: undefined })])];

    pool.tick(groups, 2, true);

    expect(el.src).toBe(''); // never assigned
    expect(el.playCalls).toBe(0); // never tried to play a source-less element
    expect(el.paused).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// In-flight seek guard (timeline-preview-audio-silent-and-volume-not-live B1①②).
// Mirrors VideoSourcePool._ensureSeeked 方案 B on the audio side: while a real
// <video>/<audio> is still seeking or cold-loading (readyState < 2), the
// per-frame planner must NOT keep re-assigning currentTime to chase a moving
// target — that restarts the seek every frame and the element never settles
// (mid-clip / clipStart-offset start → audio silent or stuttering). The fresh
// src swap is the exception: its initial seek must land even while loading,
// else the clip plays from source 0 (audio/video misalignment).
// ---------------------------------------------------------------------------

/** Fake audio element that also exposes the readiness/seeking the guard reads. */
class GuardableFakeAudio extends FakeAudio {
  seeking = false;
  readyState = 4; // HAVE_ENOUGH_DATA by default → guard idle unless overridden
}

type EventfulAudio = AudioElementLike & {
  paused: boolean;
  playCalls: number;
  rejectPlay: boolean;
  playedSources: string[];
  addEventListener(type: string, cb: () => void, opts?: { once?: boolean }): void;
  removeEventListener(type: string, cb: () => void): void;
  dispatchEvent(type: string): void;
  listenerCount(type: string): number;
};

function eventfulAudio(over: Partial<EventfulAudio> = {}): EventfulAudio {
  const handlers: Array<{ type: string; cb: () => void; once: boolean }> = [];
  const el = {
    src: '',
    currentTime: 0,
    volume: 1,
    paused: true,
    playCalls: 0,
    rejectPlay: true,
    playedSources: [] as string[],
    play(): Promise<void> {
      el.playCalls += 1;
      el.playedSources.push(el.src);
      if (el.rejectPlay) {
        el.paused = true;
        return Promise.reject(new Error('NotAllowedError'));
      }
      el.paused = false;
      return Promise.resolve();
    },
    pause() {
      el.paused = true;
    },
    addEventListener(type: string, cb: () => void, opts?: { once?: boolean }) {
      handlers.push({ type, cb, once: !!(opts && opts.once) });
    },
    removeEventListener(type: string, cb: () => void) {
      for (let i = handlers.length - 1; i >= 0; i--) {
        if (handlers[i].type === type && handlers[i].cb === cb) handlers.splice(i, 1);
      }
    },
    dispatchEvent(type: string) {
      const matched = handlers.filter((h) => h.type === type);
      for (const h of matched) {
        if (h.once) {
          const idx = handlers.indexOf(h);
          if (idx >= 0) handlers.splice(idx, 1);
        }
        h.cb();
      }
    },
    listenerCount(type: string) {
      return handlers.filter((h) => h.type === type).length;
    },
    ...over,
  };
  return el as unknown as EventfulAudio;
}

describe('AudioSyncPool.tick — in-flight seek guard (B1①②)', () => {
  it('does NOT re-assign currentTime while a seek is in flight (seeking === true)', () => {
    const el = new GuardableFakeAudio();
    el.src = AUDIO_URL; // matches the clip url → no src swap, so the guard is active
    el.currentTime = 0;
    el.seeking = true; // a seek is already running
    const pool = new AudioSyncPool(() => el);
    // clip reads source [10,15); at t=2 target source = 12 → drift huge → seek
    const groups = [audioGroup('t1', [clip('a', 0, 5, { clipStart: 10, clipEnd: 15 })])];

    pool.tick(groups, 2, true);

    expect(el.currentTime).toBe(0); // guard prevented interrupting the in-flight seek
  });

  it('does NOT re-assign currentTime while the element is cold-loading (readyState < 2)', () => {
    const el = new GuardableFakeAudio();
    el.src = AUDIO_URL;
    el.currentTime = 0;
    el.seeking = false;
    el.readyState = 0; // HAVE_NOTHING — still loading
    const pool = new AudioSyncPool(() => el);
    const groups = [audioGroup('t1', [clip('a', 0, 5, { clipStart: 10, clipEnd: 15 })])];

    pool.tick(groups, 2, true);

    expect(el.currentTime).toBe(0); // guard held off the re-seek during cold load
  });

  it('lands the initial seek on a fresh src swap even while readyState < 2 (srcJustSwapped exception)', () => {
    const el = new GuardableFakeAudio();
    el.src = ''; // no src yet → swap forced this tick
    el.currentTime = 0;
    el.seeking = false;
    el.readyState = 0; // still cold, but the fresh-src exception overrides the guard
    const pool = new AudioSyncPool(() => el);
    // mid-clip start: clip reads source [10,15); at t=2 target source = 12
    const groups = [audioGroup('t1', [clip('a', 0, 5, { clipStart: 10, clipEnd: 15 })])];

    pool.tick(groups, 2, true);

    expect(el.src).toBe(AUDIO_URL); // src assigned
    expect(el.currentTime).toBeCloseTo(12, 6); // initial seek landed despite cold load
  });

  it('re-seeks once the element is ready and not seeking (guard lifts)', () => {
    const el = new GuardableFakeAudio();
    el.src = AUDIO_URL;
    el.currentTime = 0;
    el.seeking = false;
    el.readyState = 4; // ready
    const pool = new AudioSyncPool(() => el);
    const groups = [audioGroup('t1', [clip('a', 0, 5, { clipStart: 10, clipEnd: 15 })])];

    pool.tick(groups, 2, true);

    expect(el.currentTime).toBeCloseTo(12, 6); // ready → drift seek applied
  });

  it('still plays (volume + play) even when the seek is guarded, so it self-heals next tick', () => {
    const el = new GuardableFakeAudio();
    el.src = AUDIO_URL;
    el.currentTime = 0;
    el.seeking = true;
    const pool = new AudioSyncPool(() => el);
    const groups = [audioGroup('t1', [clip('a', 0, 5, { clipStart: 10, clipEnd: 15, volume: 0.5 })])];

    pool.tick(groups, 2, true);

    expect(el.currentTime).toBe(0); // seek guarded
    expect(el.volume).toBe(0.5); // volume still applied
    expect(el.paused).toBe(false); // and play() still issued
  });
});

describe('AudioSyncPool.tick — canplay retry after rejected play()', () => {
  it('arms one canplay retry after a rejected play() and retries playback on canplay', async () => {
    const el = eventfulAudio({ rejectPlay: true });
    const pool = new AudioSyncPool(() => el);
    const groups = [audioGroup('t1', [clip('a', 0, 5, { url: 'song.mp3' })])];

    pool.tick(groups, 2, true);
    await Promise.resolve();
    await Promise.resolve();

    expect(el.playCalls).toBe(1);
    expect(el.listenerCount('canplay')).toBe(1);

    el.rejectPlay = false;
    el.dispatchEvent('canplay');

    expect(el.playCalls).toBe(2);
    expect(el.listenerCount('canplay')).toBe(0);
    expect(el.paused).toBe(false);
  });

  it('does not stack duplicate canplay listeners across repeated rejected ticks', async () => {
    const el = eventfulAudio({ rejectPlay: true });
    const pool = new AudioSyncPool(() => el);
    const groups = [audioGroup('t1', [clip('a', 0, 5, { url: 'song.mp3' })])];

    pool.tick(groups, 2, true);
    await Promise.resolve();
    await Promise.resolve();
    pool.tick(groups, 2, true);
    await Promise.resolve();
    await Promise.resolve();

    expect(el.playCalls).toBe(2);
    expect(el.listenerCount('canplay')).toBe(1);
  });

  it('keeps non-EventTarget fakes swallowing rejected play() without throwing', () => {
    const el = new FakeAudio();
    el.play = () => Promise.reject(new Error('interrupted'));
    const pool = new AudioSyncPool(() => el);
    const groups = [audioGroup('t1', [clip('a', 0, 5, { url: 'song.mp3' })])];

    expect(() => pool.tick(groups, 2, true)).not.toThrow();
    expect((el as unknown as { __ecliptrixAudioPlayKick?: unknown }).__ecliptrixAudioPlayKick).toBeUndefined();
  });

  it('disarms a pending retry when the pool pauses for a gap or user pause', async () => {
    const el = eventfulAudio({ rejectPlay: true });
    const pool = new AudioSyncPool(() => el);
    const groups = [audioGroup('t1', [clip('a', 0, 5, { url: 'song.mp3' })])];

    pool.tick(groups, 2, true);
    await Promise.resolve();
    await Promise.resolve();
    expect(el.listenerCount('canplay')).toBe(1);

    pool.tick(groups, 2, false);
    el.rejectPlay = false;
    el.dispatchEvent('canplay');

    expect(el.playCalls).toBe(1);
    expect(el.paused).toBe(true);
  });

  it('ignores stale canplay retries after a source swap and retries only the current source', async () => {
    const el = eventfulAudio({ rejectPlay: true });
    const pool = new AudioSyncPool(() => el);
    const groups = [
      audioGroup('t1', [
        clip('a', 0, 5, { url: 'first.mp3' }),
        clip('b', 5, 5, { url: 'second.mp3' }),
      ]),
    ];

    pool.tick(groups, 2, true);
    await Promise.resolve();
    await Promise.resolve();
    expect(el.listenerCount('canplay')).toBe(1);

    pool.tick(groups, 7, true);
    await Promise.resolve();
    await Promise.resolve();
    expect(el.listenerCount('canplay')).toBe(2);

    el.rejectPlay = false;
    el.dispatchEvent('canplay');

    expect(el.playCalls).toBe(3);
    expect(el.playedSources).toEqual(['first.mp3', 'second.mp3', 'second.mp3']);
    expect(el.paused).toBe(false);
  });
});
