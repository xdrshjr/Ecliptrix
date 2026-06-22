/**
 * @vitest-environment node
 *
 * ImageOverlay click-to-select stability + multi-corner resize wiring
 * (spec docs/plans/image-overlay-manual-resize/spec.md §8 #5–#7).
 *
 * Source-level regex assertions because the project's Vitest config
 * (tsconfig jsx: "preserve") cannot mount React components — same pattern as
 * exportButton.test.tsx / VideoPlayerPanel.solePath.test.tsx. The pure resize
 * geometry itself is exercised in imageOverlayGeometry.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PANEL = readFileSync(resolve(__dirname, '..', 'VideoPlayerPanel.tsx'), 'utf-8');
const OVERLAY = readFileSync(resolve(__dirname, '..', 'ImageOverlay.tsx'), 'utf-8');

describe('VideoPlayerPanel — D1′ deselect via onMouseDown (C1 fix)', () => {
  it('deselects on onMouseDown (both composition + placeholder wrappers)', () => {
    const matches = PANEL.match(/onMouseDown=\{\(\)\s*=>\s*setSelectedImageOverlay\(null\)\}/g);
    expect(matches).not.toBeNull();
    // Both the composition wrapper and the placeholder wrapper must be migrated.
    expect(matches!.length).toBe(2);
  });

  it('no longer deselects via onClick (reverse assertion — the C1 root cause)', () => {
    expect(PANEL).not.toMatch(/onClick=\{[^}]*setSelectedImageOverlay\(null\)/);
  });
});

describe('ImageOverlay — selection stability + four-corner resize (D1′/D2/D2b)', () => {
  it('keeps the selection stable by stopping the trailing click (defense-in-depth)', () => {
    expect(OVERLAY).toMatch(/onClick=\{\(e\)\s*=>\s*e\.stopPropagation\(\)\}/);
  });

  it('renders the four corner handles by mapping RESIZE_HANDLES', () => {
    expect(OVERLAY).toMatch(/RESIZE_HANDLES\.map\(/);
    expect(OVERLAY).toMatch(/handle\.positionClass/);
    expect(OVERLAY).toMatch(/handle\.cursorClass/);
  });

  it('curries handleResizeMouseDown by handle id, preserving preventDefault + stopPropagation', () => {
    expect(OVERLAY).toMatch(/handleResizeMouseDown\(handle\.id\)/);
    // Curried inner-function body: capture from the (e) => { ... }, up to its close.
    const body = OVERLAY.match(
      /\(handle:\s*HandleId\)\s*=>\s*\(e:\s*React\.MouseEvent\)\s*=>\s*\{([\s\S]*?)\},/,
    );
    expect(body).not.toBeNull();
    expect(body![1]).toMatch(/e\.preventDefault\(\)/);
    expect(body![1]).toMatch(/e\.stopPropagation\(\)/);
  });

  it('tracks the active corner in a ref (not state) so the global mousemove never re-subscribes mid-gesture', () => {
    expect(OVERLAY).toMatch(/resizeHandleRef\s*=\s*useRef<HandleId\s*\|\s*null>\(null\)/);
    expect(OVERLAY).toMatch(/resizeHandleRef\.current\s*=\s*null/); // reset on mouseup
    expect(OVERLAY).toMatch(/resizeFromHandle\(/); // move delegates to the pure helper
  });
});
