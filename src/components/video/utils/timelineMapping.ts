import type { VideoSequenceItem, AudioSequenceItem } from '../types/videoEditingTypes';

type ClippedSequence = Pick<
  VideoSequenceItem | AudioSequenceItem,
  'duration' | 'clipStart' | 'clipEnd' | 'originalDuration'
>;

type TimelineSequence = Pick<VideoSequenceItem, 'duration'>;

/**
 * Map a timeline-relative offset within a sequence to the actual time on the
 * underlying media file, taking clipStart/clipEnd into account.
 *
 * `timelineOffset` is seconds since the sequence's startTime on the timeline
 * (i.e. clampedTime - accumulatedTime). The result is clamped to
 * [clipStart, clipEnd] so callers can assign it to HTMLMediaElement.currentTime
 * without producing values outside the trimmed window.
 */
export function mapTimelineTimeToVideoTime(
  sequence: ClippedSequence,
  timelineOffset: number,
): number {
  const clipStart = sequence.clipStart || 0;
  const clipEnd =
    sequence.clipEnd || sequence.originalDuration || sequence.duration;
  const clipDuration = Math.max(clipEnd - clipStart, 1e-6);
  const sequenceDuration = Math.max(sequence.duration, 1e-6);
  const actual = clipStart + (timelineOffset * clipDuration) / sequenceDuration;
  return Math.max(clipStart, Math.min(actual, clipEnd));
}

/**
 * Map an actual media-file time back to the sequence-relative timeline offset.
 */
export function mapVideoTimeToTimelineTime(
  sequence: ClippedSequence,
  mediaTime: number,
): number {
  const clipStart = sequence.clipStart || 0;
  const clipEnd =
    sequence.clipEnd || sequence.originalDuration || sequence.duration;
  const clipDuration = Math.max(clipEnd - clipStart, 1e-6);
  const sequenceDuration = Math.max(sequence.duration, 1e-6);
  const clampedMediaTime = Math.max(clipStart, Math.min(mediaTime, clipEnd));
  const offset =
    ((clampedMediaTime - clipStart) * sequenceDuration) / clipDuration;
  return Math.max(0, Math.min(offset, sequence.duration));
}

/**
 * Locate the sequence and sequence-relative offset for a composition time.
 * Boundary clicks select the next sequence, while the exact composition end
 * maps to the final frame of the last sequence.
 */
export function findSequenceAtCompositionTime<T extends TimelineSequence>(
  sequences: T[],
  compositionTime: number,
): { sequence: T; index: number; offset: number; startTime: number } | null {
  if (sequences.length === 0) return null;

  const totalDuration = sequences.reduce(
    (sum, sequence) => sum + sequence.duration,
    0,
  );
  const clampedTime = Math.max(0, Math.min(compositionTime, totalDuration));

  let accumulatedTime = 0;
  for (let i = 0; i < sequences.length; i++) {
    const sequence = sequences[i];
    const sequenceEndTime = accumulatedTime + sequence.duration;
    const isLastSequence = i === sequences.length - 1;

    if (clampedTime < sequenceEndTime || isLastSequence) {
      return {
        sequence,
        index: i,
        offset: Math.max(
          0,
          Math.min(clampedTime - accumulatedTime, sequence.duration),
        ),
        startTime: accumulatedTime,
      };
    }

    accumulatedTime = sequenceEndTime;
  }

  return null;
}
