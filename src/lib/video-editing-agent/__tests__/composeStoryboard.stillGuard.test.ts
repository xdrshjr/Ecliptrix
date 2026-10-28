/**
 * compose_storyboard is the second route that emits add_clip, so it must share
 * the still-image guard (spec RV-01 / AC-19).
 */
import { describe, it, expect, vi } from 'vitest';
import type { MaterialItem, Track } from '@/types';
import type { ToolContext } from '../types';
import { createComposeStoryboardTool } from '../tools/composeStoryboard';

function material(id: string, type: MaterialItem['type']): MaterialItem {
  return {
    id, name: id, type, format: 'x', size: 1, url: `/${id}`, duration: 3,
  } as MaterialItem;
}

function videoTrack(): Track {
  return {
    id: 'video-track-1', name: 'Video', type: 'video', height: 80, isLocked: false,
    isMuted: false, isVisible: true, volume: 100, order: 0, items: [],
  };
}

function makeContext(tracks: Track[], materials: MaterialItem[]) {
  const updateTimeline = vi.fn();
  const context: ToolContext = {
    timelineState: {
      currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [], tracks,
      playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
    },
    materials,
    apiBaseUrl: 'http://127.0.0.1:3000',
    operations: new Map(),
    updateTimeline,
    recordOperation: vi.fn(),
    turnState: {},
    callBudget: { used: 0 },
  };
  return { context, updateTimeline };
}

const compose = (context: ToolContext, ...ids: string[]) =>
  createComposeStoryboardTool(context).execute('tc-1', {
    storyboard_id: 'pack-1',
    video_materials: ids.map((id, index) => ({ scene_id: `s${index}`, material_id: id })),
  });

describe('compose_storyboard still-image guard', () => {
  it('skips an image scene with the code and places the video scenes', async () => {
    const { context, updateTimeline } = makeContext(
      [videoTrack()], [material('still', 'image'), material('shot', 'video')]);

    const result = await compose(context, 'still', 'shot');

    expect(result.details).toMatchObject({
      success: true,
      clips_added: 1,
      skipped: [{
        scene_id: 's0',
        material_id: 'still',
        error_code: 'still_needs_conversion',
        next_step: { tool: 'image_to_video' },
      }],
    });
    expect(updateTimeline).toHaveBeenCalledTimes(1);
  });

  it('fails as a whole with the code when every scene is a still', async () => {
    const { context, updateTimeline } = makeContext(
      [videoTrack()], [material('a', 'image'), material('b', 'image')]);

    const result = await compose(context, 'a', 'b');

    expect(result.details).toMatchObject({
      success: false,
      error_code: 'still_needs_conversion',
      skipped: [{ material_id: 'a' }, { material_id: 'b' }],
    });
    expect(updateTimeline).not.toHaveBeenCalled();
  });

  it('creates no track when every scene is a still', async () => {
    const { context } = makeContext([], [material('a', 'image')]);

    await compose(context, 'a');

    expect(context.timelineState.tracks).toEqual([]);
  });

  it('does not borrow the guard code for a mixed failure', async () => {
    const { context } = makeContext([videoTrack()], [material('a', 'image')]);

    const result = await compose(context, 'a', 'ghost');

    expect(result.details).toMatchObject({ success: false });
    expect(result.details).not.toHaveProperty('error_code');
  });

  it('leaves video-only storyboards untouched', async () => {
    const { context, updateTimeline } = makeContext(
      [videoTrack()], [material('a', 'video'), material('b', 'video')]);

    const result = await compose(context, 'a', 'b');

    expect(result.details).toMatchObject({ success: true, clips_added: 2 });
    expect(result.details).not.toHaveProperty('skipped');
    expect(updateTimeline).toHaveBeenCalledTimes(2);
  });
});
