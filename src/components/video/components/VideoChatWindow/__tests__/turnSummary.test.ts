import { describe, expect, it } from 'vitest';
import type { AgentToolCallRecord, ChatMessage, TimelineItem, Track } from '@/types';
import { hasSummaryContent, summarizeTurn } from '../turnSummary';

function item(id: string, patch: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id, name: id, type: 'video', startTime: 0, duration: 5, trackId: 'v1',
    color: '#000', clipStart: 0, clipEnd: 5, ...patch,
  };
}

function track(items: TimelineItem[]): Track {
  return {
    id: 'v1', name: 'v1', type: 'video', height: 80, isLocked: false, isMuted: false,
    isVisible: true, volume: 100, order: 0, items,
  };
}

function call(name: string, patch: Partial<AgentToolCallRecord> = {}): AgentToolCallRecord {
  return { id: `${name}-1`, name, params: {}, status: 'completed', result: { success: true }, ...patch };
}

function message(patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'a1', role: 'assistant', content: 'done', timestamp: new Date(0),
    isAgentMessage: true, agentToolCalls: [call('add_to_track')], ...patch,
  };
}

describe('summarizeTurn', () => {
  it('returns null while streaming, for non-agent messages and for turns with no finished tool', () => {
    expect(summarizeTurn(message({ isStreaming: true }))).toBeNull();
    expect(summarizeTurn({ ...message(), isAgentMessage: false })).toBeNull();
    expect(summarizeTurn(message({ agentToolCalls: [] }))).toBeNull();
    expect(summarizeTurn(message({ agentToolCalls: [call('x', { status: 'executing' })] }))).toBeNull();
  });

  it('counts added, removed, moved, trimmed and resized clips from the track patches', () => {
    const before = track([
      item('keep'), item('gone'), item('moved'), item('trimmed'), item('resized'),
    ]);
    const after = track([
      item('keep'), item('moved', { startTime: 9 }),
      item('trimmed', { clipStart: 1 }), item('resized', { duration: 3 }), item('fresh'),
    ]);
    const summary = summarizeTurn(message({
      timelineTrackPatches: [{ trackId: 'v1', before, after }],
    }))!;
    expect(summary.clips).toEqual({ added: 1, removed: 1, moved: 1, trimmed: 1, resized: 1 });
    expect(summary.hasUndoable).toBe(true);
  });

  it('counts a track created by the turn as all-added clips', () => {
    const summary = summarizeTurn(message({
      timelineTrackPatches: [{ trackId: 'v1', before: null, after: track([item('a'), item('b')]) }],
    }))!;
    expect(summary.clips.added).toBe(2);
  });

  it('counts imports, generation and web downloads only for successful calls', () => {
    const summary = summarizeTurn(message({
      agentToolCalls: [
        call('download_web_media', { id: 'd1' }),
        call('download_web_media', { id: 'd2', result: { success: false } }),
        call('add_material_to_library', { id: 'm1' }),
        call('batch_generate_tts', { id: 't1' }),
        call('generate_ai_image', { id: 'i1' }),
        call('generate_ai_video', { id: 'v1' }),
        call('search_video', { id: 's1' }),
      ],
    }))!;
    expect(summary.materials).toEqual({
      imported: 2, webDownloaded: 1, generated: { tts: 1, image: 1, video: 1 },
    });
  });

  it('takes the LAST check_timeline and counts unlicensed web materials from its issues', () => {
    const summary = summarizeTurn(message({
      agentToolCalls: [
        call('check_timeline', { id: 'c1', result: { success: true, blockers: 3, warnings: 0, issues: [] } }),
        call('check_timeline', {
          id: 'c2',
          result: { success: true, blockers: 0, warnings: 2,
            issues: [{ code: 'web_material_license_unknown' }, { code: 'audio_gap' }] },
        }),
      ],
    }))!;
    expect(summary.check).toEqual({ blockers: 0, warnings: 2, unlicensed: 1 });
  });

  it('reports no check when none ran, and counts failed tools', () => {
    const summary = summarizeTurn(message({
      agentToolCalls: [call('add_to_track'), call('trim_clip', { id: 'f', status: 'error' })],
    }))!;
    expect(summary.check).toBeNull();
    expect(summary.failedTools).toBe(1);
  });

  it('marks a stopped turn as partial with its finished step count', () => {
    const summary = summarizeTurn(message({
      isCancelled: true,
      agentToolCalls: [call('add_to_track'), call('trim_clip', { id: 'x', status: 'cancelled' })],
    }))!;
    expect(summary.partial).toBe(true);
    expect(summary.completedSteps).toBe(1);
  });

  it('is not undoable once the turn was undone', () => {
    const summary = summarizeTurn(message({
      isUndone: true, timelineTrackPatches: [{ trackId: 'v1', before: null, after: track([item('a')]) }],
    }))!;
    expect(summary.hasUndoable).toBe(false);
  });
});

describe('hasSummaryContent', () => {
  it('is false for a turn that only read state', () => {
    const summary = summarizeTurn(message({ agentToolCalls: [call('get_timeline')] }))!;
    expect(hasSummaryContent(summary)).toBe(false);
  });
});
