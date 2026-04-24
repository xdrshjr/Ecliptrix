/**
 * Verifies that agent.ts::applyOperationLocally invokes the same
 * reconcile helper as OperationApplier so the server-side `context.timelineState`
 * mirrors what the frontend will end up with. We exercise this by routing
 * operations through the live ToolContext that `createVideoEditingAgent`
 * builds, then asserting the local timeline copy is overlap-free.
 *
 * Note: we don't boot a real Agent loop (no LLM mock infra in this repo);
 * instead we use the toolContext returned by createVideoEditingAgent directly
 * to invoke updateTimeline — which is exactly the path real tools take.
 */

import { describe, it, expect } from 'vitest';
import { createVideoEditingAgent } from '../agent';
import type { TimelineState, TimelineItem, MaterialItem } from '@/types';

function item(id: string, startTime: number, duration: number, trackId: string, type: TimelineItem['type'] = 'video'): TimelineItem {
  return { id, name: id, type, startTime, duration, trackId, color: '#000', volume: 1 };
}

function makeInitialState(): TimelineState {
  return {
    currentTime: 0,
    totalDuration: 5,
    zoomLevel: 1,
    selectedItems: [],
    tracks: [
      { id: 'v1', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [item('a', 0, 5, 'v1')] },
    ],
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: false,
    gridSize: 1,
    scrollLeft: 0,
  };
}

function newAgent() {
  const materials: MaterialItem[] = [{
    id: 'm-1',
    name: 'b',
    type: 'video',
    url: 'https://example.com/b.mp4',
    duration: 4,
    width: 1920,
    height: 1080,
    size: 0,
    format: 'mp4',
    createdAt: new Date(),
  } as MaterialItem];

  return createVideoEditingAgent({
    llmApiUrl: 'http://localhost:9999',
    llmApiKey: 'sk-test',
    llmModel: 'gpt-4o-mini',
    timelineState: makeInitialState(),
    materials,
    conversationHistory: [{ id: 'u1', role: 'user', content: 'hi', timestamp: new Date() }],
    apiBaseUrl: 'http://localhost:3088',
  });
}

describe('agent.ts reconcile mirror (T6b)', () => {
  it('add_clip overlap on server-side state is auto-packed', () => {
    const { toolContext } = newAgent();

    toolContext.updateTimeline('tc-1', {
      type: 'add_clip',
      clip: { id: 'b', materialId: 'm-1', trackId: 'v1', startTime: 2, duration: 4, clipStart: 0, clipEnd: 4, originalDuration: 4, volume: 1 },
      material: { id: 'm-1', name: 'b', type: 'video', url: '' },
    });

    const v1 = toolContext.timelineState.tracks.find(t => t.id === 'v1')!;
    const sorted = [...v1.items].sort((a, b) => a.startTime - b.startTime);
    expect(sorted.map(i => i.id)).toEqual(['a', 'b']);
    // After reconcile: a at 0, b at 5 (no overlap)
    expect(sorted.map(i => i.startTime)).toEqual([0, 5]);
  });

  it('move_clip into overlap is auto-resolved on server-side state', () => {
    const { toolContext } = newAgent();
    // Pre-populate a second clip past the first
    toolContext.timelineState.tracks[0].items.push(item('b', 5, 3, 'v1'));

    toolContext.updateTimeline('tc-2', {
      type: 'move_clip',
      clipId: 'b',
      fromTrackId: 'v1',
      toTrackId: 'v1',
      newStartTime: 1,
    });

    const sorted = [...toolContext.timelineState.tracks[0].items].sort((a, b) => a.startTime - b.startTime);
    // Pack-flush by startTime: b@1 then a@0 → sort by startTime puts a before b
    // Actually: after move b is at 1, a still at 0. Sorted: a(0,5), b(1,3).
    // Pack-flush: a@0, b@5
    expect(sorted.map(i => i.id)).toEqual(['a', 'b']);
    expect(sorted.map(i => i.startTime)).toEqual([0, 5]);
  });
});
