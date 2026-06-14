/**
 * VideoSourcePool — per-track A/B decode-source pool for the multi-track
 * compositor (spec 02 §2.2 / §2.6).
 *
 * Evolves the single-global A/B idea of {@link ./AbBufferController} into a
 * PER-VISIBLE-TRACK pair: each visible video track owns one active decode
 * `<video>` plus one prewarm `<video>` (A/B), so two tracks can be decoded and
 * composited in the same frame. The legacy controller multiplexed one A/B pair
 * across the single active sequence and therefore could only ever paint one
 * video; that is exactly the limitation S2 removes.
 *
 * Two hard invariants, both inherited from spec 02:
 *
 *   1. RC-B "比对键 == 赋值" (spec 02 §2.6): the key used to decide "did this
 *      track's source change?" is the SAME `resolveSource(seq)` result that is
 *      actually assigned to the element's `src`. We never compare a stale
 *      snapshot URL against a freshly-resolved one — that mismatch is the
 *      documented black-screen root cause. The planner returns `desiredUrl` and
 *      the applier assigns exactly that string. A caller injects `resolveSource`
 *      = `resolveSequencePlaybackUrl(seq, liveMaterials, lockedOpts)` so live
 *      material is authoritative and the locked options are identical on both
 *      the compare and the assign.
 *
 *   2. Source time goes through spec 01 `mapTimelineTimeToSourceTime` via
 *      {@link TrackScheduler.activeClipAt} — never hand-rolled cumulative
 *      offsets. Seek de-bounce uses {@link VIDEO_SEEK_TOLERANCE_SEC}.
 *
 * Structure (mirrors the S1 AudioSyncPool split so the decision logic is
 * jsdom-testable WITHOUT real `<video>`):
 *   - `computeSourcePlan(groups, t, currentState, resolveSource)` → one
 *     {@link TrackSourcePlan} per track. PURE.
 *   - `VideoSourcePool` class → applies the plan to injected
 *     {@link VideoElementLike} objects. The only DOM-touching code, minimal.
 */

import { activeClipAt, prewarmNextAt } from './TrackScheduler';
import { VIDEO_SEEK_TOLERANCE_SEC } from './internal/constants';
import type { VideoTrackGroup } from './types';
import type { VideoSequenceItem } from '../types';

/**
 * Minimal `<video>` surface the pool reads/writes. Real `HTMLVideoElement`
 * satisfies it; tests pass a plain object. Kept structural so the decision path
 * never touches raw DOM.
 */
export interface VideoElementLike {
  src: string;
  currentTime: number;
  readonly readyState: number;
  /**
   * Whether this decode element's own audio is silenced. A NON-detached video
   * track's embedded audio plays from THIS element (so it must be unmuted); a
   * detached track is muted because its audio is owned by a paired independent
   * audio sequence (spec 01 §2.4 / RISK 2 routing). Optional so plain test fakes
   * need not declare it.
   */
  muted?: boolean;
  /**
   * Output loudness of this decode element's OWN (embedded) audio, in [0,1].
   * Carries the active clip's effective per-clip volume (item × track, already
   * composited upstream by `CompositionAdapter.extractVideoSequences`) so a
   * non-detached video track's preview loudness follows live track/clip volume
   * drags — mirroring `AudioSyncPool` for independent audio tracks. Real
   * `HTMLVideoElement` exposes it; optional so plain structural test fakes that
   * predate volume need not declare it.
   */
  volume?: number;
  /**
   * Whether the element is currently paused (not advancing). Read by the §5.2
   * per-frame state machine to decouple "make it paint" (start MUTED so muted
   * autoplay — allowed by every policy — gets it decoding) from "restore its
   * audio route" (only once it is CONFIRMED playing, by THIS frame's plan, so
   * there is no stale-closure mis-route). Real `HTMLVideoElement` exposes it;
   * test fakes already declare it. Optional + read-only so a bare structural
   * fake still satisfies the interface.
   */
  readonly paused?: boolean;
  /**
   * Whether a seek is currently in flight (a `currentTime` assignment that has
   * not yet settled to a `seeked`). Read by the in-flight seek guard in
   * {@link VideoSourcePool._ensureSeeked} so the per-frame planner never
   * re-assigns `currentTime` while a seek is still running — repeatedly
   * interrupting a mid-clip seek while the free-running composition clock raced
   * ahead is exactly what kept the element stuck below `readyState 2`, i.e. the
   * play-from-middle black screen
   * (timeline-preview-midclip-play-black-screen 方案 B). Real `HTMLVideoElement`
   * exposes it; plain test fakes may omit it (treated as "not seeking"). Optional
   * + read-only.
   */
  readonly seeking?: boolean;
  play(): Promise<void> | void;
  pause(): void;
}

/**
 * Resolves the playable URL for a sequence at play time. Callers inject
 * `(seq) => resolveSequencePlaybackUrl(seq, liveMaterials, lockedOpts)?.url`
 * so the SAME live-material resolution drives both the change-decision and the
 * assignment (RC-B). Returning `null` means "no playable source right now".
 */
export type SequenceSourceResolver = (seq: VideoSequenceItem) => string | null;

/**
 * Current per-track element state the planner needs to make de-bounce
 * decisions without touching DOM. The pool reads these off live elements before
 * planning; tests supply them directly.
 */
export interface TrackElementState {
  /** The element's currently-assigned src (normalized by the caller / empty). */
  currentSrc: string;
  /** The element's current decode time (seconds). */
  currentTime: number;
  /** Whether a prewarm element exists for this track (enables prewarm planning). */
  hasPrewarm: boolean;
  /** The prewarm element's currently-assigned src (for prewarm de-dupe). */
  prewarmSrc?: string;
}

export type CurrentStateByTrack = Readonly<Record<string, TrackElementState>>;

/** Per-track decision for one frame. */
export interface TrackSourcePlan {
  trackId: string;
  /** Z-order (lower draws first) — carried through for layer assembly. */
  z: number;
  /**
   * URL the active element must hold this frame, or null when the track has no
   * active clip / unresolvable source (the track contributes nothing).
   */
  desiredUrl: string | null;
  /** Mapped source-media time to read (via ClipTimeMapping), or null when idle. */
  desiredSourceTime: number | null;
  /** True when `desiredUrl` differs from the element's current src (needs assign). */
  needsSrcSwap: boolean;
  /** True when |currentTime - desiredSourceTime| exceeds the seek tolerance. */
  needsSeek: boolean;
  /** Active clip id (for diagnostics / per-track scheduling), or null when idle. */
  activeClipId: string | null;
  /** URL of the next clip to prewarm into the B element, or null when none. */
  prewarmUrl: string | null;
  /**
   * Whether the active element's OWN audio must be muted this frame. True when
   * the active clip's audio is detached (paired audio track owns it → no double
   * audio); false otherwise so a non-detached track's embedded audio plays from
   * its decode element (RISK 2 routing). Idle tracks are muted.
   */
  muteAudio: boolean;
  /**
   * Output loudness [0,1] to apply to the active element's OWN audio this frame.
   * The active clip's effective volume (`seq.volume`, already item × track and
   * clamped upstream) re-clamped to [0,1]; defaults to 1 when absent. Written by
   * {@link VideoSourcePool._apply} on the "confirmed playing" / "paused hold"
   * branches so preview loudness tracks live volume changes. Idle/detached
   * tracks carry 1 here but never sound (the `muteAudio` route silences them).
   */
  desiredVolume: number;
}

/**
 * Clamp a raw volume to the [0,1] range a media element accepts. Mirrors
 * `AudioSyncPool.clampVolume` semantics (kept local to avoid coupling the video
 * module to the audio one): NaN/±∞ → 0, ≤0 → 0, ≥1 → 1. `seq.volume` is already
 * the item × track composite (clamped to [0,2] upstream), so this is a single
 * final clamp — never re-multiply by track volume here (that would double-apply).
 */
function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

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
 * Compute the per-track source plan at composition time `t`. PURE.
 *
 * For each visible video track:
 *   - find the active clip (`activeClipAt` → spec 01 source time),
 *   - resolve its desired URL via the injected resolver (SAME resolution used
 *     for assignment — RC-B),
 *   - decide `needsSrcSwap` by comparing the resolved URL against the element's
 *     CURRENT src (both normalized), not against any stale sequence snapshot,
 *   - decide `needsSeek` by the {@link VIDEO_SEEK_TOLERANCE_SEC} de-bounce,
 *   - resolve the next clip's URL to prewarm (when a B element exists).
 */
export function computeSourcePlan(
  groups: readonly VideoTrackGroup[],
  t: number,
  currentState: CurrentStateByTrack,
  resolveSource: SequenceSourceResolver,
  seekToleranceSec: number = VIDEO_SEEK_TOLERANCE_SEC,
): TrackSourcePlan[] {
  return groups.map((group) => {
    const state = currentState[group.trackId];
    const hit = activeClipAt(group.items, t);
    if (!hit) {
      return idlePlan(group.trackId, group.z);
    }

    const desiredUrl = resolveSource(hit.clip);
    if (!desiredUrl) {
      return idlePlan(group.trackId, group.z, hit.clip.id);
    }

    const currentSrc = state ? state.currentSrc : '';
    const needsSrcSwap = normalizeSrc(currentSrc) !== normalizeSrc(desiredUrl);

    const desiredSourceTime = hit.sourceTime;
    const currentTime = state ? state.currentTime : 0;
    // A fresh src always needs an initial seek; otherwise debounce.
    const needsSeek =
      needsSrcSwap ||
      Math.abs(currentTime - desiredSourceTime) > seekToleranceSec;

    return {
      trackId: group.trackId,
      z: group.z,
      desiredUrl,
      desiredSourceTime,
      needsSrcSwap,
      needsSeek,
      activeClipId: hit.clip.id,
      prewarmUrl: computePrewarmUrl(group.items, t, resolveSource, state),
      // Embedded audio plays from this element unless the clip is detached.
      muteAudio: hit.clip.audioDetached === true,
      // Per-clip effective loudness (item × track, already composited into
      // `seq.volume` upstream); single final clamp to the element's [0,1].
      desiredVolume: clampVolume(hit.clip.volume ?? 1),
    };
  });
}

function idlePlan(trackId: string, z: number, clipId: string | null = null): TrackSourcePlan {
  return {
    trackId,
    z,
    desiredUrl: null,
    desiredSourceTime: null,
    needsSrcSwap: false,
    needsSeek: false,
    activeClipId: clipId,
    prewarmUrl: null,
    // An idle track contributes no audio — keep its decode element muted.
    muteAudio: true,
    // Idle tracks are silenced via `muteAudio`; the value here is inert.
    desiredVolume: 1,
  };
}

/**
 * Resolve the next-clip URL to warm into the B element, or null when there is
 * no next clip, no prewarm element, or it is already warmed to that URL.
 */
function computePrewarmUrl(
  items: readonly VideoSequenceItem[],
  t: number,
  resolveSource: SequenceSourceResolver,
  state: TrackElementState | undefined,
): string | null {
  if (!state || !state.hasPrewarm) return null;
  const next = prewarmNextAt(items, t);
  if (!next) return null;
  const url = resolveSource(next.clip);
  if (!url) return null;
  if (state.prewarmSrc && normalizeSrc(state.prewarmSrc) === normalizeSrc(url)) {
    // Already warmed to this clip — no re-load needed.
    return null;
  }
  return url;
}

/** One physical A/B element pair for a track. */
export interface TrackElements {
  active: VideoElementLike;
  prewarm: VideoElementLike | null;
}

/** Resolves (or lazily creates) the A/B element pair bound to a track id. */
export type TrackElementResolver = (trackId: string) => TrackElements | null;

/**
 * Thin stateful applier. Reads each track's live element state, runs the pure
 * planner, then assigns src / seeks / prewarms. The assigned src is byte-equal
 * to the `desiredUrl` the planner compared against (RC-B).
 */
export class VideoSourcePool {
  private readonly _resolveElements: TrackElementResolver;
  private readonly _resolveSource: SequenceSourceResolver;
  private readonly _seekTolerance: number;

  constructor(
    resolveElements: TrackElementResolver,
    resolveSource: SequenceSourceResolver,
    seekToleranceSec: number = VIDEO_SEEK_TOLERANCE_SEC,
  ) {
    this._resolveElements = resolveElements;
    this._resolveSource = resolveSource;
    this._seekTolerance = seekToleranceSec;
  }

  /**
   * Plan + apply one frame. Returns, per track, the active `<video>` element to
   * draw (or null when idle) plus the plan (for diagnostics / layer assembly).
   * Assignment never re-resolves the URL — it uses the planned `desiredUrl`.
   */
  sync(
    groups: readonly VideoTrackGroup[],
    t: number,
    isPlaying: boolean,
  ): { plan: TrackSourcePlan; element: VideoElementLike | null }[] {
    const currentState = this._snapshotState(groups);
    const plans = computeSourcePlan(
      groups,
      t,
      currentState,
      this._resolveSource,
      this._seekTolerance,
    );
    return plans.map((plan) => ({
      plan,
      element: this._apply(plan, isPlaying),
    }));
  }

  private _snapshotState(groups: readonly VideoTrackGroup[]): CurrentStateByTrack {
    const out: Record<string, TrackElementState> = {};
    for (const group of groups) {
      const els = this._resolveElements(group.trackId);
      if (!els) continue;
      out[group.trackId] = {
        currentSrc: els.active.src ?? '',
        currentTime: els.active.currentTime ?? 0,
        hasPrewarm: els.prewarm !== null,
        prewarmSrc: els.prewarm?.src ?? '',
      };
    }
    return out;
  }

  private _apply(plan: TrackSourcePlan, isPlaying: boolean): VideoElementLike | null {
    const els = this._resolveElements(plan.trackId);
    if (!els) return null;
    const el = els.active;

    if (plan.desiredUrl === null || plan.desiredSourceTime === null) {
      // Idle track — mute + pause its decode source so it is not heard / not
      // advancing.
      el.muted = true;
      this._pauseQuietly(el);
      return null;
    }

    if (plan.needsSrcSwap) {
      // RC-B: assign exactly the planned URL (== the compare key).
      el.src = plan.desiredUrl;
    }
    this._ensureSeeked(el, plan.desiredSourceTime, plan.needsSrcSwap);

    if (isPlaying) {
      // §5.1 / §5.2: decouple "make the element decode/paint" from "should it be
      // heard". An element not yet confirmed playing is (re)started MUTED — muted
      // autoplay is allowed under every autoplay policy, so this guarantees it
      // decodes and paints. Only once it is CONFIRMED playing do we restore this
      // frame's audio route, reading the CURRENT plan.muteAudio (never a captured
      // closure) so switching to a detached clip mutes on the very next frame.
      if (el.paused === true) {
        el.muted = true;
        this._kickPlay(el);
      } else {
        // Confirmed playing — route embedded audio: a non-detached track's
        // decode element carries its own audio (unmuted); a detached track is
        // muted so its paired audio sequence is the sole source (no double
        // audio). RISK 2.
        el.muted = plan.muteAudio;
        // Apply this frame's per-clip loudness so live track/clip volume drags
        // are heard immediately (mirrors AudioSyncPool for audio tracks).
        el.volume = plan.desiredVolume;
      }
    } else {
      // Paused: hold the final audio route but make no sound.
      el.muted = plan.muteAudio;
      el.volume = plan.desiredVolume;
      this._pauseQuietly(el);
    }

    if (plan.prewarmUrl && els.prewarm) {
      this._warm(els.prewarm, plan.prewarmUrl);
    }
    return el;
  }

  /**
   * Seek the element to `targetSourceTime` only when outside tolerance (or when
   * the src was just swapped, which always needs the initial seek). De-bounced
   * so steady playback never re-seeks every frame.
   *
   * In-flight seek guard (timeline-preview-midclip-play-black-screen 方案 B):
   * once a seek is already running (`el.seeking === true`) or the element has
   * dropped below `HAVE_CURRENT_DATA` (`readyState < 2`, i.e. mid seek/buffer),
   * do NOT re-assign `currentTime`. Re-assigning it every frame while the
   * free-running composition clock raced ahead is what kept restarting the
   * mid-clip seek, so the element never reached a drawable state and the
   * compositor only ever painted the black letterbox. A fresh src swap bypasses
   * the guard because the new element genuinely needs its initial seek to the
   * target; once it settles the readiness path picks the seek back up.
   */
  private _ensureSeeked(
    el: VideoElementLike,
    targetSourceTime: number,
    srcJustSwapped: boolean,
  ): void {
    if (srcJustSwapped) {
      this._assignCurrentTime(el, targetSourceTime);
      return;
    }
    // Never interrupt an in-flight / mid-buffer seek (方案 B).
    if (el.seeking === true || el.readyState < 2) return;
    if (Math.abs(el.currentTime - targetSourceTime) > this._seekTolerance) {
      this._assignCurrentTime(el, targetSourceTime);
    }
  }

  private _assignCurrentTime(el: VideoElementLike, targetSourceTime: number): void {
    try {
      el.currentTime = targetSourceTime;
    } catch {
      // jsdom / unsupported element — the next ready tick reconciles.
    }
  }

  private _warm(prewarm: VideoElementLike, url: string): void {
    if (normalizeSrc(prewarm.src) === normalizeSrc(url)) return;
    prewarm.src = url;
    // Keep the prewarm element parked so it decodes without driving the clock.
    this._pauseQuietly(prewarm);
  }

  /**
   * Ensure the element is decoding/painting (§5.1). Starts it MUTED — muted
   * autoplay is allowed by every autoplay policy — so the canvas can `drawImage`
   * it; the audio route is restored by {@link _apply} once `el.paused === false`.
   *
   * If `play()` rejects (autoplay gate / interrupted by a near-simultaneous
   * seek), retry ONCE when the element next fires `canplay` — but ONLY when it is
   * a real `EventTarget`. The structural {@link VideoElementLike} stub has no
   * `addEventListener` (R-4), so a plain fake keeps the old swallow-the-rejection
   * behavior and never throws. `__ecliptrixPlayKick` de-dupes the listener so a
   * rejection every frame does not stack listeners (idempotent).
   */
  private _kickPlay(el: VideoElementLike): void {
    el.muted = true;
    const result = el.play();
    if (!result || typeof (result as Promise<void>).catch !== 'function') {
      return;
    }
    (result as Promise<void>).catch(() => {
      this._scheduleCanplayRetry(el);
    });
  }

  private _scheduleCanplayRetry(el: VideoElementLike): void {
    const target = el as VideoElementLike & {
      addEventListener?: (
        type: string,
        listener: () => void,
        opts?: { once?: boolean },
      ) => void;
      __ecliptrixPlayKick?: boolean;
    };
    if (typeof target.addEventListener !== 'function' || target.__ecliptrixPlayKick) {
      // Plain object stub (no EventTarget) → mirror the old behavior: the
      // rejection is already swallowed by the .catch above. Already-armed → skip.
      return;
    }
    target.__ecliptrixPlayKick = true;
    target.addEventListener(
      'canplay',
      () => {
        target.__ecliptrixPlayKick = false;
        target.muted = true;
        const retry = el.play();
        if (retry && typeof (retry as Promise<void>).catch === 'function') {
          (retry as Promise<void>).catch(() => undefined);
        }
      },
      { once: true },
    );
  }

  private _pauseQuietly(el: VideoElementLike): void {
    try {
      el.pause();
    } catch {
      // ignore — non-fatal
    }
  }
}
