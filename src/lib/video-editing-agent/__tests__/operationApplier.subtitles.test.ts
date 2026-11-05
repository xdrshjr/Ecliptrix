import { describe, expect, it } from 'vitest';
import type { AddSubtitleClipsOperation, TimelineState, Track } from '@/types';
import { OperationApplier } from '../OperationApplier';
import { DEFAULT_AGENT_SUBTITLE_STYLE } from '../subtitleClips';

/**
 * 客户端应用字幕（agent-subtitles spec §4.2 / §9.1 / AC-4）。
 *
 * 钉住四件事：一步撤销、`replace` 撤销后旧字幕逐字回来、锁轨 skipped、
 * 坏载荷 rejected 且不动时间线。
 */

function subtitleItem(id: string, text: string, start: number, duration = 1) {
  return {
    id, name: text, type: 'subtitle' as const, startTime: start, duration,
    trackId: 'subtitle-track-1', color: '#E67E22', text,
    subtitleStyle: DEFAULT_AGENT_SUBTITLE_STYLE,
  };
}

function videoTrack(): Track {
  return {
    id: 'v1', name: 'Video', type: 'video', height: 80, isLocked: false,
    isMuted: false, isVisible: true, volume: 100, order: 0,
    items: [{
      id: 'v', name: 'v', type: 'video', startTime: 0, duration: 4,
      trackId: 'v1', color: '#000',
    }],
  };
}

function stateWith(tracks: Track[] = []): { value: TimelineState } {
  return {
    value: {
      currentTime: 0, totalDuration: 4, zoomLevel: 1, selectedItems: [],
      tracks: [videoTrack(), ...tracks], playbackRate: 1, isPlaying: false,
      snapToGrid: false, gridSize: 1, scrollLeft: 0,
    },
  };
}

function makeApplier(state: { value: TimelineState }) {
  return new OperationApplier({
    getTimelineState: () => state.value,
    setTimelineState: next => { state.value = next; },
  });
}

function operation(
  clips: AddSubtitleClipsOperation['clips'],
  overrides: Partial<AddSubtitleClipsOperation> = {},
): AddSubtitleClipsOperation {
  return {
    type: 'add_subtitle_clips',
    trackId: 'subtitle-track-1',
    mode: 'append',
    style: DEFAULT_AGENT_SUBTITLE_STYLE,
    clips,
    ...overrides,
  };
}

describe('OperationApplier × subtitles', () => {
  it('applies in one undoable step and removes the new track on undo', async () => {
    const state = stateWith();
    const applier = makeApplier(state);
    const outcome = await applier.apply(operation([
      { id: 's1', name: '一句', text: '一句', startTime: 0, duration: 2 },
    ]), 'tc-1');

    expect(outcome).toEqual({ status: 'applied' });
    expect(applier.hasUndoableRecord('tc-1')).toBe(true);
    expect(state.value.tracks).toHaveLength(2);

    expect(applier.undoOperation('tc-1')).toEqual({ ok: true });
    // trackPatch: before === null → 整条轨被删掉，「一次性全部消失」不需要额外逻辑。
    expect(state.value.tracks.map(track => track.id)).toEqual(['v1']);
  });

  it('restores the previous subtitles character for character after a replace', async () => {
    const existing = {
      id: 'subtitle-track-1', name: '', type: 'subtitle' as const, height: 50,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1,
      items: [subtitleItem('old-1', '旧的第一句', 0), subtitleItem('old-2', '旧的第二句', 2)],
    };
    const state = stateWith([existing]);
    const applier = makeApplier(state);

    await applier.apply(operation(
      [{ id: 's9', name: '全新的', text: '全新的', startTime: 0, duration: 4 }],
      { mode: 'replace' },
    ), 'tc-2');
    expect(state.value.tracks[1].items.map(item => item.id)).toEqual(['s9']);

    expect(applier.undoOperation('tc-2')).toEqual({ ok: true });
    expect(state.value.tracks[1].items.map(item => item.text))
      .toEqual(['旧的第一句', '旧的第二句']);
  });

  it('skips a locked subtitle track without writing anything', async () => {
    const locked = {
      id: 'subtitle-track-1', name: '', type: 'subtitle' as const, height: 50,
      isLocked: true, isMuted: false, isVisible: true, volume: 100, order: 1,
      items: [],
    };
    const state = stateWith([locked]);
    const applier = makeApplier(state);
    const outcome = await applier.apply(operation([
      { id: 's1', name: 'x', text: 'x', startTime: 0, duration: 1 },
    ]), 'tc-3');

    expect(outcome).toEqual({ status: 'skipped', reason: 'locked-track', trackId: 'subtitle-track-1' });
    expect(state.value.tracks[1].items).toEqual([]);
    expect(applier.hasUndoableRecord('tc-3')).toBe(false);
  });

  it('rejects a zero-duration payload and leaves the timeline as it was', async () => {
    const state = stateWith();
    const before = JSON.parse(JSON.stringify(state.value)) as TimelineState;
    const applier = makeApplier(state);
    const outcome = await applier.apply(operation([
      { id: 's1', name: 'x', text: 'x', startTime: 0, duration: 0 },
    ]), 'tc-4');

    expect(outcome).toMatchObject({ status: 'rejected', reason: 'invalid-time' });
    expect(state.value).toEqual(before);
  });

  it('refuses a subtitle write aimed at a video track', async () => {
    const state = stateWith();
    const before = JSON.parse(JSON.stringify(state.value)) as TimelineState;
    const applier = makeApplier(state);
    const outcome = await applier.apply(operation(
      [{ id: 's1', name: 'x', text: 'x', startTime: 0, duration: 1 }],
      { trackId: 'v1' },
    ), 'tc-6');

    // 守卫先于构造：字幕绝不能被写进素材轨（预览与导出对轨类型的判断不同）。
    expect(outcome).toMatchObject({
      status: 'rejected', reason: 'target-track-missing',
    });
    expect(state.value).toEqual(before);
  });

  it('applies the same operation twice without doubling the cues (D-15)', async () => {
    const state = stateWith();
    const applier = makeApplier(state);
    const op = operation([
      { id: 's1', name: 'a', text: 'a', startTime: 0, duration: 1 },
      { id: 's2', name: 'b', text: 'b', startTime: 1, duration: 1 },
    ]);
    await applier.apply(op, 'tc-5');
    await applier.apply(op, 'tc-5');

    expect(state.value.tracks[1].items).toHaveLength(2);
  });
});
