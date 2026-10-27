import type { AgentToolCallRecord, ChatMessage } from '@/types';

/** Shared ChatMessage builders for the conversation-memory tests. */

let tick = 0;
const nextTime = () => new Date(1_700_000_000_000 + (tick += 1000));

export function userMessage(id: string, content: string): ChatMessage {
  return { id, role: 'user', content, timestamp: nextTime() };
}

export function plainAssistant(id: string, content: string): ChatMessage {
  return { id, role: 'assistant', content, timestamp: nextTime() };
}

export function toolCall(
  id: string,
  name: string,
  params: Record<string, unknown>,
  result: unknown,
  status: AgentToolCallRecord['status'] = 'completed',
): AgentToolCallRecord {
  return { id, name, params, status, result };
}

export function agentMessage(
  id: string,
  content: string,
  calls: AgentToolCallRecord[],
): ChatMessage {
  return {
    id, role: 'assistant', content, timestamp: nextTime(),
    isAgentMessage: true, agentToolCalls: calls,
  };
}

export function compactionMessage(
  id: string,
  summaryText: string,
  patch: Partial<NonNullable<ChatMessage['metadata']>['compaction']> = {},
): ChatMessage {
  return {
    id, role: 'system', content: '已整理 4 条早期对话', timestamp: nextTime(),
    metadata: {
      type: 'compaction',
      compaction: {
        summaryText, coveredThroughMessageId: 'm0', coveredCount: 4,
        tokensBefore: 1000, tokensAfter: 100, auto: false,
        createdAt: '2026-10-27T00:00:00.000Z', ...patch,
      },
    },
  };
}

/** A valid summarizer reply; `patch` overrides individual top-level fields. */
export function summaryJson(patch: Record<string, unknown> = {}): string {
  return JSON.stringify({
    goal: '做一条 6 个分镜的城市宣传片',
    decisions: ['竖版 9:16', '配音用女声'],
    timeline_notes: '已有 3 个片段',
    materials: [],
    research: [],
    open_items: ['等用户确认片尾'],
    avoid: [],
    ...patch,
  });
}
