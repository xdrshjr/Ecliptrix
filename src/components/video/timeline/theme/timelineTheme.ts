/**
 * Timeline design tokens (DaVinci-grade redesign).
 *
 * Single source of truth for the timeline panel's layout numbers and the CSS
 * custom-property references it paints with. Keeping the numeric constants here
 * (and the colour values in `globals.css`) means the whole timeline — ruler,
 * grid, playhead, tracks, clips, buttons — is tuned from one place.
 *
 * No JSX, no React: this module is imported by the pure tick/grid helpers
 * (which run under the `node` vitest environment) as well as the components, so
 * it must stay framework-agnostic.
 */

// ---------------------------------------------------------------------------
// Layout constants (pixels unless noted). Where a value is also expressed as a
// Tailwind utility class on an existing element, the class is the *rendered*
// source and the constant is the *shared* source for JS-side math — they must
// stay in lock-step (review R5):
//   RULER_HEIGHT (32)        ⇄ `h-8` on the ruler / bottom bars
//   TRACK_HEADER_WIDTH (224) ⇄ `w-56` on the ruler control panel + track header
// ---------------------------------------------------------------------------

/** Ruler row height. Mirrors the `h-8` (32px) utility on `.timeline-ruler`. */
export const RULER_HEIGHT = 32;

/**
 * Width of the non-scrolling left control column shared by the ruler and every
 * track header. Mirrors the `w-56` (224px) utility on those panels and is the
 * `time=0` origin offset for the track-variant playhead (the proven
 * `+ TRACK_HEADER_WIDTH` collinearity term). Widened from 192 → 224 (round 2)
 * so CJK track names (`视频轨道 1` …) are no longer truncated; all three
 * sources must stay in lock-step or the ruler/playhead will drift.
 */
export const TRACK_HEADER_WIDTH = 224;

/** Tick mark heights by tier, anchored to the ruler's bottom edge. */
export const TICK_MAJOR_H = 14;
export const TICK_MINOR_H = 8;
export const TICK_SUBMINOR_H = 4;

/** Ruler timecode label font size. */
export const TICK_LABEL_FONT_PX = 11;

/**
 * Minimum horizontal gap between *labeled* (major) ticks and between minor
 * ticks. Consumed by `pickTickIntervals` so labels never collide and minor
 * lines never moiré across the whole zoom range. Single source of truth —
 * `rulerTicks.ts` imports these rather than redeclaring them.
 */
export const MIN_MAJOR_LABEL_PX = 72;
export const MIN_MINOR_TICK_PX = 9;

/** Playhead geometry. */
export const PLAYHEAD_WIDTH = 1;
export const PLAYHEAD_HANDLE_W = 11;
export const PLAYHEAD_HANDLE_H = 12;

/** Clip bar corner radius. */
export const CLIP_RADIUS = 4;

/** Track-header control button hit size (≥ the previous 20px). */
export const CONTROL_BTN = 22;

/** Grouped layout object for ergonomic consumption. */
export const TIMELINE_LAYOUT = {
  rulerHeight: RULER_HEIGHT,
  trackHeaderWidth: TRACK_HEADER_WIDTH,
  tickMajorH: TICK_MAJOR_H,
  tickMinorH: TICK_MINOR_H,
  tickSubMinorH: TICK_SUBMINOR_H,
  tickLabelFontPx: TICK_LABEL_FONT_PX,
  minMajorLabelPx: MIN_MAJOR_LABEL_PX,
  minMinorTickPx: MIN_MINOR_TICK_PX,
  controlBtn: CONTROL_BTN,
} as const;

// ---------------------------------------------------------------------------
// Colour token references. Each value is a `var(--timeline-*)` string resolved
// against the theme block in globals.css (:root dark baseline + .light
// overrides), so these are theme-aware by construction.
// ---------------------------------------------------------------------------

export const TIMELINE_COLORS = {
  rulerBg: 'var(--timeline-ruler-bg)',
  laneBg: 'var(--timeline-lane-bg)',
  gridMinor: 'var(--timeline-grid-minor)',
  gridMajor: 'var(--timeline-grid-major)',
  tickMinor: 'var(--timeline-tick-minor)',
  tickMajor: 'var(--timeline-tick-major)',
  tickLabel: 'var(--timeline-tick-label)',
} as const;

export const PLAYHEAD = {
  color: 'var(--timeline-playhead)',
  glow: 'var(--timeline-playhead-glow)',
  width: PLAYHEAD_WIDTH,
  handleW: PLAYHEAD_HANDLE_W,
  handleH: PLAYHEAD_HANDLE_H,
} as const;

export const CLIP = {
  radius: CLIP_RADIUS,
  border: 'var(--timeline-clip-border)',
  sheen: 'var(--timeline-clip-sheen)',
  accentVideo: 'var(--timeline-accent-video)',
  accentImage: 'var(--timeline-accent-image)',
  accentAudio: 'var(--timeline-accent-audio)',
  accentSubtitle: 'var(--timeline-accent-subtitle)',
} as const;
