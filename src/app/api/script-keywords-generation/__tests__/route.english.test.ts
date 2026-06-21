import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

// 单测：spec narration-direct-ai-video-script-keywords v2 §8.1。
// 覆盖英文分支（评审 R-1 跨语言 / R-2 best-effort ≤3 / R-3 编号鲁棒性）与中文缺省防回归（R-4）。

interface CapturedRequest {
  url: string;
  body: { model: string; messages: Array<{ role: string; content: string }> };
}

let captured: CapturedRequest | null;

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/script-keywords-generation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// mock 上游 LLM：捕获下发的 messages，返回给定 content / status。
function mockLLM(content: string, status = 200) {
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    captured = {
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')),
    };
    if (status !== 200) {
      return new Response('upstream error', { status });
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
}

describe('/api/script-keywords-generation POST', () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.LLM_API_KEY;

  beforeEach(() => {
    captured = null;
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.LLM_API_KEY;
    } else {
      process.env.LLM_API_KEY = originalKey;
    }
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

    // 断言下发给 LLM 的 messages 含英文要求 + 跨语言声明（评审 R-1）。
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
