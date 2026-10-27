import { describe, it, expect } from 'vitest';
import { createCheckOverlapsTool } from '../tools/checkOverlaps';
import type { ToolContext, AgentOperation } from '../types';
import type { TimelineState, TimelineItem } from '@/types';

function item(id: string, startTime: number, duration: number, trackId: string, type: TimelineItem['type'] = 'video'): TimelineItem {
  return { id, name: id, type, startTime, duration, trackId, color: '#000', volume: 1 };
}

function makeContext(overrides?: Partial<TimelineState>): ToolContext {
  const timelineState: TimelineState = {
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
    ...overrides,
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

async function runTool(ctx: ToolContext) {
  const tool = createCheckOverlapsTool(ctx);
  const out = await tool.execute('tc-1', {});
  return out.details as {
    success: boolean;
    valid: boolean;
    overlapCount: number;
    overlaps: Array<{ trackId: string; clipAId: string; clipBId: string; overlapStart: number; overlapEnd: number }>;
    summary: string;
  };
}

describe('check_timeline_overlaps tool', () => {
  it('returns valid=true on a clean timeline', async () => {
    const ctx = makeContext({
      tracks: [
        { id: 'v1', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
          items: [item('a', 0, 5, 'v1'), item('b', 5, 2, 'v1')] },
      ],
    });
    const details = await runTool(ctx);
    expect(details.success).toBe(true);
    expect(details.valid).toBe(true);
    expect(details.overlapCount).toBe(0);
    expect(details.overlaps).toEqual([]);
    expect(details.summary).toMatch(/没有同轨重叠/);
  });

  it('returns overlaps list when tracks overlap', async () => {
    const ctx = makeContext({
      tracks: [
        { id: 'v1', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
          items: [item('a', 0, 5, 'v1'), item('b', 3, 4, 'v1')] },
      ],
    });
    const details = await runTool(ctx);
    expect(details.valid).toBe(false);
    expect(details.overlapCount).toBe(1);
    expect(details.overlaps[0]).toMatchObject({ trackId: 'v1', clipAId: 'a', clipBId: 'b' });
    expect(details.summary).toMatch(/auto_fix_overlaps/);
  });
});
