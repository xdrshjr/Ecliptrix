/**
 * @vitest-environment node
 *
 * T96 / RV3-05: whole-timeline writes keep the lock, mute and visibility the
 * user set — only a JSON import applies the flags it carries.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../useTimelineStore';
import { replaceTimelineAction } from '../replaceTimeline';
import { toggleTrackMuteAction } from '../trackActions';
import type { TimelineData, TimelineItemData, TrackData } from '../../../domain';

const get = () => useTimelineStore.getState();

function clip(id: string, startTime: number): TimelineItemData {
  return {
    id, name: id, type: 'audio', startTime, duration: 2, trackId: 'audio-track-1', color: '#10b981',
    materialId: `m-${id}`, clipStart: 0, clipEnd: 2, originalDuration: 2,
  };
}

function timeline(items: TimelineItemData[], flags: Partial<TrackData> = {}): TimelineData {
  return {
    currentTime: 0, totalDuration: 4, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'audio-track-1', name: 'Music', type: 'audio', height: 60, isLocked: false,
      isMuted: false, isVisible: true, volume: 100, order: 0, items, ...flags,
    }],
  };
}

const music = () => get().tracks[0];

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(timeline([clip('a', 0)]));
  get().clearHistory();
});

describe('replaceTimelineAction view flags', () => {
  it('undoing an agent turn keeps the track the user muted afterwards muted', () => {
    const turnStart = get().exportToData();
    replaceTimelineAction(get, timeline([clip('a', 0), clip('b', 2)]), 'agent');
    toggleTrackMuteAction(get, 'audio-track-1');
    replaceTimelineAction(get, turnStart, 'agent-undo');
    expect({ clips: music().items.map((item) => item.id), isMuted: music().isMuted }).toEqual({
      clips: ['a'], isMuted: true,
    });
  });

  it('a JSON import applies the imported track flags', () => {
    replaceTimelineAction(get, timeline([clip('a', 0)], { isLocked: true }), 'import');
    expect(music().isLocked).toBe(true);
  });

  it('a write that differs only in view flags records no history', () => {
    const written = replaceTimelineAction(get, timeline([clip('a', 0)], { isMuted: true }), 'agent');
    expect({ written, isMuted: music().isMuted, canUndo: get().canUndo }).toEqual({
      written: false, isMuted: false, canUndo: false,
    });
  });
});
