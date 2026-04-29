/**
 * Hydration unit tests for VideoEditorContainer's timeline-store handover.
 *
 * Why this file: the production bug ("opening a project shows an empty
 * timeline panel") is caused by hydration NOT happening before TimelinePanel
 * mounts. These tests pin the contract of `hydrateTimelineFromProjectData`
 * directly against the Zustand store (no React render needed) so any
 * regression — wrong field name, missing strip, swallowed schema drift —
 * fails fast in CI.
 *
 * See phase2-development-plan-revised.md §C.3 T1 / T5.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useTimelineStore } from '@/components/video/timeline/store';
import { hydrateTimelineFromProjectData } from '../hydrateTimeline';

function makeTrack(id: string, items: unknown[] = []) {
  const type: 'audio' | 'subtitle' | 'video' = id.startsWith('audio')
    ? 'audio'
    : id.startsWith('subtitle')
      ? 'subtitle'
      : 'video';
  return {
    id,
    name: id,
    type,
    height: 80,
    isLocked: false,
    isMuted: false,
    isVisible: true,
    volume: 100,
    order: 0,
    items,
  };
}

function makeItem(id: string, startTime: number, duration: number, trackId: string) {
  return {
    id,
    name: id,
    type: 'video' as const,
    startTime,
    duration,
    trackId,
    color: '#4A90D9',
    volume: 1,
    opacity: 1,
  };
}

beforeEach(() => {
  // Reset the store to a known empty state before each test so prior tests
  // do not leak. importFromData replaces the aggregate wholesale.
  useTimelineStore.getState().importFromData({
    currentTime: 0,
    totalDuration: 0,
    zoomLevel: 1,
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: true,
    gridSize: 0.5,
    scrollLeft: 0,
    tracks: [],
  });
  useTimelineStore.getState().clearHistory();
  useTimelineStore.getState().deselectAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('hydrateTimelineFromProjectData — happy path', () => {
  it('imports persisted tracks into the store', () => {
    const persisted = {
      currentTime: 5,
      totalDuration: 30,
      zoomLevel: 2,
      playbackRate: 1,
      isPlaying: false,
      snapToGrid: true,
      gridSize: 0.5,
      scrollLeft: 100,
      tracks: [makeTrack('video-track-1', [makeItem('it-a', 0, 5, 'video-track-1')])],
    };
    hydrateTimelineFromProjectData({ uiState: { currentTimelineState: persisted } });

    const state = useTimelineStore.getState();
    expect(state.tracks.length).toBe(1);
    expect(state.tracks[0].id).toBe('video-track-1');
    expect(state.tracks[0].items.length).toBe(1);
    expect(state.tracks[0].items[0].id).toBe('it-a');
    expect(state.zoomLevel).toBe(2);
    expect(state.scrollLeft).toBe(100);
  });

  it('strips selectedItems before importing — selection is reset', () => {
    const persisted = {
      currentTime: 0,
      totalDuration: 0,
      zoomLevel: 1,
      playbackRate: 1,
      isPlaying: false,
      snapToGrid: true,
      gridSize: 0.5,
      scrollLeft: 0,
      tracks: [makeTrack('video-track-1', [makeItem('it-a', 0, 5, 'video-track-1')])],
      // Persisted from a prior session where the user had item-a selected.
      selectedItems: ['it-a'],
    };
    hydrateTimelineFromProjectData({ uiState: { currentTimelineState: persisted } });

    const state = useTimelineStore.getState();
    expect(state.selectedItems).toEqual([]);
  });

  it('clears history so undo cannot revert past hydration', () => {
    const persisted = {
      currentTime: 0,
      totalDuration: 0,
      zoomLevel: 1,
      playbackRate: 1,
      isPlaying: false,
      snapToGrid: true,
      gridSize: 0.5,
      scrollLeft: 0,
      tracks: [makeTrack('video-track-1')],
    };
    hydrateTimelineFromProjectData({ uiState: { currentTimelineState: persisted } });
    expect(useTimelineStore.getState().canUndo).toBe(false);
  });
});

describe('hydrateTimelineFromProjectData — fallback paths', () => {
  it('falls back to empty store when project_data is undefined', () => {
    // First plant some leftover tracks from a "previous project".
    useTimelineStore.getState().importFromData({
      currentTime: 0,
      totalDuration: 0,
      zoomLevel: 1,
      playbackRate: 1,
      isPlaying: false,
      snapToGrid: true,
      gridSize: 0.5,
      scrollLeft: 0,
      tracks: [makeTrack('leftover-track')] as never,
    });
    expect(useTimelineStore.getState().tracks.length).toBe(1);

    hydrateTimelineFromProjectData(undefined);

    expect(useTimelineStore.getState().tracks.length).toBe(0);
  });

  it('falls back to empty store when uiState is missing (legacy project)', () => {
    useTimelineStore.getState().importFromData({
      currentTime: 0,
      totalDuration: 0,
      zoomLevel: 1,
      playbackRate: 1,
      isPlaying: false,
      snapToGrid: true,
      gridSize: 0.5,
      scrollLeft: 0,
      tracks: [makeTrack('leftover-track')] as never,
    });

    hydrateTimelineFromProjectData({ markdownContent: 'note' });

    expect(useTimelineStore.getState().tracks.length).toBe(0);
  });

  it('warns and falls back to empty store on schema drift (tracks not array)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    hydrateTimelineFromProjectData({
      uiState: {
        currentTimelineState: {
          // Bad shape: tracks is a string, not an array.
          tracks: 'not-an-array' as unknown,
        },
      },
    });

    expect(warnSpy).toHaveBeenCalled();
    expect(useTimelineStore.getState().tracks.length).toBe(0);
  });

  it('does not warn for absent persistence (legitimate fresh project)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    hydrateTimelineFromProjectData({});
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('handles null currentTimelineState without throwing (defensive fallback)', () => {
    // JSON-deserialised payloads can legitimately carry `null` here; the
    // helper must not throw — it should warn and fall back to empty tracks.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Plant some leftover state so we can assert the fallback actually wiped.
    useTimelineStore.getState().importFromData({
      currentTime: 0,
      totalDuration: 0,
      zoomLevel: 1,
      playbackRate: 1,
      isPlaying: false,
      snapToGrid: true,
      gridSize: 0.5,
      scrollLeft: 0,
      tracks: [makeTrack('leftover')] as never,
    });

    expect(() => {
      hydrateTimelineFromProjectData({
        uiState: { currentTimelineState: null as unknown as Record<string, unknown> },
      });
    }).not.toThrow();

    expect(warnSpy).toHaveBeenCalled();
    expect(useTimelineStore.getState().tracks.length).toBe(0);
  });
});

describe('hydrateTimelineFromProjectData — A→B→A isolation', () => {
  it('does not leak project A timeline into project B (B has no persistence)', () => {
    // Open project A.
    hydrateTimelineFromProjectData({
      uiState: {
        currentTimelineState: {
          currentTime: 0,
          totalDuration: 0,
          zoomLevel: 1,
          playbackRate: 1,
          isPlaying: false,
          snapToGrid: true,
          gridSize: 0.5,
          scrollLeft: 0,
          tracks: [makeTrack('video-track-1', [makeItem('a-only', 0, 3, 'video-track-1')])],
        },
      },
    });
    expect(useTimelineStore.getState().tracks[0].items[0].id).toBe('a-only');

    // Switch to project B (no persistence yet — fresh project).
    hydrateTimelineFromProjectData({});
    expect(useTimelineStore.getState().tracks.length).toBe(0);

    // Switch back to project A.
    hydrateTimelineFromProjectData({
      uiState: {
        currentTimelineState: {
          currentTime: 0,
          totalDuration: 0,
          zoomLevel: 1,
          playbackRate: 1,
          isPlaying: false,
          snapToGrid: true,
          gridSize: 0.5,
          scrollLeft: 0,
          tracks: [makeTrack('video-track-1', [makeItem('a-only', 0, 3, 'video-track-1')])],
        },
      },
    });
    expect(useTimelineStore.getState().tracks[0].items[0].id).toBe('a-only');
  });
});
