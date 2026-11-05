import { describe, expect, it } from 'vitest';
import type { AddSubtitleClipsOperation, TimelineState, Track } from '@/types';
import { createVideoEditingAgent } from '../agent';
import { OperationApplier } from '../OperationApplier';
import { DEFAULT_AGENT_SUBTITLE_STYLE } from '../subtitleClips';

/**
 * 两端一致（agent-subtitles spec §D-4 / P0-2 / §9.1）。
 *
 * 同一份 `add_subtitle_clips` 分别经
 *   · 服务端本地副本 —— `createVideoEditingAgent().toolContext.updateTimeline`
 *     （与工具同一条真实路径），
 *   · 浏览器真实时间线 —— `OperationApplier.apply`，
 * 之后 `tracks` 与 `totalDuration` 必须 **deepEqual**：项目历史上两次事故都是这两份
 * 实现漂移（「模型说加上了、界面没有」），「声明一致」不算机制。
 */

function makeState(): TimelineState {
  return {
    currentTime: 0, totalDuration: 4, zoomLevel: 1, selectedItems: [],
    tracks: [{
      id: 'v1', name: 'Video', type: 'video', height: 80, isLocked: false,
      isMuted: false, isVisible: true, volume: 100, order: 0,
      items: [{
        id: 'v', name: 'v', type: 'video', startTime: 0, duration: 4,
        trackId: 'v1', color: '#000',
      }],
    }],
    playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
  };
}

function operation(): AddSubtitleClipsOperation {
  return {
    type: 'add_subtitle_clips',
    trackId: 'subtitle-track-1',
    mode: 'append',
    style: DEFAULT_AGENT_SUBTITLE_STYLE,
    clips: [
      { id: 'subtitle-tc-1-0', name: '第一句', text: '第一句', startTime: 0, duration: 2 },
      { id: 'subtitle-tc-1-1', name: '第二句', text: '第二句', startTime: 2, duration: 2 },
      { id: 'subtitle-tc-1-2', name: '尾巴', text: '尾巴', startTime: 30, duration: 2 },
    ],
  };
}

function newAgentContext(state = makeState()) {
  return createVideoEditingAgent({
    llmApiUrl: 'http://localhost:9999',
    llmApiKey: 'sk-test',
    llmModel: 'gpt-4o-mini',
    timelineState: state,
    materials: [],
    conversationHistory: [{ id: 'u1', role: 'user', content: '加字幕', timestamp: new Date() }],
    apiBaseUrl: 'http://localhost:3088',
  });
}

describe('subtitle dual apply (P0-2)', () => {
  it('produces the same tracks and totalDuration on both sides', async () => {
    const initial = makeState();
    const { toolContext } = newAgentContext(initial);
    const receipt = toolContext.updateTimeline('tc-1', operation());
    expect(receipt).toEqual({ applied: true });

    const browserState = { value: makeState() };
    const applier = new OperationApplier({
      getTimelineState: () => browserState.value,
      setTimelineState: next => { browserState.value = next; },
    });
    expect(await applier.apply(operation(), 'tc-1')).toEqual({ status: 'applied' });

    expect(toolContext.timelineState.tracks).toEqual(browserState.value.tracks);
    expect(toolContext.timelineState.totalDuration)
      .toBe(browserState.value.totalDuration);
    // 30 秒的字幕把 totalDuration 从 4 推到 32（以前只有浏览器侧做这一步）。
    expect(toolContext.timelineState.totalDuration).toBe(32);
  });

  it('refuses locally and leaves the copy untouched, reporting {applied:false}', () => {
    const { toolContext } = newAgentContext();
    const broken: AddSubtitleClipsOperation = {
      ...operation(),
      clips: [{ id: 's1', name: 'x', text: 'x', startTime: 0, duration: 0 }],
    };

    expect(toolContext.updateTimeline('tc-bad', broken))
      .toEqual({ applied: false, reason: 'invalid-time' });
    // 一字不变：没有新建字幕轨，也没有把操作记进 operations。
    expect(toolContext.timelineState).toEqual(makeState());
    expect(toolContext.operations.has('tc-bad')).toBe(false);
  });

  it('refuses an overlapping batch on both sides', async () => {
    const { toolContext } = newAgentContext();
    const overlapping: AddSubtitleClipsOperation = {
      ...operation(),
      clips: [
        { id: 's1', name: 'a', text: 'a', startTime: 0, duration: 3 },
        { id: 's2', name: 'b', text: 'b', startTime: 1, duration: 3 },
      ],
    };
    expect(toolContext.updateTimeline('tc-overlap', overlapping).applied).toBe(false);

    const browserState = { value: makeState() };
    const applier = new OperationApplier({
      getTimelineState: () => browserState.value,
      setTimelineState: next => { browserState.value = next; },
    });
    const outcome = await applier.apply(overlapping, 'tc-overlap');
    expect(outcome).toMatchObject({ status: 'rejected', reason: 'invalid-time' });
    expect(browserState.value).toEqual(makeState());
  });

  it('keeps a subtitle track the user already has on both sides', async () => {
    const initial = makeState();
    const existingTrack: Track = {
      id: 'subtitle-track-1', name: '', type: 'subtitle', height: 50,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1,
      items: [{
        id: 'old', name: '旧', type: 'subtitle', startTime: 10, duration: 1,
        trackId: 'subtitle-track-1', color: '#E67E22', text: '旧',
      }],
    };
    initial.tracks.push(existingTrack);
    const { toolContext } = newAgentContext(initial);
    toolContext.updateTimeline('tc-2', operation());

    const browserState = { value: JSON.parse(JSON.stringify(initial)) as TimelineState };
    const applier = new OperationApplier({
      getTimelineState: () => browserState.value,
      setTimelineState: next => { browserState.value = next; },
    });
    await applier.apply(operation(), 'tc-2');

    expect(toolContext.timelineState.tracks).toEqual(browserState.value.tracks);
    expect(toolContext.timelineState.tracks).toHaveLength(2);
  });
});
