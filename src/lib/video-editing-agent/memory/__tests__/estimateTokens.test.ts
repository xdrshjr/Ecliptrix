import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/types';
import { HISTORY_CHAR_BUDGET, compactHistoryForModel } from '../../historyBudget';
import { convertToAgentMessages } from '../../messageConverter';
import {
  BYTES_PER_TOKEN, budgetModelContext, bytesToTokens, compactResult,
} from '../../modelContextBudget';
import {
  ESTIMATE_BYTES_PER_TOKEN, bytesToEstimatedTokens, estimateConversationTokens,
  estimateTextTokens,
} from '../estimateTokens';
import {
  agentMessage, compactionMessage, plainAssistant, toolCall, userMessage,
} from './fixtures';

/** What `agent.ts` + `budgetModelContext` would report for the same history. */
function serverEstimate(messages: ChatMessage[]): number {
  const history = compactHistoryForModel(
    convertToAgentMessages(messages), HISTORY_CHAR_BUDGET, compactResult);
  return budgetModelContext({ systemPrompt: '', messages: history, tools: [] }).estimatedTokens;
}

const bigTimeline = { success: true, tracks: Array.from({ length: 40 }, (_, i) => ({
  id: `t${i}`, name: `轨道${i}`, clips: Array.from({ length: 6 }, (_, j) => ({ id: `c${i}-${j}`, start: j })),
})) };
const bigSearch = { success: true, summary: '搜索摘要'.repeat(200),
  results: Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, title: `结果${i}`.repeat(8) })) };
const bigResearch = { success: true, artifact_id: 'art-1', title: '研究',
  text: '正文'.repeat(600), quality: 'full_text' };

function longConversation(): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let turn = 0; turn < 8; turn++) {
    messages.push(userMessage(`u${turn}`, `第${turn}轮：请继续处理素材并调整时间线`));
    messages.push(agentMessage(`a${turn}`, `第${turn}轮完成`, [
      toolCall(`g${turn}`, 'get_timeline', {}, bigTimeline),
      toolCall(`s${turn}`, 'search_video', { query: '城市夜景' }, bigSearch),
      toolCall(`w${turn}`, 'web_fetch', { url: 'https://example.org' }, bigResearch),
      toolCall(`t${turn}`, 'add_to_track', { materialId: `m${turn}` }, { success: true }),
    ]));
  }
  return messages;
}

describe('estimateConversationTokens', () => {
  describe('AC-C2 agreement with the server estimator', () => {
    it('pins the unit conversion to modelContextBudget', () => {
      expect(ESTIMATE_BYTES_PER_TOKEN).toBe(BYTES_PER_TOKEN);
      for (const bytes of [0, 1, 2, 3, 999, 123_457]) {
        expect(bytesToEstimatedTokens(bytes)).toBe(bytesToTokens(bytes));
      }
    });

    it.each([
      ['short chat', [userMessage('u1', '你好'), plainAssistant('a1', '你好，想剪什么？')]],
      ['long agent conversation with large results', longConversation()],
    ])('is within 15%% of budgetModelContext for a %s', (_label, messages) => {
      const estimate = estimateConversationTokens(messages);
      const actual = serverEstimate(messages);
      expect(Math.abs(estimate - actual) / actual).toBeLessThanOrEqual(0.15);
    });

    it('stays within 15% when the history ends in a compaction digest', () => {
      const messages = [...longConversation(), compactionMessage('c1', '摘要'.repeat(100)),
        userMessage('u99', '继续'), plainAssistant('a99', '好')];
      const actual = serverEstimate(messages);
      expect(Math.abs(estimateConversationTokens(messages) - actual) / actual).toBeLessThanOrEqual(0.15);
    });
  });

  it('counts only the latest digest and what follows it', () => {
    const folded = longConversation();
    const tail = [userMessage('u99', '继续'), plainAssistant('a99', '好')];
    const withDigest = [...folded, compactionMessage('c1', '简短摘要'), ...tail];
    const digestOnly = estimateConversationTokens(withDigest);
    expect(digestOnly).toBeLessThan(estimateConversationTokens(folded) / 4);
    expect(digestOnly).toBeGreaterThan(estimateConversationTokens(tail));
  });

  it('adds the caller-supplied system prompt allowance', () => {
    const messages = [userMessage('u1', '你好')];
    const base = estimateConversationTokens(messages);
    expect(estimateConversationTokens(messages, { systemPromptBytes: 20_000 })).toBe(base + 10_000);
  });

  it('is deterministic and does not mutate its input', () => {
    const messages = longConversation();
    const snapshot = JSON.stringify(messages);
    expect(estimateConversationTokens(messages)).toBe(estimateConversationTokens(messages));
    expect(JSON.stringify(messages)).toBe(snapshot);
  });

  it('estimates plain text at the shared bytes-per-token rate', () => {
    expect(estimateTextTokens('abcd')).toBe(2);
    expect(estimateTextTokens('中')).toBe(2);
  });
});
