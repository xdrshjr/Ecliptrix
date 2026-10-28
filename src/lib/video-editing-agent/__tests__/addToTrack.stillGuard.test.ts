/**
 * add_to_track refuses scene images (docs/plans/agent-still-to-clip, AC-3/AC-4):
 * a still clip renders as a draggable 80 % overlay, so a picture used as a shot
 * must be converted with image_to_video first. `as_still:true` keeps the old
 * overlay behaviour byte for byte.
 */
import { describe, it, expect, vi } from 'vitest';
import type { MaterialItem, Track } from '@/types';
import type { ToolContext } from '../types';
import { createAddToTrackTool } from '../tools/addToTrack';

function material(id: string, type: MaterialItem['type'], duration?: number): MaterialItem {
  return {
    id, name: `${id}.name`, type, format: type === 'image' ? 'jpg' : 'mp4', size: 1,
    url: `/api/storage/files/${id}`, ...(duration ? { duration } : {}),
  } as MaterialItem;
}

function videoTrack(): Track {
  return {
    id: 'v1', name: 'Video', type: 'video', height: 80, isLocked: false,
    isMuted: false, isVisible: true, volume: 100, order: 0, items: [],
  };
}

function makeContext(tracks: Track[], materials: MaterialItem[]) {
  const updateTimeline = vi.fn();
  const recordOperation = vi.fn();
  const context: ToolContext = {
    timelineState: {
      currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [], tracks,
      playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
    },
    materials,
    apiBaseUrl: 'http://127.0.0.1:3000',
    operations: new Map(),
    updateTimeline,
    recordOperation,
    turnState: {},
    callBudget: { used: 0 },
  };
  return { context, updateTimeline, recordOperation };
}

describe('add_to_track still-image guard', () => {
  it('refuses an image with a stable code and a complete next step', async () => {
    const { context, updateTimeline } = makeContext([videoTrack()], [material('photo', 'image')]);

    const result = await createAddToTrackTool(context).execute('tc-1', { materialId: 'photo' });

    expect(result.details).toMatchObject({
      success: false,
      error_code: 'still_needs_conversion',
      next_step: {
        tool: 'image_to_video',
        category: 'still_tools',
        call: expect.stringContaining('image_to_video({material_id:"photo"})'),
        overlay_exception: expect.stringContaining('as_still:true'),
      },
    });
    expect(updateTimeline).not.toHaveBeenCalled();
  });

  it('keeps the model-visible text identical to the details', async () => {
    const { context } = makeContext([videoTrack()], [material('photo', 'image')]);
    const result = await createAddToTrackTool(context).execute('tc-1', { materialId: 'photo' });
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(result.details);
  });

  it('creates no track and records nothing when it refuses', async () => {
    const { context, updateTimeline, recordOperation } = makeContext([], [material('photo', 'image')]);

    await createAddToTrackTool(context).execute('tc-1', { materialId: 'photo' });

    expect(context.timelineState.tracks).toEqual([]);
    expect(updateTimeline).not.toHaveBeenCalled();
    expect(recordOperation).not.toHaveBeenCalled();
  });

  it('lets an image through as an overlay with as_still:true, unchanged from before', async () => {
    const { context, updateTimeline } = makeContext([videoTrack()], [material('logo', 'image')]);

    const result = await createAddToTrackTool(context).execute('tc-1', {
      materialId: 'logo', as_still: true,
    });

    expect(result.details).toMatchObject({ success: true });
    expect(updateTimeline).toHaveBeenCalledTimes(1);
    const operation = updateTimeline.mock.calls[0][1];
    expect(operation.clip).toMatchObject({
      materialId: 'logo', duration: 5, clipStart: 0, clipEnd: 5, originalDuration: 0, volume: 1,
    });
  });

  it('does not touch video materials', async () => {
    const { context, updateTimeline } = makeContext([videoTrack()], [material('clip', 'video', 4)]);

    const result = await createAddToTrackTool(context).execute('tc-1', { materialId: 'clip' });

    expect(result.details).toMatchObject({ success: true });
    expect(updateTimeline.mock.calls[0][1].clip).toMatchObject({ originalDuration: 4 });
  });

  it('accepts the converted video returned by image_to_video', async () => {
    const converted = { ...material('i2v-0123456789abcdef', 'video', 5) };
    const { context, updateTimeline } = makeContext([videoTrack()], [converted]);

    const result = await createAddToTrackTool(context).execute('tc-1', {
      materialId: 'i2v-0123456789abcdef',
    });

    expect(result.details).toMatchObject({ success: true });
    expect(updateTimeline).toHaveBeenCalledTimes(1);
  });

  it('escalates the hint on the third refusal of the same image', async () => {
    const { context } = makeContext([videoTrack()], [material('photo', 'image')]);
    const tool = createAddToTrackTool(context);
    const details: Array<{ next_step: { call: string } }> = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      details.push((await tool.execute(`tc-${attempt}`, { materialId: 'photo' }))
        .details as (typeof details)[number]);
    }

    expect(details[1].next_step.call).not.toContain('refused');
    expect(details[2].next_step.call).toContain('refused 3 times');
    expect(context.turnState.stillRejections).toEqual({ photo: 3 });
  });

  it('counts refusals per image', async () => {
    const { context } = makeContext([videoTrack()], [
      material('a', 'image'), material('b', 'image'),
    ]);
    const tool = createAddToTrackTool(context);
    await tool.execute('1', { materialId: 'a' });
    await tool.execute('2', { materialId: 'b' });
    await tool.execute('3', { materialId: 'a' });
    expect(context.turnState.stillRejections).toEqual({ a: 2, b: 1 });
  });
});
