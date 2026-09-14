/**
 * duplicateClips — the copy (Ctrl+C) edit as a pure transform (TL2-22).
 *
 * Copies of the selected clips are appended after the last clip of their own
 * track, in the order they appear there. Clips on locked tracks are never
 * duplicated. The ids of the copies are returned so the caller can select
 * them: the copies are what the user just made, and the selection used to
 * stay on the originals.
 *
 * `audioDetached` is copied as-is: stripping it while the detached audio clip
 * is copied alongside would play the sound twice (linked copies are TL2-01).
 */

import type { TimelineData, TimelineItemData } from '../domain/types';

function newClipId(): string {
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function trackEnd(items: readonly TimelineItemData[]): number {
  return items.reduce((end, item) => Math.max(end, item.startTime + item.duration), 0);
}

export function duplicateSelectedClips(
  data: TimelineData,
  selectedIds: readonly string[],
  nameFor: (name: string) => string,
): { data: TimelineData; newIds: string[] } {
  const selected = new Set(selectedIds);
  const newIds: string[] = [];
  const tracks = data.tracks.map((track) => {
    if (track.isLocked) return track;
    const originals = track.items.filter((item) => selected.has(item.id));
    if (originals.length === 0) return track;

    let placement = trackEnd(track.items);
    const copies = originals.map((original) => {
      const copy: TimelineItemData = {
        ...original,
        id: newClipId(),
        name: nameFor(original.name),
        startTime: placement,
      };
      newIds.push(copy.id);
      placement += original.duration;
      return copy;
    });
    return { ...track, items: [...track.items, ...copies] };
  });
  return { data: { ...data, tracks }, newIds };
}
