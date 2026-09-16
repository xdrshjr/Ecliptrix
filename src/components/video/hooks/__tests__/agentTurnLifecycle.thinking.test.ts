import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/types';
import { normalizeInterruptedAgentMessages } from '../agentTurnLifecycle';

function message(patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'agent', role: 'assistant', timestamp: new Date(0),
    content: '', isAgentMessage: true, ...patch,
  };
}

describe('中断思考记录清理', () => {
  it('保留只有思考内容的中断消息并清除两个活动标记', () => {
    const input = message({ thinkingContent: '分析轨道', isThinking: true });
    expect(normalizeInterruptedAgentMessages([input])).toEqual([{
      ...input, isStreaming: false, isThinking: false, isCancelled: true,
    }]);
  });

  it('保留工具记录并只取消仍执行的工具', () => {
    const input = message({ agentToolCalls: [
      { id: 'a', name: 'search', params: {}, status: 'executing' },
      { id: 'b', name: 'search', params: {}, status: 'completed' },
    ] });
    const [result] = normalizeInterruptedAgentMessages([input]);
    expect(result.agentToolCalls?.map(tool => tool.status))
      .toEqual(['cancelled', 'completed']);
    expect(result.agentToolCalls?.[1]).toBe(input.agentToolCalls?.[1]);
  });

  it('仅删除活动的 Agent 空占位，普通消息不增加取消标记', () => {
    const ordinary = message({ isAgentMessage: false, isStreaming: true });
    expect(normalizeInterruptedAgentMessages([
      message({ isStreaming: true }), ordinary,
    ])).toEqual([{ ...ordinary, isStreaming: false }]);
  });

  it('干净的消息及数组保持原引用', () => {
    const input = [message({ content: '完成' })];
    expect(normalizeInterruptedAgentMessages(input)).toBe(input);
  });
});
