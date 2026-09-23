/**
 * resolveConsoleTime — the play bar reads the same time the compositor is
 * fed (segment-centric-editor-workbench §3.6, RV-06).
 */

import { describe, expect, it } from 'vitest';
import { resolveConsoleTime, type ConsoleTimeInput } from '../consoleTime';

function input(overrides: Partial<ConsoleTimeInput>): ConsoleTimeInput {
  return {
    playbackMode: 'composition',
    currentTimelineTime: undefined,
    compositionCurrentTime: 0,
    currentTime: 0,
    totalDuration: 25,
    ...overrides,
  };
}

describe('resolveConsoleTime', () => {
  it('console_time_prefers_timeline_time_in_composition', () => {
    const time = resolveConsoleTime(input({ currentTimelineTime: 3.34, compositionCurrentTime: 0 }));
    expect(time).toBe(3.34);
  });

  it('console_time_falls_back_to_composition_cursor_without_timeline_time', () => {
    expect(resolveConsoleTime(input({ compositionCurrentTime: 7 }))).toBe(7);
  });

  it('console_time_clamps_to_total', () => {
    expect(resolveConsoleTime(input({ currentTimelineTime: 31, totalDuration: 25 }))).toBe(25);
    expect(resolveConsoleTime(input({ currentTimelineTime: -1, totalDuration: 25 }))).toBe(0);
  });

  it('console_time_is_unclamped_when_total_is_unknown', () => {
    expect(resolveConsoleTime(input({ currentTimelineTime: 4, totalDuration: 0 }))).toBe(4);
  });

  it('console_time_uses_current_time_outside_composition', () => {
    const time = resolveConsoleTime(input({
      playbackMode: 'preview', currentTime: 1.5, currentTimelineTime: 3.34, compositionCurrentTime: 9,
    }));
    expect(time).toBe(1.5);
  });
});
