import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNarrationDirectScript } from '../useNarrationDirectScript';
import type { ScriptSegment } from '@/types';

// ── SSE mock helpers (mirror useStoryboardChat.test.ts) ──────────────────────
type SSEChunk = { content?: string; reasoning?: string };

function makeSSEBody(chunks: SSEChunk[]) {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  for (const c of chunks) lines.push(`data: ${JSON.stringify(c)}\n\n`);
  lines.push('data: [DONE]\n\n');
  const stream = new ReadableStream({
    start(controller) {
      for (const l of lines) controller.enqueue(encoder.encode(l));
      controller.close();
    },
  });
  return stream;
}

function mockChatFetch(chunks: SSEChunk[]) {
  const body = makeSSEBody(chunks);
  const resp = new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  Object.defineProperty(resp, 'body', { value: body });
  return vi.fn(async () => resp);
}

/**
 * A hand-driven SSE stream: the test pushes chunks one at a time so it can sample
 * intermediate state (e.g. the left draft mid-stream) before the stream completes.
 */
function makeControllableChatFetch() {
  const encoder = new TextEncoder();
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
    },
  });
  const resp = new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  Object.defineProperty(resp, 'body', { value: stream });
  return {
    fetch: vi.fn(async () => resp),
    push(chunk: SSEChunk) {
      ctrl!.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
    },
    done() {
      ctrl!.enqueue(encoder.encode('data: [DONE]\n\n'));
      ctrl!.close();
    },
  };
}

/** Yield to the microtask + macrotask queues so the streaming reader loop can advance. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function makeOptions(onComplete = vi.fn()) {
  return {
    locale: 'zh' as const,
    onComplete,
    defaultSegmentTitle: '解说段落',
  };
}

describe('useNarrationDirectScript', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('open() initializes step=compose with an empty draft by default', () => {
    const { result } = renderHook(() => useNarrationDirectScript(makeOptions()));
    act(() => {
      result.current.open();
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.step).toBe('compose');
    expect(result.current.draftText).toBe('');
    expect(result.current.splitSentences).toHaveLength(0);
  });

  it('sendChatMessage() streams a rewrite and writes the full text back to the draft', async () => {
    globalThis.fetch = mockChatFetch([
      { content: '这是改写后的' },
      { content: '完整解说文案。' },
    ]) as any;
    const { result } = renderHook(() => useNarrationDirectScript(makeOptions()));
    act(() => {
      result.current.open();
    });
    await act(async () => {
      await result.current.sendChatMessage('更口语化一些');
    });
    expect(result.current.draftText).toBe('这是改写后的完整解说文案。');
    expect(result.current.isStreaming).toBe(false);
    // The user's request shows in the chat transcript.
    expect(result.current.chatMessages.some((m) => m.role === 'user' && m.content === '更口语化一些')).toBe(true);
  });

  // E1 回归护栏：必须断言「流中途」左侧就已出现部分文案（而非只在流末一次性回写）。
  // 若删掉 useNarrationChat 的增量回调 `if (chunk) onStreamDraft?.(accumulated)`，
  // 流中途 draftText 仍为空 → 本用例的中途断言失败，从而锁死「左侧实时流式」行为。
  it('sendChatMessage() updates the left draft mid-stream, not only at stream end', async () => {
    const sse = makeControllableChatFetch();
    globalThis.fetch = sse.fetch as any;
    const { result } = renderHook(() => useNarrationDirectScript(makeOptions()));
    act(() => {
      result.current.open();
    });

    let sendPromise!: Promise<void>;
    // 仅推送第一块正文,先不结束流,让 reader 处理后取样。
    await act(async () => {
      sendPromise = result.current.sendChatMessage('写一段解说');
      sse.push({ content: '第一段。' });
      await flush();
    });

    // 中途取样:左侧应只含已累计的第一块(部分文案),且仍处于流式中。
    expect(result.current.draftText).toBe('第一段。');
    expect(result.current.isStreaming).toBe(true);

    // 推送剩余正文并结束流。
    await act(async () => {
      sse.push({ content: '第二段。' });
      sse.done();
      await sendPromise;
    });

    expect(result.current.draftText).toBe('第一段。第二段。');
    expect(result.current.isStreaming).toBe(false);
  });

  // R-B/E2 回归护栏:模型只产 reasoning、无正文 content 时,左侧全程为空(reasoning 绝不进 draft),
  // 且流末摘要给出明确空守卫文案,而非误导性的「正在改写文案…」。
  it('reasoning-only stream keeps the draft empty and shows the empty-content guard summary', async () => {
    globalThis.fetch = mockChatFetch([
      { reasoning: '思考A' },
      { reasoning: '思考B' },
    ]) as any;
    const { result } = renderHook(() => useNarrationDirectScript(makeOptions()));
    act(() => {
      result.current.open();
    });
    await act(async () => {
      await result.current.sendChatMessage('写一段解说');
    });

    // 左侧 draft 全程为空:reasoning 绝不混进解说正文。
    expect(result.current.draftText).toBe('');
    expect(result.current.isStreaming).toBe(false);

    const assistant = result.current.chatMessages.find((m) => m.role === 'assistant');
    // 流末摘要为新的内容空守卫,而非误导性的「正在改写文案…」。
    expect(assistant?.summaryText).toContain('仅返回思考内容');
    expect(assistant?.summaryText).not.toContain('正在改写');
    // reasoning 仍保留在右侧可折叠区。
    expect(assistant?.reasoningContent).toBe('思考A思考B');
  });

  it('goToSplitStep() with a valid AI split moves to step=split with sentences', async () => {
    // AI returns a split whose joined text matches the draft (passes consistency check).
    globalThis.fetch = mockChatFetch([
      { content: '{"sentences":["第一句。","第二句。"]}' },
    ]) as any;

    const { result } = renderHook(() => useNarrationDirectScript(makeOptions()));
    act(() => {
      result.current.open('第一句。第二句。');
    });
    await act(async () => {
      await result.current.goToSplitStep();
    });

    expect(result.current.step).toBe('split');
    expect(result.current.splitSentences.map((s) => s.text)).toEqual(['第一句。', '第二句。']);
    expect(result.current.isSplitting).toBe(false);
  });

  it('falls back to local split when the AI request fails, without throwing', async () => {
    // 500 → fetchSplitCompletion throws → splitNarrationIntoSentences returns local split.
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as any;

    const { result } = renderHook(() => useNarrationDirectScript(makeOptions()));
    act(() => {
      result.current.open('甲。乙。丙。');
    });
    await act(async () => {
      await result.current.goToSplitStep();
    });

    expect(result.current.step).toBe('split');
    expect(result.current.error).toBeNull();
    expect(result.current.splitSentences.map((s) => s.text)).toEqual(['甲。', '乙。', '丙。']);
  });

  it('does not advance when the draft is blank', async () => {
    globalThis.fetch = mockChatFetch([{ content: '{"sentences":["x"]}' }]) as any;
    const { result } = renderHook(() => useNarrationDirectScript(makeOptions()));
    act(() => {
      result.current.open('   ');
    });
    await act(async () => {
      await result.current.goToSplitStep();
    });
    expect(result.current.step).toBe('compose');
    expect(result.current.splitSentences).toHaveLength(0);
  });

  it('complete(\'append\') emits one ScriptSegment per sentence and appends them in a single onComplete call', async () => {
    const onComplete = vi.fn();
    globalThis.fetch = mockChatFetch([
      { content: '{"sentences":["第一句。","第二句。"]}' },
    ]) as any;

    const { result } = renderHook(() => useNarrationDirectScript(makeOptions(onComplete)));
    act(() => {
      result.current.open('第一句。第二句。');
    });
    await act(async () => {
      await result.current.goToSplitStep();
    });
    act(() => {
      result.current.complete('append');
    });

    // 逐句导出：N 句 → N 个 segment，一次性批量上抛（B1，规避逐次单写丢句）。
    expect(onComplete).toHaveBeenCalledTimes(1);
    const segments = onComplete.mock.calls[0][0] as ScriptSegment[];
    expect(segments).toHaveLength(2);
    // mode 沿 complete → onComplete 透传，父级据此判定追加/替换。
    expect(onComplete.mock.calls[0][1]).toBe('append');
    // 每段仅含 1 句，narrationText 即该句本身（不再拼接）。
    expect(segments.map((seg) => seg.narrationText)).toEqual(['第一句。', '第二句。']);
    expect(segments.every((seg) => seg.sentences.length === 1)).toBe(true);
    expect(segments.flatMap((seg) => seg.sentences).map((s) => s.text)).toEqual(['第一句。', '第二句。']);
    expect(segments.every((seg) => seg.sentences.every((s) => s.narration === s.text))).toBe(true);
    // 多句时标题补 1 基序号，便于面板逐句对应。
    expect(segments.map((seg) => seg.title)).toEqual(['解说段落 1', '解说段落 2']);
    // complete() closes and resets.
    expect(result.current.isOpen).toBe(false);
  });

  it('complete(\'replace\') forwards the replace mode as the second onComplete argument', async () => {
    const onComplete = vi.fn();
    globalThis.fetch = mockChatFetch([
      { content: '{"sentences":["第一句。","第二句。"]}' },
    ]) as any;

    const { result } = renderHook(() => useNarrationDirectScript(makeOptions(onComplete)));
    act(() => {
      result.current.open('第一句。第二句。');
    });
    await act(async () => {
      await result.current.goToSplitStep();
    });
    act(() => {
      result.current.complete('replace');
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    const segments = onComplete.mock.calls[0][0] as ScriptSegment[];
    expect(segments).toHaveLength(2);
    // 「替换」意图沿 complete('replace') 透传为第二参。
    expect(onComplete.mock.calls[0][1]).toBe('replace');
    expect(result.current.isOpen).toBe(false);
  });

  it('keeps the title un-numbered when only a single sentence is exported', async () => {
    const onComplete = vi.fn();
    globalThis.fetch = mockChatFetch([{ content: '{"sentences":["甲。"]}' }]) as any;
    const { result } = renderHook(() => useNarrationDirectScript(makeOptions(onComplete)));
    act(() => {
      result.current.open('甲。');
    });
    await act(async () => {
      await result.current.goToSplitStep();
    });
    act(() => {
      result.current.complete('append');
    });
    const segments = onComplete.mock.calls[0][0] as ScriptSegment[];
    expect(segments).toHaveLength(1);
    expect(segments[0].title).toBe('解说段落');
    expect(segments[0].narrationText).toBe('甲。');
  });

  it('does not merge sentences — each English sentence stays its own segment', async () => {
    const onComplete = vi.fn();
    globalThis.fetch = mockChatFetch([{ content: '{"sentences":["A.","B."]}' }]) as any;
    const { result } = renderHook(() =>
      useNarrationDirectScript({ ...makeOptions(onComplete), locale: 'en' }),
    );
    act(() => {
      result.current.open('A.B.');
    });
    await act(async () => {
      await result.current.goToSplitStep();
    });
    act(() => {
      result.current.complete('append');
    });
    const segments = onComplete.mock.calls[0][0] as ScriptSegment[];
    // 取代旧 joinNarration(R9) 拼接行为：每句独立成段，不再合并成 "A. B."。
    expect(segments.map((seg) => seg.narrationText)).toEqual(['A.', 'B.']);
  });

  it('close() resets all state', async () => {
    globalThis.fetch = mockChatFetch([{ content: '{"sentences":["甲。"]}' }]) as any;
    const { result } = renderHook(() => useNarrationDirectScript(makeOptions()));
    act(() => {
      result.current.open('甲。');
    });
    await act(async () => {
      await result.current.goToSplitStep();
    });
    act(() => {
      result.current.close();
    });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.step).toBe('compose');
    expect(result.current.draftText).toBe('');
    expect(result.current.splitSentences).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it('updateSplitSentences() replaces the working sentence list', async () => {
    globalThis.fetch = mockChatFetch([{ content: '{"sentences":["甲。","乙。"]}' }]) as any;
    const { result } = renderHook(() => useNarrationDirectScript(makeOptions()));
    act(() => {
      result.current.open('甲。乙。');
    });
    await act(async () => {
      await result.current.goToSplitStep();
    });
    act(() => {
      result.current.updateSplitSentences([{ id: 'x', text: '改后。' }]);
    });
    expect(result.current.splitSentences).toEqual([{ id: 'x', text: '改后。' }]);
  });
});
