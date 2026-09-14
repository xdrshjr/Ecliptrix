import { describe, expect, it } from 'vitest';

import { createDragActor, type PointerDownEvent } from '../dragMachine';

function pointerDown(relativeX: number): PointerDownEvent {
  return {
    type: 'POINTER_DOWN',
    itemId: 'clip',
    trackId: 'video-track-1',
    clientX: 100,
    clientY: 50,
    relativeX,
    itemWidth: 200,
    originalStartTime: 2,
    originalDuration: 4,
    zoomLevel: 1,
    clipStart: 0,
    clipEnd: 4,
    originalMediaDuration: 10,
  };
}

function pressed(relativeX: number) {
  const actor = createDragActor();
  actor.start();
  actor.send(pointerDown(relativeX));
  return actor;
}

describe('drag machine threshold', () => {
  it('the threshold-crossing move already carries a preview', () => {
    const actor = pressed(100);
    actor.send({ type: 'POINTER_MOVE', clientX: 200, clientY: 50, deltaX: 100 });
    const snapshot = actor.getSnapshot();
    expect({
      dragging: snapshot.matches('dragging'),
      previewStartTime: snapshot.context.previewStartTime,
    }).toEqual({ dragging: true, previewStartTime: 4 });
  });

  it('ESCAPE leaves committed', () => {
    const actor = pressed(100);
    actor.send({ type: 'POINTER_MOVE', clientX: 200, clientY: 50, deltaX: 100 });
    actor.send({ type: 'POINTER_UP', clientX: 200, clientY: 50 });
    const wasCommitted = actor.getSnapshot().matches('committed');
    actor.send({ type: 'ESCAPE' });
    expect({ wasCommitted, idle: actor.getSnapshot().matches('idle') }).toEqual({
      wasCommitted: true,
      idle: true,
    });
  });

  it('a purely vertical move past the threshold starts a move drag', () => {
    const actor = pressed(100);
    actor.send({ type: 'POINTER_MOVE', clientX: 100, clientY: 70, deltaX: 0, targetTrackId: 'video-track-2' });
    expect(actor.getSnapshot().matches('dragging')).toBe(true);
  });

  it('vertical jitter on a trim handle does not start a resize', () => {
    const actor = pressed(2);
    actor.send({ type: 'POINTER_MOVE', clientX: 100, clientY: 70, deltaX: 0 });
    expect(actor.getSnapshot().matches('detecting')).toBe(true);
  });

  it('an explicit deltaY is used instead of the pointer-down position', () => {
    const actor = pressed(100);
    actor.send({ type: 'POINTER_MOVE', clientX: 100, clientY: 50, deltaX: 0, deltaY: 20 });
    expect(actor.getSnapshot().matches('dragging')).toBe(true);
  });
});
