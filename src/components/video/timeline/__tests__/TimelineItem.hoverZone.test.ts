/**
 * @vitest-environment node
 *
 * TL2-06: the trim zones used to be invisible (no cursor feedback) and ate
 * the whole clip when it was narrow. Source-level for the same
 * `jsx: "preserve"` reason as the sibling TimelineItem tests.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '..', 'TimelineItem.tsx'), 'utf-8');

describe('TimelineItem hover zones', () => {
  it('cursor and handle width come from edgeHandleWidthPx', () => {
    expect({
      detectsZone: /detectInteractionType\(/.test(src),
      handleWidth: /edgeHandleWidthPx\(width\)/.test(src),
      resizeCursor: /visibleHoverZone === 'move'[\s\S]{0,80}'ew-resize'/.test(src),
      fixedHandleGone: /w-1\.5 h-full cursor-ew-resize/.test(src),
    }).toEqual({ detectsZone: true, handleWidth: true, resizeCursor: true, fixedHandleGone: false });
  });

  it('the hover zone stays frozen from press to release', () => {
    // The inline caption editor also freezes it: the pointer is in a text field (UI3-04).
    expect(src).toMatch(/if \(isInteracting \|\| isTrackLocked \|\| isEditingSubtitle\) return;/);
    expect(src).toMatch(/if \(!isInteracting\) setHoverZone\('move'\)/);
    expect(src).not.toMatch(/isDragging \|\| isResizing/);
  });

  it('the cut tool never advertises a trim at the edges', () => {
    expect(src).toMatch(/visibleHoverZone: InteractionType = activeTool === 'cut' \? 'move' : hoverZone/);
  });

  it('a cut too close to an edge tells the user why nothing was split', () => {
    expect(src).toMatch(/=== 'too-close'[\s\S]{0,120}splitTooCloseToEdge/);
  });
});
