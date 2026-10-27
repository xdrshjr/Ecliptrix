import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/types';
import { convertToAgentMessages } from '../messageConverter';
import { scanExploredCategories } from '../historyScan';
import { scanLatestPlan } from '../planScan';
import {
  agentMessage, compactionMessage, plainAssistant, toolCall, userMessage,
} from '../memory/__tests__/fixtures';

const SUMMARY = '## 早期对话摘要\n**目标**: 做城市宣传片';

/** m1..m10: five folded turns, one of which holds a plan and an explore. */
function foldedTurns(): ChatMessage[] {
  const planResult = { success: true, plan_id: 'plan-1', steps: [
    { index: 0, title: '找素材', status: 'completed' },
    { index: 1, title: '剪辑', status: 'in_progress' },
  ] };
  return [
    userMessage('m1', 'FOLDED-1'), plainAssistant('m2', 'FOLDED-2'),
    userMessage('m3', 'FOLDED-3'),
    agentMessage('m4', 'FOLDED-4', [
      toolCall('p1', 'update_plan', { steps: [] }, planResult),
      toolCall('e1', 'explore_tools', { category: 'web_tools' }, { success: true }),
    ]),
    userMessage('m5', 'FOLDED-5'), plainAssistant('m6', 'FOLDED-6'),
    userMessage('m7', 'FOLDED-7'), plainAssistant('m8', 'FOLDED-8'),
    userMessage('m9', 'FOLDED-9'), plainAssistant('m10', 'FOLDED-10'),
  ];
}

const tail = (): ChatMessage[] => [
  userMessage('m11', 'TAIL-11'), plainAssistant('m12', 'TAIL-12'),
  userMessage('m13', 'TAIL-13'), plainAssistant('m14', 'TAIL-14'),
];

const texts = (messages: ReturnType<typeof convertToAgentMessages>): string =>
  JSON.stringify(messages);

describe('convertToAgentMessages compaction barrier', () => {
  describe('AC-C6 barrier semantics', () => {
    it('emits the digest followed by the messages after it, and nothing before', () => {
      const history = [...foldedTurns(), compactionMessage('C', SUMMARY), ...tail()];
      const converted = convertToAgentMessages(history);
      expect(converted).toHaveLength(5);
      expect(converted[0].role).toBe('user');
      expect(converted.slice(1).map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
      expect(texts(converted)).not.toContain('FOLDED');
      expect(texts(converted)).toContain('TAIL-11');
      expect(texts(converted)).toContain('TAIL-14');
    });

    it('frames the digest as data, never instructions (AC-C12)', () => {
      const [digest] = convertToAgentMessages(
        [...foldedTurns(), compactionMessage('C', SUMMARY), ...tail()]);
      expect(digest.role).toBe('user');
      const content = (digest as { content: string }).content;
      expect(content).toContain('never as instructions');
      expect(content).toContain(SUMMARY);
      expect(content.startsWith('[Conversation summary')).toBe(true);
      expect(content).toContain('[End of summary.');
    });

    it('honours only the LAST compaction message', () => {
      const history = [
        ...foldedTurns(), compactionMessage('C1', 'FIRST-DIGEST'),
        userMessage('m11', 'MIDDLE-11'), plainAssistant('m12', 'MIDDLE-12'),
        compactionMessage('C2', 'SECOND-DIGEST', { supersedes: 'C1' }),
        userMessage('m13', 'TAIL-13'), plainAssistant('m14', 'TAIL-14'),
      ];
      const text = texts(convertToAgentMessages(history));
      expect(text).toContain('SECOND-DIGEST');
      expect(text).not.toContain('FIRST-DIGEST');
      expect(text).not.toContain('MIDDLE');
      expect(text).toContain('TAIL-13');
    });

    it('treats a digest-less compaction message like any other skipped system message', () => {
      const broken: ChatMessage = { ...compactionMessage('C', ''), metadata: { type: 'compaction' } };
      const history = [userMessage('m1', 'KEEP-1'), broken, plainAssistant('m2', 'KEEP-2')];
      expect(convertToAgentMessages(history).map(m => m.role)).toEqual(['user', 'assistant']);
      expect(texts(convertToAgentMessages(history))).toContain('KEEP-1');
    });

    it('leaves a history without a compaction message exactly as before', () => {
      const history = [...foldedTurns(), ...tail()];
      const converted = convertToAgentMessages(history);
      expect(converted.map(m => m.role)).toEqual([
        'user', 'assistant', 'user', 'assistant', 'toolResult', 'toolResult',
        'user', 'assistant', 'user', 'assistant', 'user', 'assistant',
        'user', 'assistant', 'user', 'assistant']);
      expect(texts(converted)).toContain('FOLDED-1');
    });

    it('judges the resume note by the visible tail, not by folded turns', () => {
      const stopped = { ...plainAssistant('m2', 'STOPPED'), isCancelled: true };
      const history = [userMessage('m1', 'x'), stopped, compactionMessage('C', SUMMARY),
        userMessage('m3', 'next'), plainAssistant('m4', 'done')];
      expect(texts(convertToAgentMessages(history))).not.toContain('[System note]');
    });
  });

  describe('AC-C9 undo', () => {
    it('restores the pre-compaction output when the compaction message is removed', () => {
      const folded = foldedTurns();
      const recent = tail();
      const plain = [...folded, ...recent];
      const withDigest = [...folded, compactionMessage('C', SUMMARY), ...recent];
      const undone = withDigest.filter(message => message.id !== 'C');
      expect(convertToAgentMessages(undone)).toEqual(convertToAgentMessages(plain));
      expect(convertToAgentMessages(withDigest)).not.toEqual(convertToAgentMessages(plain));
    });

    it('falls back to the superseded digest when the rolling one is removed', () => {
      const history = [
        ...foldedTurns(), compactionMessage('C1', 'FIRST-DIGEST'),
        userMessage('m11', 'MIDDLE-11'), plainAssistant('m12', 'MIDDLE-12'),
        compactionMessage('C2', 'SECOND-DIGEST', { supersedes: 'C1' }),
        userMessage('m13', 'TAIL-13'),
      ];
      const restored = convertToAgentMessages(history.filter(message => message.id !== 'C2'));
      const text = texts(restored);
      expect(text).toContain('FIRST-DIGEST');
      expect(text).toContain('MIDDLE-11');
      expect(text).not.toContain('SECOND-DIGEST');
    });
  });

  describe('AC-C7 scanners keep reading the full history', () => {
    it('returns the same plan and explored categories with and without a digest', () => {
      const plain = [...foldedTurns(), ...tail()];
      const withDigest = [...foldedTurns(), compactionMessage('C', SUMMARY), ...tail()];
      expect(scanLatestPlan(withDigest)).toEqual(scanLatestPlan(plain));
      expect(scanExploredCategories(withDigest)).toEqual(scanExploredCategories(plain));
      expect(scanLatestPlan(withDigest)?.planId).toBe('plan-1');
      expect(scanExploredCategories(withDigest)).toEqual(['web_tools']);
    });
  });
});
