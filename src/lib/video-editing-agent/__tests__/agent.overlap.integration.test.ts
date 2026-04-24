/**
 * Deterministic integration test (no LLM mock) — exercises the full
 * agent-side tool call flow:
 *   1. Three sequential add_to_track calls all targeting startTime=0 on the
 *      same video track.
 *   2. check_timeline_overlaps observes the layout produced by the
 *      reconcile pipeline (`agent.ts::applyOperationLocally` + `reconcile.ts`).
 *   3. auto_fix_overlaps is invoked as a self-test; it must report noop
 *      because the reconcile layer has already packed everything.
 *
 * This locks in the end-to-end contract that the reflect-fix loop the
 * system prompt describes will succeed deterministically.
 */

import { describe, it, expect } from 'vitest';
import { createVideoEditingAgent } from '../agent';
import { createCheckOverlapsTool } from '../tools/checkOverlaps';
import { createAutoFixOverlapsTool } from '../tools/autoFixOverlaps';
import { createAddToTrackTool } from '../tools/addToTrack';
import type { TimelineState, MaterialItem } from '@/types';

function makeMaterial(id: string, duration = 4): MaterialItem {
  return {
    id,
    name: id,
    type: 'video',
    url: `https://example.com/${id}.mp4`,
    duration,
    width: 1920,
    height: 1080,
    size: 0,
    format: 'mp4',
    createdAt: new Date(),
  } as MaterialItem;
}

function initialState(): TimelineState {
  return {
    currentTime: 0,
    totalDuration: 0,
    zoomLevel: 1,
    selectedItems: [],
    tracks: [
      { id: 'video-track-1', name: 'video', type: 'video', height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0, items: [] },
    ],
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: false,
    gridSize: 1,
    scrollLeft: 0,
  };
}

function makeAgent() {
  return createVideoEditingAgent({
    llmApiUrl: 'http://localhost:9999',
    llmApiKey: 'sk-test',
    llmModel: 'gpt-4o-mini',
    timelineState: initialState(),
    materials: [makeMaterial('m-1', 4), makeMaterial('m-2', 3), makeMaterial('m-3', 2)],
    conversationHistory: [{ id: 'u1', role: 'user', content: 'hi', timestamp: new Date() }],
    apiBaseUrl: 'http://localhost:3088',
  });
}

describe('agent overlap integration (T7)', () => {
  it('three add_to_track(startTime=0) calls produce a packed, overlap-free track', async () => {
    const { toolContext } = makeAgent();
    const addTool = createAddToTrackTool(toolContext);

    // Three calls all asking for startTime=0. Without reconcile they would
    // stack at 0; with reconcile they are pack-flushed in startTime order.
    await addTool.execute('add-1', { materialId: 'm-1', trackId: 'video-track-1', startTime: 0 });
    await addTool.execute('add-2', { materialId: 'm-2', trackId: 'video-track-1', startTime: 0 });
    await addTool.execute('add-3', { materialId: 'm-3', trackId: 'video-track-1', startTime: 0 });

    const v = toolContext.timelineState.tracks[0];
    expect(v.items).toHaveLength(3);
    const sorted = [...v.items].sort((a, b) => a.startTime - b.startTime);
    // Each item should follow the previous one with no gap.
    let cursor = 0;
    for (const it of sorted) {
      expect(it.startTime).toBeCloseTo(cursor, 6);
      cursor += it.duration;
    }
  });

  it('check_timeline_overlaps reports valid=true after the sequence', async () => {
    const { toolContext } = makeAgent();
    const addTool = createAddToTrackTool(toolContext);
    const check = createCheckOverlapsTool(toolContext);

    await addTool.execute('add-1', { materialId: 'm-1', trackId: 'video-track-1', startTime: 0 });
    await addTool.execute('add-2', { materialId: 'm-2', trackId: 'video-track-1', startTime: 0 });
    await addTool.execute('add-3', { materialId: 'm-3', trackId: 'video-track-1', startTime: 0 });

    const out = await check.execute('chk-1', {});
    expect((out.details as { valid: boolean }).valid).toBe(true);
  });

  it('auto_fix_overlaps is a noop after reconcile already packed the timeline', async () => {
    const { toolContext } = makeAgent();
    const addTool = createAddToTrackTool(toolContext);
    const autoFix = createAutoFixOverlapsTool(toolContext);

    await addTool.execute('add-1', { materialId: 'm-1', trackId: 'video-track-1', startTime: 0 });
    await addTool.execute('add-2', { materialId: 'm-2', trackId: 'video-track-1', startTime: 0 });

    const out = await autoFix.execute('fix-1', {});
    const d = out.details as { noop: boolean; fixedCount: number };
    expect(d.noop).toBe(true);
    expect(d.fixedCount).toBe(0);
  });

  it('overlapWarning is NOT emitted on the add_to_track result when reconcile cleared it', async () => {
    const { toolContext } = makeAgent();
    const addTool = createAddToTrackTool(toolContext);

    const r1 = await addTool.execute('add-1', { materialId: 'm-1', trackId: 'video-track-1', startTime: 0 });
    const r2 = await addTool.execute('add-2', { materialId: 'm-2', trackId: 'video-track-1', startTime: 0 });
    expect((r1.details as Record<string, unknown>).overlapWarning).toBeUndefined();
    expect((r2.details as Record<string, unknown>).overlapWarning).toBeUndefined();
  });
});
