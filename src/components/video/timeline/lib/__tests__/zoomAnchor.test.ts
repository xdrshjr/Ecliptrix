import { describe, expect, it } from 'vitest';
import { computeAnchoredScrollLeft } from '../zoomAnchor';

/** Time under a viewport offset for a given scroll position and scale. */
function timeAt(scrollLeft: number, offset: number, pixelsPerSecond: number): number {
  return (scrollLeft + offset) / pixelsPerSecond;
}

describe('computeAnchoredScrollLeft', () => {
  it('keeps the time under the cursor fixed when zooming in and out', () => {
    // 40 s sits 300 px into the lane at 50 px/s (scrollLeft 1700).
    const anchor = { timeAtAnchor: 40, anchorOffsetPx: 300 };
    const zoomedIn = computeAnchoredScrollLeft({ ...anchor, pixelsPerSecond: 115 });
    const zoomedOut = computeAnchoredScrollLeft({ ...anchor, pixelsPerSecond: 20 });
    expect([
      timeAt(zoomedIn, 300, 115),
      timeAt(zoomedOut, 300, 20),
    ].map((value) => Number(value.toFixed(9)))).toEqual([40, 40]);
  });

  it('clamps scrollLeft at 0', () => {
    expect(computeAnchoredScrollLeft({ timeAtAnchor: 1, anchorOffsetPx: 400, pixelsPerSecond: 50 })).toBe(0);
  });
});
