/**
 * repairTimelineData — recover a persisted timeline the aggregate refuses.
 *
 * Before AG2-08 was fixed an agent could persist clips with a negative start;
 * `TimelineAggregate.fromPlainObject` then throws on open. Opening such a
 * project with an empty timeline let the next autosave erase the user's
 * timeline for good. This clamps exactly the values that make the aggregate
 * throw and leaves everything else as saved — no packing, no reordering.
 *
 * An item is removed only when it still cannot be constructed after clamping.
 * Values the aggregate accepts on its own (a legacy agent image whose clipEnd
 * is 0, a zero duration, clipEnd ≤ clipStart) are kept: dropping them used to
 * delete valid clips whenever ANOTHER clip triggered the repair (DS3-01).
 *
 * Never mutates its input.
 */

import type { TimelineData, TimelineItemData, TrackData } from '@/components/video/timeline/domain/types';
import { TimelineAggregate, TimelineItem, Track } from '@/components/video/timeline/domain';

export interface TimelineRepairReport {
  clampedItemIds: string[];
  droppedItemIds: string[];
}

export interface TimelineSalvageReport {
  droppedTrackIds: string[];
  droppedItemIds: string[];
}

/**
 * Empty `TimelineData`. Mirrors the slice's DEFAULT_INITIAL_DATA so the
 * store's derived fields land on the same defaults as a fresh page load.
 */
export const EMPTY_TIMELINE_DATA: TimelineData = {
  currentTime: 0,
  totalDuration: 0,
  zoomLevel: 1.0,
  playbackRate: 1.0,
  isPlaying: false,
  snapToGrid: true,
  gridSize: 0.5,
  scrollLeft: 0,
  tracks: [],
};

type MutableItem = Record<string, unknown>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function canConstruct(build: () => unknown): boolean {
  try {
    build();
    return true;
  } catch {
    return false;
  }
}

/**
 * Clamp the fields the aggregate rejects; returns whether anything changed.
 * `null` in an optional field reads as absent to the aggregate (`!= null`
 * checks), so it is left alone rather than rewritten and reported as repaired.
 */
function clampItemFields(item: MutableItem): boolean {
  let clamped = false;
  if (!isFiniteNumber(item.startTime) || item.startTime < 0) {
    item.startTime = 0;
    clamped = true;
  }
  if (item.clipStart != null && (!isFiniteNumber(item.clipStart) || item.clipStart < 0)) {
    item.clipStart = 0;
    clamped = true;
  }
  // A finite duration ≤ 0 is left to the aggregate (Duration.default()); a
  // value that is not a finite number would make it throw instead.
  if (item.duration != null && !isFiniteNumber(item.duration)) {
    delete item.duration;
    clamped = true;
  }
  if (item.clipEnd != null && (!isFiniteNumber(item.clipEnd) || item.clipEnd < 0)) {
    if (item.originalMaterialType === 'image' && isFiniteNumber(item.duration) && item.duration > 0) {
      item.clipEnd = item.duration;
    } else {
      delete item.clipEnd;
    }
    clamped = true;
  }
  return clamped;
}

/**
 * Clamp one item and keep it only when `isBuildable` accepts the result.
 * The untouched original is returned when nothing needed clamping, so a
 * valid timeline stays byte-identical.
 */
function repairItem(
  item: unknown,
  fallbackId: string,
  report: TimelineRepairReport,
  isBuildable: (candidate: TimelineItemData) => boolean,
): TimelineItemData | null {
  if (!isRecord(item)) {
    report.droppedItemIds.push(fallbackId);
    return null;
  }
  const id = typeof item.id === 'string' ? item.id : fallbackId;
  const candidate: MutableItem = { ...item };
  const clamped = clampItemFields(candidate);
  const repaired = (clamped ? candidate : item) as unknown as TimelineItemData;
  if (!isBuildable(repaired)) {
    report.droppedItemIds.push(id);
    return null;
  }
  if (clamped) report.clampedItemIds.push(id);
  return repaired;
}

function repairTrack(track: TrackData, report: TimelineRepairReport): TrackData {
  if (!track || typeof track !== 'object' || !Array.isArray(track.items)) return track;
  const items: TimelineItemData[] = [];
  track.items.forEach((item, index) => {
    const repaired = repairItem(item, `${track.id}#${index}`, report,
      (candidate) => canConstruct(() => TimelineItem.fromPlainObject(candidate)));
    if (repaired) items.push(repaired);
  });
  return { ...track, items };
}

/**
 * startTime non-finite or < 0 → 0; clipStart non-finite or < 0 → 0; a
 * duration that is not a finite number is removed (the aggregate defaults
 * it); clipEnd non-finite or < 0 → the image's duration, else removed. An item
 * is dropped only when it is not an object or still cannot be constructed.
 * All other fields are kept verbatim.
 */
export function repairTimelineData(data: TimelineData): { data: TimelineData; report: TimelineRepairReport } {
  const report: TimelineRepairReport = { clampedItemIds: [], droppedItemIds: [] };
  const tracks = Array.isArray(data.tracks)
    ? data.tracks.map((track) => repairTrack(track, report))
    : data.tracks;
  return { data: { ...data, tracks }, report };
}

function salvageTrack(raw: Record<string, unknown>, report: TimelineSalvageReport): TrackData | null {
  const track = { ...raw, items: [] } as unknown as TrackData;
  if (!canConstruct(() => Track.fromPlainObject(track))) return null;
  const itemReport: TimelineRepairReport = { clampedItemIds: [], droppedItemIds: [] };
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  rawItems.forEach((item, index) => {
    const repaired = repairItem(item, `${track.id}#${index}`, itemReport,
      (candidate) => canConstruct(() => Track.fromPlainObject({ ...track, items: [candidate] })));
    if (repaired) track.items.push(repaired);
  });
  report.droppedItemIds.push(...itemReport.droppedItemIds);
  return track;
}

/**
 * Read a timeline backup the hydration could not import (N-07). Only tracks
 * are salvaged — view state (zoom, scroll, playhead) stays the user's current
 * one. Tracks that are not objects or lack an id / type are dropped, a
 * non-array `items` reads as empty, and every item goes through the same
 * clamping as `repairTimelineData`, kept only if its track can be built with it.
 *
 * @returns null when `raw` has no tracks array or the result still cannot
 *   form a timeline.
 */
export function salvageTimelineData(
  raw: unknown,
): { data: TimelineData; report: TimelineSalvageReport } | null {
  if (!isRecord(raw) || !Array.isArray(raw.tracks)) return null;
  const report: TimelineSalvageReport = { droppedTrackIds: [], droppedItemIds: [] };
  const tracks: TrackData[] = [];
  raw.tracks.forEach((entry, index) => {
    const hasIdentity = isRecord(entry) && typeof entry.id === 'string' && typeof entry.type === 'string';
    const salvaged = hasIdentity ? salvageTrack(entry, report) : null;
    if (salvaged) {
      tracks.push(salvaged);
    } else {
      report.droppedTrackIds.push(isRecord(entry) && typeof entry.id === 'string' ? entry.id : `#${index}`);
    }
  });
  const data: TimelineData = { ...EMPTY_TIMELINE_DATA, tracks };
  if (!canConstruct(() => TimelineAggregate.fromPlainObject(data))) return null;
  return { data, report };
}
