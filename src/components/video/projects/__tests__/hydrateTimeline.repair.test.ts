import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from '@/components/video/timeline/store';
import { hydrateTimelineFromProjectData, withTimelineRecoveryBackup } from '../hydrateTimeline';

const NOW = new Date('2026-09-14T10:00:00.000Z');

function track(id: string, items: unknown) {
  return {
    id, name: id, type: 'video', height: 80, isLocked: false, isMuted: false,
    isVisible: true, volume: 100, order: 0, items,
  };
}

function clip(id: string, startTime: number, duration: number) {
  return {
    id, name: id, type: 'video', startTime, duration, trackId: 'video-track-1',
    color: '#4A90D9', clipStart: 0, clipEnd: duration,
  };
}

function projectWithTimeline(tracks: unknown[]): Record<string, unknown> {
  return {
    markdownContent: '',
    uiState: {
      currentTimelineState: {
        currentTime: 0, totalDuration: 10, zoomLevel: 1, playbackRate: 1, isPlaying: false,
        snapToGrid: true, gridSize: 0.5, scrollLeft: 0, tracks,
      },
    },
  };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  hydrateTimelineFromProjectData({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('hydrateTimelineFromProjectData — repair', () => {
  it('a timeline with a negative start opens repaired instead of empty', () => {
    const projectData = projectWithTimeline([
      track('video-track-1', [clip('neg', -3, 5), clip('ok', 5, 5)]),
    ]);

    const result = hydrateTimelineFromProjectData(projectData);

    expect(result).toEqual({ status: 'repaired', report: { clampedItemIds: ['neg'], droppedItemIds: [] } });
    const items = useTimelineStore.getState().tracks[0].items;
    expect(items.map((item) => item.id).sort()).toEqual(['neg', 'ok']);
    expect(items.every((item) => item.startTime >= 0)).toBe(true);
    expect(withTimelineRecoveryBackup(projectData, result, NOW)).toBe(projectData);
  });

  it('an unreadable timeline is backed up before the editor opens empty', () => {
    const projectData = projectWithTimeline([track('video-track-1', 'broken-items')]);
    const original = (projectData.uiState as { currentTimelineState: unknown }).currentTimelineState;

    const result = hydrateTimelineFromProjectData(projectData);
    const opened = withTimelineRecoveryBackup(projectData, result, NOW);

    expect(result).toEqual({ status: 'failed' });
    expect(useTimelineStore.getState().tracks).toEqual([]);
    expect(opened.timelineRecoveryBackup).toEqual({ savedAt: NOW.toISOString(), data: original });
    expect(opened.uiState).toBe(projectData.uiState);
  });

  it('an existing recovery backup is never overwritten', () => {
    const earliest = { savedAt: '2026-09-01T00:00:00.000Z', data: { tracks: 'first' } };
    const projectData = { ...projectWithTimeline([track('video-track-1', 'broken-items')]), timelineRecoveryBackup: earliest };

    const result = hydrateTimelineFromProjectData(projectData);
    const opened = withTimelineRecoveryBackup(projectData, result, NOW);

    expect(result.status).toBe('failed');
    expect(opened.timelineRecoveryBackup).toBe(earliest);
  });

  it('a negative start elsewhere does not drop an agent-added image', () => {
    // A legacy agent image (clipEnd 0) is valid for the aggregate; only the
    // negative start on another clip makes the import throw (DS3-01).
    const image = {
      ...clip('image', 0, 4), trackId: 'image-track-1', clipStart: 0, clipEnd: 0, originalMaterialType: 'image',
    };
    const projectData = projectWithTimeline([
      track('video-track-1', [clip('neg', -3, 5)]),
      track('image-track-1', [image]),
    ]);

    const result = hydrateTimelineFromProjectData(projectData);

    expect({
      result,
      imageIds: useTimelineStore.getState().tracks
        .find((entry) => entry.id === 'image-track-1')?.items.map((item) => item.id),
    }).toEqual({
      result: { status: 'repaired', report: { clampedItemIds: ['neg'], droppedItemIds: [] } },
      imageIds: ['image'],
    });
  });

  it('a repair that drops an item keeps a recovery backup', () => {
    const projectData = projectWithTimeline([track('video-track-1', [clip('neg', -3, 5), null])]);
    const original = (projectData.uiState as { currentTimelineState: unknown }).currentTimelineState;

    const result = hydrateTimelineFromProjectData(projectData);
    const opened = withTimelineRecoveryBackup(projectData, result, NOW);

    expect({ result, backup: opened.timelineRecoveryBackup }).toEqual({
      result: { status: 'repaired', report: { clampedItemIds: ['neg'], droppedItemIds: ['video-track-1#1'] } },
      backup: { savedAt: NOW.toISOString(), data: original },
    });
  });

  it('a fresh project and a null timeline have nothing to recover', () => {
    expect(hydrateTimelineFromProjectData({})).toEqual({ status: 'loaded' });
    expect(hydrateTimelineFromProjectData({ uiState: { currentTimelineState: null } })).toEqual({ status: 'loaded' });
  });
});
