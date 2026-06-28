import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

// 单测：spec narration-direct-video-script-rewrite v2 §8.1。
// 覆盖：成功路径(videoScript ≠ narration) × OpenAI/Anthropic 两种传输；等价校验·重试
// （首轮回吐旁白 → 第二轮真画面 → 返回第二轮）；等价校验·失败（两轮都回吐 → 422
// IDENTICAL_OUTPUT）；未配置 → 503 LLM_NOT_CONFIGURED；上游 401 透传。
//
// 路由复用 api_type 感知的共享客户端 streamLlmChat，上游是 SSE 流，故 mock 必须按命中的 URL
// （/v1/messages → anthropic，否则 → openai）产出对应 SSE 帧。每次「LLM 调用」按调用序返回
// contents[i]，以模拟两轮不同输出。

interface CapturedRequest {
  url: string;
  body: { model: string; messages: Array<{ role: string; content: string }>; system?: string };
}

let captured: CapturedRequest[] = [];

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/narration-video-script', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function sseOpenAI(content: string): string {
  const chunk = JSON.stringify({ choices: [{ delta: { content } }] });
  return `data: ${chunk}\n\ndata: [DONE]\n\n`;
}

function sseAnthropic(content: string): string {
  const chunk = JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: content } });
  const stop = JSON.stringify({ type: 'message_stop' });
  return `data: ${chunk}\n\ndata: ${stop}\n\n`;
}

// resolve 强制回退到 env（单测不接 DB）；LLM 调用按序号返回 contents[i] 的 SSE。
// resolveStatus / resolveBody 用于「未配置」用例：resolve 返回 503 + MODEL_NOT_CONFIGURED。
function mockLLMSequence(
  contents: string[],
  opts: { upstreamStatus?: number; resolve?: { status: number; body: unknown } } = {},
) {
  let llmCall = 0;
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/api/model-settings/resolve/chat')) {
      const r = opts.resolve ?? { status: 200, body: { success: false } };
      return new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    captured.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')) });
    if (opts.upstreamStatus && opts.upstreamStatus !== 200) {
      return new Response('upstream error', { status: opts.upstreamStatus });
    }
    const content = contents[Math.min(llmCall, contents.length - 1)];
    llmCall += 1;
    const sse = u.includes('/v1/messages') ? sseAnthropic(content) : sseOpenAI(content);
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
}

describe('/api/narration-video-script POST', () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.LLM_API_KEY;
  const originalType = process.env.LLM_API_TYPE;
  const originalUrl = process.env.LLM_API_URL;

  beforeEach(() => {
    captured = [];
    process.env.LLM_API_KEY = 'test-key';
    delete process.env.LLM_API_TYPE;
    delete process.env.LLM_API_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    const restore = (name: 'LLM_API_KEY' | 'LLM_API_TYPE' | 'LLM_API_URL', value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('LLM_API_KEY', originalKey);
    restore('LLM_API_TYPE', originalType);
    restore('LLM_API_URL', originalUrl);
    vi.restoreAllMocks();
  });

  const NARRATION = '这家百年老店的招牌面，汤头醇厚，是几代人的回忆。';
  const VISUAL = '清晨的窄巷里，蒸汽从一口黑铁大锅升腾，老师傅俯身挑面，暖黄灯光打在木质招牌上，特写慢推。';

  it('success: returns videoScript distinct from the narration (OpenAI transport)', async () => {
    mockLLMSequence([VISUAL]);

    const res = await POST(makeRequest({ narration: NARRATION, locale: 'zh' }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.videoScript).toBe(VISUAL);
    expect(json.videoScript).not.toBe(NARRATION);
    // 只发生一次 LLM 调用（非退化，无需重试）。
    expect(captured.length).toBe(1);
    // openai 传输：system 仍在 messages 内、走 /chat/completions。
    expect(captured[0].url.endsWith('/chat/completions')).toBe(true);
    expect(captured[0].body.messages.some(m => m.role === 'system')).toBe(true);
  });

  it('success: works over the Anthropic transport (/v1/messages, no api_type regression)', async () => {
    process.env.LLM_API_TYPE = 'anthropic';
    process.env.LLM_API_URL = 'https://open.bigmodel.cn/api/anthropic';
    mockLLMSequence([VISUAL]);

    const res = await POST(makeRequest({ narration: NARRATION, locale: 'zh' }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.videoScript).toBe(VISUAL);
    // anthropic 传输：URL 以 /v1/messages 结尾，system 提到顶层（不在 messages 内）。
    expect(captured[0].url.endsWith('/v1/messages')).toBe(true);
    expect(typeof captured[0].body.system).toBe('string');
    expect(captured[0].body.messages.some(m => m.role === 'system')).toBe(false);
  });

  it('equivalence retry: round-1 echoes the narration, round-2 returns a real shot → returns round-2', async () => {
    mockLLMSequence([NARRATION, VISUAL]);

    const res = await POST(makeRequest({ narration: NARRATION, locale: 'zh' }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.videoScript).toBe(VISUAL);
    // 两次 LLM 调用：第二次带纠偏指令重试。
    expect(captured.length).toBe(2);
    const retryUser = captured[1].body.messages.filter(m => m.role === 'user').pop()!.content;
    expect(retryUser).toContain('画面');
  });

  it('equivalence failure: both rounds echo the narration → 422 IDENTICAL_OUTPUT', async () => {
    mockLLMSequence([NARRATION, NARRATION]);

    const res = await POST(makeRequest({ narration: NARRATION, locale: 'zh' }));

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.code).toBe('IDENTICAL_OUTPUT');
    expect(json.videoScript).toBe('');
    expect(captured.length).toBe(2);
  });

  it('not configured: resolve 503 + no env key → 503 LLM_NOT_CONFIGURED', async () => {
    delete process.env.LLM_API_KEY;
    mockLLMSequence([VISUAL], {
      resolve: { status: 503, body: { error_code: 'MODEL_NOT_CONFIGURED', message: 'configure the model' } },
    });

    const res = await POST(makeRequest({ narration: NARRATION }));

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.code).toBe('LLM_NOT_CONFIGURED');
    // 未进行任何 LLM 调用。
    expect(captured.length).toBe(0);
  });

  it('passes through an upstream 401', async () => {
    mockLLMSequence([''], { upstreamStatus: 401 });

    const res = await POST(makeRequest({ narration: NARRATION }));

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('rejects an empty narration with 400', async () => {
    mockLLMSequence([VISUAL]);

    const res = await POST(makeRequest({ narration: '   ' }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(captured.length).toBe(0);
  });
});
