/**
 * @vitest-environment node
 *
 * The store and drag machine need no DOM; the node environment also lets the
 * listener-wiring check read TimelinePanel.tsx from disk.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { useTimelineStore } from '../../useTimelineStore';
import type { TimelineData } from '../../../domain';

const get = () => useTimelineStore.getState();

function timelineWithClip(): TimelineData {
  return {
    currentTime: 0,
    totalDuration: 4,
    zoomLevel: 1,
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: false,
    gridSize: 1,
    scrollLeft: 0,
    tracks: [
      {
        id: 'video-track-1',
        name: 'Video 1',
        type: 'video',
        height: 80,
        isLocked: false,
        isMuted: false,
        isVisible: true,
        volume: 100,
        order: 0,
        items: [
          {
            id: 'clip-1',
            name: 'Clip',
            type: 'video',
            startTime: 0,
            duration: 4,
            trackId: 'video-track-1',
            color: '#3b82f6',
            materialId: 'material-1',
            clipStart: 0,
            clipEnd: 4,
            originalDuration: 4,
          },
        ],
      },
    ],
  };
}

const startOfClip = () => get().tracks[0].items[0].startTime;

/** Press in the middle of the clip (a move, not a trim) and drag right. */
function beginMoveDrag(deltaX: number): void {
  get().startDrag({
    type: 'POINTER_DOWN',
    itemId: 'clip-1',
    trackId: 'video-track-1',
    clientX: 100,
    clientY: 10,
    relativeX: 100,
    itemWidth: 200,
    originalStartTime: 0,
    originalDuration: 4,
    zoomLevel: 1,
    clipStart: 0,
    clipEnd: 4,
    originalMediaDuration: 4,
  });
  get().updateDrag({ type: 'POINTER_MOVE', clientX: 100 + deltaX / 2, clientY: 10, deltaX: deltaX / 2 });
  get().updateDrag({ type: 'POINTER_MOVE', clientX: 100 + deltaX, clientY: 10, deltaX });
}

beforeEach(() => {
  get().disposeDragActor();
  get().setExternalEditLock(null);
  get().initTimeline(timelineWithClip());
  get().clearHistory();
});

afterEach(() => {
  get().disposeDragActor();
});

describe('cancelDrag', () => {
  it('cancelDrag restores the dragged clip start time and records no history', () => {
    beginMoveDrag(150);
    const previewStart = startOfClip();

    get().cancelDrag();

    expect({
      movedDuringPreview: previewStart > 0,
      restoredStart: startOfClip(),
      canUndo: get().canUndo,
    }).toEqual({ movedDuringPreview: true, restoredStart: 0, canUndo: false });
  });

  it('pointercancel and window blur cancel an active drag', () => {
    // TimelinePanel cannot be rendered under Vitest (tsconfig jsx: preserve),
    // so the listener wiring is pinned at the source level.
    const panel = readFileSync(resolve(__dirname, '../../../TimelinePanel.tsx'), 'utf-8');
    expect(panel).toMatch(
      /addEventListener\('pointercancel', handleCancel\)[\s\S]*?addEventListener\('blur', handleCancel\)/,
    );
  });
});
