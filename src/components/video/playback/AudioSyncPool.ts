/**
 * AudioSyncPool — audio-track synchronisation for the multi-track compositor
 * (spec 02 §2.5). Lifts the v1 inline HTMLAudio pool
 * (`VideoPlayerPanel.syncAudioPlayback`) onto the single composition clock.
 *
 * Design split so the per-tick DECISION logic is pure and testable WITHOUT
 * real audio elements:
 *   - `computeAudioSyncActions(groups, compositionTime, opts)` → one
 *     {@link AudioSyncAction} per track (seek / play / pause / hold). Pure.
 *   - `AudioSyncPool.tick(...)` → applies those actions to injected
 *     HTMLAudio-like elements. The only DOM-touching code, kept minimal.
 *
 * Time math goes through spec 01 `mapTimelineTimeToSourceTime` (NEVER hand
 * rolled), so preview audio reads the exact same source offset the video and
 * the export filtergraph use. Drift is debounced by `AUDIO_DRIFT_EPSILON_SEC`
 * (carried from v1) — a hard seek is emitted only when the deviation exceeds it.
 *
 * audioDetached (spec 01 §2.4): a video track whose active clip has
 * `audioDetached === true` MUST NOT drive audio — its embedded audio is owned
 * by the paired independent audio sequence. The compositor enforces "no double
 * audio" upstream: a video track's embedded audio plays from its OWN decode
 * `<video>` element (the VideoSourcePool mutes a detached/idle clip), so this
 * pool only ever owns independent `'audio'` tracks — the detached video track's
 * paired audio sequence carries the sound. (S4 removed the now-dead
 * `'embeddedVideoAudio'` group kind: the live path never emits it.)
 */

import { mapTimelineTimeToSourceTime } from '../timeline/domain/services/ClipTimeMapping';
import { activeClipAt, type SchedulableClip } from './TrackScheduler';
import { AUDIO_DRIFT_EPSILON_SEC } from './internal/constants';

/** One audio-bearing clip item the pool can read. */
export interface AudioSyncClip extends SchedulableClip {
  /** Item-level volume (0..1, may exceed via track gain), defaults to 1. */
  volume?: number;
  /**
   * Playable source URL for this clip. The pool assigns it to the element's
   * `src` before play/seek (mirroring the VideoSourcePool RC-B "比对键==赋值").
   * Absent → the clip has no resolvable source and the track is paused (the
   * pool never calls play() on a source-less element — the original silent bug).
   */
  url?: string;
}

/** One sync-able independent audio-sequence track. */
export interface AudioSyncGroup {
  trackId: string;
  /** Track muted → all its clips are paused regardless of activity. */
  muted: boolean;
  /** Track-level volume scalar (already normalized, e.g. 0..2). */
  volume: number;
  /**
   * 'audio' — an independent audio track (always a candidate to play). This is
   * the only kind on the live path; a video track's embedded audio plays from
   * its own decode `<video>`, not through this pool (S4).
   */
  kind: 'audio';
  items: readonly AudioSyncClip[];
}

export type AudioSyncActionKind = 'seek' | 'play' | 'pause' | 'hold';

/**
 * Intended action for one track this tick. `'hold'` means the element is
 * already playing at the right time and volume — no DOM write needed.
 */
export interface AudioSyncAction {
  trackId: string;
  action: AudioSyncActionKind;
  /** Target source-media time (seconds) when `action` is 'seek'. */
  targetSourceTime?: number;
  /** Effective volume to apply (clamped [0,1]) when not pausing. */
  volume?: number;
  /**
   * Source URL the element must hold before play/seek. Carried on 'play'/'seek'
   * actions; `_apply` assigns it to `el.src` only when it differs from the
   * element's current src (normalized), then plays. Absent on pause/hold.
   */
  url?: string;
}

export interface ComputeAudioSyncOptions {
  /**
   * When false the whole pool parks (everything pauses) — playback is not
   * running. Mirrors v1's `isPlaying` argument to `syncAudioPlayback`.
   */
  isPlaying: boolean;
  /** Current source time per track, to debounce seeks. Missing → treated as 0. */
  currentSourceTimeByTrack?: Readonly<Record<string, number>>;
  /** Whether each track's element is currently playing, to choose play/hold. */
  isElementPlayingByTrack?: Readonly<Record<string, boolean>>;
  /**
   * Current `src` assigned to each track's element, to detect a source swap.
   * Missing → treated as '' (forces a seek so the new src is assigned). Mirrors
   * the VideoSourcePool `needsSrcSwap` decision on the audio side.
   */
  currentSrcByTrack?: Readonly<Record<string, string>>;
  /** Drift threshold override (seconds); defaults to {@link AUDIO_DRIFT_EPSILON_SEC}. */
  driftEpsilonSec?: number;
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * Absolutise a src for stable equality. Identical to the VideoSourcePool helper
 * (kept local to avoid coupling the audio path to the video module): the
 * `<media>.src` IDL getter always reads back an ABSOLUTE url, while a local
 * material `seq.url` is usually relative (`/api/storage/files/audio/...`). Both
 * sides go through this so "did the source change?" compares equal and we never
 * re-assign `src` every frame (which would interrupt play() → AbortError churn).
 */
function normalizeSrc(src: string | null | undefined): string {
  if (!src) return '';
  try {
    const base =
      typeof window !== 'undefined' && window.location
        ? window.location.href
        : 'http://localhost/';
    return new URL(src, base).href;
  } catch {
    return src;
  }
}

/**
 * Effective per-clip volume = clip.volume (default 1) * track.volume, clamped
 * to [0,1] (spec 02 §2.5).
 */
export function computeEffectiveVolume(
  clipVolume: number | undefined,
  trackVolume: number,
): number {
  const item = clipVolume === undefined ? 1 : clipVolume;
  return clampVolume(item * trackVolume);
}

/**
 * Decide what each track's audio element should do at `compositionTime`. Pure:
 * no DOM, no timers. One action per group, in group order.
 *
 * Rules (per spec 02 §2.5 / spec 01 §2.4):
 *   - Not playing             → 'pause'.
 *   - Track muted             → 'pause'.
 *   - No active clip at `t`   → 'pause' (gap).
 *   - Active clip with no url  → 'pause' (cannot play a source-less element).
 *   - Active clip whose url ≠ element's current src → 'seek' (re-assigns src +
 *     currentTime; mirrors VideoSourcePool needsSrcSwap, since a fresh src
 *     starts at 0 and must be re-positioned).
 *   - Active clip, |current - target| > drift → 'seek' to target (+ volume + url).
 *   - Active clip, within drift, element already playing → 'hold' (+ volume).
 *   - Active clip, within drift, element paused → 'play' (+ volume + url).
 */
export function computeAudioSyncActions(
  groups: readonly AudioSyncGroup[],
  compositionTime: number,
  opts: ComputeAudioSyncOptions,
): AudioSyncAction[] {
  const drift = opts.driftEpsilonSec ?? AUDIO_DRIFT_EPSILON_SEC;
  const currentByTrack = opts.currentSourceTimeByTrack ?? {};
  const playingByTrack = opts.isElementPlayingByTrack ?? {};
  const currentSrcByTrack = opts.currentSrcByTrack ?? {};

  return groups.map((group) => {
    if (!opts.isPlaying || group.muted) {
      return { trackId: group.trackId, action: 'pause' };
    }

    const hit = activeClipAt(group.items, compositionTime);
    if (!hit) {
      return { trackId: group.trackId, action: 'pause' };
    }

    const url = hit.clip.url;
    if (!url) {
      // No resolvable source → pause. Calling play() on a source-less element is
      // exactly the original silent-audio bug; never do it.
      return { trackId: group.trackId, action: 'pause' };
    }

    const targetSourceTime = mapTimelineTimeToSourceTime(hit.clip, compositionTime);
    const volume = computeEffectiveVolume(hit.clip.volume, group.volume);
    const current = currentByTrack[group.trackId] ?? 0;
    const srcChanged =
      normalizeSrc(currentSrcByTrack[group.trackId]) !== normalizeSrc(url);

    // A source swap MUST be expressed as a seek: assigning a new src resets the
    // element to time 0, so we always re-position it (only 'seek' carries the
    // target time). Otherwise fall back to the drift de-bounce.
    if (srcChanged || Math.abs(current - targetSourceTime) > drift) {
      return { trackId: group.trackId, action: 'seek', targetSourceTime, volume, url };
    }
    const isPlaying = playingByTrack[group.trackId] === true;
    return {
      trackId: group.trackId,
      action: isPlaying ? 'hold' : 'play',
      volume,
      url,
    };
  });
}

/**
 * Minimal HTMLAudioElement surface the pool writes to. Real
 * `HTMLAudioElement` satisfies it; tests pass a fake object.
 */
export interface AudioElementLike {
  /**
   * The element's media source. The pool assigns it before play/seek when the
   * active clip's url changes (RC-B). Real `HTMLMediaElement` exposes it; the
   * engine adapter (`toAudioElement`) passes it through to the underlying
   * `<video>`/`<audio>`.
   */
  src: string;
  currentTime: number;
  volume: number;
  readonly paused: boolean;
  play(): Promise<void> | void;
  pause(): void;
}

/** Resolves (or lazily creates) the audio element bound to a track id. */
export type AudioElementResolver = (trackId: string) => AudioElementLike | null;

/**
 * Thin stateful wrapper that applies pure {@link computeAudioSyncActions} to
 * injected audio elements. Keeps DOM-touching code out of the tested path.
 */
export class AudioSyncPool {
  private readonly _resolve: AudioElementResolver;

  constructor(resolveElement: AudioElementResolver) {
    this._resolve = resolveElement;
  }

  /**
   * Apply one tick. Reads each element's live `currentTime` / `paused` to feed
   * the pure planner, then writes back the planned action. Returns the actions
   * applied (for diagnostics / tests).
   */
  tick(
    groups: readonly AudioSyncGroup[],
    compositionTime: number,
    isPlaying: boolean,
  ): AudioSyncAction[] {
    const currentSourceTimeByTrack: Record<string, number> = {};
    const isElementPlayingByTrack: Record<string, boolean> = {};
    const currentSrcByTrack: Record<string, string> = {};
    for (const group of groups) {
      const el = this._resolve(group.trackId);
      if (!el) continue;
      currentSourceTimeByTrack[group.trackId] = el.currentTime;
      isElementPlayingByTrack[group.trackId] = !el.paused;
      currentSrcByTrack[group.trackId] = el.src;
    }

    const actions = computeAudioSyncActions(groups, compositionTime, {
      isPlaying,
      currentSourceTimeByTrack,
      isElementPlayingByTrack,
      currentSrcByTrack,
    });

    for (const action of actions) {
      this._apply(action);
    }
    return actions;
  }

  private _apply(action: AudioSyncAction): void {
    const el = this._resolve(action.trackId);
    if (!el) return;
    switch (action.action) {
      case 'pause':
        if (!el.paused) el.pause();
        return;
      case 'seek':
        // Assign src BEFORE currentTime: a new src resets the element to time 0,
        // so the seek must follow it. No-op (normalized compare) when unchanged,
        // so a pure drift seek never churns src → no AbortError.
        this._ensureSrc(el, action.url);
        if (action.targetSourceTime !== undefined) {
          el.currentTime = action.targetSourceTime;
        }
        if (action.volume !== undefined) el.volume = action.volume;
        this._ensurePlaying(el);
        return;
      case 'play':
        this._ensureSrc(el, action.url);
        if (action.volume !== undefined) el.volume = action.volume;
        this._ensurePlaying(el);
        return;
      case 'hold':
        if (action.volume !== undefined) el.volume = action.volume;
        return;
    }
  }

  /**
   * Assign `el.src` only when the desired url differs from the element's current
   * src (both normalized to absolute). Mirrors VideoSourcePool RC-B so the
   * compare key equals the assigned value and src is never re-written every
   * frame (which would interrupt play() and raise AbortError).
   */
  private _ensureSrc(el: AudioElementLike, url: string | undefined): void {
    if (!url) return;
    if (normalizeSrc(el.src) === normalizeSrc(url)) return;
    el.src = url;
  }

  private _ensurePlaying(el: AudioElementLike): void {
    if (!el.paused) return;
    const result = el.play();
    // The browser rejects play() when interrupted by a near-simultaneous
    // pause/seek; that is benign and self-heals next tick, so swallow only the
    // promise rejection (NOT a structural error) to avoid an unhandled
    // rejection. Non-promise returns (test fakes) need no handling.
    if (result && typeof (result as Promise<void>).catch === 'function') {
      (result as Promise<void>).catch(() => undefined);
    }
  }
}
