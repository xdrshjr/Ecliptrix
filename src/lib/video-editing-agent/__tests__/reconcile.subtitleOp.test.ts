import { describe, expect, it } from 'vitest';
import type { AddSubtitleClipsOperation, TimelineState, Track } from '@/types';
import { reconcileOverlapsAfterAgentOp } from '../reconcile';
import { DEFAULT_AGENT_SUBTITLE_STYLE, applySubtitleClipsToState } from '../subtitleClips';

/**
 * 回归钉子（agent-subtitles spec §D-5 / RK-1 / AC-10）。
 *
 * `affectedTrackIds` 不给 `add_subtitle_clips` 加 case 时，`reconcileOverlapsAfterAgentOp`
 * 会拿到 `allowed === null` 且 `packAlways === true`，于是把所有视频/音频轨重新
 * 紧凑排列——加个字幕就悄悄挪动用户的视频片段。这个用例就是那条护栏：
 * 视频轨与音频轨上刻意留白，加 18 条字幕后两轨的 `startTime` 必须**一字不变**。
 */

function track(id: string, type: Track['type'], starts: number[]): Track {
  return {
    id, name: id, type, height: type === 'subtitle' ? 50 : 80,
    isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
    items: starts.map((startTime, index) => ({
      id: `${id}-${index}`,
      name: `${id}-${index}`,
      type: type === 'subtitle' ? 'subtitle' as const : type === 'audio' ? 'audio' as const : 'video' as const,
      startTime, duration: 3, trackId: id, color: '#000',
    })),
  };
}

function makeState(): TimelineState {
  return {
    currentTime: 0, totalDuration: 22, zoomLevel: 1, selectedItems: [],
    // 视频轨 a@0(3) 与 b@7(3)：中间 4 秒留白；音频轨同样留白。
    tracks: [
      track('v1', 'video', [0, 7, 14]),
      track('a1', 'audio', [0, 7, 14]),
      track('subtitle-track-1', 'subtitle', []),
    ],
    playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
  };
}

function subtitleOperation(): AddSubtitleClipsOperation {
  return {
    type: 'add_subtitle_clips',
    trackId: 'subtitle-track-1',
    mode: 'append',
    style: DEFAULT_AGENT_SUBTITLE_STYLE,
    clips: Array.from({ length: 18 }, (_, index) => ({
      id: `subtitle-call-${index}`,
      name: `第${index}句`,
      text: `第${index}句`,
      startTime: index * 2,
      duration: 1.8,
    })),
  };
}

function startsOf(state: TimelineState): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  for (const each of state.tracks) {
    result[each.id] = each.items.map(item => item.startTime);
  }
  return result;
}

describe('reconcile + add_subtitle_clips (D-5)', () => {
  it('moves no video or audio clip when subtitles land', () => {
    const state = makeState();
    const operation = subtitleOperation();
    applySubtitleClipsToState(state, operation);
    // 快照必须在字幕已经落轨之后：这里只测 reconcile 会不会动**别的**轨。
    const before = startsOf(state);

    reconcileOverlapsAfterAgentOp(state, operation);

    expect(startsOf(state)).toEqual(before);
    expect(state.tracks[2].items).toHaveLength(18);
    expect(startsOf(state).v1).toEqual([0, 7, 14]);
  });

  it('would repack everything if the operation type were unknown (the pit this pins)', () => {
    // 反证：`affectedTrackIds` 对未知 op 落到 `return null`，`packAlways` 随之为真
    // → 所有视频/音频轨被紧凑排列，留白被吃掉。这正是漏加 case 时会发生的事。
    const state = makeState();
    const unknown = { type: 'legacy_unknown_op' } as unknown as AddSubtitleClipsOperation;

    reconcileOverlapsAfterAgentOp(state, unknown);

    expect(startsOf(state).v1).toEqual([0, 3, 6]);
    expect(startsOf(state).a1).toEqual([0, 3, 6]);
  });
});
