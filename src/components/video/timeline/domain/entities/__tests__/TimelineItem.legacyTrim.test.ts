/**
 * TL2-05: a legacy media clip saved without clip fields plays from source 0.
 * Trimming its left edge must move the in-point, not only the track edge.
 */
import { describe, expect, it } from 'vitest';

import { TimelineItem } from '../TimelineItem';
import { TimePosition } from '../../value-objects/TimePosition';

describe('trimming clips without clip fields', () => {
  it('left trim of a clip without clip info moves its in-point', () => {
    const item = TimelineItem.fromPlainObject({
      id: 'legacy', name: 'legacy', type: 'video', startTime: 0, duration: 10,
      trackId: 'video-track-1', color: '#3b82f6', originalDuration: 10,
    });
    item.resize('start', TimePosition.create(2));
    const data = item.toPlainObject();
    expect({
      startTime: data.startTime, duration: data.duration, clipStart: data.clipStart, clipEnd: data.clipEnd,
    }).toEqual({ startTime: 2, duration: 8, clipStart: 2, clipEnd: 10 });
  });

  it('subtitle trim keeps no clip fields', () => {
    const item = TimelineItem.fromPlainObject({
      id: 'caption', name: 'caption', type: 'subtitle', startTime: 5, duration: 2,
      trackId: 'subtitle-track-1', color: '#f59e0b', text: 'hello',
    });
    item.resize('start', TimePosition.create(4));
    const data = item.toPlainObject();
    expect({
      startTime: data.startTime, duration: data.duration, clipStart: data.clipStart, clipEnd: data.clipEnd,
    }).toEqual({ startTime: 4, duration: 3, clipStart: undefined, clipEnd: undefined });
  });
});
