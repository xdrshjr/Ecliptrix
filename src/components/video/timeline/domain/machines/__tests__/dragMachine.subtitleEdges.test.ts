/**
 * @vitest-environment node
 *
 * TL3-03: a subtitle has no source media, so its left edge must extend
 * earlier like a still. It used to be clamped as if its in-point were 0,
 * which pinned the minimum start to the original start.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createDragActor, getDragPreview } from '../dragMachine';

describe('subtitle trim edges', () => {
  it("a subtitle's left edge extends earlier like a still", () => {
    const actor = createDragActor();
    actor.start();
    // What TimelineItem sends for a caption at 5 s lasting 2 s (100 px wide).
    actor.send({
      type: 'POINTER_DOWN', itemId: 's1', trackId: 'subtitle-track-1', clientX: 0, clientY: 0,
      relativeX: 2, itemWidth: 100, originalStartTime: 5, originalDuration: 2, zoomLevel: 1,
      originalMediaDuration: Number.POSITIVE_INFINITY, isStill: true,
    });
    actor.send({ type: 'POINTER_MOVE', clientX: -10, clientY: 0, deltaX: -10 });
    actor.send({ type: 'POINTER_MOVE', clientX: -50, clientY: 0, deltaX: -50 });
    const preview = getDragPreview(actor.getSnapshot());
    actor.stop();
    expect({ startTime: preview?.startTime, duration: preview?.duration }).toEqual({ startTime: 4, duration: 3 });
  });

  it('TimelineItem gives subtitles the free edges of a still', () => {
    const source = readFileSync(resolve(__dirname, '../../../TimelineItem.tsx'), 'utf-8');
    expect(source).toMatch(
      /const hasFreeEdges = item\.originalMaterialType === 'image' \|\| item\.type === 'subtitle';[\s\S]*?isStill: hasFreeEdges/,
    );
  });
});
