import { describe, expect, it } from 'vitest';
import { createVideoEditingAgent } from '../agent';
import type { TimelineState } from '@/types';

/**
 * `createVideoEditingAgent` 的 YOLO 分支（docs/plans/agent-yolo-autonomous-mode
 * spec.md §4.3 / §4.4 / AC-A1 / AC-A4）。
 *
 * 断言的是**同一份事实的两面**：注册表 offer 的工具名集合里没有 `ask_user`，
 * 提示词里也没有 `### ask_user` 段。两者必须同时成立，只有一面成立就是半可用。
 */

function emptyTimeline(): TimelineState {
  return {
    currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [],
    tracks: [{ id: 'video-track-1', name: 'video', type: 'video', height: 80,
      isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0,
      items: [] }],
    playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1,
    scrollLeft: 0,
  };
}

function build(autonomy?: 'interactive' | 'yolo') {
  return createVideoEditingAgent({
    llmApiUrl: 'http://localhost:9999',
    llmApiKey: 'sk-test',
    llmModel: 'gpt-4o-mini',
    timelineState: emptyTimeline(),
    materials: [],
    conversationHistory: [
      { id: 'u1', role: 'user', content: '做一条 60 秒资讯视频', timestamp: new Date() },
    ],
    apiBaseUrl: 'http://localhost:3088',
    autonomy,
  });
}

describe('createVideoEditingAgent({ autonomy: \'yolo\' })', () => {
  it('offers no ask_user tool while keeping the prompt in sync', () => {
    const { agent } = build('yolo');
    const offered = (agent.state.tools ?? []).map(tool => tool.name);
    expect(offered).not.toContain('ask_user');
    expect(agent.state.systemPrompt).not.toContain('### ask_user');
    expect(agent.state.systemPrompt).toContain('YOLO 全自动模式');
  });

  it('keeps the interactive tool set unchanged when autonomy is omitted', () => {
    const { agent } = build();
    const offered = (agent.state.tools ?? []).map(tool => tool.name);
    expect(offered).toContain('ask_user');
    expect(agent.state.systemPrompt).toContain('### ask_user');
    expect(agent.state.systemPrompt).not.toContain('YOLO 全自动模式');
  });

  it('treats an unknown autonomy value as interactive (失败即旧行为)', () => {
    const unknown = 'YOLO' as unknown as 'yolo';
    const { agent } = build(unknown);
    expect(agent.state.systemPrompt).not.toContain('YOLO 全自动模式');
  });
});
