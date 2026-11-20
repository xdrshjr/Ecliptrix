// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveScriptConfig } from '../scriptConfig';

afterEach(() => vi.unstubAllGlobals());

describe('脚本模型解析取消', () => {
  it.each([
    ['AbortError', 'LLM_CANCELLED', 499],
    ['TimeoutError', 'LLM_TIMEOUT', 504],
  ])('读取响应正文时保留 %s 类别', async (name, code, status) => {
    const controller = new AbortController();
    const reason = new DOMException('fixture body interrupted', name);
    const response = new Response(new ReadableStream({
      pull(body) {
        controller.abort(reason);
        body.error(reason);
      },
    }, { highWaterMark: 0 }), {
      headers: { 'content-type': 'application/json' },
    });
    const fetch = vi.fn(async () => response);
    vi.stubGlobal('fetch', fetch);

    await expect(resolveScriptConfig(controller.signal)).rejects
      .toMatchObject({ code, status });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
