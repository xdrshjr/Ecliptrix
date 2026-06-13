/**
 * @vitest-environment node
 *
 * Unit tests for the shared lane grid background builder
 * (timeline-panel-davinci-redesign spec §6.1). Pure function, no DOM.
 */

import { describe, it, expect } from 'vitest';
import { buildGridBackground } from '../lib/timelineGrid';
import type { TickIntervals } from '../lib/rulerTicks';

const intervals: TickIntervals = {
  majorInterval: 1,
  minorInterval: 0.5,
  subMinorInterval: 0.25,
};

describe('buildGridBackground', () => {
  it('returns two repeating-linear-gradient layers with the right periods', () => {
    const style = buildGridBackground(50, intervals);
    const bg = String(style.backgroundImage);

    // Two layers (major + minor); sub-minor is NOT painted into the grid.
    const layerCount = (bg.match(/repeating-linear-gradient/g) || []).length;
    expect(layerCount).toBe(2);

    // major period = 1s * 50 = 50px; minor period = 0.5s * 50 = 25px.
    expect(bg).toContain('50px');
    expect(bg).toContain('25px');

    expect(style.backgroundRepeat).toBe('repeat');
  });

  it('lists the major layer first (painted on top of the coincident minor line)', () => {
    const style = buildGridBackground(50, intervals);
    const bg = String(style.backgroundImage);

    // The major layer (50px period) must precede the minor layer (25px period).
    expect(bg.indexOf('50px')).toBeLessThan(bg.indexOf('25px'));
    // and the major colour token precedes the minor colour token.
    expect(bg.indexOf('--timeline-grid-major')).toBeLessThan(
      bg.indexOf('--timeline-grid-minor'),
    );
  });

  it('guards against a zero/negative scale without producing a 0px period', () => {
    const style = buildGridBackground(0, intervals);
    const bg = String(style.backgroundImage);
    expect(bg).toContain('repeating-linear-gradient');
    expect(bg).not.toContain(' 0px)');
  });
});
