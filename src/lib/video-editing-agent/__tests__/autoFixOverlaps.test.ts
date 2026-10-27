import { describe, it, expect } from 'vitest';
import { AgentEventRouter } from '../AgentEventRouter';
import { AgentStateManager } from '../AgentStateManager';
import { OperationApplier } from '../OperationApplier';
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
    turnState: {}, callBudget: { used: 0 },
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
          item('b', 1, 6, 'v1'), // 1–7 overlaps a
          item('c', 8, 2, 'v1'),
        ] },
    ]);
    const d = await run(ctx);
    // After packing in startTime order: b->0, a->6, c->9
    const moves = d.operations.filter((o): o is Extract<TimelineOperation, { type: 'move_clip' }> => o.type === 'move_clip');
    const ids = moves.map(m => m.clipId).sort();
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('auto_fix_overlaps leaves tracks without overlaps untouched', async () => {
    const ctx = makeContext([
      { id: 'v1', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
        items: [item('a', 0, 5, 'v1'), item('b', 3, 4, 'v1')] },
      // Narration that starts at 3 s (aligned to subtitles) has no overlap.
      { id: 'a1', name: 'a', type: 'audio', height: 60, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1,
        items: [item('voice', 3, 2, 'a1', 'audio')] },
    ]);
    const d = await run(ctx) as Awaited<ReturnType<typeof run>> & {
      fixedTrackIds: string[];
      shiftedClips?: Array<{ clipId: string; from: number; to: number }>;
    };
    expect({
      fixedTrackIds: d.fixedTrackIds,
      shiftedClips: d.shiftedClips,
      voiceStart: ctx.timelineState.tracks[1].items[0].startTime,
    }).toEqual({
      fixedTrackIds: ['v1'],
      shiftedClips: [{ clipId: 'b', from: 3, to: 5 }],
      voiceStart: 3,
    });
  });

  describe('client replay', () => {
    function overlappingTrack(): TimelineState['tracks'] {
      return [
        { id: 'v1', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
          items: [item('a', 0, 5, 'v1'), item('b', 2, 2, 'v1'), item('c', 3, 3, 'v1'), item('d', 4, 5, 'v1')] },
      ];
    }

    function startsById(state: TimelineState): Record<string, number> {
      return Object.fromEntries(state.tracks[0].items.map(i => [i.id, i.startTime]));
    }

    /** Runs the tool on one copy and routes its result to a client applier holding another. */
    async function fixOnToolAndClient() {
      const tool = makeContext(overlappingTrack());
      const result = await run(tool);
      const client = { value: makeContext(overlappingTrack()).timelineState };
      const applier = new OperationApplier({
        getTimelineState: () => client.value,
        setTimelineState: next => { client.value = next; },
      });
      const router = new AgentEventRouter({
        stateManager: new AgentStateManager('msg-1'),
        operationApplier: applier,
      });
      await router.handleEvent({
        type: 'tool_result', toolCallId: 'tc-1', toolName: 'auto_fix_overlaps', result, operation: null,
      });
      return { tool, client, applier };
    }

    it('the client lands on the layout auto_fix_overlaps reported', async () => {
      const { tool, client } = await fixOnToolAndClient();

      expect({ tool: startsById(tool.timelineState), client: startsById(client.value) })
        .toEqual({ tool: { a: 0, b: 5, c: 7, d: 10 }, client: { a: 0, b: 5, c: 7, d: 10 } });
    });

    it('undoing auto_fix_overlaps restores the overlapping layout in one step', async () => {
      const { client, applier } = await fixOnToolAndClient();

      const undo = applier.undoOperation('tc-1');

      expect({ undo, client: startsById(client.value) })
        .toEqual({ undo: { ok: true }, client: { a: 0, b: 2, c: 3, d: 4 } });
    });
  });
});
