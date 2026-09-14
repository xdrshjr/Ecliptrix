/**
 * TL3-01: a clip dropped on a magnetic lane takes the slot its preview start
 * points at — counted by the midpoints of the other clips.
 */
import { describe, expect, it } from 'vitest';

import { magneticInsertIndex } from '../MagneticInsertion';
import type { LanePeer } from '../FreeLaneRules';

const lane: LanePeer[] = [
  { id: 'A', startTime: 0, duration: 2 },
  { id: 'B', startTime: 2, duration: 2 },
  { id: 'C', startTime: 4, duration: 10 },
  { id: 'D', startTime: 14, duration: 2 },
];

describe('magneticInsertIndex', () => {
  it("a start before the first clip's midpoint inserts at index 0", () => {
    expect(magneticInsertIndex(lane, 'C', 0)).toBe(0);
  });

  it("a start past a peer's midpoint inserts after it", () => {
    // Others are B (mid 3), C (mid 9), D (mid 15): only B's midpoint is passed.
    expect(magneticInsertIndex(lane, 'A', 3.5)).toBe(1);
  });

  it('never counts the dragged clip itself', () => {
    expect(magneticInsertIndex(lane, 'D', 100)).toBe(3);
  });
});
