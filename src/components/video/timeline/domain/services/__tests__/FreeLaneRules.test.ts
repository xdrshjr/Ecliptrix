/**
 * TL3-04: fitting and clamping hand edits on a free (subtitle) lane.
 */
import { describe, expect, it } from 'vitest';

import { clampTrimEdge, fitMove, type LanePeer } from '../FreeLaneRules';

describe('fitMove', () => {
  it('fitMove picks the nearest gap that fits', () => {
    const peers: LanePeer[] = [
      { id: 'S1', startTime: 0, duration: 2 },
      { id: 'S2', startTime: 5, duration: 2 },
      { id: 'X', startTime: 10, duration: 2 },
    ];
    // Gap [2,5) is 2.5 s away (at 3), the tail after S2 is 1.5 s away (at 7).
    expect(fitMove(peers, 'X', 5.5, 2)).toBe(7);
  });

  it('returns the requested start when that span is free', () => {
    const peers: LanePeer[] = [{ id: 'S1', startTime: 0, duration: 2 }, { id: 'X', startTime: 9, duration: 1 }];
    expect(fitMove(peers, 'X', 3, 1)).toBe(3);
  });
});

describe('clampTrimEdge', () => {
  it("stops a start edge at the previous caption's end", () => {
    const peers: LanePeer[] = [{ id: 'S1', startTime: 0, duration: 2 }, { id: 'S2', startTime: 3, duration: 2 }];
    expect(clampTrimEdge(peers, 'S2', 'start', 1, { startTime: 3, duration: 2 })).toBe(2);
  });

  it('never pushes an edge that already overlaps a neighbour', () => {
    const peers: LanePeer[] = [{ id: 'S1', startTime: 0, duration: 4 }, { id: 'S2', startTime: 3, duration: 2 }];
    expect(clampTrimEdge(peers, 'S2', 'start', 3, { startTime: 3, duration: 2 })).toBe(3);
  });
});
