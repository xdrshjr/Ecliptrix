/**
 * @vitest-environment node
 *
 * TL2-22: copying clips selects the copies, appended after their track's
 * last clip.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { duplicateSelectedClips } from '../duplicateClips';
import type { TimelineData, TimelineItemData, TrackData } from '../../domain/types';

function clip(id: string, trackId: string, startTime: number, duration: number): TimelineItemData {
  return { id, name: id, type: 'video', startTime, duration, trackId, color: '#3b82f6', materialId: `m-${id}` };
}

function track(id: string, items: TimelineItemData[], isLocked = false): TrackData {
  return {
    id, name: id, type: 'video', height: 80, isLocked, isMuted: false, isVisible: true,
    volume: 100, order: 0, items,
  };
}

function timeline(tracks: TrackData[]): TimelineData {
  return {
    currentTime: 0, totalDuration: 10, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0, tracks,
  };
}

const copyName = (name: string) => `${name} copy`;

describe('duplicateSelectedClips', () => {
  it('copies become the new selection', () => {
    const { data, newIds } = duplicateSelectedClips(
      timeline([track('v1', [clip('a', 'v1', 0, 2), clip('b', 'v1', 2, 3)])]),
      ['a', 'b'],
      copyName,
    );
    const copies = data.tracks[0].items.filter((item) => newIds.includes(item.id));
    expect(copies.map((item) => item.name)).toEqual(['a copy', 'b copy']);

    // The panel hands exactly those ids to the selection once history is captured.
    const panel = readFileSync(resolve(__dirname, '../../TimelinePanel.tsx'), 'utf-8');
    const handleCopy = panel.slice(panel.indexOf('const handleCopy = useCallback('));
    expect(handleCopy).toMatch(/captureNextState\(\);[\s\S]*?selectItems\(newIds\)/);
  });

  it('copies land after the last clip of their track', () => {
    const { data, newIds } = duplicateSelectedClips(
      timeline([track('v1', [clip('a', 'v1', 0, 2), clip('b', 'v1', 2, 3)])]),
      ['a'],
      copyName,
    );
    const copy = data.tracks[0].items.find((item) => item.id === newIds[0]);
    expect(copy?.startTime).toBe(5);
  });

  it('clips on locked tracks are not copied', () => {
    const { newIds } = duplicateSelectedClips(
      timeline([track('v1', [clip('a', 'v1', 0, 2)], true)]),
      ['a'],
      copyName,
    );
    expect(newIds).toEqual([]);
  });
});
