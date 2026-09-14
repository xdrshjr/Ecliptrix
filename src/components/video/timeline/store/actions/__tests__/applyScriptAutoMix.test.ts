import { describe, it, expect, beforeEach } from 'vitest';
import type { MaterialItem } from '@/types';
import { useTimelineStore } from '../../useTimelineStore';
import type { TimelineData, TrackData } from '../../../domain';
import { planScriptAutoMix } from '@/components/video/lib/aiMix/planScriptAutoMix';
import { applyScriptAutoMixAction } from '../applyScriptAutoMix';

function scriptMaterial(
  id: string,
  type: 'audio' | 'video',
  duration: number,
): MaterialItem {
  return {
    id,
    name: id,
    type,
    format: type === 'audio' ? 'mp3' : 'mp4',
    size: 1,
    duration,
    url: `/api/storage/files/${id}`,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    metadata: { segment_id: 'segment-1', segment_number: 1 },
  };
}

function track(
  id: string,
  type: TrackData['type'],
  order: number,
  overrides: Partial<TrackData> = {},
): TrackData {
  return {
    id,
    name: id,
    type,
    height: 60,
    isLocked: false,
    isMuted: false,
    isVisible: true,
    volume: 100,
    order,
    items: [{
      id: `${id}-existing`,
      name: 'existing',
      type,
      startTime: 0,
      duration: 2,
      trackId: id,
      color: '#6b7280',
      ...(type === 'subtitle' ? { text: 'hello' } : {}),
    }],
    ...overrides,
  };
}

function seedTimeline(tracks: TrackData[]): void {
  const data: TimelineData = {
    currentTime: 0,
    totalDuration: 2,
    zoomLevel: 1,
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: true,
    gridSize: 0.5,
    scrollLeft: 0,
    tracks,
  };
  useTimelineStore.getState().initTimeline(data);
  useTimelineStore.getState().clearHistory();
}

const get = () => useTimelineStore.getState();
const plan = planScriptAutoMix([
  scriptMaterial('tts-1', 'audio', 3),
  scriptMaterial('video-1', 'video', 5),
]);

describe('applyScriptAutoMixAction', () => {
  beforeEach(() => {
    seedTimeline([
      track('video-track-1', 'video', 0),
      track('audio-track-1', 'audio', 1),
      track('subtitle-track-1', 'subtitle', 2),
    ]);
  });

  it('replaces the target lanes as one undoable step', () => {
    const before = get().exportToData().tracks;

    applyScriptAutoMixAction(get, plan);
    const recorded = get()._historyService.getActionCount();
    get().undo();

    expect({ recorded, tracks: get().exportToData().tracks })
      .toEqual({ recorded: 1, tracks: before });
  });

  it('reports how many existing clips were replaced', () => {
    expect(applyScriptAutoMixAction(get, plan))
      .toEqual({ ok: true, replacedItemCount: 2 });
  });

  it('leaves tracks outside the plan untouched', () => {
    const subtitles = get().exportToData().tracks[2];

    applyScriptAutoMixAction(get, plan);

    expect(get().exportToData().tracks[2]).toEqual(subtitles);
  });

  it('places clips at the planned times and records the source length', () => {
    applyScriptAutoMixAction(get, plan);

    const video = get().exportToData().tracks[0].items;
    expect(video).toMatchObject([{
      materialId: 'video-1',
      startTime: 0,
      duration: 3,
      clipStart: 0,
      clipEnd: 3,
      originalDuration: 5,
      originalMaterialType: 'video',
    }]);
  });

  it('refuses a locked target track without recording history', () => {
    seedTimeline([
      track('video-track-1', 'video', 0),
      track('audio-track-1', 'audio', 1, { isLocked: true }),
    ]);

    const result = applyScriptAutoMixAction(get, plan);

    expect({ result, canUndo: get().canUndo })
      .toEqual({ result: { ok: false, reason: 'track-locked' }, canUndo: false });
  });

  it('refuses when the plan needs a lane the timeline lacks', () => {
    seedTimeline([track('video-track-1', 'video', 0)]);

    const result = applyScriptAutoMixAction(get, plan);

    expect({ result, canUndo: get().canUndo }).toEqual({
      result: { ok: false, reason: 'no-target-track' },
      canUndo: false,
    });
  });
});
