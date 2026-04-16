import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { parseShots, useStoryboardChat } from '../useStoryboardChat';

describe('parseShots', () => {
  it('parses a clean JSON object', () => {
    const text = JSON.stringify({
      shots: [
        { index: 1, script: 'a', visual_prompt: 'b' },
        { index: 2, script: 'c', visual_prompt: 'd' },
      ],
    });
    const r = parseShots(text);
    expect(r.parseError).toBeUndefined();
    expect(r.shots).toHaveLength(2);
    expect(r.shots[0].script).toBe('a');
    expect(r.shots[0].visualPrompt).toBe('b');
    expect(r.shots[0].shotId).toBeTruthy();
  });

  it('strips a fenced code block', () => {
    const text =
      '```json\n{"shots":[{"index":1,"script":"x","visual_prompt":"y"}]}\n```';
    const r = parseShots(text);
    expect(r.parseError).toBeUndefined();
    expect(r.shots).toHaveLength(1);
    expect(r.shots[0].script).toBe('x');
  });

  it('extracts JSON between {...} when surrounded by prose', () => {
    const text =
      '好的，下面是分镜：\n{"shots":[{"index":1,"script":"开场","visual_prompt":"日出"}]}\n（结束）';
    const r = parseShots(text);
    expect(r.parseError).toBeUndefined();
    expect(r.shots[0].script).toBe('开场');
  });

  it('returns parseError for malformed JSON', () => {
    const r = parseShots('not json at all');
    expect(r.shots).toHaveLength(0);
    expect(r.parseError).toBeDefined();
  });

  it('handles truncated JSON gracefully', () => {
    const r = parseShots('{"shots":[{"index":1,"script":"x"');
    expect(r.shots).toHaveLength(0);
    expect(r.parseError).toBeDefined();
  });

  it('accepts camelCase visualPrompt as fallback', () => {
    const text = JSON.stringify({
      shots: [{ index: 1, script: 'a', visualPrompt: 'b' }],
    });
    const r = parseShots(text);
    expect(r.shots[0].visualPrompt).toBe('b');
  });
});

// ── Hook-level streaming tests (reasoning + summary replacement) ─────────────
function makeSSEBody(chunks: Array<{ content?: string; reasoning?: string }>) {
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

function mockFetch(chunks: Array<{ content?: string; reasoning?: string }>) {
  const body = makeSSEBody(chunks);
  const resp = new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  // ensure .body is the stream we built
  Object.defineProperty(resp, 'body', { value: body });
  return vi.fn(async () => resp);
}

describe('useStoryboardChat streaming', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const validJson = JSON.stringify({
    shots: [{ index: 1, script: 's1', visual_prompt: 'v1' }],
  });

  it('accumulates content-only stream and replaces content with summary', async () => {
    globalThis.fetch = mockFetch([
      { content: validJson.slice(0, 10) },
      { content: validJson.slice(10) },
    ]) as any;
    const { result } = renderHook(() => useStoryboardChat({ locale: 'en' }));
    await act(async () => {
      const parsed = await result.current.sendMessage('make 1 shot');
      expect(parsed?.shots).toHaveLength(1);
    });
    const assistant = result.current.messages.find((m) => m.role === 'assistant')!;
    expect(assistant.reasoningContent ?? '').toBe('');
    expect(assistant.summaryText).toMatch(/Generated 1 shot/);
    // raw JSON must NOT be the displayed content anymore
    expect(assistant.content).not.toContain('"shots"');
  });

  it('handles reasoning-only stream (no content) → parse error summary, reasoning preserved', async () => {
    globalThis.fetch = mockFetch([
      { reasoning: 'thinking step A' },
      { reasoning: ' step B' },
    ]) as any;
    const { result } = renderHook(() => useStoryboardChat({ locale: 'en' }));
    await act(async () => {
      await result.current.sendMessage('hi');
    });
    const assistant = result.current.messages.find((m) => m.role === 'assistant')!;
    expect(assistant.reasoningContent).toBe('thinking step A step B');
    expect(assistant.parseError).toBeDefined();
  });

  it('handles interleaved reasoning + content chunks', async () => {
    globalThis.fetch = mockFetch([
      { reasoning: 'plan: ' },
      { content: validJson.slice(0, 5) },
      { reasoning: 'ok' },
      { content: validJson.slice(5) },
    ]) as any;
    const { result } = renderHook(() => useStoryboardChat({ locale: 'en' }));
    await act(async () => {
      const parsed = await result.current.sendMessage('do it');
      expect(parsed?.shots).toHaveLength(1);
    });
    const assistant = result.current.messages.find((m) => m.role === 'assistant')!;
    expect(assistant.reasoningContent).toBe('plan: ok');
    expect(assistant.summaryText).toBeDefined();
    expect(assistant.content).not.toContain('"shots"');
    expect(assistant.content).not.toContain('visual_prompt');
  });

  it('falls back to parse-error summary when JSON malformed', async () => {
    globalThis.fetch = mockFetch([{ content: 'not json at all' }]) as any;
    const { result } = renderHook(() => useStoryboardChat({ locale: 'en' }));
    await act(async () => {
      await result.current.sendMessage('x');
    });
    const assistant = result.current.messages.find((m) => m.role === 'assistant')!;
    expect(assistant.parseError).toBeDefined();
    expect(assistant.summaryText).toMatch(/Incomplete|not parseable/i);
  });
});
