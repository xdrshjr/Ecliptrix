/**
 * @vitest-environment node
 *
 * TL2-24: a clip drag measures its delta from the press position. Scrolling
 * the lanes mid-drag (Shift+wheel, follow-playhead) moves the content under a
 * still pointer, so the delta must include the scroll offset gained since the
 * press — and a scroll must re-send the move, or the clip detaches from the
 * cursor until the pointer moves again. Source-level: TimelinePanel imports
 * most of the editor.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '..', 'TimelinePanel.tsx'), 'utf-8');

describe('TimelinePanel clip drag', () => {
  it('drag delta includes the scroll offset', () => {
    expect({
      recordsScrollAtPress: /dragStartScrollLeftRef\.current\s*=\s*trackScrollRef\.current\?\.scrollLeft/.test(src),
      deltaIncludesScroll: /deltaX:\s*clientX - dragStartXRef\.current \+ scrollOffsetSincePress\(\)/.test(src),
      resendsOnScroll: /addEventListener\('scroll',\s*handleLaneScroll/.test(src),
    }).toEqual({ recordsScrollAtPress: true, deltaIncludesScroll: true, resendsOnScroll: true });
  });
});
