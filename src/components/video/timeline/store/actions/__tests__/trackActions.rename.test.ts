/**
 * @vitest-environment node
 *
 * T-TRACK-RENAME (spec R2 §3.10): renaming a lane is one undoable edit, an
 * empty name brings the derived default back, and the exported timeline JSON
 * carries the new name (useTimelineExport derives names the same way).
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { getTranslations } from '@/lib/i18n';
import { useTimelineStore } from '../../useTimelineStore';
import { renameTrackAction, toggleTrackLockAction } from '../trackActions';
import { deriveTrackDisplayName } from '../../../trackDisplayName';
import type { TimelineData } from '../../../domain';

const get = () => useTimelineStore.getState();
const trackCopy = getTranslations('zh-CN').timeline.track;

function timeline(): TimelineData {
  return {
    currentTime: 0, totalDuration: 6, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'video-track-1', name: '', type: 'video', height: 60,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
      items: [{
        id: 'clip', name: 'clip', type: 'video', startTime: 0, duration: 6, trackId: 'video-track-1',
        color: '#3b82f6', materialId: 'm-clip', clipStart: 0, clipEnd: 6, originalDuration: 6,
      }],
    }],
  };
}

const trackName = () => get().tracks[0].name;
/** The name useTimelineExport writes into the exported JSON. */
const exportedNames = () => get().exportToData().tracks
  .map((track) => deriveTrackDisplayName(track, trackCopy));

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(timeline());
  get().clearHistory();
});

describe('renameTrackAction', () => {
  it('rename is undoable and redoable', () => {
    renameTrackAction(get, 'video-track-1', '空镜');
    get().undo();
    const afterUndo = trackName();
    get().redo();
    expect({ afterUndo, afterRedo: trackName() }).toEqual({ afterUndo: '', afterRedo: '空镜' });
  });

  it('an empty name restores the derived default name', () => {
    renameTrackAction(get, 'video-track-1', '空镜');
    renameTrackAction(get, 'video-track-1', '   ');
    expect({ stored: trackName(), shown: exportedNames()[0] })
      .toEqual({ stored: '', shown: trackCopy.mainVisual });
  });

  it('exported timeline JSON uses the new name', () => {
    renameTrackAction(get, 'video-track-1', '  开场空镜  ');
    expect(exportedNames()).toEqual(['开场空镜']);
  });

  it('names are capped at 24 characters', () => {
    renameTrackAction(get, 'video-track-1', 'x'.repeat(30));
    expect(trackName()).toHaveLength(24);
  });

  it('a locked track can still be renamed', () => {
    toggleTrackLockAction(get, 'video-track-1');
    renameTrackAction(get, 'video-track-1', '已锁定的轨');
    expect({ name: trackName(), isLocked: get().tracks[0].isLocked })
      .toEqual({ name: '已锁定的轨', isLocked: true });
  });

  it('the agent edit lock refuses a rename without recording history', () => {
    get().setExternalEditLock('agent');
    renameTrackAction(get, 'video-track-1', '空镜');
    expect({ name: trackName(), canUndo: get().canUndo }).toEqual({ name: '', canUndo: false });
  });

  it('renaming to the current name records nothing', () => {
    renameTrackAction(get, 'video-track-1', '');
    expect(get().canUndo).toBe(false);
  });
});
