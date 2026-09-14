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
import { MAX_EFFECTIVE_VOLUME } from '../timeline/infrastructure/effectiveVolume';

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
  /**
   * Effective volume in [0, MAX_EFFECTIVE_VOLUME] when not pausing. Values above
   * 1 reach the injected `applyVolume` (ME-06 gain); the default writer clamps
   * the element to [0,1].
   */
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

/** Clamp to the effective range export applies; NaN/±∞ → 0. */
function clampEffectiveVolume(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, MAX_EFFECTIVE_VOLUME);
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
 * Effective per-clip volume = clip.volume (default 1) * group volume (the
 * preview master volume), clamped to [0, MAX_EFFECTIVE_VOLUME] (spec 02 §2.5,
 * ME-06). The element write clamps it again to [0,1] unless a gain stage
 * carries the part above 1.
 */
export function computeMediaElementVolume(
  clipVolume: number | undefined,
  trackVolume: number,
): number {
  const item = clipVolume === undefined ? 1 : clipVolume;
  return clampEffectiveVolume(item * trackVolume);
}

/** Preview audio hooks injected by the host (ME-06). Both default to plain element writes. */
export interface AudioSyncPoolOptions {
  /** Writes an effective [0, MAX_EFFECTIVE_VOLUME] volume to the track's element. */
  applyVolume?: (trackId: string, element: AudioElementLike, volume: number) => void;
  /**
   * Called before `src` is assigned; returns the element to assign on — a fresh
   * one when the current element is gain-routed and cannot play `url`.
   */
  prepareElementForSrc?: (trackId: string, element: AudioElementLike, url: string) => AudioElementLike;
}

/** The default volume writer: the element's own [0,1] range, no gain. */
function writeElementVolume(_trackId: string, element: AudioElementLike, volume: number): void {
  element.volume = Math.min(1, clampEffectiveVolume(volume));
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
    const volume = computeMediaElementVolume(hit.clip.volume, group.volume);
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
  /**
   * Pipeline readiness (`HTMLMediaElement.readyState`). Read by the in-flight
   * seek guard in {@link AudioSyncPool._assignCurrentTime}: while the element
   * has not reached `HAVE_CURRENT_DATA` (< 2) it is still cold-loading, so
   * re-assigning `currentTime` every frame would restart the load and keep it
   * from ever settling — the audio mirror of the play-from-middle black screen
   * (timeline-preview-midclip-play-black-screen 方案 B). Real `HTMLMediaElement`
   * exposes it; plain test fakes may omit it (treated as "ready"). Optional +
   * read-only so existing structural fakes still satisfy the interface.
   */
  readonly readyState?: number;
  /**
   * Whether a seek is currently in flight (a `currentTime` assignment that has
   * not yet settled to a `seeked`). Read by the same guard so the per-frame
   * planner never interrupts a running seek. Real `HTMLMediaElement` exposes it;
   * plain test fakes may omit it (treated as "not seeking"). Optional + read-only.
   */
  readonly seeking?: boolean;
  play(): Promise<void> | void;
  pause(): void;
}

/** Resolves (or lazily creates) the audio element bound to a track id. */
export type AudioElementResolver = (trackId: string) => AudioElementLike | null;

type AudioCanplayRetryMarker = {
  epoch: number;
  src: string;
};

type AudioCanplayRetryTarget = AudioElementLike & {
  addEventListener?: (
    type: string,
    listener: () => void,
    opts?: { once?: boolean },
  ) => void;
  __ecliptrixAudioPlayKick?: AudioCanplayRetryMarker;
  __ecliptrixAudioPlayRetryEpoch?: number;
};

/**
 * Thin stateful wrapper that applies pure {@link computeAudioSyncActions} to
 * injected audio elements. Keeps DOM-touching code out of the tested path.
 */
export class AudioSyncPool {
  private readonly _resolve: AudioElementResolver;
  private readonly _applyVolume: NonNullable<AudioSyncPoolOptions['applyVolume']>;
  private readonly _prepareElementForSrc: AudioSyncPoolOptions['prepareElementForSrc'];

  constructor(resolveElement: AudioElementResolver, options: AudioSyncPoolOptions = {}) {
    this._resolve = resolveElement;
    this._applyVolume = options.applyVolume ?? writeElementVolume;
    this._prepareElementForSrc = options.prepareElementForSrc;
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
    const resolved = this._resolve(action.trackId);
    if (!resolved) return;
    switch (action.action) {
      case 'pause':
        this._disarmCanplayRetry(resolved);
        if (!resolved.paused) resolved.pause();
        return;
      case 'seek': {
        // Assign src BEFORE currentTime: a new src resets the element to time 0,
        // so the seek must follow it. No-op (normalized compare) when unchanged,
        // so a pure drift seek never churns src → no AbortError.
        const { element, swapped } = this._ensureSrc(action.trackId, resolved, action.url);
        if (action.targetSourceTime !== undefined) {
          this._assignCurrentTime(element, action.targetSourceTime, swapped);
        }
        this._writeVolume(action, element);
        this._ensurePlaying(element);
        return;
      }
      case 'play': {
        const { element } = this._ensureSrc(action.trackId, resolved, action.url);
        this._writeVolume(action, element);
        this._ensurePlaying(element);
        return;
      }
      case 'hold':
        this._writeVolume(action, resolved);
        return;
    }
  }

  private _writeVolume(action: AudioSyncAction, element: AudioElementLike): void {
    if (action.volume !== undefined) this._applyVolume(action.trackId, element, action.volume);
  }

  /**
   * Assign `el.src` only when the desired url differs from the element's current
   * src (both normalized to absolute). Mirrors VideoSourcePool RC-B so the
   * compare key equals the assigned value and src is never re-written every
   * frame (which would interrupt play() and raise AbortError).
   *
   * Returns the element that now holds the src (the host may swap a gain-routed
   * one, ME-06) and whether it actually swapped the src this tick — the caller
   * uses that as the `srcJustSwapped` exception for the in-flight seek guard (a
   * fresh src genuinely needs its initial seek, even while still loading).
   */
  private _ensureSrc(
    trackId: string,
    el: AudioElementLike,
    url: string | undefined,
  ): { element: AudioElementLike; swapped: boolean } {
    if (!url) return { element: el, swapped: false };
    if (normalizeSrc(el.src) === normalizeSrc(url)) return { element: el, swapped: false };
    this._disarmCanplayRetry(el);
    const element = this._prepareElementForSrc ? this._prepareElementForSrc(trackId, el, url) : el;
    element.src = url;
    return { element, swapped: true };
  }

  /**
   * Assign `el.currentTime`, guarding against interrupting an in-flight or
   * cold-loading seek. Mirrors `VideoSourcePool._ensureSeeked` (方案 B): once a
   * fresh src has just been assigned (`srcJustSwapped`) the initial seek MUST
   * land even while `readyState < 2` (otherwise a mid-clip/`clipStart`-offset
   * source would play from 0 — audio/video misalignment). Otherwise, while the
   * element is still seeking or has not reached `HAVE_CURRENT_DATA`, leave
   * `currentTime` alone so the free-running composition clock does not restart
   * the seek every frame and stall it below a playable state. Fakes without
   * `seeking`/`readyState` (undefined) skip the guard and behave as before.
   */
  private _assignCurrentTime(
    el: AudioElementLike,
    targetSourceTime: number,
    srcJustSwapped: boolean,
  ): void {
    if (!srcJustSwapped) {
      if (el.seeking === true) return;
      if (el.readyState !== undefined && el.readyState < 2) return;
    }
    el.currentTime = targetSourceTime;
  }

  private _ensurePlaying(el: AudioElementLike): void {
    if (!el.paused) return;
    const retryTarget = el as AudioCanplayRetryTarget;
    const epoch = retryTarget.__ecliptrixAudioPlayRetryEpoch ?? 0;
    const src = normalizeSrc(el.src);
    const result = el.play();
    // The browser rejects play() when interrupted by a near-simultaneous
    // pause/seek; that is benign and self-heals next tick, so swallow only the
    // promise rejection (NOT a structural error) to avoid an unhandled
    // rejection. Non-promise returns (test fakes) need no handling.
    if (result && typeof (result as Promise<void>).catch === 'function') {
      (result as Promise<void>).catch(() => {
        if ((retryTarget.__ecliptrixAudioPlayRetryEpoch ?? 0) !== epoch) return;
        if (normalizeSrc(el.src) !== src) return;
        this._scheduleCanplayRetry(el, epoch, src);
      });
    }
  }

  private _scheduleCanplayRetry(el: AudioElementLike, epoch: number, src: string): void {
    const target = el as AudioCanplayRetryTarget;
    if (typeof target.addEventListener !== 'function' || target.__ecliptrixAudioPlayKick) {
      // Plain structural fakes keep the old swallow-only behavior; already
      // armed elements avoid stacking one canplay listener per rejected tick.
      return;
    }

    const marker: AudioCanplayRetryMarker = { epoch, src };
    target.__ecliptrixAudioPlayKick = marker;
    target.addEventListener(
      'canplay',
      () => {
        if (target.__ecliptrixAudioPlayKick !== marker) return;
        target.__ecliptrixAudioPlayKick = undefined;
        if ((target.__ecliptrixAudioPlayRetryEpoch ?? 0) !== marker.epoch) return;
        if (normalizeSrc(el.src) !== marker.src) return;
        if (!el.paused) return;

        const retry = el.play();
        if (retry && typeof (retry as Promise<void>).catch === 'function') {
          (retry as Promise<void>).catch(() => undefined);
        }
      },
      { once: true },
    );
  }

  private _disarmCanplayRetry(el: AudioElementLike): void {
    const target = el as AudioCanplayRetryTarget;
    target.__ecliptrixAudioPlayKick = undefined;
    target.__ecliptrixAudioPlayRetryEpoch =
      (target.__ecliptrixAudioPlayRetryEpoch ?? 0) + 1;
  }
}
