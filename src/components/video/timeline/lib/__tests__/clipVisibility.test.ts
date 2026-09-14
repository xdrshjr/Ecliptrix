import { describe, expect, it } from 'vitest';
import { isClipVisibleInLane } from '../clipVisibility';

// Content coordinates: the 224 px track header occupies [0, 224) of the
// scroll content and stays pinned to the viewport's left edge (sticky).
const viewport = { scrollLeft: 1000, clientWidth: 1224, headerWidth: 224 };

describe('isClipVisibleInLane', () => {
  it('a clip under the sticky header counts as hidden', () => {
    expect(isClipVisibleInLane({ ...viewport, elLeft: 1100, elRight: 1300 })).toBe(false);
  });

  it('a clip fully right of the header and inside the viewport is visible', () => {
    expect(isClipVisibleInLane({ ...viewport, elLeft: 1300, elRight: 2100 })).toBe(true);
  });

  it('a clip past the right edge is hidden', () => {
    expect(isClipVisibleInLane({ ...viewport, elLeft: 2000, elRight: 2400 })).toBe(false);
  });
});
