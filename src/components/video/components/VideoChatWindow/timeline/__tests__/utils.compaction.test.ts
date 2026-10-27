import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/types';
import { mapMessageToNodes, messagesToTimelineNodes } from '../utils';

const labels = { emptyResponse: 'empty' };
const at = new Date(0);
const user = (id: string): ChatMessage => ({ id, role: 'user', content: id, timestamp: at });
const reply = (id: string): ChatMessage => ({ id, role: 'assistant', content: id, timestamp: at });
const digest = (id: string, extra: object = {}): ChatMessage => ({
  id, role: 'system', content: 'folded 4', timestamp: at,
  metadata: { type: 'compaction', compaction: {
    summaryText: '## Goal', coveredThroughMessageId: 'a2', coveredCount: 4, tokensBefore: 1000,
    tokensAfter: 250, auto: true, createdAt: at.toISOString(), ...extra,
  } },
});
const kinds = (messages: ChatMessage[], options?: Parameters<typeof messagesToTimelineNodes>[2]) =>
  messagesToTimelineNodes(messages, labels, options).map(node => `${node.kind}:${node.id}`);

describe('compaction in the timeline', () => {
  it('a digest renders as a divider node, never as a chat bubble', () => {
    const [node] = mapMessageToNodes(digest('c1'), labels);

    expect(node).toMatchObject({
      kind: 'compaction', messageId: 'c1', pending: false, summaryText: '## Goal',
      coveredCount: 4, tokensBefore: 1000, tokensAfter: 250,
    });
  });

  it('a plain system message still renders as before', () => {
    const plain: ChatMessage = { id: 's', role: 'system', content: 'note', timestamp: at };

    expect(mapMessageToNodes(plain, labels)[0].kind).toBe('response');
  });

  it('keeps the folded originals in place and puts the divider after them', () => {
    expect(kinds([user('u1'), reply('a1'), digest('c1'), user('u2')])).toEqual([
      'user:u1-user', 'response:a1-response', 'compaction:c1-compaction', 'user:u2-user',
    ]);
  });

  it('hides a digest that a later one replaced', () => {
    const messages = [user('u1'), digest('c1'), user('u2'), digest('c2', { supersedes: 'c1' })];

    expect(kinds(messages).filter(k => k.startsWith('compaction'))).toEqual(['compaction:c2-compaction']);
  });

  it('shows the older digest again once the newer one is gone (undo)', () => {
    const messages = [user('u1'), digest('c1'), user('u2')];

    expect(kinds(messages)).toContain('compaction:c1-compaction');
  });

  it('puts a pending placeholder right after the message the digest will follow', () => {
    const nodes = messagesToTimelineNodes([user('u1'), reply('a1'), user('u2')], labels,
      { compactingAfterMessageId: 'a1' });

    expect(nodes.map(n => n.kind)).toEqual(['user', 'response', 'compaction', 'user']);
    expect(nodes[2]).toMatchObject({ kind: 'compaction', pending: true });
  });

  it('adds no placeholder for a message that is not in the list', () => {
    expect(kinds([user('u1')], { compactingAfterMessageId: 'gone' })).toEqual(['user:u1-user']);
  });
});
