/**
 * Integration test for the system-prompt persistence fix.
 *
 * Spec: docs/plans/video-agent-prompt-persistence/spec.md §6.1 ("agent.test.ts").
 *
 * Builds a 3-message conversation history where turn 1 includes a successful
 * `explore_tools(script_tools)` call. The agent created from that history
 * must end up with a system prompt that includes the script category's
 * expanded block — proving Layer B (history → appendix) works end-to-end.
 */

import { describe, it, expect } from 'vitest';
import { createVideoEditingAgent } from '../agent';
import type { TimelineState, ChatMessage } from '@/types';

function emptyTimeline(): TimelineState {
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

describe('createVideoEditingAgent — explored-categories appendix is reflected in initial system prompt', () => {
  it('replays a turn-1 explore_tools(script_tools) call into the system prompt', () => {
    const history: ChatMessage[] = [
      { id: 'u1', role: 'user', content: '帮我做一个解说视频', timestamp: new Date() },
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isAgentMessage: true,
        agentToolCalls: [
          {
            id: 't1',
            name: 'explore_tools',
            params: { category: 'script_tools' },
            status: 'completed',
            result: { success: true },
          },
        ],
      },
      { id: 'u2', role: 'user', content: '再做一个 60 秒的版本', timestamp: new Date() },
    ];

    const { agent } = createVideoEditingAgent({
      llmApiUrl: 'http://localhost:9999',
      llmApiKey: 'sk-test',
      llmModel: 'gpt-4o-mini',
      timelineState: emptyTimeline(),
      materials: [],
      conversationHistory: history,
      apiBaseUrl: 'http://localhost:3088',
    });

    const sp = agent.state.systemPrompt;
    expect(sp).toContain('## 已加载的高级工具');
    expect(sp).toContain('generate_video_script');
    expect(sp).toContain('expand_video_script');
  });

  it('produces a system prompt that always includes the Core Workflow Toolkit and Workflow Recipes (Layers A + C)', () => {
    const { agent } = createVideoEditingAgent({
      llmApiUrl: 'http://localhost:9999',
      llmApiKey: 'sk-test',
      llmModel: 'gpt-4o-mini',
      timelineState: emptyTimeline(),
      materials: [],
      conversationHistory: [{ id: 'u1', role: 'user', content: 'hi', timestamp: new Date() }],
      apiBaseUrl: 'http://localhost:3088',
    });
    const sp = agent.state.systemPrompt;
    expect(sp).toContain('## 核心工作流工具');
    expect(sp).toContain('## 工作流配方');
    expect(sp).toContain('search_video');
    expect(sp).toContain('generate_storyboard');
    // No appendix when no categories were explored.
    expect(sp).not.toContain('## 已加载的高级工具');
  });

  it('keeps the prompt under the 18000-char ceiling even when 3 categories have been explored', () => {
    const explored = ['script_tools', 'storyboard_tools', 'tts_tools'];
    const history: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: new Date() },
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isAgentMessage: true,
        agentToolCalls: explored.map((cat, i) => ({
          id: `t${i}`,
          name: 'explore_tools',
          params: { category: cat },
          status: 'completed' as const,
          result: { success: true },
        })),
      },
      { id: 'u2', role: 'user', content: 'go', timestamp: new Date() },
    ];

    const { agent } = createVideoEditingAgent({
      llmApiUrl: 'http://localhost:9999',
      llmApiKey: 'sk-test',
      llmModel: 'gpt-4o-mini',
      timelineState: emptyTimeline(),
      materials: [],
      conversationHistory: history,
      apiBaseUrl: 'http://localhost:3088',
    });

    expect(agent.state.systemPrompt.length).toBeLessThan(18000);
  });
});
