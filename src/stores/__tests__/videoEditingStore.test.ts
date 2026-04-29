import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetVideoEditingStore,
  useVideoEditingStore,
} from '../videoEditingStore';
import type { MaterialItem, TimelineState } from '@/types';

const sampleMaterial: MaterialItem = {
  id: 'm1',
  name: 'a.mp4',
  type: 'video',
  format: 'mp4',
  size: 1024,
  url: 'https://x',
  createdAt: new Date(),
};

const sampleTimeline: TimelineState = {
  currentTime: 0,
  totalDuration: 10,
  zoomLevel: 1,
  selectedItems: [],
  tracks: [],
  playbackRate: 1,
  isPlaying: false,
  snapToGrid: false,
  gridSize: 1,
  scrollLeft: 0,
};

describe('resetVideoEditingStore (R-F)', () => {
  beforeEach(() => {
    // Ensure each test starts clean
    resetVideoEditingStore();
  });

  it('clears materials, timeline, storyboards, async tasks, and script', () => {
    const s = useVideoEditingStore.getState();
    s.addMaterial(sampleMaterial);
    s.setTimelineState(sampleTimeline);
    s.setStoryboards([
      {
        id: 'sb1',
        title: 't',
        description: 'd',
        order: 1,
      },
    ]);
    s.addTask({
      taskId: 'task-1',
      type: 'ai_video',
      status: 'processing',
      progress: 50,
      result: null,
      error: null,
      createdAt: Date.now(),
      metadata: {},
    });
    s.setScriptContent('hello');
    s.setStoryboardGenerating(true);

    // Sanity — state is populated
    expect(useVideoEditingStore.getState().materials.length).toBe(1);
    expect(useVideoEditingStore.getState().scriptContent).toBe('hello');
    expect(Object.keys(useVideoEditingStore.getState().tasks).length).toBe(1);

    resetVideoEditingStore();

    const after = useVideoEditingStore.getState();
    expect(after.materials).toEqual([]);
    expect(after.timelineState).toBeNull();
    expect(after.storyboards).toEqual([]);
    expect(after.storyboardPacks).toEqual([]);
    expect(after.activeStoryboardId).toBeNull();
    expect(after.tasks).toEqual({});
    expect(after.scriptContent).toBe('');
    expect(after.isStoryboardGenerating).toBe(false);
  });

  it('is idempotent — calling twice keeps state empty', () => {
    resetVideoEditingStore();
    resetVideoEditingStore();
    const after = useVideoEditingStore.getState();
    expect(after.materials).toEqual([]);
    expect(after.tasks).toEqual({});
  });
});
