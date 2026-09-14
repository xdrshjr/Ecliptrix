/**
 * Test helper for invariant S8 "a write is stable": every external writer
 * (AI mix merge, script auto-mix, agent reconcile) must produce a layout that
 * `organizeVideoAudioTracks` leaves unchanged, otherwise the next unrelated
 * edit silently rewrites it.
 *
 * Returns the items whose start time a subsequent organize pass would move;
 * an empty array means the timeline is a fixed point.
 */

import { TimelineAggregate } from '@/components/video/timeline/domain/aggregates/TimelineAggregate';
import type { TimelineData } from '@/components/video/timeline/domain/types';

const DRIFT_TOLERANCE_SECONDS = 1e-6;

export interface OrganizeDrift {
  itemId: string;
  before: number;
  after: number;
}

export function findOrganizeDrift(data: TimelineData): OrganizeDrift[] {
  const before = new Map<string, number>();
  for (const track of data.tracks) {
    for (const item of track.items) before.set(item.id, item.startTime);
  }

  const aggregate = TimelineAggregate.fromPlainObject(data);
  aggregate.organizeVideoAudioTracks();

  const drift: OrganizeDrift[] = [];
  for (const track of aggregate.toPlainObject().tracks) {
    for (const item of track.items) {
      const original = before.get(item.id);
      if (original === undefined) continue;
      if (Math.abs(original - item.startTime) > DRIFT_TOLERANCE_SECONDS) {
        drift.push({ itemId: item.id, before: original, after: item.startTime });
      }
    }
  }
  return drift;
}
