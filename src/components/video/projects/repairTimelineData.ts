/**
 * repairTimelineData — recover a persisted timeline the aggregate refuses.
 *
 * Before AG2-08 was fixed an agent could persist clips with a negative start;
 * `TimelineAggregate.fromPlainObject` then throws on open. Opening such a
 * project with an empty timeline let the next autosave erase the user's
 * timeline for good. This repairs exactly the values that make the aggregate
 * throw and leaves everything else as saved — no packing, no reordering.
 *
 * Never mutates its input.
 */

import type { TimelineData, TimelineItemData, TrackData } from '@/components/video/timeline/domain/types';

export interface TimelineRepairReport {
  clampedItemIds: string[];
  droppedItemIds: string[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function repairItem(
  item: TimelineItemData,
  fallbackId: string,
  report: TimelineRepairReport,
): TimelineItemData | null {
  if (!item || typeof item !== 'object') {
    report.droppedItemIds.push(fallbackId);
    return null;
  }
  const id = typeof item.id === 'string' ? item.id : fallbackId;
  if (!isFiniteNumber(item.duration) || item.duration <= 0) {
    report.droppedItemIds.push(id);
    return null;
  }

  const repaired: TimelineItemData = { ...item };
  let clamped = false;
  if (!isFiniteNumber(repaired.startTime) || repaired.startTime < 0) {
    repaired.startTime = 0;
    clamped = true;
  }
  if (repaired.clipStart !== undefined && (!isFiniteNumber(repaired.clipStart) || repaired.clipStart < 0)) {
    repaired.clipStart = 0;
    clamped = true;
  }
  if (isFiniteNumber(repaired.clipEnd) && repaired.clipEnd <= (repaired.clipStart ?? 0)) {
    report.droppedItemIds.push(id);
    return null;
  }

  if (!clamped) return item;
  report.clampedItemIds.push(id);
  return repaired;
}

function repairTrack(track: TrackData, report: TimelineRepairReport): TrackData {
  if (!track || typeof track !== 'object' || !Array.isArray(track.items)) return track;
  const items: TimelineItemData[] = [];
  track.items.forEach((item, index) => {
    const repaired = repairItem(item, `${track.id}#${index}`, report);
    if (repaired) items.push(repaired);
  });
  return { ...track, items };
}

/**
 * startTime non-finite or < 0 → 0; clipStart non-finite or < 0 → 0; an item
 * whose duration is non-finite or ≤ 0, or whose clipEnd ≤ clipStart, is
 * dropped. All other fields are kept verbatim.
 */
export function repairTimelineData(data: TimelineData): { data: TimelineData; report: TimelineRepairReport } {
  const report: TimelineRepairReport = { clampedItemIds: [], droppedItemIds: [] };
  const tracks = Array.isArray(data.tracks)
    ? data.tracks.map((track) => repairTrack(track, report))
    : data.tracks;
  return { data: { ...data, tracks }, report };
}
