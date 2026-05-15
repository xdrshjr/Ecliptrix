/**
 * Playback v2 — internal numeric constants.
 *
 * Spec: docs/plans/video-editor-playback-v2-phase2/spec.md §3.2.4 / §3.2.7 / §3.2.8
 *
 * Centralised so tests can import the same values the runtime uses, and so
 * tuning changes are a single-line edit.
 */

/** Spec §3.2.4. Auto-resume on visibility return iff wall delta < this. */
export const VISIBILITY_RESUME_MAX_MS = 10_000;

/** Spec §3.2.7. Drift below this is absorbed by drawImage; no correction. */
export const DRIFT_SOFT_MS = 40;

/** Spec §3.2.7. Drift at or above this triggers a hard `<video>.currentTime = t` resync. */
export const DRIFT_HARD_MS = 200;

/** Spec §3.2.7. Soft-drift correction multiplier on `<video>.playbackRate`. */
export const DRIFT_SOFT_RATE_DELTA = 0.05;

/** Spec §3.2.7. After this many consecutive hard resyncs, fire kill-switch. */
export const DRIFT_HARD_TRIP_COUNT = 3;

/** Spec §3.2.7. Sample interval for drift detection (ms). */
export const DRIFT_SAMPLE_INTERVAL_MS = 1_000;

/** Spec §3.2.1. Max wait for `loadeddata + play()` before we declare stalled. */
export const PREPARING_TIMEOUT_MS = 5_000;

/** Spec §3.2.2. fps-stat reporting cadence on rAF tick. */
export const TICK_FPS_REPORT_INTERVAL_MS = 250;

/** Spec §3.2.5. Adaptive-fps degrade threshold (rolling mean lastDrawMs). */
export const ADAPTIVE_DEGRADE_DRAW_MS = 12;

/** Spec §3.2.5. Adaptive-fps recover threshold (rolling mean lastDrawMs). */
export const ADAPTIVE_RECOVER_DRAW_MS = 8;

/** Spec §3.2.5. Frames in the rolling window for adaptive-fps decision. */
export const ADAPTIVE_WINDOW_FRAMES = 60;

/** Spec §3.2.5. Frames at recover threshold required to climb back to 60fps. */
export const ADAPTIVE_RECOVER_HOLD_FRAMES = 120;

/** Spec §3.2.8. localStorage key written when v2 hits an unrecoverable error. */
export const KILL_SWITCH_LS_KEY = 'ecliptrix-playback-v2-killswitch';

/** Spec §3.2. PlayheadController throttle window. */
export const PLAYHEAD_THROTTLE_MS = 16;

// ---------------------------------------------------------------------------
// Phase 3 — A/B Buffer + Preview Proxy
// ---------------------------------------------------------------------------

/** Phase-3 spec §3.2.3 / spec 04 §3.2. Lead time before sequence end at which prewarmNext fires. */
export const PREWARM_LEAD_SEC = 1.0;

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
