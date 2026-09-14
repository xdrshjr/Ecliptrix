import { describe, expect, it } from 'vitest';

import { TimelineItem } from '../TimelineItem';
import { Track } from '../Track';
import { TimePosition } from '../../value-objects/TimePosition';
import { SplitService } from '../../services/SplitService';
import type { SequenceTransitionData, TimelineItemData } from '../../types';

const FADE: SequenceTransitionData = { type: 'fade', duration: 0.5 };
const DISSOLVE: SequenceTransitionData = { type: 'dissolve', duration: 1 };

function imageItem(overrides: Partial<TimelineItemData> = {}): TimelineItemData {
  return {
    id: 'image-1',
    name: 'Still',
    type: 'video',
    startTime: 4,
    duration: 5,
    trackId: 'image-track-1',
    color: '#8b5cf6',
    materialId: 'image-material',
    clipStart: 0,
    clipEnd: 5,
    originalMaterialType: 'image',
    ...overrides,
  };
}

describe('still image resizing', () => {
  it('image items can be lengthened past their initial duration', () => {
    const item = TimelineItem.fromPlainObject(imageItem());
    item.resize('end', TimePosition.create(16));
    expect(item.toPlainObject()).toMatchObject({ startTime: 4, duration: 12, clipStart: 0, clipEnd: 12 });
  });

  it('image items can be extended to the left', () => {
    const item = TimelineItem.fromPlainObject(imageItem());
    item.resize('start', TimePosition.create(1));
    expect(item.toPlainObject()).toMatchObject({ startTime: 1, duration: 8, clipStart: 0, clipEnd: 8 });
  });

  it('legacy image items with originalDuration still extend', () => {
    const item = TimelineItem.fromPlainObject(imageItem({ originalDuration: 5 }));
    item.resize('end', TimePosition.create(16));
    expect(item.duration.value).toBe(12);
  });

  it('agent-added images with an empty clip range stretch to the dragged length', () => {
    // The agent writes images with clipStart 0 / clipEnd 0; the right edge
    // must not be derived from that empty source range.
    const item = TimelineItem.fromPlainObject(imageItem({ clipEnd: 0 }));
    item.resize('end', TimePosition.create(11));
    expect(item.toPlainObject()).toMatchObject({ startTime: 4, duration: 7, clipStart: 0, clipEnd: 7 });
  });

  it('agent-added images with an empty clip range can be shortened', () => {
    const item = TimelineItem.fromPlainObject(imageItem({ clipEnd: 0 }));
    item.resize('end', TimePosition.create(8));
    expect(item.toPlainObject()).toMatchObject({ startTime: 4, duration: 4, clipStart: 0, clipEnd: 4 });
  });

  it('video items stay bounded by their source length', () => {
    const item = TimelineItem.fromPlainObject(
      imageItem({ originalMaterialType: 'video', originalDuration: 5 }),
    );
    item.resize('end', TimePosition.create(16));
    expect(item.duration.value).toBe(5);
  });
});

describe('transition fields', () => {
  it('transitions survive fromPlainObject and toPlainObject', () => {
    const data = imageItem({ transitionIn: FADE, transitionOut: DISSOLVE });
    expect(TimelineItem.fromPlainObject(data).toPlainObject()).toMatchObject({
      transitionIn: FADE,
      transitionOut: DISSOLVE,
    });
  });

  it('split clears the inner transition edges', () => {
    const track = Track.fromPlainObject({
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
        imageItem({
          id: 'clip-1',
          trackId: 'video-track-1',
          startTime: 0,
          duration: 10,
          clipEnd: 10,
          originalMaterialType: 'video',
          originalDuration: 10,
          transitionIn: FADE,
          transitionOut: DISSOLVE,
        }),
      ],
    });

    const result = SplitService.splitItemAtTime(track, 'clip-1', 4);
    const left = track.findItem(result!.leftId)!.toPlainObject();
    const right = track.findItem(result!.rightId)!.toPlainObject();

    expect({
      leftIn: left.transitionIn,
      leftOut: left.transitionOut,
      rightIn: right.transitionIn,
      rightOut: right.transitionOut,
    }).toEqual({ leftIn: FADE, leftOut: undefined, rightIn: undefined, rightOut: DISSOLVE });
  });
});
