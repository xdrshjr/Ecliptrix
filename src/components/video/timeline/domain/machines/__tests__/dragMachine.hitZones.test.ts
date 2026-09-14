import { describe, expect, it } from 'vitest';

import { detectInteractionType, edgeHandleWidthPx, MIN_MOVE_ZONE_PX } from '../dragMachine';

describe('drag hit zones', () => {
  it('a 12px clip moves from any point', () => {
    expect([0, 1, 6, 11, 12].map((x) => detectInteractionType(x, 12))).toEqual([
      'move', 'move', 'move', 'move', 'move',
    ]);
  });

  it('a 40px clip trims only within 8px of each edge', () => {
    expect([0, 8, 9, 31, 32, 40].map((x) => detectInteractionType(x, 40))).toEqual([
      'resize-start', 'resize-start', 'move', 'move', 'resize-end', 'resize-end',
    ]);
  });

  it('a 20px clip shrinks its edge zones to keep a 12px move zone', () => {
    const handle = edgeHandleWidthPx(20);
    expect({
      handle,
      moveZone: 20 - 2 * handle,
      zones: [4, 5, 15, 16].map((x) => detectInteractionType(x, 20)),
    }).toEqual({
      handle: 4,
      moveZone: MIN_MOVE_ZONE_PX,
      zones: ['resize-start', 'move', 'move', 'resize-end'],
    });
  });
});
