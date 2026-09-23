/**
 * fillSpanWithMaterial — cover a time span with material, trimming and
 * looping, without a hole (spec R2 §3.2.2).
 *
 * `coverSpanWithSources` is the one coverage algorithm of the editor: the
 * script auto-mix (`planScriptAutoMix`) and the segment commands (replace
 * visual, extend a segment after a longer voice-over) both call it, so a
 * segment filled by either path looks the same.
 */

import type { MaterialItem } from '@/types';
import { ItemPlacementService, Track } from '@/components/video/timeline/domain';
import type { TimelineItemData, TrackData } from '@/components/video/timeline/domain';
import { toMaterialData } from '@/components/video/timeline/domain/services/ItemPlacementService';

export const MIN_CLIP_SECONDS = 0.1;
/** Slack for comparisons between times rounded to microseconds. */
const TIME_EPSILON = 1e-9;

export const roundTime = (seconds: number): number => Math.round(seconds * 1e6) / 1e6;

export interface SpanClip {
  material: MaterialItem;
  startTime: number;
  duration: number;
  clipStart: number;
  clipEnd: number;
}

export interface SpanCoverage {
  clips: SpanClip[];
  looped: boolean;
  covered: boolean;
}

function clipAt(material: MaterialItem, startTime: number, duration: number): SpanClip {
  const length = roundTime(duration);
  return {
    material, startTime: roundTime(startTime), duration: length, clipStart: 0, clipEnd: length,
  };
}

/**
 * Fill [start, start + span) with the sources, trimming and looping. Clips
 * never end with a sub-0.1 s residue: the previous clip is shortened to leave
 * a full 0.1 s, and a residue that still remains is taken from the last
 * clip's unused source. Sources shorter than 0.1 s (or of unknown length) are
 * skipped: they cannot fill anything and would make the loop unbounded. The
 * auto-mix already filters them out, so its output is unchanged.
 */
export function coverSpanWithSources(
  candidates: readonly MaterialItem[],
  start: number,
  span: number,
): SpanCoverage {
  const sources = candidates.filter((source) =>
    (source.duration ?? 0) >= MIN_CLIP_SECONDS - TIME_EPSILON);
  const clips: SpanClip[] = [];
  if (sources.length === 0) {
    return { clips, looped: false, covered: span < MIN_CLIP_SECONDS };
  }
  const shortest = Math.min(...sources.map((source) => source.duration ?? 0));
  const maxClips = sources.length + Math.ceil(span / shortest) + 1;
  let remaining = span;
  let looped = false;
  for (let index = 0; index < maxClips && remaining >= MIN_CLIP_SECONDS - TIME_EPSILON; index += 1) {
    looped = looped || index >= sources.length;
    const source = sources[index % sources.length];
    let take = Math.min(source.duration ?? 0, remaining);
    const leftover = remaining - take;
    if (leftover > TIME_EPSILON && leftover < MIN_CLIP_SECONDS - TIME_EPSILON
      && remaining - MIN_CLIP_SECONDS >= MIN_CLIP_SECONDS - TIME_EPSILON) {
      take = remaining - MIN_CLIP_SECONDS; // leave the next clip a whole 0.1 s
    }
    take = roundTime(take);
    clips.push(clipAt(source, start + span - remaining, take));
    remaining = roundTime(remaining - take);
  }
  const last = clips[clips.length - 1];
  if (remaining > TIME_EPSILON && last
    && (last.material.duration ?? 0) - last.duration >= remaining - TIME_EPSILON) {
    last.duration = roundTime(last.duration + remaining);
    last.clipEnd = roundTime(last.clipEnd + remaining);
    remaining = 0;
  }
  return { clips, looped, covered: remaining <= TIME_EPSILON };
}

/**
 * Build a clip exactly like a manual drop (colour, url / cacheUrl /
 * storageKey snapshot, originalMaterialType, waveform), pinned to `clip`.
 */
export function buildItemForClip(track: TrackData, clip: SpanClip): TimelineItemData {
  const emptyTrack = Track.fromPlainObject({ ...track, items: [] });
  const item = ItemPlacementService.createItemFromMaterial(
    toMaterialData(clip.material),
    emptyTrack,
  );
  const sourceDuration = clip.material.duration;
  return {
    ...item,
    startTime: clip.startTime,
    duration: clip.duration,
    clipStart: clip.clipStart,
    clipEnd: clip.clipEnd,
    ...(sourceDuration && sourceDuration > 0 && clip.material.type !== 'image'
      ? { originalDuration: sourceDuration }
      : {}),
  };
}

export interface FilledSpan {
  items: TimelineItemData[];
  /** True when a residue shorter than 0.1 s could not be filled. */
  hasGap: boolean;
}

/**
 * Fill [start, start + span) on `track` with one material. An image is one
 * clip of exactly `span`; a video is trimmed when long enough and looped
 * otherwise.
 */
export function fillSpanWithMaterial(
  material: MaterialItem,
  track: TrackData,
  start: number,
  span: number,
): FilledSpan {
  if (span < MIN_CLIP_SECONDS - TIME_EPSILON) return { items: [], hasGap: span > TIME_EPSILON };
  if (material.type === 'image') {
    const clip = clipAt(material, start, span);
    return { items: [buildItemForClip(track, clip)], hasGap: false };
  }
  const coverage = coverSpanWithSources([material], start, span);
  return {
    items: coverage.clips.map((clip) => buildItemForClip(track, clip)),
    hasGap: !coverage.covered,
  };
}
