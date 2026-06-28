import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

// 单测：spec narration-direct-ai-video-script-keywords v2 §8.1
// + diagnose search-keywords-llm-401-anthropic-format §6 方案A。
// 覆盖英文分支（评审 R-1 跨语言 / R-2 best-effort ≤3 / R-3 编号鲁棒性）、中文缺省防回归（R-4）、
// 上游错误状态码透传，以及 anthropic 形态走 /v1/messages 不再 401（本轮修复的核心）。
//
// 路由已迁移到 api_type 感知的共享客户端 streamLlmChat（与 /api/chat、generate_video_script 同款），
// 上游响应是 SSE 流，故 mock 必须按 api_type 产出对应的 SSE 帧，而非旧的非流式 OpenAI JSON。

interface CapturedRequest {
  url: string;
  body: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    system?: string;
  };
}

let captured: CapturedRequest | null;

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/script-keywords-generation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// OpenAI（dev/DashScope 默认）SSE：一帧 content + [DONE]。
function sseOpenAI(content: string): string {
  const chunk = JSON.stringify({ choices: [{ delta: { content } }] });
  return `data: ${chunk}\n\ndata: [DONE]\n\n`;
}

// Anthropic（桌面端默认，智谱 anthropic-compat）SSE：text_delta + message_stop。
function sseAnthropic(content: string): string {
  const chunk = JSON.stringify({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: content },
  });
  const stop = JSON.stringify({ type: 'message_stop' });
  return `data: ${chunk}\n\ndata: ${stop}\n\n`;
}

// mock 上游：先应答后端 resolve（这里强制回退到 env 配置，单测不接 DB），
// 再按命中的 URL（/v1/messages → anthropic，否则 → openai）产出对应 SSE，并捕获 LLM 请求体。
function mockLLM(content: string, status = 200) {
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/api/model-settings/resolve/chat')) {
      // 单测无 DB 配置 → 让 getConfig 回退到 env。
      return new Response(JSON.stringify({ success: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    captured = {
      url: u,
      body: JSON.parse(String(init?.body ?? '{}')),
    };
    if (status !== 200) {
      return new Response('upstream error', { status });
    }
    const sse = u.includes('/v1/messages') ? sseAnthropic(content) : sseOpenAI(content);
    return new Response(sse, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as unknown as typeof fetch;
}

describe('/api/script-keywords-generation POST', () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.LLM_API_KEY;
  const originalType = process.env.LLM_API_TYPE;
  const originalUrl = process.env.LLM_API_URL;

  beforeEach(() => {
    captured = null;
    process.env.LLM_API_KEY = 'test-key';
    // 默认 env 形态为 openai（无 LLM_API_TYPE）；anthropic 用例自行覆盖。
    delete process.env.LLM_API_TYPE;
    delete process.env.LLM_API_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    const restore = (name: 'LLM_API_KEY' | 'LLM_API_TYPE' | 'LLM_API_URL', value: string | undefined) => {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    };
    restore('LLM_API_KEY', originalKey);
    restore('LLM_API_TYPE', originalType);
    restore('LLM_API_URL', originalUrl);
    vi.restoreAllMocks();
  });

  it('language:english → outputs ≤3 english keywords and instructs cross-language english output', async () => {
    mockLLM('mountain landscape\ncity skyline at night\nteam meeting');

    const res = await POST(
      makeRequest({
        segmentTitle: '段落一',
        segmentContent: '辽阔的山脉在晨光中铺展，城市天际线在夜色里点亮。',
        taskId: 't1',
        language: 'english',
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    // best-effort ≤3：不断言 ===3（评审 R-2）。
    expect(json.keywords.length).toBeGreaterThanOrEqual(1);
    expect(json.keywords.length).toBeLessThanOrEqual(3);
    expect(json.keywords).toEqual([
      'mountain landscape',
      'city skyline at night',
      'team meeting',
    ]);

    // openai 形态：system 仍在 messages 内。断言英文要求 + 跨语言声明（评审 R-1）。
    const system = captured!.body.messages.find(m => m.role === 'system')!.content;
    const user = captured!.body.messages.find(m => m.role === 'user')!.content;
    expect(system).toContain('ENGLISH');
    expect(user).toContain('ENGLISH');
    expect(user).toContain('Chinese');
  });

  it('strips numbering / bullets / quotes instead of dropping the whole line (R-3)', async () => {
    mockLLM('1. mountain landscape\n- city skyline\n"team meeting"');

    const res = await POST(
      makeRequest({
        segmentTitle: '段落一',
        segmentContent: '画面描述文本',
        taskId: 't2',
        language: 'english',
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    // 旧逻辑会把「1. mountain landscape」整行丢弃；新逻辑剥离前缀后保留。
    expect(json.keywords.length).toBeGreaterThanOrEqual(1);
    expect(json.keywords).toEqual([
      'mountain landscape',
      'city skyline',
      'team meeting',
    ]);
  });

  it('defaults to the chinese prompt when language is omitted (no regression)', async () => {
    mockLLM('商务办公\n团队合作\n现代办公室');

    const res = await POST(
      makeRequest({
        segmentTitle: '段落一',
        segmentContent: '一群同事在现代化办公室里开会。',
        taskId: 't3',
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.keywords).toEqual(['商务办公', '团队合作', '现代办公室']);

    const system = captured!.body.messages.find(m => m.role === 'system')!.content;
    const user = captured!.body.messages.find(m => m.role === 'user')!.content;
    expect(system).toContain('视频制作助手');
    expect(user).toContain('关键词');
    expect(user).not.toContain('ENGLISH');
  });

  it('falls back to the chinese prompt for an invalid language value (R-4)', async () => {
    mockLLM('商务办公\n团队合作');

    const res = await POST(
      makeRequest({
        segmentTitle: '段落一',
        segmentContent: '办公室场景。',
        taskId: 't4',
        language: 'french',
      }),
    );

    // 非法 language 回退中文、不返回 400（评审 R-4）。
    expect(res.status).toBe(200);
    const user = captured!.body.messages.find(m => m.role === 'user')!.content;
    expect(user).toContain('关键词');
    expect(user).not.toContain('ENGLISH');
  });

  it('anthropic config hits /v1/messages and no longer 401s (the fix)', async () => {
    // 复刻桌面端默认生效配置：anthropic 形态、智谱 anthropic-compat 端点。
    process.env.LLM_API_TYPE = 'anthropic';
    process.env.LLM_API_URL = 'https://open.bigmodel.cn/api/anthropic';
    mockLLM('city skyline at night\nneon lights\nrainy street');

    const res = await POST(
      makeRequest({
        segmentTitle: 'city',
        segmentContent: '夜晚的城市天际线灯光闪烁',
        taskId: 'repro',
        language: 'english',
      }),
    );

    // 旧实现硬打 .../anthropic/chat/completions + Bearer → 401；修复后走 /v1/messages → 200。
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.keywords).toEqual([
      'city skyline at night',
      'neon lights',
      'rainy street',
    ]);
    // 命中 anthropic 传输：URL 以 /v1/messages 结尾，且 system 被提到顶层（不在 messages 内）。
    expect(captured!.url.endsWith('/v1/messages')).toBe(true);
    expect(captured!.body.system).toContain('ENGLISH');
    expect(captured!.body.messages.some(m => m.role === 'system')).toBe(false);
    const user = captured!.body.messages.find(m => m.role === 'user')!.content;
    expect(user).toContain('ENGLISH');
  });

  it('passes through a non-2xx upstream status', async () => {
    mockLLM('', 502);

    const res = await POST(
      makeRequest({
        segmentTitle: '段落一',
        segmentContent: '内容',
        taskId: 't5',
        language: 'english',
      }),
    );

    expect(res.status).toBe(502);
  });
});
