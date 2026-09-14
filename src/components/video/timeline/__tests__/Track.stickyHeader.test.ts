/**
 * @vitest-environment node
 *
 * UI3-10: the track header column lives inside the horizontally scrolling
 * content. Without `sticky` it scrolls away with the lanes — names, lock,
 * volume and delete disappear on a long timeline while the ruler's control
 * column stays put. Source-level: jsdom does no layout, so `position: sticky`
 * cannot be observed by rendering.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const trackSrc = readFileSync(resolve(__dirname, '..', 'Track.tsx'), 'utf-8');
const containerSrc = readFileSync(resolve(__dirname, '..', 'TrackContainer.tsx'), 'utf-8');

describe('track header column', () => {
  it('track header column is sticky at the left edge above clips', () => {
    const header = trackSrc.match(/className=\{`track-controls[^`]*`/)?.[0] ?? '';
    expect({
      sticky: /\bsticky\b/.test(header),
      pinnedLeft: /\bleft-0\b/.test(header),
      aboveClips: /\bz-20\b/.test(header),
      opaque: /\bbg-muted\b/.test(header),
    }).toEqual({ sticky: true, pinnedLeft: true, aboveClips: true, opaque: true });
  });

  it('the left scroll fade starts after the sticky header', () => {
    expect(containerSrc).toMatch(/left:\s*TRACK_HEADER_WIDTH/);
  });
});
