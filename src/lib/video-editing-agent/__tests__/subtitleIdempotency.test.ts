import { describe, expect, it } from 'vitest';
import type { AddSubtitleClipsOperation, TimelineState } from '@/types';
import {
  DEFAULT_AGENT_SUBTITLE_STYLE,
  applySubtitleClipsToState,
} from '../subtitleClips';

/**
 * 幂等钉子（agent-subtitles spec §D-15 / RK-12 / AC-12）。
 *
 * 「确定性 id」只解决了一半：如果纯函数无脑 push，SSE 重放 / 同 turn 重试会让
 * 同一条字幕落两次（React key 冲突、假补丁、双层字幕）。这一组用例钉住
 * 「重复应用 = no-op」，以及 `replace` 之后 `append` 不残留旧条目。
 */

function emptyState(): TimelineState {
  return {
    currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [],
    tracks: [], playbackRate: 1, isPlaying: false, snapToGrid: false,
    gridSize: 1, scrollLeft: 0,
  };
}

function operation(
  clips: AddSubtitleClipsOperation['clips'],
  mode: AddSubtitleClipsOperation['mode'] = 'append',
): AddSubtitleClipsOperation {
  return {
    type: 'add_subtitle_clips',
    trackId: 'subtitle-track-1',
    mode,
    style: DEFAULT_AGENT_SUBTITLE_STYLE,
    clips,
  };
}

const CLIPS = [
  { id: 'subtitle-call-0', name: '第一句', text: '第一句', startTime: 0, duration: 2 },
  { id: 'subtitle-call-1', name: '第二句', text: '第二句', startTime: 2, duration: 2 },
  { id: 'subtitle-call-2', name: '第三句', text: '第三句', startTime: 4, duration: 2 },
];

describe('subtitle operation idempotency', () => {
  it('keeps the count, order and text unchanged when applied twice', () => {
    const state = emptyState();
    applySubtitleClipsToState(state, operation(CLIPS));
    const first = JSON.parse(JSON.stringify(state.tracks)) as unknown;

    applySubtitleClipsToState(state, operation(CLIPS));

    expect(state.tracks).toEqual(first);
    expect(state.tracks[0].items).toHaveLength(3);
    expect(state.tracks[0].items.map(item => item.id))
      .toEqual(CLIPS.map(clip => clip.id));
  });

  it('overwrites the fields of an existing id instead of duplicating it', () => {
    const state = emptyState();
    applySubtitleClipsToState(state, operation(CLIPS));
    applySubtitleClipsToState(state, operation([
      { ...CLIPS[1], text: '改写后的第二句', startTime: 2.5 },
    ]));

    const items = state.tracks[0].items;
    expect(items).toHaveLength(3);
    expect(items.find(item => item.id === 'subtitle-call-1'))
      .toMatchObject({ text: '改写后的第二句', startTime: 2.5 });
  });

  it('leaves nothing behind when replace is followed by append', () => {
    const state = emptyState();
    applySubtitleClipsToState(state, operation(CLIPS));
    applySubtitleClipsToState(state, operation([
      { id: 'subtitle-new-0', name: '新一句', text: '新一句', startTime: 0, duration: 1 },
    ], 'replace'));
    applySubtitleClipsToState(state, operation([
      { id: 'subtitle-new-1', name: '再一句', text: '再一句', startTime: 5, duration: 1 },
    ]));

    expect(state.tracks[0].items.map(item => item.id))
      .toEqual(['subtitle-new-0', 'subtitle-new-1']);
  });

  it('keeps a single subtitle track even when the replays arrive out of order', () => {
    const state = emptyState();
    applySubtitleClipsToState(state, operation([CLIPS[2], CLIPS[0]]));
    applySubtitleClipsToState(state, operation([CLIPS[1], CLIPS[0]]));

    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0].items.map(item => item.id))
      .toEqual(['subtitle-call-0', 'subtitle-call-1', 'subtitle-call-2']);
  });
});
