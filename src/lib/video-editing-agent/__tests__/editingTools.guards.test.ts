/**
 * Editing tool guards: locked tracks (AG-04), track / material type
 * compatibility (AG-05), the resize_clip source bound (AG-07), negative
 * start times (AG2-08), storyboard type checks (AG2-14), trim out-points and
 * images (AG2-15), in-use material removal (AG2-16), overlap warnings limited
 * to fixable overlaps on the edited track (AG2-18) and gap closing after
 * delete (N-10).
 */
import { describe, it, expect, vi } from 'vitest';
import type { MaterialItem, TimelineItem, Track } from '@/types';
import type { ToolContext } from '../types';
import { createVideoEditingAgent } from '../agent';
import { createCheckOverlapsTool } from '../tools/checkOverlaps';
import { createAddToTrackTool } from '../tools/addToTrack';
import { createComposeStoryboardTool } from '../tools/composeStoryboard';
import { createDeleteClipTool } from '../tools/deleteClip';
import { createMoveClipTool } from '../tools/moveClip';
import { createRemoveMaterialTool } from '../tools/removeMaterial';
import { createResizeClipTool } from '../tools/resizeClip';
import { createTrimClipTool } from '../tools/trimClip';

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

function material(id: string, type: MaterialItem['type'], duration = 3): MaterialItem {
  return { id, name: id, type, format: 'mp4', size: 1, url: `/${id}`, duration } as MaterialItem;
}

function makeContext(tracks: Track[], materials: MaterialItem[] = []) {
  const updateTimeline = vi.fn();
  const recordOperation = vi.fn();
  const context: ToolContext = {
    timelineState: {
      currentTime: 0, totalDuration: 10, zoomLevel: 1, selectedItems: [], tracks,
      playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
    },
    materials,
    apiBaseUrl: 'http://127.0.0.1:3000',
    operations: new Map(),
    updateTimeline,
    recordOperation,
  };
  return { context, updateTimeline, recordOperation };
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

  it('add_to_track rejects a negative start time', async () => {
    const { context, updateTimeline } = makeContext(
      [track('v1', 'video', [])],
      [material('scene', 'video')],
    );

    const result = await createAddToTrackTool(context).execute('tc-1', {
      materialId: 'scene', trackId: 'v1', startTime: -3,
    });

    expect({ details: result.details, applied: updateTimeline.mock.calls.length }).toEqual({
      details: { success: false, error: expect.stringContaining('non-negative') },
      applied: 0,
    });
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

  it('resize_clip on an image keeps duration equal to clipEnd minus clipStart', async () => {
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
      type: 'resize_clip', clipId: 'photo', newDuration: 60, clipEnd: 60,
    });
  });

  it('trim_clip derives the out-point from clipStart plus duration when clipEnd is absent', async () => {
    const { context, updateTimeline } = makeContext([
      track('v1', 'video', [clip('a', 'v1', { clipStart: 2, clipEnd: undefined, duration: 4 })]),
    ]);

    await createTrimClipTool(context).execute('tc-1', { clipId: 'a', clipStart: 3 });

    expect(updateTimeline).toHaveBeenCalledWith('tc-1', {
      type: 'trim_clip', clipId: 'a', clipStart: 3, clipEnd: 6, duration: 3,
    });
  });

  it('trim_clip on an image is refused with a resize hint', async () => {
    const { context, updateTimeline } = makeContext([
      track('v1', 'video', [
        clip('photo', 'v1', { originalMaterialType: 'image', duration: 20, clipEnd: 20 }),
      ]),
    ]);

    const result = await createTrimClipTool(context).execute('tc-1', { clipId: 'photo', clipStart: 1 });

    expect({ details: result.details, applied: updateTimeline.mock.calls.length }).toEqual({
      details: { success: false, error: expect.stringContaining('use resize_clip') },
      applied: 0,
    });
  });

  it('compose_storyboard skips non-video materials and reports them', async () => {
    const { context, updateTimeline } = makeContext(
      [track('video-track-1', 'video', [])],
      [material('voice', 'audio'), material('scene', 'video')],
    );

    const result = await createComposeStoryboardTool(context).execute('tc-1', {
      storyboard_id: 'pack-1',
      video_materials: [
        { scene_id: 's1', material_id: 'voice' },
        { scene_id: 's2', material_id: 'scene' },
      ],
    });

    expect({ details: result.details, applied: updateTimeline.mock.calls.length }).toMatchObject({
      details: {
        success: true,
        clips_added: 1,
        skipped: [{ scene_id: 's1', material_id: 'voice', reason: expect.stringContaining('cannot be placed') }],
      },
      applied: 1,
    });
  });

  it('compose_storyboard leaves no auto-created track when every scene is skipped', async () => {
    const { context } = makeContext([], [material('voice', 'audio')]);

    const result = await createComposeStoryboardTool(context).execute('tc-1', {
      storyboard_id: 'pack-1',
      video_materials: [{ scene_id: 's1', material_id: 'voice' }],
    });

    expect({ success: (result.details as { success: boolean }).success, tracks: context.timelineState.tracks })
      .toEqual({ success: false, tracks: [] });
  });

  it('remove_material refuses a material still used on the timeline', async () => {
    const { context, recordOperation } = makeContext(
      [track('v1', 'video', [clip('a', 'v1', { materialId: 'scene' })])],
      [material('scene', 'video')],
    );

    const result = await createRemoveMaterialTool(context).execute('tc-1', { material_id: 'scene' });

    expect({
      details: result.details,
      recorded: recordOperation.mock.calls.length,
      library: context.materials.map(m => m.id),
    }).toEqual({
      details: { success: false, error: expect.stringContaining('delete those clips first'), usedByClipIds: ['a'] },
      recorded: 0,
      library: ['scene'],
    });
  });

  it('an edit on the video track carries no warning for subtitle overlaps', async () => {
    const { context } = makeContext(
      [
        track('v1', 'video', []),
        track('s1', 'subtitle', [
          clip('s-a', 's1', { type: 'subtitle', startTime: 0, duration: 3 }),
          clip('s-b', 's1', { type: 'subtitle', startTime: 2, duration: 3 }),
        ]),
      ],
      [material('scene', 'video')],
    );

    const result = await createAddToTrackTool(context).execute('tc-1', { materialId: 'scene', trackId: 'v1' });
    const details = result.details as Record<string, unknown>;

    expect({ success: details.success, warned: 'overlapWarning' in details }).toEqual({ success: true, warned: false });
  });

  it('check_timeline_overlaps marks subtitle overlaps as not auto-fixable', async () => {
    const { context } = makeContext([
      track('v1', 'video', [clip('a', 'v1'), clip('b', 'v1', { startTime: 2 })]),
      track('s1', 'subtitle', [
        clip('s-a', 's1', { type: 'subtitle', startTime: 0, duration: 3 }),
        clip('s-b', 's1', { type: 'subtitle', startTime: 2, duration: 3 }),
      ]),
    ]);

    const result = await createCheckOverlapsTool(context).execute('tc-1', {});
    const details = result.details as { overlaps: Array<{ trackId: string; autoFixable: boolean }>; summary: string };

    expect({
      overlaps: details.overlaps.map(overlap => [overlap.trackId, overlap.autoFixable]),
      explainsIgnoring: details.summary.includes('autoFixable=false'),
    }).toEqual({ overlaps: [['v1', true], ['s1', false]], explainsIgnoring: true });
  });

  it('delete_clip reports the clips it pulled earlier', async () => {
    const { context } = makeContext([
      track('v1', 'video', [
        clip('a', 'v1', { duration: 5, clipEnd: 5 }),
        clip('b', 'v1', { startTime: 5, duration: 5, clipEnd: 5 }),
        clip('c', 'v1', { startTime: 10, duration: 5, clipEnd: 5 }),
      ]),
    ]);
    // The agent's own context applies and reconciles the delete.
    const { toolContext } = createVideoEditingAgent({
      llmApiUrl: 'http://localhost:9999',
      llmApiKey: 'sk-test',
      llmModel: 'gpt-4o-mini',
      timelineState: context.timelineState,
      materials: [],
      conversationHistory: [{ id: 'u1', role: 'user', content: 'hi', timestamp: new Date() }],
      apiBaseUrl: 'http://localhost:3088',
    });

    const result = await createDeleteClipTool(toolContext).execute('tc-1', { clipId: 'b' });

    expect(result.details).toMatchObject({ success: true, shiftedClips: [{ clipId: 'c', from: 10, to: 5 }] });
  });
});
