import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { completeSimple } = vi.hoisted(() => ({ completeSimple: vi.fn() }));
vi.mock('@mariozechner/pi-ai', async importOriginal => ({
  ...(await importOriginal<typeof import('@mariozechner/pi-ai')>()),
  completeSimple,
}));

import { POST } from '../route';
import { summaryJson } from '@/lib/video-editing-agent/memory/__tests__/fixtures';

const ORIGIN = 'http://localhost:3000';
const URL_ = 'http://localhost:3000/api/video-editing-agent/compact';

const message = (id: string, role: 'user' | 'assistant', content: string) => ({
  id, role, content, timestamp: '2026-10-27T00:00:00.000Z',
});
const validBody = {
  messages: [message('m1', 'user', '做一条城市宣传片'), message('m2', 'assistant', '好的')],
  locale: 'zh',
};

function request(body: unknown, headers: Record<string, string> = {}, raw?: string) {
  return new NextRequest(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: raw ?? JSON.stringify(body),
  });
}

function assistantReply(text: string) {
  return { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' };
}

/** Backend stub: `fast` and `chat` resolve responses, keyed by function type. */
function stubBackend(tiers: { fast?: boolean; chat?: boolean }) {
  const resolved = (name: string) => new Response(JSON.stringify({
    success: true, api_key: 'sk-test', api_url: 'https://llm.test/v1',
    model_name: name, provider_type: 'openai', api_type: 'openai',
  }), { status: 200 });
  const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/resolve/fast') && tiers.fast) return resolved('fast-model');
    if (url.includes('/resolve/chat') && tiers.chat) return resolved('chat-model');
    return new Response(JSON.stringify({ success: false }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchStub);
  return fetchStub;
}

describe('POST /api/video-editing-agent/compact', () => {
  beforeEach(() => {
    completeSimple.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  describe('AC-C5 / AC-C13 guards', () => {
    it('answers 415 BEFORE the origin check when Content-Type is missing', async () => {
      const response = await POST(request(validBody, { 'content-type': 'text/plain', origin: 'http://evil.test' }));
      expect(response.status).toBe(415);
      expect((await response.json()).error_code).toBe('json_required');
    });

    it('answers 415, not 403, when both Content-Type and Origin are absent', async () => {
      const bare = new NextRequest(URL_, { method: 'POST', body: JSON.stringify(validBody) });
      expect((await POST(bare)).status).toBe(415);
    });

    it('answers 403 for a JSON request without an Origin header', async () => {
      const noOrigin = new NextRequest(URL_, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validBody),
      });
      expect((await POST(noOrigin)).status).toBe(403);
    });

    it.each([
      ['foreign origin', { origin: 'http://evil.test' }],
      ['cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
    ])('answers 403 for %s', async (_label, headers) => {
      expect((await POST(request(validBody, headers))).status).toBe(403);
    });

    it('answers 413 for a body over 400 KiB', async () => {
      const huge = { messages: [message('m1', 'user', 'x'.repeat(401 * 1024))] };
      expect((await POST(request(huge))).status).toBe(413);
    });

    it.each([
      ['malformed JSON', undefined, '{not json'],
      ['a missing messages field', {}, undefined],
      ['messages that is not an array', { messages: 'hi' }, undefined],
      ['an empty messages array', { messages: [] }, undefined],
      ['more than 400 messages', { messages: Array.from({ length: 401 }, (_, i) => message(`m${i}`, 'user', 'x')) }, undefined],
      ['a message without content', { messages: [{ id: 'm1', role: 'user' }] }, undefined],
      ['an unknown role', { messages: [{ id: 'm1', role: 'tool', content: 'x' }] }, undefined],
      ['a non-string previousSummary', { ...validBody, previousSummary: 5 }, undefined],
    ])('answers 400 for %s', async (_label, body, raw) => {
      expect((await POST(request(body, {}, raw))).status).toBe(400);
    });

    it('does not touch the backend or the model when a guard rejects', async () => {
      const fetchStub = stubBackend({ fast: true });
      await POST(request(validBody, { origin: 'http://evil.test' }));
      expect(fetchStub).not.toHaveBeenCalled();
      expect(completeSimple).not.toHaveBeenCalled();
    });
  });

  describe('summarization', () => {
    it('returns the digest from the fast tier', async () => {
      stubBackend({ fast: true, chat: true });
      completeSimple.mockResolvedValue(assistantReply(summaryJson()));
      const response = await POST(request(validBody));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ success: true, modelTier: 'fast', droppedIds: 0 });
      expect(body.text).toContain('做一条 6 个分镜的城市宣传片');
      expect(completeSimple.mock.calls[0][0].id).toBe('fast-model');
      expect(completeSimple.mock.calls[0][2]).toMatchObject({
        apiKey: 'sk-test', maxTokens: 1800, temperature: 0.2 });
    });

    it('falls back to the chat model when no fast model resolves', async () => {
      stubBackend({ chat: true });
      completeSimple.mockResolvedValue(assistantReply(summaryJson()));
      const body = await (await POST(request(validBody))).json();
      expect(body).toMatchObject({ success: true, modelTier: 'main' });
      expect(completeSimple.mock.calls[0][0].id).toBe('chat-model');
    });

    it('reports a model 401 as HTTP 200 compact_model_unavailable', async () => {
      stubBackend({ fast: true });
      completeSimple.mockResolvedValue({
        role: 'assistant', content: [], stopReason: 'error',
        errorMessage: '401 invalid_api_key' });
      const response = await POST(request(validBody));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: false, error_code: 'compact_model_unavailable' });
    });

    it('reports an unusable reply as HTTP 200 compact_invalid_summary', async () => {
      stubBackend({ fast: true });
      completeSimple.mockResolvedValue(assistantReply('{"goal":"a","goal":"b"}'));
      const response = await POST(request(validBody));
      expect(response.status).toBe(200);
      expect((await response.json()).error_code).toBe('compact_invalid_summary');
    });

    it('reports no configured model as compact_model_unavailable', async () => {
      stubBackend({});
      vi.stubEnv('LLM_API_KEY', '');
      vi.stubEnv('OPENAI_API_KEY', '');
      const body = await (await POST(request(validBody))).json();
      expect(body).toEqual({ success: false, error_code: 'compact_model_unavailable' });
      expect(completeSimple).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });

    it('never logs conversation text', async () => {
      stubBackend({ fast: true });
      completeSimple.mockResolvedValue(assistantReply(summaryJson()));
      const spies = (['log', 'warn', 'error', 'info'] as const)
        .map(method => vi.spyOn(console, method).mockImplementation(() => undefined));
      await POST(request(validBody));
      const printed = spies.flatMap(spy => spy.mock.calls).flat().join(' ');
      expect(printed).not.toContain('做一条城市宣传片');
    });
  });
});
