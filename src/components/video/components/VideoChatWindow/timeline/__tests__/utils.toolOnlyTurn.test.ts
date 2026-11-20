/**
 * AG2-17: the response node is the only place a turn offers "Undo all", so a
 * turn stopped after its tool calls but before any text must still get one.
 */
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/types';
import { getToolDisplayName, mapMessageToNodes } from '../utils';

const LABELS = { emptyResponse: 'The model returned an empty response.' };

function stoppedToolOnlyTurn(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: '',
    timestamp: new Date(0),
    isStreaming: false,
    isAgentMessage: true,
    isCancelled: true,
    agentToolCalls: [
      { id: 'tc-1', name: 'delete_clip', params: { clipId: 'a' }, status: 'completed', changedTimeline: true },
    ],
    timelineTrackPatches: [{ trackId: 'v1', before: null, after: null }],
    ...overrides,
  };
}

describe('mapMessageToNodes — tool-only turns', () => {
  it('仅写入脚本且没有回复文字时仍提供脚本操作节点', () => {
    const nodes = mapMessageToNodes(stoppedToolOnlyTurn({ timelineTrackPatches: [],
      agentToolCalls: [{ id: 'script', name: 'set_video_script', params: {}, status: 'completed', result: { client_applied: true } }] }), LABELS);
    expect(nodes).toContainEqual(expect.objectContaining({ kind: 'response', canUndo: false }));
  });
  it('a stopped tool-only turn with track patches still offers undo this turn', () => {
    const response = mapMessageToNodes(stoppedToolOnlyTurn(), LABELS).find(node => node.kind === 'response');

    expect(response).toMatchObject({ kind: 'response', content: '', canUndo: true, messageId: 'msg-1' });
  });

  it('a tool-only turn without track patches renders no response node', () => {
    const nodes = mapMessageToNodes(stoppedToolOnlyTurn({ timelineTrackPatches: [] }), LABELS);

    expect(nodes.map(node => node.kind)).toEqual(['execution']);
  });

  it('an empty finished turn shows the localised empty-response text', () => {
    const nodes = mapMessageToNodes(
      stoppedToolOnlyTurn({ agentToolCalls: [], timelineTrackPatches: undefined }),
      { emptyResponse: '模型返回了空内容' },
    );

    expect(nodes).toEqual([expect.objectContaining({ kind: 'response', content: '模型返回了空内容' })]);
  });

  it('tool names come from the localised labels and fall back to the raw name', () => {
    const labels = { delete_clip: '删除片段' };

    expect([getToolDisplayName('delete_clip', labels), getToolDisplayName('mystery_tool', labels)])
      .toEqual(['删除片段', 'mystery_tool']);
  });
});
