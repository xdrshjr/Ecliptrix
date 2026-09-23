/**
 * Play-bar time read-out — single source (spec §3.6, RV-06).
 *
 * The compositor is fed `currentTimelineTime ?? compositionCurrentTime`
 * (VideoPlayerPanel → useCompositionPlayback). The play bar used to read
 * `getCurrentTime()`, which only sees the internal `compositionCurrentTime`
 * state: it starts at 0 and is written only by explicit seeks, so a restored
 * playhead (e.g. a project saved paused at 3.34 s) showed 00:00 while the
 * timeline playhead and the painted frame were at 00:03.
 *
 * This pure function is used ONLY for the play-bar text and scrubber value.
 * `useCompositionTransport.getCurrentTime` and the imperative
 * `VideoPlayerPanelRef` handle keep their semantics (echo suppression, seek
 * chain and `onTimeUpdate` depend on them).
 */

import type { PlaybackMode } from './useCompositionTransport';

export interface ConsoleTimeInput {
  playbackMode: PlaybackMode;
  /** The parent's timeline playhead (restored from the project on open). */
  currentTimelineTime?: number;
  /** Panel-internal composition cursor, written by seeks. */
  compositionCurrentTime: number;
  /** Preview-mode cursor (usePreviewTransport). */
  currentTime: number;
  /** Duration the play bar spans; 0 when unknown / empty. */
  totalDuration: number;
}

/** Time the play bar shows, in seconds. */
export function resolveConsoleTime(input: ConsoleTimeInput): number {
  if (input.playbackMode !== 'composition') return input.currentTime;
  const time = input.currentTimelineTime ?? input.compositionCurrentTime;
  // N-06: the store playhead may sit past the render end; the preview shows
  // the last frame, so the read-out stops at the total (same clamp as
  // getCurrentTime).
  if (!(input.totalDuration > 0)) return time;
  return Math.min(Math.max(time, 0), input.totalDuration);
}
