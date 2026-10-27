import { describe, expect, it } from 'vitest';
import type { ChatMessage, VideoEditingTaskContent } from '@/types';
import { convertToAgentMessages } from '@/lib/video-editing-agent/messageConverter';
import { normaliseProjectDataForSave } from '@/lib/api/videoProjects';
import {
  buildCompactionMessage, countConversationMessages, findActiveCompaction, insertCompaction,
  isCompactionMessage, isFoldStillValid, planFold, removeCompaction, savedPercent,
  supersededCompactionIds, withoutCompaction, type FoldPlan,
} from '../conversationCompaction';

const at = new Date('2026-10-27T00:00:00Z');
const user = (n: number): ChatMessage => ({ id: `u${n}`, role: 'user', content: `question ${n}`, timestamp: at });
const reply = (n: number): ChatMessage => ({ id: `a${n}`, role: 'assistant', content: `answer ${n}`, timestamp: at });
/** u1 a1 u2 a2 ... for `turns` turns. */
const conversation = (turns: number, from = 1): ChatMessage[] =>
  Array.from({ length: turns }, (_, i) => [user(from + i), reply(from + i)]).flat();

function digest(plan: FoldPlan, id: string, summary = 'digest'): ChatMessage {
  return buildCompactionMessage(plan, {
    id, summaryText: summary, tokensBefore: 1000, tokensAfter: 250, auto: false,
    content: 'folded', now: at,
  });
}
const asPlan = (value: ReturnType<typeof planFold>): FoldPlan => {
  if (typeof value === 'string') throw new Error(`expected a plan, got ${value}`);
  return value;
};
/** Fold `messages` and return the array with the digest inserted. */
function fold(messages: ChatMessage[], id: string): { messages: ChatMessage[]; plan: FoldPlan } {
  const plan = asPlan(planFold(messages));
  return { plan, messages: insertCompaction(messages, plan, digest(plan, id)) };
}

describe('planFold', () => {
  it('refuses a conversation with fewer than 6 user/assistant messages', () => {
    expect(planFold(conversation(2))).toBe('too_short');
  });

  it('counts only user and assistant messages toward the minimum', () => {
    const padded: ChatMessage[] = [
      ...conversation(2),
      { id: 's1', role: 'system', content: 'note', timestamp: at },
      { id: 's2', role: 'system', content: 'note', timestamp: at },
    ];

    expect(countConversationMessages(padded)).toBe(4);
    expect(planFold(padded)).toBe('too_short');
  });

  it('refuses while a message is still streaming', () => {
    const streaming = [...conversation(4), { ...reply(5), isStreaming: true }];

    expect(planFold(streaming)).toBe('busy');
  });

  it('keeps the latest two user turns and folds everything before them', () => {
    const plan = asPlan(planFold(conversation(4)));

    expect(plan.segment.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(plan.coveredThroughMessageId).toBe('a2');
    expect(plan.coveredCount).toBe(4);
    expect(plan.previous).toBeNull();
  });

  it('refuses when the folded part would be empty (only two user turns)', () => {
    expect(planFold([...conversation(2), reply(9), reply(10), reply(11), reply(12)])).toBe('too_short');
  });

  it('merges rolling: the old digest becomes `previous`, only newer messages are summarised', () => {
    const first = fold(conversation(4), 'c1');
    const grown = [...first.messages, ...conversation(2, 5)];

    const plan = asPlan(planFold(grown));

    expect(plan.previous?.id).toBe('c1');
    expect(plan.segment.map(m => m.id)).toEqual(['u3', 'a3', 'u4', 'a4']);
    expect(plan.coveredCount).toBe(4 + 4);
    expect(plan.coveredThroughMessageId).toBe('a4');
  });

  it('has nothing to fold right after a compaction', () => {
    expect(planFold(fold(conversation(4), 'c1').messages)).toBe('too_short');
  });
});

describe('insertCompaction / removeCompaction', () => {
  it('places the digest right after the last folded message', () => {
    const { messages } = fold(conversation(4), 'c1');

    expect(messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'c1', 'u3', 'a3', 'u4', 'a4']);
  });

  it('records what it supersedes', () => {
    const first = fold(conversation(4), 'c1');
    const second = fold([...first.messages, ...conversation(2, 5)], 'c2');

    expect(findActiveCompaction(second.messages)?.id).toBe('c2');
    expect(findActiveCompaction(second.messages)?.metadata?.compaction?.supersedes).toBe('c1');
    expect(Array.from(supersededCompactionIds(second.messages))).toEqual(['c1']);
  });

  it('puts the newer digest after the older one so the last-wins barrier picks it', () => {
    const first = fold(conversation(4), 'c1');
    const second = fold([...first.messages, ...conversation(2, 5)], 'c2');

    const ids = second.messages.map(m => m.id);

    expect(ids.indexOf('c1')).toBeLessThan(ids.indexOf('c2'));
  });
});

describe('isFoldStillValid', () => {
  const base = conversation(4);

  it('accepts an unchanged conversation', () => {
    expect(isFoldStillValid(base, asPlan(planFold(base)))).toBe(true);
  });

  it('rejects when the covered message is gone (cleared or switched)', () => {
    const plan = asPlan(planFold(base));

    expect(isFoldStillValid(base.filter(m => m.id !== 'a2'), plan)).toBe(false);
  });

  it('rejects when any message streams, even outside the folded segment', () => {
    const plan = asPlan(planFold(base));

    expect(isFoldStillValid([...base, { ...user(5), isStreaming: true }], plan)).toBe(false);
  });

  it('rejects when a newer compaction appeared meanwhile', () => {
    const plan = asPlan(planFold(base));
    const other = fold(base, 'c-other').messages;

    expect(isFoldStillValid(other, plan)).toBe(false);
  });
});

describe('model view of compaction and undo (AC-C9)', () => {
  const view = (messages: ChatMessage[]) => JSON.stringify(convertToAgentMessages(messages));

  it('undoing a compaction restores exactly the pre-compaction model view', () => {
    const before = [...conversation(4), user(9)];
    const after = fold(before, 'c1').messages;

    expect(view(after)).not.toBe(view(before));
    expect(view(removeCompaction(after, 'c1'))).toBe(view(before));
  });

  it('undoing a rolling merge restores the previous digest, not the original conversation', () => {
    const first = fold(conversation(4), 'c1');
    const grown = [...first.messages, ...conversation(2, 5)];
    const second = fold(grown, 'c2');

    expect(view(removeCompaction(second.messages, 'c2'))).toBe(view(grown));
    expect(findActiveCompaction(removeCompaction(second.messages, 'c2'))?.id).toBe('c1');
  });

  it('hides the folded messages from the model but keeps them in the array', () => {
    const after = fold(conversation(4), 'c1').messages;

    expect(view(after)).not.toContain('question 1');
    expect(view(after)).toContain('question 3');
    expect(after.map(m => m.id)).toContain('u1');
  });
});

describe('persistence round trip (AC-C11)', () => {
  /** Mirrors `rehydrateConversations` in VideoEditorContainer: Dates come back as ISO strings. */
  function roundTrip(messages: ChatMessage[]): ChatMessage[] {
    const content = { conversations: [{ id: 'c', title: 't', messages, createdAt: at, updatedAt: at }] };
    const saved = JSON.stringify(normaliseProjectDataForSave(content as unknown as VideoEditingTaskContent));
    const parsed = JSON.parse(saved) as { conversations: Array<{ messages: ChatMessage[] }> };
    return parsed.conversations[0].messages.map(m => ({ ...m, timestamp: new Date(m.timestamp) }));
  }

  it('keeps the digest, its metadata and the barrier semantics', () => {
    const second = fold([...fold(conversation(4), 'c1').messages, ...conversation(2, 5)], 'c2').messages;

    const restored = roundTrip(second);

    expect(restored.filter(isCompactionMessage).map(m => m.id)).toEqual(['c1', 'c2']);
    expect(findActiveCompaction(restored)?.metadata?.compaction).toMatchObject({
      summaryText: 'digest', supersedes: 'c1', coveredCount: 8, coveredThroughMessageId: 'a4',
    });
    expect(JSON.stringify(convertToAgentMessages(restored)))
      .toBe(JSON.stringify(convertToAgentMessages(second)));
  });
});

describe('helpers', () => {
  it('savedPercent is clamped and safe on an empty segment', () => {
    expect(savedPercent(1000, 250)).toBe(75);
    expect(savedPercent(100, 400)).toBe(0);
    expect(savedPercent(0, 0)).toBe(0);
  });

  it('withoutCompaction drops digests and nothing else', () => {
    const { messages } = fold(conversation(4), 'c1');

    expect(withoutCompaction(messages).map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3', 'u4', 'a4']);
  });
});
