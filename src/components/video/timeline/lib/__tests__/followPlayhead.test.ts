import { describe, expect, it } from 'vitest';
import { computeFollowScrollLeft } from '../followPlayhead';

const view = { scrollLeft: 0, laneViewportWidth: 1000, maxScrollLeft: 5000 };

describe('computeFollowScrollLeft', () => {
  it('pages the view when the playhead passes the right margin', () => {
    // margin 48 → the page turns once the playhead reaches 952 px; the new view
    // leads with 10% of the lane (100 px) before the playhead.
    expect(computeFollowScrollLeft({ ...view, playheadPx: 960 })).toBe(860);
  });

  it('returns null while the playhead is inside the view', () => {
    expect(computeFollowScrollLeft({ ...view, playheadPx: 500 })).toBeNull();
  });

  it('brings a playhead that jumped before the view back into it, clamped to the scroll range', () => {
    expect([
      computeFollowScrollLeft({ ...view, scrollLeft: 2000, playheadPx: 50 }),
      computeFollowScrollLeft({ ...view, playheadPx: 9000 }),
    ]).toEqual([0, 5000]);
  });
});
