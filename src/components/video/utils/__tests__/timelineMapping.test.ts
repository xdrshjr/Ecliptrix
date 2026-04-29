import { describe, expect, it } from 'vitest';
import type { VideoSequenceItem } from '../../types/videoEditingTypes';
import {
  findSequenceAtCompositionTime,
  mapTimelineTimeToVideoTime,
  mapVideoTimeToTimelineTime,
} from '../timelineMapping';

const makeSequence = (
  id: string,
  duration: number,
  overrides: Partial<VideoSequenceItem> = {},
): VideoSequenceItem => ({
  id,
  name: id,
  url: '/same-source.mp4',
  startTime: 0,
  duration,
  trackId: 'track-1',
  ...overrides,
});

describe('timelineMapping', () => {
  it('maps sequence-relative time to trimmed media time', () => {
    const sequence = makeSequence('trimmed', 5, {
      clipStart: 10,
      clipEnd: 20,
      originalDuration: 30,
    });

    expect(mapTimelineTimeToVideoTime(sequence, 0)).toBe(10);
    expect(mapTimelineTimeToVideoTime(sequence, 2.5)).toBe(15);
    expect(mapTimelineTimeToVideoTime(sequence, 5)).toBe(20);
  });

  it('maps trimmed media time back to sequence-relative time', () => {
    const sequence = makeSequence('trimmed', 5, {
      clipStart: 10,
      clipEnd: 20,
      originalDuration: 30,
    });

    expect(mapVideoTimeToTimelineTime(sequence, 10)).toBe(0);
    expect(mapVideoTimeToTimelineTime(sequence, 15)).toBe(2.5);
    expect(mapVideoTimeToTimelineTime(sequence, 20)).toBe(5);
  });

  it('selects the next sequence on exact boundaries and clamps the composition end to the last sequence', () => {
    const sequences = [
      makeSequence('first', 4),
      makeSequence('second', 6),
    ];

    expect(findSequenceAtCompositionTime(sequences, 0)).toMatchObject({
      index: 0,
      offset: 0,
    });
    expect(findSequenceAtCompositionTime(sequences, 4)).toMatchObject({
      index: 1,
      offset: 0,
    });
    expect(findSequenceAtCompositionTime(sequences, 10)).toMatchObject({
      index: 1,
      offset: 6,
    });
  });

  it('keeps reused media URLs distinguishable by composition time', () => {
    const sequences = [
      makeSequence('first-use', 4, { clipStart: 0, clipEnd: 4 }),
      makeSequence('second-use', 4, { clipStart: 20, clipEnd: 24 }),
    ];

    const target = findSequenceAtCompositionTime(sequences, 6);

    expect(target).toMatchObject({
      index: 1,
      offset: 2,
      sequence: { id: 'second-use' },
    });
    expect(mapTimelineTimeToVideoTime(target!.sequence, target!.offset)).toBe(22);
  });
});
