import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/types';
import type { SteerNote } from '@/types/agentSteering';
import { convertToAgentMessages } from '../messageConverter';
import { STEER_WRAPPER } from '../promptParts';

function user(content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: 'u1', role: 'user', content, timestamp: new Date(1000), ...extra };
}

function agent(steers: SteerNote[]): ChatMessage {
  return {
    id: 'a1', role: 'assistant', content: 'working', timestamp: new Date(2000),
    isAgentMessage: true,
    agentToolCalls: [
      { id: 'call-1', name: 'search_video', params: {}, status: 'completed', result: { ok: 1 } },
      { id: 'call-2', name: 'add_to_track', params: {}, status: 'completed', result: { ok: 2 } },
    ],
    steers,
  };
}

const note = (patch: Partial<SteerNote>): SteerNote => ({
  id: 'steer-0001', text: '改成竖版', status: 'applied', createdAt: 1500,
  afterToolCallId: 'call-1', ...patch,
});

function roles(messages: ReturnType<typeof convertToAgentMessages>) {
  return messages.map(message => message.role);
}

/** Every assistant tool call must be answered by a toolResult BEFORE any user message. */
function expectToolPairingIntact(messages: ReturnType<typeof convertToAgentMessages>) {
  messages.forEach((message, index) => {
    if (message.role !== 'assistant') return;
    const calls = message.content.filter(part => part.type === 'toolCall')
      .map(part => (part as { id: string }).id);
    const following = messages.slice(index + 1);
    const firstUser = following.findIndex(next => next.role === 'user');
    const answered = (firstUser === -1 ? following : following.slice(0, firstUser))
      .filter(next => next.role === 'toolResult')
      .map(next => (next as { toolCallId: string }).toolCallId);
    expect(answered.sort()).toEqual([...calls].sort());
  });
}

describe('steer replay (spec §3.2.5)', () => {
  it('places an applied steer after the whole tool block, never between tool results', () => {
    const converted = convertToAgentMessages([user('go'), agent([note({})])]);
    expect(roles(converted)).toEqual(['user', 'assistant', 'toolResult', 'toolResult', 'user']);
    expect((converted[4] as { content: string }).content).toBe(STEER_WRAPPER('改成竖版'));
    expectToolPairingIntact(converted);
  });

  it('places a start-of-turn steer (afterToolCallId null) before the first assistant message', () => {
    const converted = convertToAgentMessages(
      [user('go'), agent([note({ afterToolCallId: null })])]);
    expect(roles(converted)).toEqual(['user', 'user', 'assistant', 'toolResult', 'toolResult']);
    expectToolPairingIntact(converted);
  });

  it('falls back to before the assistant message when the tool call id is unknown', () => {
    const converted = convertToAgentMessages(
      [user('go'), agent([note({ afterToolCallId: 'gone' })])]);
    expect(roles(converted).slice(0, 3)).toEqual(['user', 'user', 'assistant']);
  });

  it.each(['queued', 'failed', 'local', 'sent'] as const)(
    'does not replay a %s steer', status => {
      const converted = convertToAgentMessages([user('go'), agent([note({ status })])]);
      expect(roles(converted)).toEqual(['user', 'assistant', 'toolResult', 'toolResult']);
    });

  it('keeps several steers in order', () => {
    const converted = convertToAgentMessages([user('go'), agent([
      note({ id: 'steer-0001', text: 'first' }),
      note({ id: 'steer-0002', text: 'second', afterToolCallId: 'call-2' }),
    ])]);
    const texts = converted.filter(message => message.role === 'user').slice(1)
      .map(message => (message as { content: string }).content);
    expect(texts).toEqual([STEER_WRAPPER('first'), STEER_WRAPPER('second')]);
  });

  it('adds a skill annotation for a user message that used one, without repeating the body', () => {
    const [first] = convertToAgentMessages([user('做视频', { skillId: 'explainer-video' })]);
    expect((first as { content: string }).content).toContain('本轮使用技能：explainer-video');
  });

  it('adds no annotation once skill_skipped cleared the skillId', () => {
    const [first] = convertToAgentMessages([user('做视频', { skillId: undefined })]);
    expect((first as { content: string }).content).toBe('做视频');
  });
});
