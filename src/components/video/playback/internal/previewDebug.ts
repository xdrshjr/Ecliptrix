/**
 * previewDebug — runtime diagnostics for the multi-track preview compositor
 * (spec composition-preview-playback-fix §5.4, the "落地第一步" / first-landed
 * locating + acceptance tool).
 *
 * DEFAULT OFF. Gated by `localStorage['ecliptrix-preview-debug'] === 'true'` or
 * the build-time `NEXT_PUBLIC_PREVIEW_DEBUG === 'true'`, so it tree-shakes /
 * no-ops out of a production preview where the flag is never set (R5: never
 * leak to production). This module owns NO DOM and NO engine state — it is pure
 * formatting plus a single flag read, so the engine can collect per-track rows
 * and hand them here to print without coupling either way.
 *
 * The rows let whoever can run the desktop App tell, in ~30s, which hypothesis
 * is the load-bearing one (H1 / H2 / H6 / H3 — see {@link classifyTrackDiagnosis}
 * and §4 of the spec) instead of guessing from a static hypothesis ranking.
 */

/** localStorage key that turns the runtime overlay/log on. */
export const PREVIEW_DEBUG_STORAGE_KEY = 'ecliptrix-preview-debug';

/** Throttle interval (ms) for the per-second diagnostic dump. */
export const PREVIEW_DEBUG_INTERVAL_MS = 1000;

/**
 * One per-track diagnostic snapshot. Every field is optional except `trackId`
 * so a caller can fill in only what a given element / compositor exposes (a
 * structural fake or a partially-loaded `<video>` may not have all of them).
 */
export interface TrackDiagnosticRow {
  trackId: string;
  /** The URL the VideoSourcePool resolved + assigned this frame (RC-B key). */
  resolvedSrc: string | null;
  /** HTMLMediaElement.readyState (0..4). `<2` cannot be drawn (§3 / H6). */
  readyState: number;
  /** HTMLMediaElement.networkState (0..3). 3 = NO_SOURCE (H6 tell). */
  networkState?: number;
  /** Whether the decode element is paused (H1 tell when src is non-detached). */
  paused?: boolean;
  /** Whether the decode element is muted this frame (audio-route diagnostics). */
  muted?: boolean;
  /** HTMLMediaElement.error?.code, or null when there is no media error. */
  errorCode?: number | null;
  /** The element's current decode time (seconds). */
  currentTime?: number;
  /** The mapped source-media time the engine wants this frame (ClipTimeMapping). */
  desiredSourceTime?: number | null;
  /** Times this track's layer was actually drawn (CanvasCompositor per-layer). */
  drawn?: number;
  /** Times this track's layer was skipped (not ready / opacity 0 / draw error). */
  dropped?: number;
}

/**
 * Whether the runtime preview-debug overlay/log is enabled. Build flag wins so
 * headless / SSR can opt in; otherwise the browser-only localStorage flag is
 * read defensively (no window, or a storage-access throw → disabled).
 */
export function isPreviewDebugEnabled(): boolean {
  if (
    typeof process !== 'undefined' &&
    process.env &&
    process.env.NEXT_PUBLIC_PREVIEW_DEBUG === 'true'
  ) {
    return true;
  }
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage?.getItem(PREVIEW_DEBUG_STORAGE_KEY) === 'true';
  } catch {
    // Storage access can throw under strict privacy modes — treat as off.
    return false;
  }
}

/**
 * Best-effort, per-row hypothesis label using the §5.4 judging quick-reference.
 * It is intentionally conservative: a row whose `readyState >= 2` is `OK`
 * (drawable); a paused-but-unmuted not-ready row points at H1; a playing
 * not-ready row with no source / a media error points at H6. Anything else is
 * `unknown` (needs the persistence / black-screen context only the live App
 * has). PURE — no DOM, deterministic for snapshot tests.
 */
export function classifyTrackDiagnosis(row: TrackDiagnosticRow): 'OK' | 'H1' | 'H6' | 'unknown' {
  if (row.readyState >= 2) return 'OK';
  if (row.paused === true && row.muted === false) return 'H1';
  if (
    row.paused === false &&
    row.readyState < 2 &&
    (row.networkState === 3 || (row.errorCode !== null && row.errorCode !== undefined))
  ) {
    return 'H6';
  }
  return 'unknown';
}

function formatField(label: string, value: unknown): string {
  if (value === undefined) return `${label}=-`;
  if (value === null) return `${label}=null`;
  if (typeof value === 'number') {
    return `${label}=${Number.isInteger(value) ? value : value.toFixed(3)}`;
  }
  return `${label}=${String(value)}`;
}

/** Format one row as a single stable line (field order is fixed). */
export function formatTrackDiagnosticRow(row: TrackDiagnosticRow): string {
  return [
    `track=${row.trackId}`,
    formatField('verdict', classifyTrackDiagnosis(row)),
    formatField('readyState', row.readyState),
    formatField('networkState', row.networkState),
    formatField('paused', row.paused),
    formatField('muted', row.muted),
    formatField('error', row.errorCode),
    formatField('t', row.currentTime),
    formatField('want', row.desiredSourceTime),
    formatField('drawn', row.drawn),
    formatField('dropped', row.dropped),
    formatField('src', row.resolvedSrc),
  ].join(' ');
}

/**
 * Render all track rows as a multi-line string for `console.debug` / an overlay.
 * PURE + deterministic (no timestamps) so it is snapshot-testable.
 */
export function formatTrackDiagnostics(rows: readonly TrackDiagnosticRow[]): string {
  if (rows.length === 0) {
    return '[preview-debug] no video tracks';
  }
  return ['[preview-debug] track diagnostics', ...rows.map(formatTrackDiagnosticRow)].join('\n');
}
