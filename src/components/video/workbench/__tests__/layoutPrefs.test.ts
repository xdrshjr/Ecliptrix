import { describe, expect, it } from 'vitest';
import {
  CENTER_MIN,
  DEFAULT_LAYOUT,
  DEFAULT_PREFS,
  LEFT_MIN,
  RIGHT_MIN,
  UPPER_MIN,
  applyPreset,
  autoCollapseFor,
  clampLayout,
  parseLayoutPrefs,
  resolvePanelSizes,
  setLayoutSize,
} from '../layoutPrefs';

const both = { leftWidth: 480, rightWidth: 440, timelineHeight: 260, leftOpen: true, rightOpen: true };

describe('layoutPrefs', () => {
  it('clamps_widths_into_bounds', () => {
    const clamped = clampLayout({ ...DEFAULT_LAYOUT, leftWidth: 10, rightWidth: 9999, timelineHeight: 20 });
    expect([clamped.leftWidth, clamped.rightWidth, clamped.timelineHeight]).toEqual([280, 440, 160]);
  });

  it('invalid_json_falls_back_to_defaults', () => {
    const result = parseLayoutPrefs('{not json');
    expect([result.ok, result.prefs]).toEqual([false, DEFAULT_PREFS]);
  });

  it('unknown_version_falls_back_to_defaults', () => {
    const result = parseLayoutPrefs(JSON.stringify({ ...DEFAULT_PREFS, v: 2 }));
    expect(result.ok ? null : result.reason).toBe('unknown-version');
  });

  it('valid_prefs_round_trip', () => {
    const stored = { ...DEFAULT_PREFS, leftWidth: 350, followPlayback: true, rightPanelTab: 'properties' };
    expect(parseLayoutPrefs(JSON.stringify(stored)).prefs).toEqual(stored);
  });

  it('applying_preset_sets_sizes_and_preset_id', () => {
    const edit = applyPreset({ ...DEFAULT_LAYOUT, rightCollapsed: true }, 'edit');
    expect(edit).toMatchObject({ leftWidth: 300, rightWidth: 300, timelineHeight: 360, preset: 'edit', rightCollapsed: false });
  });

  it('manual_resize_switches_preset_to_custom', () => {
    const next = setLayoutSize(applyPreset(DEFAULT_LAYOUT, 'script'), 'left', 333);
    expect([next.preset, next.leftWidth]).toEqual(['custom', 333]);
  });

  it('sides_shrink_proportionally_to_keep_center_min', () => {
    const width = 1300;
    const solved = resolvePanelSizes(both, width, 900);
    expect(width - solved.leftWidth - solved.rightWidth - 16).toBeGreaterThanOrEqual(CENTER_MIN);
    expect(solved.leftWidth).toBeGreaterThan(LEFT_MIN);
    expect(solved.rightForcedCollapsed).toBe(false);
  });

  it('right_auto_collapses_when_sides_at_min_still_overflow', () => {
    const solved = resolvePanelSizes(both, LEFT_MIN + RIGHT_MIN + CENTER_MIN, 900);
    expect(solved.rightForcedCollapsed).toBe(true);
  });

  it('timeline_height_keeps_upper_min', () => {
    const solved = resolvePanelSizes({ ...both, timelineHeight: 360 }, 1600, 600);
    expect(600 - solved.timelineHeight - 8).toBeGreaterThanOrEqual(UPPER_MIN);
  });

  it('resolved_sizes_do_not_overwrite_prefs', () => {
    const input = { ...both };
    resolvePanelSizes(input, 1100, 700);
    expect(input).toEqual(both);
  });

  it('auto_collapses_right_below_1180', () => {
    expect([autoCollapseFor(1179), autoCollapseFor(1180)]).toEqual([
      { left: false, right: true }, { left: false, right: false },
    ]);
  });
});
