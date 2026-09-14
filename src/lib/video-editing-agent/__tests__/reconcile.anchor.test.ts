/**
 * AG2-01: a moved / added clip wins start-time ties, tool results report
 * the position reconcile actually produced, and agent writes are fixed
 * points of the UI's organize pass (S8).
 */
import { describe, it, expect } from 'vitest';
import type { AgentTimelineOperation, MaterialItem, TimelineItem, TimelineState } from '@/types';
import type { TimelineData } from '@/components/video/timeline/domain/types';
import { findOrganizeDrift } from '@/test/organizeFixedPoint';
import { createVideoEditingAgent } from '../agent';
import { OperationApplier } from '../OperationApplier';
import { createAddToTrackTool } from '../tools/addToTrack';
import { createMoveClipTool } from '../tools/moveClip';

function item(id: string, startTime: number, duration: number): TimelineItem {
  return {
    id, name: id, type: 'video', startTime, duration, trackId: 'v1', color: '#000',
    materialId: `m-${id}`, clipStart: 0, clipEnd: duration, originalDuration: 20, volume: 1,
  };
}

function timeline(items: TimelineItem[]): TimelineState {
  return {
    currentTime: 0, totalDuration: 15, zoomLevel: 1, selectedItems: [],
    tracks: [{
      id: 'v1', name: 'Video', type: 'video', height: 80, isLocked: false, isMuted: false,
      isVisible: true, volume: 100, order: 0, items,
    }],
    playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
  };
}

function abc(): TimelineState {
  return timeline([item('a', 0, 5), item('b', 5, 5), item('c', 10, 5)]);
}

const MATERIALS: MaterialItem[] = [
  { id: 'm-d', name: 'd', type: 'video', format: 'mp4', size: 1, url: '/d.mp4', duration: 4 } as MaterialItem,
];

function makeAgent(state: TimelineState) {
  return createVideoEditingAgent({
    llmApiUrl: 'http://localhost:9999',
    llmApiKey: 'sk-test',
    llmModel: 'gpt-4o-mini',
    timelineState: state,
    materials: MATERIALS.map(m => ({ ...m })),
    conversationHistory: [{ id: 'u1', role: 'user', content: 'hi', timestamp: new Date() }],
    apiBaseUrl: 'http://localhost:3088',
  });
}

function starts(state: TimelineState): Array<[string, number]> {
  return [...state.tracks[0].items]
    .sort((x, y) => x.startTime - y.startTime)
    .map(i => [i.id, i.startTime]);
}

describe('reconcile anchor and reported positions', () => {
  it('move_clip to 0 places the clip first on its track', async () => {
    const state = { value: abc() };
    const applier = new OperationApplier({
      getTimelineState: () => state.value,
      setTimelineState: next => { state.value = next; },
    });

    await applier.apply({ type: 'move_clip', clipId: 'c', fromTrackId: 'v1', toTrackId: 'v1', newStartTime: 0 }, 'tc-1');

    expect(starts(state.value)).toEqual([['c', 0], ['a', 5], ['b', 10]]);
  });

  it('move_clip reports the post-reconcile start time and shifted clips', async () => {
    const { toolContext } = makeAgent(abc());

    const out = await createMoveClipTool(toolContext).execute('tc-1', { clipId: 'c', newStartTime: 3 });

    expect(out.details).toMatchObject({
      success: true,
      clip: { id: 'c', startTime: 5, requestedStartTime: 3, repositioned: true, duration: 5 },
      shiftedClips: [{ clipId: 'b', from: 5, to: 10 }],
    });
  });

  it('add_to_track reports where the clip landed after the track was re-packed', async () => {
    const { toolContext } = makeAgent(timeline([item('a', 0, 5), item('b', 20, 5)]));

    const out = await createAddToTrackTool(toolContext).execute('tc-1', {
      materialId: 'm-d', trackId: 'v1', startTime: 22,
    });

    expect(out.details).toMatchObject({
      clip: { startTime: 10, requestedStartTime: 22, repositioned: true },
      shiftedClips: [{ clipId: 'b', from: 20, to: 5 }],
    });
  });

  it('client and server layouts match after the same operations', async () => {
    const operations: AgentTimelineOperation[] = [
      { type: 'move_clip', clipId: 'c', fromTrackId: 'v1', toTrackId: 'v1', newStartTime: 0 },
      { type: 'move_clip', clipId: 'a', fromTrackId: 'v1', toTrackId: 'v1', newStartTime: 30 },
      { type: 'delete_clip', clipId: 'b', trackId: 'v1' },
    ];
    const client = { value: abc() };
    const applier = new OperationApplier({
      getTimelineState: () => client.value,
      setTimelineState: next => { client.value = next; },
    });
    const { toolContext } = makeAgent(abc());

    for (let index = 0; index < operations.length; index++) {
      await applier.apply(operations[index], `tc-${index}`);
      toolContext.updateTimeline(`tc-${index}`, operations[index] as never);
    }

    expect(starts(client.value)).toEqual(starts(toolContext.timelineState));
  });

  it('agent add and move results are organize fixed points', async () => {
    const { toolContext } = makeAgent(abc());

    await createMoveClipTool(toolContext).execute('tc-1', { clipId: 'a', newStartTime: 40 });
    await createAddToTrackTool(toolContext).execute('tc-2', { materialId: 'm-d', trackId: 'v1', startTime: 2 });

    expect(findOrganizeDrift(toolContext.timelineState as unknown as TimelineData)).toEqual([]);
  });
});
