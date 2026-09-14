/**
 * @vitest-environment node
 *
 * ME-05 — an image-overlay gesture is committed to the timeline store the
 * moment it ends, not when the user remembers to press a confirm button.
 *
 * `hasPositionChanged` decides whether a finished gesture is an edit at all;
 * the wiring (pointer capture, gesture end, cancel/Escape revert, i18n
 * buttons, lock) is pinned with source assertions because the Vitest config
 * cannot mount `.tsx` components (tsconfig jsx: "preserve").
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ImagePosition } from '@/types';
import { hasPositionChanged, POSITION_CHANGE_TOLERANCE } from '../imageOverlayGeometry';

const OVERLAY = readFileSync(resolve(__dirname, '..', 'ImageOverlay.tsx'), 'utf-8');
const PANEL = readFileSync(resolve(__dirname, '..', 'VideoPlayerPanel.tsx'), 'utf-8');

const base: ImagePosition = { x: 0.2, y: 0.3, width: 0.4, height: 0.5, zIndex: 10 };

describe('hasPositionChanged', () => {
  it('hasPositionChanged ignores sub-tolerance noise', () => {
    const jitter = POSITION_CHANGE_TOLERANCE / 2;
    expect(hasPositionChanged(base, { ...base, x: base.x + jitter, height: base.height - jitter })).toBe(false);
    expect(hasPositionChanged(base, { ...base, zIndex: undefined })).toBe(false);
  });

  it('reports a real move, resize or layer change', () => {
    expect(hasPositionChanged(base, { ...base, x: 0.25 })).toBe(true);
    expect(hasPositionChanged(base, { ...base, width: 0.41 })).toBe(true);
    expect(hasPositionChanged(base, { ...base, zIndex: 11 })).toBe(true);
  });
});

describe('ImageOverlay gesture wiring', () => {
  it('captures the pointer and reports the gesture end with the final position', () => {
    expect(OVERLAY).toMatch(/setPointerCapture\(/);
    expect(OVERLAY).toMatch(/onGestureEnd\?:\s*\(itemId:\s*string,\s*position:\s*ImagePosition\)\s*=>\s*void/);
    expect(OVERLAY).toMatch(/hasPositionChanged\(/);
  });

  it('reverts to the gesture start on pointercancel or Escape', () => {
    expect(OVERLAY).toMatch(/onPointerCancel=/);
    expect(OVERLAY).toMatch(/e\.key !== 'Escape'/);
    expect(OVERLAY).toMatch(/finishGesture\(false\)/);
    expect(OVERLAY).toMatch(/gestureStartRef/);
  });

  it('labels the done and revert buttons through i18n', () => {
    expect(OVERLAY).toMatch(/t\.imageOverlay\.done/);
    expect(OVERLAY).toMatch(/t\.imageOverlay\.revert/);
    expect(OVERLAY).not.toMatch(/Confirm image position|Cancel image position/);
  });
});

describe('VideoPlayerPanel image overlay commit', () => {
  it('commits a finished gesture through onImagePositionConfirm', () => {
    expect(PANEL).toMatch(/onGestureEnd=\{handleImageGestureEnd\}/);
    expect(PANEL).toMatch(/const handleImageGestureEnd = useCallback\(\(itemId: string, position: ImagePosition\) => \{[\s\S]*?onImagePositionConfirm\?\.\(itemId, position\)/);
  });

  it('hides the drag handles while the agent holds the edit lock', () => {
    expect(PANEL).toMatch(/useTimelineStore\(\(state\) => state\.externalEditLock !== null\)/);
    expect(PANEL).toMatch(/isImageEditLocked \? null : getCurrentImageOverlays\(\)\.map\(/);
  });

  it('shows the auto-fit box only when the store accepted it', () => {
    // A locked track refuses the fit: a box kept only in component state would
    // be exported without reaching the store and snap back on the next sync.
    expect(PANEL).toMatch(
      /if \(fitImagePositionAction\(\(\) => useTimelineStore\.getState\(\), itemId, position\)\) \{\s*handleImagePositionChange\(itemId, position\);\s*\}/,
    );
  });
});
