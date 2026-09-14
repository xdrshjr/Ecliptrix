import { describe, it, expect } from 'vitest';
import type { ChatMessage, AgentToolCallRecord } from '@/types';
import { convertToAgentMessages } from '../messageConverter';

function userMsg(id: string, content = 'hello'): ChatMessage {
  return { id, role: 'user', content, timestamp: new Date(0) };
}

function assistantWithTools(
  id: string,
  tools: AgentToolCallRecord[],
  opts: { isCancelled?: boolean; content?: string } = {},
): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: opts.content ?? '',
    timestamp: new Date(0),
    isAgentMessage: true,
    agentToolCalls: tools,
    isCancelled: opts.isCancelled,
  };
}

describe('convertToAgentMessages — cancelled tool branch', () => {
  it('emits an isError toolResult for status === "cancelled"', () => {
    const tools: AgentToolCallRecord[] = [
      { id: 'tc-1', name: 'search_materials', params: { q: 'cat' }, status: 'completed', result: { items: [] } },
      { id: 'tc-2', name: 'add_to_track', params: {}, status: 'cancelled' },
    ];
    const history: ChatMessage[] = [
      userMsg('u1'),
      assistantWithTools('a1', tools, { isCancelled: true, content: 'working on it' }),
    ];

    const result = convertToAgentMessages(history);

    const toolResults = result.filter((m) => m.role === 'toolResult');
    expect(toolResults).toHaveLength(2);
    expect(toolResults[0]).toMatchObject({ toolCallId: 'tc-1', isError: false });
    expect(toolResults[1]).toMatchObject({ toolCallId: 'tc-2', toolName: 'add_to_track', isError: true });
    const cancelledBody = (toolResults[1].content[0] as { text: string }).text;
    expect(cancelledBody).toContain('cancelled_by_user');
    expect(cancelledBody).toContain('add_to_track');
  });

  it('treats stray status === "executing" identically to cancelled', () => {
    const tools: AgentToolCallRecord[] = [
      { id: 'tc-x', name: 'compose_storyboard', params: {}, status: 'executing' },
    ];
    const history: ChatMessage[] = [
      userMsg('u1'),
      assistantWithTools('a1', tools, { isCancelled: true }),
    ];

    const result = convertToAgentMessages(history);
    const toolResults = result.filter((m) => m.role === 'toolResult');
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]).toMatchObject({ toolCallId: 'tc-x', isError: true });
  });

  it('appends a single system-note user message ONLY when the most recent assistant is cancelled', () => {
    const tools: AgentToolCallRecord[] = [
      { id: 'tc-1', name: 'search_materials', params: {}, status: 'completed', result: { ok: true } },
    ];
    const history: ChatMessage[] = [
      userMsg('u1'),
      assistantWithTools('a1', tools, { isCancelled: true }),
    ];

    const result = convertToAgentMessages(history);

    // Tail must be the synthetic system-note (encoded as a user message
    // since pi-ai does not support system role in the messages array).
    const last = result[result.length - 1];
    expect(last.role).toBe('user');
    expect((last as { content: string }).content).toContain('[System note]');
    // Only one note even after multiple cancelled assistants in history.
    const noteCount = result.filter(
      (m) => m.role === 'user' && typeof (m as { content: string }).content === 'string' && (m as { content: string }).content.startsWith('[System note]'),
    ).length;
    expect(noteCount).toBe(1);
  });

  it('does NOT inject the system-note when no assistant is cancelled', () => {
    const tools: AgentToolCallRecord[] = [
      { id: 'tc-1', name: 'search_materials', params: {}, status: 'completed', result: { ok: true } },
    ];
    const history: ChatMessage[] = [userMsg('u1'), assistantWithTools('a1', tools)];

    const result = convertToAgentMessages(history);
    const hasNote = result.some(
      (m) => m.role === 'user' && typeof (m as { content: string }).content === 'string' && (m as { content: string }).content.startsWith('[System note]'),
    );
    expect(hasNote).toBe(false);
  });

  it('does not inject the stopped note when a later assistant turn completed', () => {
    const stopped: AgentToolCallRecord[] = [
      { id: 'tc-a', name: 'add_to_track', params: {}, status: 'cancelled' },
    ];
    const completed: AgentToolCallRecord[] = [
      { id: 'tc-b', name: 'search_materials', params: {}, status: 'completed', result: { ok: true } },
    ];
    const history: ChatMessage[] = [
      userMsg('u1'),
      assistantWithTools('a1', stopped, { isCancelled: true }),
      userMsg('u2'),
      assistantWithTools('a2', completed, { content: 'done' }),
    ];

    const result = convertToAgentMessages(history);
    const hasNote = result.some(
      (m) => m.role === 'user' && typeof (m as { content: string }).content === 'string' && (m as { content: string }).content.startsWith('[System note]'),
    );
    expect(hasNote).toBe(false);
  });

  it('emits at most ONE system-note even across multiple cancelled assistants (P1-9)', () => {
    const tools1: AgentToolCallRecord[] = [
      { id: 'tc-a', name: 'search_materials', params: {}, status: 'cancelled' },
    ];
    const tools2: AgentToolCallRecord[] = [
      { id: 'tc-b', name: 'search_materials', params: {}, status: 'completed', result: { ok: true } },
      { id: 'tc-c', name: 'add_to_track', params: {}, status: 'cancelled' },
    ];
    const history: ChatMessage[] = [
      userMsg('u1'),
      assistantWithTools('a1', tools1, { isCancelled: true }),
      userMsg('u2'),
      assistantWithTools('a2', tools2, { isCancelled: true }),
    ];

    const result = convertToAgentMessages(history);
    const noteCount = result.filter(
      (m) => m.role === 'user' && typeof (m as { content: string }).content === 'string' && (m as { content: string }).content.startsWith('[System note]'),
    ).length;
    expect(noteCount).toBe(1);
  });
});
