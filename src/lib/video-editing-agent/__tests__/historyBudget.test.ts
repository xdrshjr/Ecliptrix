/**
 * AG2-13: the history replayed to the model has a size budget. Older turns
 * lose stale snapshots; over budget, whole oldest turns go, never splitting
 * a tool call from its result.
 */
import { describe, it, expect } from 'vitest';
import type { Message } from '@mariozechner/pi-ai';
import { compactHistoryForModel } from '../historyBudget';

const usage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function user(text: string): Message {
  return { role: 'user', content: text, timestamp: 0 };
}

function toolCall(id: string, name: string): Message {
  return {
    role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: {} }],
    api: 'openai-completions', provider: 'openai', model: '', usage, stopReason: 'toolUse', timestamp: 0,
  };
}

function toolResult(id: string, name: string, text: string): Message {
  return { role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }], isError: false, timestamp: 0 };
}

/** One turn: read the timeline (a large snapshot), then fix overlaps. */
function turn(n: number): Message[] {
  return [
    user(`turn ${n}`),
    toolCall(`get-${n}`, 'get_timeline'),
    toolResult(`get-${n}`, 'get_timeline', JSON.stringify({ tracks: 'x'.repeat(5000) })),
    toolCall(`fix-${n}`, 'auto_fix_overlaps'),
    toolResult(`fix-${n}`, 'auto_fix_overlaps', JSON.stringify({ success: true, operations: [{ type: 'move_clip' }, { type: 'move_clip' }] })),
  ];
}

function resultText(messages: Message[], toolCallId: string): string | undefined {
  const found = messages.find(m => m.role === 'toolResult' && m.toolCallId === toolCallId);
  return found?.role === 'toolResult' && found.content[0].type === 'text' ? found.content[0].text : undefined;
}

function toolCallIds(messages: Message[]): string[] {
  return messages.flatMap(m => (m.role === 'assistant'
    ? m.content.flatMap(block => (block.type === 'toolCall' ? [block.id] : []))
    : []));
}

function toolResultIds(messages: Message[]): string[] {
  return messages.flatMap(m => (m.role === 'toolResult' ? [m.toolCallId] : []));
}

describe('compactHistoryForModel', () => {
  it('older timeline snapshots become stubs and every tool call keeps its result', () => {
    const history = [...turn(1), ...turn(2), ...turn(3), ...turn(4)];

    const compacted = compactHistoryForModel(history);

    expect({
      pairs: toolResultIds(compacted),
      oldSnapshot: resultText(compacted, 'get-1'),
      oldFix: resultText(compacted, 'fix-2'),
      recentSnapshot: resultText(compacted, 'get-3'),
      recentFix: resultText(compacted, 'fix-4'),
    }).toEqual({
      pairs: toolCallIds(compacted),
      oldSnapshot: '{"omitted":"stale get_timeline snapshot; call it again"}',
      oldFix: '{"success":true,"operationsCount":2}',
      recentSnapshot: resultText(history, 'get-3'),
      recentFix: resultText(history, 'fix-4'),
    });
  });

  it('over budget drops whole oldest turns', () => {
    const history = [...turn(1), ...turn(2), ...turn(3), ...turn(4), ...turn(5)];

    const compacted = compactHistoryForModel(history, 0);
    const [note, firstKept] = compacted;

    expect({
      note: note.role === 'user' ? note.content : null,
      firstKept: firstKept.role === 'user' ? firstKept.content : null,
      pairs: toolResultIds(compacted),
      length: compacted.length,
    }).toEqual({
      note: expect.stringMatching(/^\[System note\] 3 earlier turns omitted/),
      firstKept: 'turn 4',
      pairs: toolCallIds(compacted),
      length: 1 + 10,
    });
  });

  it('a history within budget gets no omission note', () => {
    const history = [...turn(1), ...turn(2)];

    expect(compactHistoryForModel(history)).toEqual(history);
  });
});
