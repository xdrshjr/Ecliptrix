/**
 * Editing tool guards: locked tracks (AG-04), track / material type
 * compatibility (AG-05) and the resize_clip source bound (AG-07).
 */
import { describe, it, expect, vi } from 'vitest';
import type { MaterialItem, TimelineItem, Track } from '@/types';
import type { ToolContext } from '../types';
import { createAddToTrackTool } from '../tools/addToTrack';
import { createDeleteClipTool } from '../tools/deleteClip';
import { createMoveClipTool } from '../tools/moveClip';
import { createResizeClipTool } from '../tools/resizeClip';

function clip(id: string, trackId: string, extra: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id, name: id, type: 'video', startTime: 0, duration: 4, trackId, color: '#000',
    clipStart: 0, clipEnd: 4, originalDuration: 10, ...extra,
  };
}

function track(id: string, type: Track['type'], items: TimelineItem[], isLocked = false): Track {
  return {
    id, name: id, type, height: 80, isLocked, isMuted: false, isVisible: true,
    volume: 100, order: 0, items,
  };
}

function makeContext(tracks: Track[], materials: MaterialItem[] = []) {
  const updateTimeline = vi.fn();
  const context: ToolContext = {
    timelineState: {
      currentTime: 0, totalDuration: 10, zoomLevel: 1, selectedItems: [], tracks,
      playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
    },
    materials,
    apiBaseUrl: 'http://127.0.0.1:3000',
    operations: new Map(),
    updateTimeline,
    recordOperation: vi.fn(),
  };
  return { context, updateTimeline };
}

describe('editing tool guards', () => {
  it('delete_clip refuses a clip on a locked track', async () => {
    const { context, updateTimeline } = makeContext([
      track('v1', 'video', [clip('a', 'v1')], true),
    ]);

    const result = await createDeleteClipTool(context).execute('tc-1', { clipId: 'a' });

    expect(result.details).toEqual({
      success: false,
      error: expect.stringContaining('Track is locked: v1'),
    });
    expect(updateTimeline).not.toHaveBeenCalled();
  });

  it('move_clip refuses a locked source track', async () => {
    const { context, updateTimeline } = makeContext([
      track('v1', 'video', [clip('a', 'v1')], true),
      track('v2', 'video', []),
    ]);

    const result = await createMoveClipTool(context).execute('tc-1', {
      clipId: 'a', newStartTime: 0, newTrackId: 'v2',
    });

    expect(result.details).toEqual({
      success: false,
      error: expect.stringContaining('Track is locked: v1'),
    });
    expect(updateTimeline).not.toHaveBeenCalled();
  });

  it('add_to_track rejects audio material on a video track', async () => {
    const voice = {
      id: 'voice-1', name: 'voice', type: 'audio', format: 'mp3', size: 1,
      url: '/voice.mp3', duration: 3,
    } as MaterialItem;
    const { context, updateTimeline } = makeContext([track('v1', 'video', [])], [voice]);

    const result = await createAddToTrackTool(context).execute('tc-1', {
      materialId: 'voice-1', trackId: 'v1',
    });

    expect(result.details).toEqual({
      success: false,
      error: expect.stringContaining('cannot be placed on v1'),
    });
    expect(updateTimeline).not.toHaveBeenCalled();
  });

  it('resize_clip rejects a duration past the source end', async () => {
    const { context, updateTimeline } = makeContext([
      track('v1', 'video', [clip('a', 'v1', { clipStart: 2, clipEnd: 6 })]),
    ]);

    const result = await createResizeClipTool(context).execute('tc-1', {
      clipId: 'a', newDuration: 9,
    });

    expect(result.details).toEqual({
      success: false,
      error: expect.stringContaining('at most 8.00s'),
    });
    expect(updateTimeline).not.toHaveBeenCalled();
  });

  it('resize_clip allows any length for images', async () => {
    const { context, updateTimeline } = makeContext([
      track('v1', 'video', [
        clip('photo', 'v1', { originalMaterialType: 'image', duration: 5, clipEnd: 5, originalDuration: 5 }),
      ]),
    ]);

    const result = await createResizeClipTool(context).execute('tc-1', {
      clipId: 'photo', newDuration: 60,
    });

    expect(result.details).toMatchObject({ success: true });
    expect(updateTimeline).toHaveBeenCalledWith('tc-1', {
      type: 'resize_clip', clipId: 'photo', newDuration: 60, clipEnd: undefined,
    });
  });
});
