// @vitest-environment node
/**
 * Camera-motion eligibility — the ONE predicate behind four entry points
 * (camera-motion-stills §4.5.1 / A16).
 *
 * The rule is deliberately about the picture, not the material: a still on a
 * video track is `type: 'video'` + `originalMaterialType: 'image'`, and it now
 * takes camera motion through the same panel, the same math and the same data
 * model as a video clip. What is excluded is what has no picture at all.
 *
 * This file exists mostly as a tripwire: the toolbar, the `M` shortcut, the
 * double-click and the clip badge must all keep asking THIS function. Every
 * time one of them re-implemented the rule inline, the four drifted apart.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canApplyCameraMotion, cameraMotionIneligibleReason } from '../eligibility';
import type { TimelineItemData, TrackData } from '../../../timeline/domain/types';

function track(overrides: Partial<TrackData> = {}): TrackData {
  return {
    id: 'track-1',
    type: 'video',
    name: 'Video 1',
    items: [],
    isVisible: true,
    isLocked: false,
    height: 60,
    ...overrides,
  } as TrackData;
}

function item(overrides: Partial<TimelineItemData> = {}): TimelineItemData {
  return {
    id: 'item-1',
    name: 'clip.mp4',
    type: 'video',
    startTime: 0,
    duration: 5,
    trackId: 'track-1',
    ...overrides,
  } as TimelineItemData;
}

describe('cameraMotionIneligibleReason', () => {
  it('accepts a video clip on an unlocked video track', () => {
    expect(cameraMotionIneligibleReason(item(), track())).toBeNull();
    expect(canApplyCameraMotion(item(), track())).toBe(true);
  });

  it('accepts an IMAGE clip on a video track (the whole point of this round)', () => {
    const still = item({ name: 'storyboard-03.png', originalMaterialType: 'image' });
    expect(cameraMotionIneligibleReason(still, track())).toBeNull();
    expect(canApplyCameraMotion(still, track())).toBe(true);
  });

  it('rejects audio and subtitle items — no picture to move', () => {
    expect(cameraMotionIneligibleReason(item({ type: 'audio' }), track({ type: 'audio' })))
      .toBe('not-visual');
    expect(cameraMotionIneligibleReason(item({ type: 'subtitle' }), track({ type: 'subtitle' })))
      .toBe('not-visual');
  });

  it('rejects a visual item that somehow sits on a non-video track', () => {
    expect(cameraMotionIneligibleReason(item(), track({ type: 'audio' }))).toBe('not-visual');
  });

  it('rejects a locked track before anything else', () => {
    const still = item({ originalMaterialType: 'image' });
    expect(cameraMotionIneligibleReason(still, track({ isLocked: true }))).toBe('track-locked');
  });

  it('reports no-selection for a missing item or track', () => {
    expect(cameraMotionIneligibleReason(undefined, track())).toBe('no-selection');
    expect(cameraMotionIneligibleReason(item(), undefined)).toBe('no-selection');
  });
});

describe('the four entry points share this predicate', () => {
  const root = resolve(__dirname, '../../../');

  const sources: Array<[string, string]> = [
    ['toolbar / shortcut', 'timeline/TimelinePanel.tsx'],
    ['clip badge', 'timeline/TimelineItem.tsx'],
  ];

  sources.forEach(([label, relative]) => {
    it(`${label} calls canApplyCameraMotion instead of re-typing the rule`, () => {
      const source = readFileSync(resolve(root, relative), 'utf-8');
      expect(source).toMatch(/canApplyCameraMotion/);
      // The exact drift this predicate exists to prevent: an inline material
      // check that quietly disagrees with the shared rule.
      expect(source).not.toMatch(/originalMaterialType === 'image'\s*\)?\s*return\s+false/);
    });
  });

  it('the disabled tooltip maps the renamed reason (no stale not-video key)', () => {
    const toolbar = readFileSync(resolve(root, 'timeline/TimelineToolbar.tsx'), 'utf-8');
    expect(toolbar).toMatch(/'not-visual'/);
    expect(toolbar).toMatch(/disabledNotVisual/);
    expect(toolbar).not.toMatch(/disabledNotVideo/);
  });
});
