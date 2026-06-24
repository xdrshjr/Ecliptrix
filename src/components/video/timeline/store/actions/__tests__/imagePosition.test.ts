import { describe, it, expect, beforeEach } from 'vitest';
import { useTimelineStore } from '../../useTimelineStore';
import type { ImagePosition, TimelineData } from '../../../domain';

function baseData(): TimelineData {
  return {
    currentTime: 0,
    totalDuration: 6,
    zoomLevel: 1,
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: false,
    gridSize: 1,
    scrollLeft: 0,
    tracks: [
      {
        id: 'video-track-1',
        name: 'Video 1',
        type: 'video',
        height: 80,
        isLocked: false,
        isMuted: false,
        isVisible: true,
        volume: 100,
        order: 0,
        items: [
          {
            id: 'image-item-1',
            name: 'Overlay image',
            type: 'video',
            startTime: 0,
            duration: 6,
            trackId: 'video-track-1',
            color: '#8b5cf6',
            materialId: 'image-material-1',
            originalMaterialType: 'image',
            imagePosition: { x: 0.1, y: 0.1, width: 0.8, height: 0.8, zIndex: 10 },
            volume: 1,
            opacity: 1,
          },
        ],
      },
    ],
  };
}

function storedImagePosition(): ImagePosition | undefined {
  return useTimelineStore
    .getState()
    .tracks.find(track => track.id === 'video-track-1')
    ?.items.find(item => item.id === 'image-item-1')
    ?.imagePosition;
}

describe('updateItemImagePosition', () => {
  beforeEach(() => {
    useTimelineStore.getState().initTimeline(baseData());
  });

  it('persists confirmed overlay transforms through playback time updates', () => {
    const confirmed = { x: 0.42, y: 0.18, width: 0.31, height: 0.31, zIndex: 10 };

    useTimelineStore.getState().updateItemImagePosition('image-item-1', confirmed);
    useTimelineStore.getState().setCurrentTime(2);

    expect(storedImagePosition()).toEqual(confirmed);
    expect(
      useTimelineStore
        .getState()
        .exportToData()
        .tracks[0]
        .items[0]
        .imagePosition,
    ).toEqual(confirmed);
  });
});
