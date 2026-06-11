/**
 * Playback — internal numeric constants.
 *
 * Spec: docs/plans/video-editor-playback-v2-phase2/spec.md §3.2.5 / §3.2.7
 *
 * Centralised so tests can import the same values the runtime uses, and so
 * tuning changes are a single-line edit.
 */

/** Spec §3.2.5. Adaptive-fps degrade threshold (rolling mean lastDrawMs). */
export const ADAPTIVE_DEGRADE_DRAW_MS = 12;

/** Spec §3.2.5. Adaptive-fps recover threshold (rolling mean lastDrawMs). */
export const ADAPTIVE_RECOVER_DRAW_MS = 8;

/** Spec §3.2.5. Frames in the rolling window for adaptive-fps decision. */
export const ADAPTIVE_WINDOW_FRAMES = 60;

/** Spec §3.2.5. Frames at recover threshold required to climb back to 60fps. */
export const ADAPTIVE_RECOVER_HOLD_FRAMES = 120;

/** Spec §3.2. PlayheadController throttle window. */
export const PLAYHEAD_THROTTLE_MS = 16;

/**
 * timeline-preview-playback-stutter fix (A). Throttle window (ms) for pushing
 * the engine clock into REACT state (the parent tree's `timelineCurrentTime`).
 * The engine clock, Canvas compositing and audio sync stay at full frame rate;
 * only the React-state mirror is throttled here so the whole editing tree
 * re-renders at ~10Hz instead of ~60Hz. SEPARATE from {@link PLAYHEAD_THROTTLE_MS}
 * (the engine's single-writer cadence into the facade), which is intentionally
 * kept at one rAF tick so the scrub-guard refs stay frame-precise.
 */
export const REACT_PLAYHEAD_THROTTLE_MS = 100;

/**
 * timeline-preview-playback-stutter fix (D). Tolerance (seconds) for treating a
 * prop-driven `currentTime` change as engine echo rather than a real user scrub
 * WHILE PLAYING. The React playhead lags the engine clock by up to one
 * {@link REACT_PLAYHEAD_THROTTLE_MS} window plus render time; a value within
 * this band of the engine's live composition time is its own throttled echo and
 * must NOT re-seek (which would yank the clock backward — §3.5). A genuine ruler
 * drag lands far outside this band and still seeks.
 */
export const PLAYBACK_SCRUB_ECHO_TOLERANCE_SEC = 0.35;

// ---------------------------------------------------------------------------
// Phase 3 — A/B Buffer + Preview Proxy
// ---------------------------------------------------------------------------

/** Phase-3 spec §3.2.5 / spec 04 §5.5. Skip prewarm when next sequence shorter than this. */
export const SHORT_CLIP_THRESHOLD_SEC = 1.5;

/** Phase-3 spec §3.2.2 / spec 04. Max wait for `loadedmetadata` during bindActive. */
export const BIND_LOADEDMETA_TIMEOUT_MS = 1000;

/** Phase-3 spec §3.2.2 / spec 04. Max wait for `seeked` before forcing rebind. */
export const BIND_SEEK_TIMEOUT_MS = 500;

/** Phase-3 spec §3.2.1 / spec 07. MediaProxyClient watch poll cadence. */
export const PREVIEW_PROXY_POLL_INTERVAL_MS = 2000;

/** Phase-3 spec §3.2.1. Hard upper bound on preview-proxy watch budget (10 minutes). */
export const PREVIEW_PROXY_POLL_BUDGET_MS = 600_000;

// ---------------------------------------------------------------------------
// local-video-editing-refactor — Stage 2 (spec 02 §2.5) audio sync
// ---------------------------------------------------------------------------

/**
 * Audio drift-correction threshold (seconds). Only when an audio element's
 * `currentTime` deviates from its target source time by MORE than this do we
 * hard-seek; smaller deviations are left alone so we never seek every tick
 * (which would audibly stutter).
 *
 * Carried over verbatim from the v1 inline audio pool
 * (`VideoPlayerPanel.syncAudioPlayback`, `drift > 0.5`) so the lifted
 * AudioSyncPool keeps the same proven debounce behaviour. This is a DIFFERENT
 * concept from spec 01 `TIME_EPSILON` (clip-edge math): that is sub-frame
 * boundary snapping; this is human-perceptible audio drift tolerance.
 */
export const AUDIO_DRIFT_EPSILON_SEC = 0.5;

/**
 * Per-track VIDEO seek-tolerance (seconds) for the multi-track
 * {@link ../VideoSourcePool}. While playing, a decode `<video>` advances on its
 * own; re-seeking it every frame to the exact target source time would stall
 * decode and stutter. We only issue `currentTime = target` when the element's
 * `currentTime` deviates from the mapped source time by MORE than this.
 *
 * Sits between the A/B controller's bind-time seek snap (`0.05`, used when an
 * element is freshly bound and idle) and the audible audio drift threshold
 * (`AUDIO_DRIFT_EPSILON_SEC = 0.5`). 0.25s ≈ a handful of frames at 24–30fps —
 * imperceptible for preview yet loose enough to avoid per-frame re-seeks during
 * steady playback. The drift-correction loop in `PlaybackEngine` still catches
 * any larger divergence. Named here so tuning is a single-line edit and tests
 * import the same value (no bare magic number).
 */
export const VIDEO_SEEK_TOLERANCE_SEC = 0.25;
