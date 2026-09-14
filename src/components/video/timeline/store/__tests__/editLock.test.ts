/**
 * @vitest-environment node
 *
 * S9 / TL2-19: while the agent holds the external edit lock, every user edit
 * that reaches the store is refused — not only undo/redo. Refusals change
 * neither the tracks nor the history. The agent's own writes still land.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTimelineStore } from '../useTimelineStore';
import { addItemAction } from '../actions/addItem';
import { moveItemAction } from '../actions/moveItem';
import { resizeItemAction } from '../actions/resizeItem';
import { removeItemAction, removeItemsAction } from '../actions/removeItem';
import { swapItemsAction } from '../actions/swapItems';
import { splitAction } from '../actions/splitItem';
import { detachAudioAction } from '../actions/detachAudio';
import { setCameraMotionAction } from '../actions/setCameraMotion';
import {
  addTrackAction,
  commitTrackVolumeAction,
  removeTrackAction,
  setTrackVolumeAction,
  setTrackVolumePreviewAction,
  toggleTrackLockAction,
  toggleTrackMuteAction,
  toggleTrackVisibilityAction,
} from '../actions/trackActions';
import { updateImagePositionAction, updateSubtitleTextAction } from '../actions/updateItemFields';
import { replaceTimelineAction, type ReplaceTimelineReason } from '../actions/replaceTimeline';
import { isEditLocked } from '../editLock';
import type { CameraMotionData, TimelineData, TrackData } from '../../domain';

const get = () => useTimelineStore.getState();

const KEYFRAME = { scale: 1.2, x: 0.5, y: 0.5, roll: 0, rotateX: 0, rotateY: 0, dolly: 0 };
const MOTION: CameraMotionData = {
  version: 1, mode: '2d', presetId: 'custom', intensity: 1, easing: 'linear',
  start: KEYFRAME, end: { ...KEYFRAME, scale: 1.5 },
};

function lane(id: string, type: TrackData['type'], order: number, items: TrackData['items']): TrackData {
  return {
    id, name: id, type, height: 60, isLocked: false, isMuted: false, isVisible: true,
    volume: 100, order, items,
  };
}

function timeline(): TimelineData {
  return {
    currentTime: 0, totalDuration: 8, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [
      lane('video-track-1', 'video', 0, [
        {
          id: 'v1', name: 'v1', type: 'video', startTime: 0, duration: 4, trackId: 'video-track-1',
          color: '#3b82f6', materialId: 'material-v1', clipStart: 0, clipEnd: 4, originalDuration: 4,
          originalMaterialType: 'video',
        },
        {
          id: 'img', name: 'img', type: 'video', startTime: 4, duration: 4, trackId: 'video-track-1',
          color: '#8b5cf6', materialId: 'material-img', originalMaterialType: 'image',
          clipStart: 0, clipEnd: 4, imagePosition: { x: 0.1, y: 0.1, width: 0.8, height: 0.8, zIndex: 10 },
        },
      ]),
      lane('audio-track-1', 'audio', 1, [
        {
          id: 'a1', name: 'a1', type: 'audio', startTime: 0, duration: 4, trackId: 'audio-track-1',
          color: '#10b981', materialId: 'material-a1', clipStart: 0, clipEnd: 4, originalDuration: 4,
        },
      ]),
      lane('audio-track-2', 'audio', 2, []),
      lane('subtitle-track-1', 'subtitle', 3, [
        {
          id: 's1', name: 's1', type: 'subtitle', startTime: 0, duration: 2,
          trackId: 'subtitle-track-1', color: '#f59e0b', text: 'hello',
        },
      ]),
    ],
  };
}

function dragV1(): void {
  get().startDrag({
    type: 'POINTER_DOWN', itemId: 'v1', trackId: 'video-track-1', clientX: 100, clientY: 10,
    relativeX: 100, itemWidth: 200, originalStartTime: 0, originalDuration: 4, zoomLevel: 1,
    clipStart: 0, clipEnd: 4, originalMediaDuration: 4,
  });
  get().updateDrag({ type: 'POINTER_MOVE', clientX: 250, clientY: 10, deltaX: 150 });
}

const EDITS: Array<[string, () => void]> = [
  ['add', () => addItemAction(get, 'video-track-1', { id: 'm-new', name: 'new', type: 'video', duration: 2 })],
  ['move', () => moveItemAction(get, 'v1', 6)],
  ['resize', () => resizeItemAction(get, 'v1', 'end', 3)],
  ['remove', () => removeItemAction(get, 'v1')],
  ['remove many', () => removeItemsAction(get, ['v1', 'a1'])],
  ['swap', () => swapItemsAction(get, 'v1', 'img')],
  ['split', () => splitAction(get, 2, 'playhead')],
  ['detach audio', () => detachAudioAction(get, 'v1', { type: 'video' })],
  ['camera motion', () => setCameraMotionAction(get, ['v1'], MOTION)],
  ['track lock', () => toggleTrackLockAction(get, 'audio-track-1')],
  ['track mute', () => toggleTrackMuteAction(get, 'audio-track-1')],
  ['track visibility', () => toggleTrackVisibilityAction(get, 'audio-track-1')],
  ['track volume', () => setTrackVolumeAction(get, 'audio-track-1', 50)],
  ['track volume preview', () => setTrackVolumePreviewAction(get, 'audio-track-1', 50)],
  ['track volume commit', () => commitTrackVolumeAction(get, 'audio-track-1', 100, 40)],
  ['add track', () => addTrackAction(get, { type: 'audio', baseTrackName: 'Audio' })],
  ['remove track', () => removeTrackAction(get, 'audio-track-2')],
  ['subtitle text', () => updateSubtitleTextAction(get, 's1', 'changed')],
  ['image position', () => updateImagePositionAction(get, 'img', { x: 0.3, y: 0.1, width: 0.8, height: 0.8, zIndex: 10 })],
  ['drag commit', () => { dragV1(); get().endDrag({ type: 'POINTER_UP', clientX: 250, clientY: 10 }); }],
];

function fingerprint() {
  return {
    tracks: JSON.stringify(get().exportToData().tracks),
    history: get()._historyService.getHistory().length,
  };
}

beforeEach(() => {
  get().disposeDragActor();
  get().setExternalEditLock(null);
  get().initTimeline(timeline());
  get().clearHistory();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  get().disposeDragActor();
  get().setExternalEditLock(null);
  vi.restoreAllMocks();
});

describe('store-level edit lock', () => {
  it('isEditLocked follows the external edit lock', () => {
    const unlocked = isEditLocked(get());
    get().setExternalEditLock('agent');
    expect({ unlocked, locked: isEditLocked(get()) }).toEqual({ unlocked: false, locked: true });
  });

  it.each(EDITS)('the %s edit changes the timeline when unlocked', (_name, edit) => {
    const before = fingerprint();
    edit();
    expect(fingerprint()).not.toEqual(before);
  });

  it.each(EDITS)(
    'every user edit action is refused while the agent holds the edit lock: %s',
    (_name, edit) => {
      get().setExternalEditLock('agent');
      const before = fingerprint();
      edit();
      expect(fingerprint()).toEqual(before);
    },
  );

  it('a drag that acquires the lock mid-gesture commits nothing', () => {
    const before = fingerprint();
    dragV1();
    get().setExternalEditLock('agent');
    get().endDrag({ type: 'POINTER_UP', clientX: 250, clientY: 10 });
    expect({ ...fingerprint(), interacting: get().isInteracting }).toEqual({ ...before, interacting: false });
  });

  it('a volume gesture the lock interrupts ends at its pre-gesture volume without history', () => {
    const before = fingerprint();
    setTrackVolumePreviewAction(get, 'audio-track-1', 40);
    get().setExternalEditLock('agent');
    commitTrackVolumeAction(get, 'audio-track-1', 100, 40);
    expect(fingerprint()).toEqual(before);
  });

  it("the agent's own replace still applies while locked", () => {
    get().setExternalEditLock('agent');
    const withAgentClip = get().exportToData();
    withAgentClip.tracks[2].items.push({
      id: 'agent-clip', name: 'agent', type: 'audio', startTime: 0, duration: 2,
      trackId: 'audio-track-2', color: '#10b981', materialId: 'material-agent',
      clipStart: 0, clipEnd: 2, originalDuration: 2,
    });
    const applied = replaceTimelineAction(get, withAgentClip, 'agent');
    const undoApplied = replaceTimelineAction(get, timeline(), 'agent-undo');
    expect({ applied, undoApplied }).toEqual({ applied: true, undoApplied: true });
  });

  it('import and ai-mix replaces are refused while locked', () => {
    get().setExternalEditLock('agent');
    const before = fingerprint();
    const changed = get().exportToData();
    changed.tracks[0].items = [];
    const reasons: ReplaceTimelineReason[] = ['import', 'ai-mix', 'auto-mix', 'subtitles'];
    const results = reasons.map((reason) => replaceTimelineAction(get, changed, reason));
    expect({ results, ...fingerprint() }).toEqual({ results: [false, false, false, false], ...before });
  });
});
