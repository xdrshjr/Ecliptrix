import type { VideoSequenceItem, AudioSequenceItem } from '../types/videoEditingTypes';

type ClippedSequence = Pick<
  VideoSequenceItem | AudioSequenceItem,
  'duration' | 'clipStart' | 'clipEnd' | 'originalDuration'
>;

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
