/**
 * Integration tests for the audio-detach orchestrated action (spec 01 §2.4 / §6 #5).
 *
 * Drives the real Zustand store. The action does the has-audio check from the
 * live material BEFORE recording history: a video item with audio yields a new
 * audio-track item (same start/dur/clip) and flags the source `audioDetached`;
 * undo restores; silent / already-detached / non-video inputs are no-ops.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTimelineStore } from '../../useTimelineStore';
import { detachAudioAction, type DetachAudioMaterialInfo } from '../detachAudio';
import type { TimelineData } from '../../../domain';

function baseData(): TimelineData {
  return {
    currentTime: 0, totalDuration: 6, zoomLevel: 1, playbackRate: 1,
    isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [
      {
        id: 'video-track-1', name: 'V1', type: 'video', height: 80,
        isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [
          {
            id: 'v-a', name: 'A', type: 'video', startTime: 0, duration: 4,
            trackId: 'video-track-1', color: '#4A90D9', materialId: 'mat-1',
            clipStart: 2, clipEnd: 6, originalDuration: 10, volume: 1, opacity: 1,
          },
        ],
      },
      {
        id: 'audio-track-1', name: 'A1', type: 'audio', height: 60,
        isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1,
        items: [],
      },
    ],
  };
}

const withAudio: DetachAudioMaterialInfo = { type: 'video', hasAudio: true };

describe('detachAudioAction', () => {
  beforeEach(() => {
    useTimelineStore.getState().initTimeline(baseData());
    useTimelineStore.getState().clearHistory();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      setTimeout(() => cb(performance.now()), 0);
      return 0 as unknown as number;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates an audio item mirroring start/duration/clip and flags audioDetached', () => {
    detachAudioAction(() => useTimelineStore.getState(), 'v-a', withAudio);

    const audioTrack = useTimelineStore.getState().tracks.find(t => t.id === 'audio-track-1')!;
    expect(audioTrack.items.length).toBe(1);
    const audio = audioTrack.items[0];
    expect(audio.type).toBe('audio');
    expect(audio.materialId).toBe('mat-1');
    expect(audio.startTime).toBe(0);
    expect(audio.duration).toBe(4);
    expect(audio.clipStart).toBe(2);
    expect(audio.clipEnd).toBe(6);

    const video = useTimelineStore.getState().tracks
      .find(t => t.id === 'video-track-1')!.items.find(i => i.id === 'v-a')!;
    expect(video.audioDetached).toBe(true);
  });

  it('records exactly one DETACH_AUDIO history entry and undo reverts cleanly', async () => {
    const before = useTimelineStore.getState().exportToData();
    detachAudioAction(() => useTimelineStore.getState(), 'v-a', withAudio);
    await new Promise(r => setTimeout(r, 5));

    const history = useTimelineStore.getState()._historyService.getHistory();
    expect(history[history.length - 1].type).toBe('DETACH_AUDIO');

    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().exportToData().tracks).toEqual(before.tracks);
  });

  it('redo re-applies the detach', async () => {
    detachAudioAction(() => useTimelineStore.getState(), 'v-a', withAudio);
    await new Promise(r => setTimeout(r, 5));
    const detached = useTimelineStore.getState().exportToData();
    useTimelineStore.getState().undo();
    useTimelineStore.getState().redo();
    expect(useTimelineStore.getState().exportToData().tracks).toEqual(detached.tracks);
  });

  it('no-op (no history) when the material has no audio stream', () => {
    detachAudioAction(() => useTimelineStore.getState(), 'v-a', { type: 'video', hasAudio: false });
    expect(useTimelineStore.getState().canUndo).toBe(false);
    const audioTrack = useTimelineStore.getState().tracks.find(t => t.id === 'audio-track-1')!;
    expect(audioTrack.items.length).toBe(0);
  });

  it('no-op when the item is already detached', () => {
    detachAudioAction(() => useTimelineStore.getState(), 'v-a', withAudio);
    useTimelineStore.getState().clearHistory();
    detachAudioAction(() => useTimelineStore.getState(), 'v-a', withAudio);
    expect(useTimelineStore.getState().canUndo).toBe(false);
    const audioTrack = useTimelineStore.getState().tracks.find(t => t.id === 'audio-track-1')!;
    expect(audioTrack.items.length).toBe(1);
  });

  it('treats unknown hasAudio (undefined) on a video material as detachable', () => {
    detachAudioAction(() => useTimelineStore.getState(), 'v-a', { type: 'video' });
    const audioTrack = useTimelineStore.getState().tracks.find(t => t.id === 'audio-track-1')!;
    expect(audioTrack.items.length).toBe(1);
  });

  it('keeps the detached audio time-aligned with the source video after autoOrganize', () => {
    // A leading clip pins v-a's start time; the detached audio must land at the
    // same start so video + audio stay in sync (autoOrganize repacks both tracks
    // identically because their item layouts mirror each other).
    const data = baseData();
    data.tracks[0].items = [
      {
        id: 'v-lead', name: 'lead', type: 'video', startTime: 0, duration: 2,
        trackId: 'video-track-1', color: '#4A90D9', materialId: 'mat-0',
        clipStart: 0, clipEnd: 2, originalDuration: 2, volume: 1, opacity: 1,
      },
      {
        id: 'v-a', name: 'A', type: 'video', startTime: 2, duration: 4,
        trackId: 'video-track-1', color: '#4A90D9', materialId: 'mat-1',
        clipStart: 2, clipEnd: 6, originalDuration: 10, volume: 1, opacity: 1,
      },
    ];
    // Mirror the lead on the audio track so autoOrganize packs both identically.
    data.tracks[1].items = [
      {
        id: 'a-lead', name: 'leadA', type: 'audio', startTime: 0, duration: 2,
        trackId: 'audio-track-1', color: '#10b981', materialId: 'mat-0',
        clipStart: 0, clipEnd: 2, originalDuration: 2, volume: 1, opacity: 1,
      },
    ];
    useTimelineStore.getState().initTimeline(data);
    useTimelineStore.getState().clearHistory();

    detachAudioAction(() => useTimelineStore.getState(), 'v-a', withAudio);

    const video = useTimelineStore.getState().tracks
      .find(t => t.id === 'video-track-1')!.items.find(i => i.id === 'v-a')!;
    const audioTrack = useTimelineStore.getState().tracks.find(t => t.id === 'audio-track-1')!;
    const detachedAudio = audioTrack.items.find(i => i.materialId === 'mat-1')!;
    expect(detachedAudio.startTime).toBe(video.startTime);
  });
});
