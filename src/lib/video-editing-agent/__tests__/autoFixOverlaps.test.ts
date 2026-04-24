import { describe, it, expect } from 'vitest';
import { createAutoFixOverlapsTool } from '../tools/autoFixOverlaps';
import type { ToolContext, AgentOperation, TimelineOperation } from '../types';
import type { TimelineState, TimelineItem } from '@/types';

function item(id: string, startTime: number, duration: number, trackId: string, type: TimelineItem['type'] = 'video'): TimelineItem {
  return { id, name: id, type, startTime, duration, trackId, color: '#000', volume: 1 };
}

function makeContext(tracks: TimelineState['tracks']): ToolContext {
  const timelineState: TimelineState = {
    currentTime: 0,
    totalDuration: 0,
    zoomLevel: 1,
    selectedItems: [],
    tracks,
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: false,
    gridSize: 1,
    scrollLeft: 0,
  };
  return {
    timelineState,
    materials: [],
    apiBaseUrl: 'http://localhost',
    operations: new Map<string, AgentOperation>(),
    updateTimeline: () => undefined,
    recordOperation: () => undefined,
  };
}

async function run(ctx: ToolContext, params: Parameters<ReturnType<typeof createAutoFixOverlapsTool>['execute']>[1] = {}) {
  const tool = createAutoFixOverlapsTool(ctx);
  const out = await tool.execute('tc-1', params);
  return out.details as {
    success: boolean;
    noop: boolean;
    fixedCount: number;
    changedTrackIds: string[];
    overlapsBefore: number;
    overlapsAfter: number;
    operations: TimelineOperation[];
    message: string;
    warning?: string;
  };
}

describe('auto_fix_overlaps tool', () => {
  it('packs overlapping items and reports operations', async () => {
    const ctx = makeContext([
      { id: 'v1', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [item('a', 0, 5, 'v1'), item('b', 3, 4, 'v1')] },
    ]);
    const d = await run(ctx);
    expect(d.success).toBe(true);
    expect(d.noop).toBe(false);
    expect(d.fixedCount).toBeGreaterThan(0);
    expect(d.overlapsBefore).toBe(1);
    expect(d.overlapsAfter).toBe(0);
    expect(d.operations.every(op => op.type === 'move_clip')).toBe(true);
    expect(ctx.timelineState.tracks[0].items.map(i => i.startTime)).toEqual([0, 5]);
  });

  it('returns noop=true when timeline is already packed', async () => {
    const ctx = makeContext([
      { id: 'v1', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [item('a', 0, 5, 'v1'), item('b', 5, 4, 'v1')] },
    ]);
    const d = await run(ctx);
    expect(d.noop).toBe(true);
    expect(d.fixedCount).toBe(0);
    expect(d.operations).toEqual([]);
  });

  it('skips locked tracks', async () => {
    const ctx = makeContext([
      { id: 'v1', name: 'v', type: 'video', height: 80, isLocked: true, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [item('a', 0, 5, 'v1'), item('b', 3, 4, 'v1')] },
    ]);
    const d = await run(ctx);
    expect(d.noop).toBe(true);
    expect(d.fixedCount).toBe(0);
    // Locked track preserved
    expect(ctx.timelineState.tracks[0].items.map(i => i.startTime)).toEqual([0, 3]);
    // The unresolved overlap shows up in warning
    expect(d.warning).toMatch(/仍有/);
  });

  it('skips subtitle tracks', async () => {
    const ctx = makeContext([
      { id: 's1', name: 's', type: 'subtitle', height: 50, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [item('a', 0, 3, 's1', 'subtitle'), item('b', 2, 2, 's1', 'subtitle')] },
    ]);
    const d = await run(ctx);
    expect(d.noop).toBe(true);
    expect(d.fixedCount).toBe(0);
    expect(ctx.timelineState.tracks[0].items.map(i => i.startTime)).toEqual([0, 2]);
  });

  it('honours trackIds filter', async () => {
    const ctx = makeContext([
      { id: 'v1', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [item('a', 0, 5, 'v1'), item('b', 3, 4, 'v1')] },
      { id: 'v2', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1,
        items: [item('c', 10, 2, 'v2'), item('d', 11, 3, 'v2')] },
    ]);
    const d = await run(ctx, { trackIds: ['v1'] });
    expect(d.changedTrackIds).toEqual(['v1']);
    // v2 untouched
    expect(ctx.timelineState.tracks[1].items.map(i => i.startTime)).toEqual([10, 11]);
  });

  it('emits one move_clip per repositioned clip (batch operations contract)', async () => {
    const ctx = makeContext([
      { id: 'v1', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [
          item('a', 5, 3, 'v1'),
          item('b', 1, 2, 'v1'),
          item('c', 8, 2, 'v1'),
        ] },
    ]);
    const d = await run(ctx);
    // After packing in startTime order: b->0, a->2, c->5
    const moves = d.operations.filter((o): o is Extract<TimelineOperation, { type: 'move_clip' }> => o.type === 'move_clip');
    const ids = moves.map(m => m.clipId).sort();
    // 'a' moved 5->2, 'b' moved 1->0, 'c' moved 8->5
    expect(ids).toEqual(['a', 'b', 'c']);
  });
});
