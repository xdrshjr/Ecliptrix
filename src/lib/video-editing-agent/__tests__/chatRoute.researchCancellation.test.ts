// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  contextWindow: vi.fn(), createAgent: vi.fn(), thinking: vi.fn(), close: vi.fn(),
}));
vi.mock('@/lib/server/researchRunClient', () => ({
  ResearchRunClient: class { close = mocks.close; },
  researchSnapshot: mocks.contextWindow,
}));
vi.mock('@/lib/video-editing-agent/agent', () => ({
  createVideoEditingAgent: mocks.createAgent, formatErrorDetail: String, subscribeAgentEvents: vi.fn(),
}));
vi.mock('@/lib/llm/streamLlmChat', () => ({
  normalizeApiType: () => 'openai', streamLlmChat: mocks.thinking,
}));
import { POST } from '@/app/api/video-editing-agent/chat/route';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('ends cancellation during capabilities loading without starting a paid model call', async () => {
  mocks.contextWindow.mockReturnValue(new Promise(() => {}));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true,
    api_key: 'fake', api_url: 'https://example.com', model_name: 'test' })));
  const stop = new AbortController();
  const response = await POST(new NextRequest('http://localhost:3000/api/video-editing-agent/chat', {
    method: 'POST', signal: stop.signal,
    body: JSON.stringify({ messages: [{ role: 'user', content: 'research', timestamp: 1 }] }),
  }));
  stop.abort();
  const events = await response.text();
  expect(events).toContain('cancelled');
  expect(events).toContain('[DONE]');
  expect(mocks.thinking).not.toHaveBeenCalled();
  expect(mocks.createAgent).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledOnce();
});
