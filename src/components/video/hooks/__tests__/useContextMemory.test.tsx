import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { ChatMessage } from '@/types';
import type { CompactionOutcome } from '@/lib/api/agentCompact';
import { useContextMemory, type UseContextMemoryParams } from '../useContextMemory';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  capabilities: vi.fn(),
  update: vi.fn(),
  estimate: { value: 100 },
}));

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));
vi.mock('@/lib/api/agentCompact', () => ({ requestConversationCompaction: mocks.request }));
vi.mock('@/lib/api/agentToolkit', () => ({ fetchAgentToolkitCapabilities: mocks.capabilities }));
vi.mock('@/lib/api/systemSettings', () => ({ updateCategorySettings: mocks.update }));
vi.mock('@/lib/video-editing-agent/memory/estimateTokens', () => ({
  estimateConversationTokens: () => mocks.estimate.value,
}));

const at = new Date('2026-10-27T00:00:00Z');
const turns = (count: number): ChatMessage[] => Array.from({ length: count }, (_, i) => [
  { id: `u${i + 1}`, role: 'user' as const, content: `q${i + 1}`, timestamp: at },
  { id: `a${i + 1}`, role: 'assistant' as const, content: `r${i + 1}`, timestamp: at },
]).flat();

const SUCCESS: CompactionOutcome = {
  success: true, summary: {} as never, text: '## Goal\nvertical video', tokensBefore: 4000,
  tokensAfter: 800, droppedIds: 0, modelTier: 'fast',
};
/** Ratio of 0.9 against the default 128k window; 100 tokens is ~0. */
const HIGH = 110_000;

function setup(patch: Partial<UseContextMemoryParams> = {}) {
  const writeMessages = vi.fn();
  const initial: UseContextMemoryParams = {
    conversationId: 'conv-1', messages: turns(4), writeMessages, liveUsage: null,
    agentIsExecuting: false, executionStatus: 'idle', hasPendingSteers: false, ...patch,
  };
  const view = renderHook((props: UseContextMemoryParams) => useContextMemory(props),
    { initialProps: initial });
  return { ...view, writeMessages, initial };
}

/** Run a turn to its end: executing, then idle with `status`. */
function endTurn(
  view: ReturnType<typeof setup>, status: UseContextMemoryParams['executionStatus'],
  patch: Partial<UseContextMemoryParams> = {},
) {
  view.rerender({ ...view.initial, agentIsExecuting: true, executionStatus: 'executing', ...patch });
  view.rerender({ ...view.initial, agentIsExecuting: false, executionStatus: status, ...patch });
}

beforeEach(() => {
  mocks.request.mockReset().mockResolvedValue(SUCCESS);
  mocks.capabilities.mockReset().mockResolvedValue({
    memory_compaction: { auto_compact: true, auto_compact_ratio: 0.75 },
  });
  mocks.update.mockReset().mockResolvedValue({ success: true });
  mocks.estimate.value = 100;
});

describe('useContextMemory — reading', () => {
  it('shows the local estimate against default limits between turns', () => {
    mocks.estimate.value = 60_928;

    const { result } = setup();

    expect(result.current.percent).toBe(50);
    expect(result.current.level).toBe('ok');
  });

  it('prefers the live server reading while a turn runs', () => {
    const live = { usedTokens: 100_000, windowTokens: 128_000, maxOutputTokens: 4096, dropped: false };

    const { result } = setup({ agentIsExecuting: true, executionStatus: 'executing', liveUsage: live });

    expect(result.current.reading.usedTokens).toBe(100_000);
    expect(result.current.level).toBe('warn');
  });

  it('flags a dropped request', () => {
    const live = { usedTokens: 100, windowTokens: 128_000, maxOutputTokens: 4096, dropped: true };

    expect(setup({ liveUsage: live }).result.current.level).toBe('dropped');
  });
});

describe('useContextMemory — a stale server reading', () => {
  const live = { usedTokens: 100_000, windowTokens: 128_000, maxOutputTokens: 4096, dropped: false };

  it('is ignored once the chat is cleared', () => {
    const view = setup({ liveUsage: live });
    expect(view.result.current.reading.usedTokens).toBe(100_000);

    view.rerender({ ...view.initial, messages: [] });

    expect(view.result.current.reading.usedTokens).toBe(100);
  });

  it('is not carried over to another conversation', () => {
    const view = setup({ liveUsage: live });

    view.rerender({ ...view.initial, conversationId: 'conv-2' });

    expect(view.result.current.reading.usedTokens).toBe(100);
  });

  it('is replaced by the next reading even in the same conversation', () => {
    const view = setup({ liveUsage: live });

    view.rerender({ ...view.initial, liveUsage: { ...live, usedTokens: 50_000 } });

    expect(view.result.current.reading.usedTokens).toBe(50_000);
  });
});

describe('useContextMemory — auto compaction (AC-C8)', () => {
  it('compacts once the turn completed, over the threshold, with auto on and nothing queued', async () => {
    mocks.estimate.value = HIGH;
    const view = setup();

    endTurn(view, 'completed');

    await waitFor(() => expect(view.writeMessages).toHaveBeenCalledTimes(1));
    const [conversationId, written] = view.writeMessages.mock.calls[0] as [string, ChatMessage[]];
    expect(conversationId).toBe('conv-1');
    expect(written.map(m => m.id).slice(0, 5)).toEqual(['u1', 'a1', 'u2', 'a2', expect.stringMatching(/^compaction-/)]);
    expect(written[4]).toMatchObject({
      role: 'system', metadata: { type: 'compaction', compaction: { auto: true, summaryText: SUCCESS.success && SUCCESS.text } },
    });
  });

  it.each([
    ['the ratio is under the threshold', 'completed', { estimate: 1000 }, undefined],
    ['the turn was stopped', 'cancelled', { estimate: HIGH }, undefined],
    ['the turn errored', 'error', { estimate: HIGH }, undefined],
    ['steers or follow-ups are waiting', 'completed', { estimate: HIGH }, { hasPendingSteers: true }],
  ] as const)('does not compact when %s', async (_name, status, { estimate }, patch) => {
    mocks.estimate.value = estimate;
    const view = setup();

    endTurn(view, status, patch);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

    expect(mocks.request).not.toHaveBeenCalled();
    expect(view.writeMessages).not.toHaveBeenCalled();
  });

  it('does not compact when auto_compact is off', async () => {
    mocks.estimate.value = HIGH;
    mocks.capabilities.mockResolvedValue({ memory_compaction: { auto_compact: false, auto_compact_ratio: 0.75 } });
    const view = setup();

    endTurn(view, 'completed');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('honours a lower configured threshold', async () => {
    mocks.estimate.value = 80_000; // ratio ~0.66
    mocks.capabilities.mockResolvedValue({ memory_compaction: { auto_compact: true, auto_compact_ratio: 0.6 } });
    const view = setup();

    endTurn(view, 'completed');

    await waitFor(() => expect(view.writeMessages).toHaveBeenCalledTimes(1));
  });

  it('falls back to the defaults when the capabilities call fails', async () => {
    mocks.estimate.value = HIGH;
    mocks.capabilities.mockRejectedValue(new Error('offline'));
    const view = setup();

    endTurn(view, 'completed');

    await waitFor(() => expect(view.writeMessages).toHaveBeenCalledTimes(1));
  });
});

describe('useContextMemory — manual compaction', () => {
  it('reports too_short without calling the model', async () => {
    const view = setup({ messages: turns(2) });

    await expect(view.result.current.compactNow()).resolves.toBe('too_short');

    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('refuses while the agent runs', async () => {
    const view = setup({ agentIsExecuting: true, executionStatus: 'executing' });

    await expect(view.result.current.compactNow()).resolves.toBe('busy');
    expect(view.result.current.canCompact).toBe(false);
  });

  it('sends the folded segment and the previous digest, not the kept tail', async () => {
    const view = setup();

    await act(async () => { await view.result.current.compactNow(); });

    const request = mocks.request.mock.calls[0][0] as { messages: ChatMessage[]; locale: string };
    expect(request.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(request.locale).toBe('en');
  });

  it('allows only one compaction in flight', async () => {
    let release!: (outcome: CompactionOutcome) => void;
    mocks.request.mockReturnValue(new Promise<CompactionOutcome>(resolve => { release = resolve; }));
    const view = setup();

    let first!: Promise<string>;
    act(() => { first = view.result.current.compactNow(); });
    const second = await view.result.current.compactNow();
    await act(async () => { release(SUCCESS); await first; });

    expect(second).toBe('busy');
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(view.writeMessages).toHaveBeenCalledTimes(1);
  });

  it('shows the pending digest after the last folded message while it works', async () => {
    let release!: (outcome: CompactionOutcome) => void;
    mocks.request.mockReturnValue(new Promise<CompactionOutcome>(resolve => { release = resolve; }));
    const view = setup();

    let pending!: Promise<string>;
    act(() => { pending = view.result.current.compactNow(); });

    expect(view.result.current.isCompacting).toBe(true);
    expect(view.result.current.compactingAfterMessageId).toBe('a2');
    await act(async () => { release(SUCCESS); await pending; });
    expect(view.result.current.isCompacting).toBe(false);
  });
});

describe('useContextMemory — writes nothing when the world moved on', () => {
  async function compactWhile(mutate: (view: ReturnType<typeof setup>) => void) {
    let release!: (outcome: CompactionOutcome) => void;
    mocks.request.mockReturnValue(new Promise<CompactionOutcome>(resolve => { release = resolve; }));
    const view = setup();
    let pending!: Promise<string>;
    act(() => { pending = view.result.current.compactNow(); });
    act(() => mutate(view));
    let result = '';
    await act(async () => { release(SUCCESS); result = await pending; });
    return { view, result };
  }

  it('a message started streaming during the request', async () => {
    const { view, result } = await compactWhile(v => v.rerender({
      ...v.initial,
      messages: [...v.initial.messages, { id: 'u5', role: 'user', content: 'x', timestamp: at },
        { id: 'a5', role: 'assistant', content: '', timestamp: at, isStreaming: true }],
    }));

    expect(result).toBe('discarded');
    expect(view.writeMessages).not.toHaveBeenCalled();
  });

  it('the covered message disappeared (chat cleared)', async () => {
    const { view, result } = await compactWhile(v => v.rerender({ ...v.initial, messages: [] }));

    expect(result).toBe('discarded');
    expect(view.writeMessages).not.toHaveBeenCalled();
  });

  it('the conversation was switched', async () => {
    const { view, result } = await compactWhile(v => v.rerender({ ...v.initial, conversationId: 'conv-2' }));

    expect(result).toBe('discarded');
    expect(view.writeMessages).not.toHaveBeenCalled();
  });

  it.each([
    ['the model failed', { success: false, error_code: 'compact_timeout' } as CompactionOutcome],
    ['the request was refused', { success: false, error_code: 'compact_model_unavailable' } as CompactionOutcome],
  ])('%s', async (_name, outcome) => {
    mocks.request.mockResolvedValue(outcome);
    const view = setup();

    let result = '';
    await act(async () => { result = await view.result.current.compactNow(); });

    expect(result).toBe('failed');
    expect(view.writeMessages).not.toHaveBeenCalled();
    expect(view.result.current.isCompacting).toBe(false);
  });
});

describe('useContextMemory — undo', () => {
  const folded = (): ChatMessage[] => {
    const messages = turns(4);
    const digest: ChatMessage = {
      id: 'c1', role: 'system', content: 'folded', timestamp: at,
      metadata: { type: 'compaction', compaction: {
        summaryText: 's', coveredThroughMessageId: 'a2', coveredCount: 4, tokensBefore: 10,
        tokensAfter: 5, auto: false, createdAt: at.toISOString(),
      } },
    };
    return [...messages.slice(0, 4), digest, ...messages.slice(4)];
  };

  it('removes the digest message and nothing else', () => {
    const messages = folded();
    const view = setup({ messages });

    let undone = false;
    act(() => { undone = view.result.current.undoCompaction('c1'); });

    expect(undone).toBe(true);
    expect(view.writeMessages).toHaveBeenCalledWith('conv-1', messages.filter(m => m.id !== 'c1'));
  });

  it('is refused while a turn runs, because the turn would overwrite the change', () => {
    const view = setup({ messages: folded(), agentIsExecuting: true, executionStatus: 'executing' });

    expect(view.result.current.undoCompaction('c1')).toBe(false);
    expect(view.writeMessages).not.toHaveBeenCalled();
  });

  it('ignores an unknown id', () => {
    const view = setup({ messages: folded() });

    expect(view.result.current.undoCompaction('missing')).toBe(false);
  });
});
